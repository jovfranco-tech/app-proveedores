import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  DocumentData,
  QueryConstraint,
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { nanoid } from 'nanoid';
import type {
  AuditLog,
  Category,
  ChatMessage,
  EscrowStatus,
  FraudSignal,
  HeatPoint,
  Metrics,
  NotificationEvent,
  OperationalAlert,
  PaymentCheckout,
  PaymentRecord,
  Provider,
  ProviderVerificationDocument,
  ProviderVerificationRequest,
  RequestStatus,
  Role,
  RuntimeConfig,
  ServiceRequest,
  SupportDocument,
  UserSession
} from '../types';
import { firebaseFunctionsBaseUrl, getFirebaseClient, isFirebaseConfigured } from './client';

export interface RequestFilters {
  role: Role;
  clientId?: string;
  providerId?: string;
  category?: string;
  search?: string;
  maxBudget?: number;
  maxDistance?: number;
}

export interface CreateRequestPayload {
  clientId: string;
  title: string;
  categoryId: string;
  address: string;
  city: string;
  dateTime: string;
  budget: number;
  description: string;
  location?: {
    lat: number;
    lng: number;
  };
}

export interface SignupPayload {
  name: string;
  email: string;
  password: string;
  role: Exclude<Role, 'admin'>;
}

export interface ProviderVerificationPayload {
  providerId: string;
  legalName: string;
  taxId: string;
  address: string;
  notes?: string;
  files: Array<{ docType: ProviderVerificationDocument['docType']; file: File }>;
}

const nowIso = () => new Date().toISOString();

function asData<T>(data: DocumentData | undefined, id: string): T {
  return { id, ...data } as T;
}

function applyRequestFilters(requests: ServiceRequest[], filters: RequestFilters) {
  return requests
    .filter((request) => (filters.category && filters.category !== 'todas' ? request.categoryId === filters.category : true))
    .filter((request) => (filters.search ? `${request.title} ${request.description}`.toLowerCase().includes(filters.search.toLowerCase()) : true))
    .filter((request) => (filters.maxBudget ? request.budget <= filters.maxBudget : true))
    .filter((request) => (filters.maxDistance ? request.distanceKm <= filters.maxDistance : true))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

async function listCollection<T>(path: string, constraints: QueryConstraint[] = []) {
  const { db } = getFirebaseClient();
  const snapshot = await getDocs(query(collection(db, path), ...constraints));
  return snapshot.docs.map((item) => asData<T>(item.data(), item.id));
}

async function getById<T>(path: string, id: string) {
  const { db } = getFirebaseClient();
  const snapshot = await getDoc(doc(db, path, id));
  if (!snapshot.exists()) throw new Error('No encontramos el registro solicitado.');
  return asData<T>(snapshot.data(), snapshot.id);
}

async function profileFromUser(user: User, expectedRole?: Role): Promise<UserSession> {
  const { db } = getFirebaseClient();
  const snapshot = await getDoc(doc(db, 'users', user.uid));
  if (!snapshot.exists()) {
    if (expectedRole === 'admin') {
      throw new Error('El rol admin debe ser asignado por una operacion privilegiada.');
    }
    const role: Exclude<Role, 'admin'> = expectedRole === 'proveedor' ? 'proveedor' : 'cliente';
    const providerId = role === 'proveedor' ? `prov_${user.uid}` : undefined;
    const fallbackProfile: UserSession = {
      id: user.uid,
      name: user.displayName ?? user.email?.split('@')[0] ?? 'Usuario',
      email: user.email ?? '',
      role,
      providerId
    };
    await setDoc(doc(db, 'users', user.uid), {
      ...fallbackProfile,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      onboardingComplete: false
    });
    if (providerId) await createProviderProfile(fallbackProfile, providerId);
    return fallbackProfile;
  }

  const profile = asData<UserSession>(snapshot.data(), snapshot.id);
  if (expectedRole && profile.role !== expectedRole) {
    throw new Error(`Esta cuenta esta registrada como ${profile.role}, no como ${expectedRole}.`);
  }
  return profile;
}

async function createProviderProfile(user: UserSession, providerId: string) {
  const { db } = getFirebaseClient();
  await setDoc(doc(db, 'providers', providerId), {
    name: user.name,
    ownerUid: user.id,
    trade: 'Proveedor de servicios locales',
    categoryIds: [],
    verified: false,
    rating: 0,
    jobsCompleted: 0,
    subscription: {
      plan: 'Basico',
      status: 'pendiente',
      renewalDate: '',
      price: 299
    },
    location: {
      lat: 19.4328,
      lng: -99.1333,
      address: 'Ciudad de Mexico'
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

async function callPrivileged<T>(path: string, body: Record<string, unknown>) {
  if (!firebaseFunctionsBaseUrl) {
    throw new Error('Configura VITE_FIREBASE_FUNCTIONS_BASE_URL para ejecutar pagos o acciones privilegiadas.');
  }
  const { auth } = getFirebaseClient();
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Inicia sesion para continuar.');

  const response = await fetch(`${firebaseFunctionsBaseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = (await response.json().catch(() => null)) as { data?: T; message?: string } | null;
  if (!response.ok) throw new Error(payload?.message ?? 'La operacion privilegiada no pudo completarse.');
  if (!payload?.data) throw new Error('La funcion no regreso el formato esperado.');
  return payload.data;
}

export const firebaseRepository = {
  isConfigured: isFirebaseConfigured,

  onSessionChanged(callback: (session: UserSession | null) => void) {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      callback(user ? await profileFromUser(user) : null);
    });
  },

  async currentSession() {
    const { auth } = getFirebaseClient();
    const user = await new Promise<User | null>((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
        unsubscribe();
        resolve(nextUser);
      });
    });
    return user ? profileFromUser(user) : null;
  },

  async login(role: Role, email: string, password: string) {
    const { auth } = getFirebaseClient();
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return profileFromUser(credential.user, role);
  },

  async signup(payload: SignupPayload) {
    const { auth, db } = getFirebaseClient();
    const credential = await createUserWithEmailAndPassword(auth, payload.email, payload.password);
    await updateProfile(credential.user, { displayName: payload.name });
    const providerId = payload.role === 'proveedor' ? `prov_${credential.user.uid}` : undefined;
    const session: UserSession = {
      id: credential.user.uid,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      providerId
    };
    await setDoc(doc(db, 'users', credential.user.uid), {
      ...session,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      onboardingComplete: false
    });
    if (providerId) await createProviderProfile(session, providerId);
    return session;
  },

  async logout() {
    const { auth } = getFirebaseClient();
    await signOut(auth);
    return { ok: true };
  },

  async config(): Promise<RuntimeConfig> {
    return {
      mapboxToken: import.meta.env.VITE_MAPBOX_TOKEN as string | undefined,
      paymentProvider: 'local',
      sseReplay: false,
      services: {
        firebase: true,
        firebaseStorage: true,
        privilegedFunctions: Boolean(firebaseFunctionsBaseUrl)
      }
    };
  },

  categories() {
    return listCollection<Category>('categories', [orderBy('name', 'asc')]);
  },

  async featuredCategories() {
    const categories = await listCollection<Category>('categories', [where('featured', '==', true), limit(8)]);
    return categories.sort((a, b) => a.name.localeCompare(b.name));
  },

  async notifications(role: Role) {
    const own = await listCollection<NotificationEvent>('notifications', [where('role', 'in', [role, 'todos']), orderBy('createdAt', 'desc'), limit(30)]);
    return own;
  },

  async requests(filters: RequestFilters) {
    if (filters.role === 'admin') {
      return listCollection<ServiceRequest>('serviceRequests', [orderBy('createdAt', 'desc')]);
    }
    if (filters.role === 'cliente') {
      return listCollection<ServiceRequest>('serviceRequests', [where('clientId', '==', filters.clientId ?? ''), orderBy('createdAt', 'desc')]);
    }

    const providerId = filters.providerId ?? '';
    const [open, assigned] = await Promise.all([
      listCollection<ServiceRequest>('serviceRequests', [where('status', 'in', ['abierta', 'cotizada']), limit(50)]),
      listCollection<ServiceRequest>('serviceRequests', [where('providerId', '==', providerId), limit(50)])
    ]);
    return applyRequestFilters([...new Map([...open, ...assigned].map((request) => [request.id, request])).values()], filters);
  },

  async createRequest(payload: CreateRequestPayload) {
    const { db } = getFirebaseClient();
    const createdAt = nowIso();
    const request: Omit<ServiceRequest, 'id'> = {
      ...payload,
      distanceKm: 0,
      status: 'abierta',
      createdAt,
      timeline: [
        {
          id: nanoid(),
          status: 'abierta',
          label: 'Solicitud publicada para proveedores verificados.',
          actor: 'cliente',
          createdAt
        }
      ],
      escrow: {
        amount: 0,
        status: 'sin_pago'
      }
    };
    const created = await addDoc(collection(db, 'serviceRequests'), request);
    return { id: created.id, ...request };
  },

  request(id: string) {
    return getById<ServiceRequest>('serviceRequests', id);
  },

  async updateStatus(id: string, role: Role, status: RequestStatus, label: string) {
    const { db } = getFirebaseClient();
    const event = { id: nanoid(), status, label, actor: role, createdAt: nowIso() };
    await updateDoc(doc(db, 'serviceRequests', id), {
      status,
      timeline: arrayUnion(event),
      updatedAt: nowIso()
    });
    return this.request(id);
  },

  async quoteRequest(id: string, providerId: string, amount: number, message: string) {
    const { db } = getFirebaseClient();
    const provider = await this.provider(providerId);
    const createdAt = nowIso();
    await addDoc(collection(db, 'quotes'), {
      requestId: id,
      providerId,
      amount,
      message,
      status: 'sent',
      createdAt
    });
    await updateDoc(doc(db, 'serviceRequests', id), {
      providerId,
      status: 'cotizada',
      quote: { providerId, amount, message },
      timeline: arrayUnion({
        id: nanoid(),
        status: 'cotizada',
        label: `${provider.name} envio una cotizacion por ${new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount)}.`,
        actor: 'proveedor',
        createdAt
      }),
      updatedAt: createdAt
    });
    return this.request(id);
  },

  async acceptRequest(id: string, providerId: string, amount: number, message: string) {
    const { db } = getFirebaseClient();
    const provider = await this.provider(providerId);
    const createdAt = nowIso();
    await updateDoc(doc(db, 'serviceRequests', id), {
      providerId,
      status: 'aceptada',
      quote: { providerId, amount, message },
      escrow: { amount, status: 'sin_pago' as EscrowStatus },
      timeline: arrayUnion({
        id: nanoid(),
        status: 'aceptada',
        label: `${provider.name} acepto el trabajo. El pago debe confirmarse por checkout o webhook antes de retener escrow.`,
        actor: 'proveedor',
        createdAt
      }),
      updatedAt: createdAt
    });
    return this.request(id);
  },

  messages(id: string) {
    return listCollection<ChatMessage>('messages', [where('requestId', '==', id), orderBy('createdAt', 'asc')]);
  },

  async sendMessage(id: string, senderRole: Role, senderName: string, message: string) {
    const { auth, db } = getFirebaseClient();
    if (!auth.currentUser) throw new Error('Inicia sesion para enviar mensajes.');
    const created: Omit<ChatMessage, 'id'> & { senderId: string } = {
      requestId: id,
      senderId: auth.currentUser.uid,
      senderRole,
      senderName,
      message,
      createdAt: nowIso()
    };
    const result = await addDoc(collection(db, 'messages'), created);
    return { id: result.id, ...created };
  },

  escrow(id: string, role: Role, action: 'pay' | 'release' | 'refund', amount?: number) {
    return callPrivileged<PaymentCheckout>('/payments/escrow', { requestId: id, role, action, amount });
  },

  async review(id: string, rating: number, comment: string) {
    const { db } = getFirebaseClient();
    await addDoc(collection(db, 'reviews'), { requestId: id, rating, comment, createdAt: nowIso() });
    await updateDoc(doc(db, 'serviceRequests', id), { review: { rating, comment }, updatedAt: nowIso() });
    return this.request(id);
  },

  async dispute(id: string, reason: string) {
    const { db } = getFirebaseClient();
    await addDoc(collection(db, 'disputes'), { requestId: id, reason, status: 'abierta', createdAt: nowIso() });
    await updateDoc(doc(db, 'serviceRequests', id), {
      status: 'disputa',
      dispute: { reason, status: 'abierta' },
      timeline: arrayUnion({ id: nanoid(), status: 'disputa', label: 'Cliente abrio disputa con evidencia.', actor: 'cliente', createdAt: nowIso() }),
      updatedAt: nowIso()
    });
    return this.request(id);
  },

  async provider(providerId?: string) {
    if (providerId) return getById<Provider>('providers', providerId);
    const session = await this.currentSession();
    if (!session?.providerId) throw new Error('Esta cuenta no tiene perfil de proveedor.');
    return getById<Provider>('providers', session.providerId);
  },

  providers() {
    return listCollection<Provider>('providers', [orderBy('name', 'asc')]);
  },

  async updateProviderLocation(providerId: string, location: Provider['location']) {
    const { db } = getFirebaseClient();
    await updateDoc(doc(db, 'providers', providerId), { location, updatedAt: nowIso() });
    return this.provider(providerId);
  },

  paySubscription(providerId: string, plan: Provider['subscription']['plan'], price: number) {
    return callPrivileged<PaymentCheckout>('/payments/subscription', { providerId, plan, price });
  },

  documents(requestId: string) {
    return listCollection<SupportDocument>('supportDocuments', [where('requestId', '==', requestId), orderBy('createdAt', 'desc')]);
  },

  async createDocument(requestId: string, payload: Pick<SupportDocument, 'docType' | 'fileName' | 'fileUrl'>) {
    const { auth, db } = getFirebaseClient();
    if (!auth.currentUser) throw new Error('Inicia sesion para adjuntar documentos.');
    const documentPayload: Omit<SupportDocument, 'id'> = {
      requestId,
      uploadedBy: auth.currentUser.uid,
      reviewStatus: 'pendiente',
      storageProvider: 'url',
      uploadStatus: 'attached',
      createdAt: nowIso(),
      ...payload
    };
    const result = await addDoc(collection(db, 'supportDocuments'), documentPayload);
    return { id: result.id, ...documentPayload };
  },

  async uploadDocumentFile(requestId: string, file: File) {
    const { auth, db, storage } = getFirebaseClient();
    if (!auth.currentUser) throw new Error('Inicia sesion para subir archivos.');
    const documentId = nanoid();
    const objectKey = `supportDocuments/${requestId}/${documentId}/${file.name}`;
    const storageRef = ref(storage, objectKey);
    await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
      customMetadata: { requestId, uploadedBy: auth.currentUser.uid }
    });
    const fileUrl = await getDownloadURL(storageRef);
    const documentPayload: Omit<SupportDocument, 'id'> = {
      requestId,
      uploadedBy: auth.currentUser.uid,
      docType: 'evidencia',
      fileName: file.name,
      fileUrl,
      reviewStatus: 'pendiente',
      storageProvider: 'url',
      objectKey,
      uploadStatus: 'uploaded',
      createdAt: nowIso()
    };
    await setDoc(doc(db, 'supportDocuments', documentId), documentPayload);
    return { id: documentId, ...documentPayload };
  },

  async providerVerification(providerId: string) {
    try {
      return await getById<ProviderVerificationRequest>('providerVerificationRequests', providerId);
    } catch {
      return null;
    }
  },

  async submitProviderVerification(payload: ProviderVerificationPayload) {
    const { auth, db, storage } = getFirebaseClient();
    if (!auth.currentUser) throw new Error('Inicia sesion para enviar verificacion.');
    const requestId = payload.providerId;
    const createdAt = nowIso();
    const documents: ProviderVerificationDocument[] = [];

    for (const item of payload.files) {
      const documentId = nanoid();
      const objectKey = `providerKyc/${payload.providerId}/${documentId}/${item.file.name}`;
      const storageRef = ref(storage, objectKey);
      await uploadBytes(storageRef, item.file, {
        contentType: item.file.type || 'application/octet-stream',
        customMetadata: { providerId: payload.providerId, uploadedBy: auth.currentUser.uid, docType: item.docType }
      });
      documents.push({
        id: documentId,
        docType: item.docType,
        fileName: item.file.name,
        fileUrl: await getDownloadURL(storageRef),
        objectKey,
        uploadedAt: nowIso()
      });
    }

    const verification: ProviderVerificationRequest = {
      id: requestId,
      providerId: payload.providerId,
      ownerUid: auth.currentUser.uid,
      legalName: payload.legalName,
      taxId: payload.taxId,
      address: payload.address,
      notes: payload.notes,
      status: 'pendiente',
      documents,
      createdAt,
      updatedAt: createdAt
    };

    await setDoc(doc(db, 'providerVerificationRequests', requestId), verification);
    return verification;
  },

  async metrics(): Promise<Metrics> {
    const [requests, providers] = await Promise.all([this.requests({ role: 'admin' }), this.providers()]);
    return {
      activeRequests: requests.filter((request) => request.status !== 'cerrada').length,
      activeProviders: providers.filter((provider) => provider.subscription.status === 'activa').length,
      escrowBalance: requests.reduce((total, request) => total + (request.escrow.status === 'retenido' ? request.escrow.amount : 0), 0),
      disputesOpen: requests.filter((request) => request.dispute?.status === 'abierta').length,
      conversionRate: requests.length ? Math.round((requests.filter((request) => request.status === 'cerrada').length / requests.length) * 100) : 0
    };
  },

  disputes() {
    return listCollection<ServiceRequest>('serviceRequests', [where('status', '==', 'disputa'), orderBy('createdAt', 'desc')]);
  },

  async verifyProvider(providerId: string, verified: boolean) {
    return callPrivileged<Provider>('/admin/providers/verify', { providerId, verified });
  },

  async resolveDispute(requestId: string, resolution: 'release' | 'refund') {
    return callPrivileged<ServiceRequest>('/admin/disputes/resolve', { requestId, resolution });
  },

  auditLogs() {
    return listCollection<AuditLog>('auditLogs', [orderBy('createdAt', 'desc'), limit(50)]);
  },

  fraudSignals() {
    return listCollection<FraudSignal>('fraudSignals', [orderBy('createdAt', 'desc'), limit(50)]);
  },

  payments() {
    return listCollection<PaymentRecord>('payments', [orderBy('createdAt', 'desc'), limit(50)]);
  },

  reconcilePayments() {
    return callPrivileged<PaymentRecord[]>('/admin/payments/reconcile', {});
  },

  supportDocuments() {
    return listCollection<SupportDocument>('supportDocuments', [orderBy('createdAt', 'desc'), limit(50)]);
  },

  providerVerifications() {
    return listCollection<ProviderVerificationRequest>('providerVerificationRequests', [orderBy('createdAt', 'desc'), limit(50)]);
  },

  reviewProviderVerification(providerId: string, status: 'aprobado' | 'rechazado', reason?: string) {
    return callPrivileged<ProviderVerificationRequest>('/admin/provider-verifications/review', { providerId, status, reason });
  },

  async operationalAlerts() {
    const [disputes, verifications, payments, fraudSignals] = await Promise.all([
      this.disputes(),
      this.providerVerifications(),
      this.payments(),
      this.fraudSignals()
    ]);
    const now = nowIso();
    const alerts: OperationalAlert[] = [];
    const pendingKyc = verifications.filter((item) => item.status === 'pendiente');
    if (pendingKyc.length) {
      alerts.push({
        id: 'kyc_pending',
        severity: pendingKyc.length > 5 ? 'critical' : 'warning',
        title: 'KYC pendiente',
        message: `${pendingKyc.length} proveedor(es) esperan revision documental.`,
        source: 'kyc',
        status: 'open',
        createdAt: now
      });
    }
    if (disputes.length) {
      alerts.push({
        id: 'disputes_open',
        severity: disputes.length > 3 ? 'critical' : 'warning',
        title: 'Disputas abiertas',
        message: `${disputes.length} caso(s) requieren resolucion de soporte.`,
        source: 'disputes',
        status: 'open',
        createdAt: now
      });
    }
    if (payments.some((payment) => payment.status === 'requires_action')) {
      alerts.push({
        id: 'payments_requires_action',
        severity: 'info',
        title: 'Pagos esperando confirmacion',
        message: 'Hay checkouts creados que aun no han sido confirmados por webhook.',
        source: 'payments',
        status: 'open',
        createdAt: now
      });
    }
    if (fraudSignals.some((signal) => signal.score >= 75)) {
      alerts.push({
        id: 'fraud_high_score',
        severity: 'critical',
        title: 'Senales antifraude altas',
        message: 'Hay solicitudes con score antifraude elevado.',
        source: 'security',
        status: 'open',
        createdAt: now
      });
    }
    return alerts;
  },

  async heatmap() {
    return listCollection<HeatPoint>('runtimeConfig', [orderBy('label', 'asc'), limit(40)]);
  }
};
