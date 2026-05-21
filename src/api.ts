import { nanoid } from 'nanoid';
import {
  categories as seedCategories,
  chatMessages as seedMessages,
  heatPoints as seedHeatPoints,
  metrics as seedMetrics,
  notifications as seedNotifications,
  providers as seedProviders,
  requests as seedRequests,
  sessions as seedSessions
} from '../server/seed';
import { isFirebaseConfigured } from './firebase/client';
import { CreateRequestPayload, ProviderVerificationPayload, RequestFilters, SignupPayload, firebaseRepository } from './firebase/repository';
import type {
  AuditLog,
  ChatMessage,
  EscrowStatus,
  FraudSignal,
  OperationalAlert,
  PaymentCheckout,
  PaymentRecord,
  Provider,
  ProviderVerificationRequest,
  RequestStatus,
  Role,
  RuntimeConfig,
  ServiceRequest,
  SupportDocument,
  UserSession
} from './types';

export type { CreateRequestPayload, ProviderVerificationPayload, RequestFilters, SignupPayload };

const nowIso = () => new Date().toISOString();

let demoSession: UserSession | null = null;
const demoRequests = seedRequests.map((request) => ({ ...request, timeline: [...request.timeline] }));
const demoMessages = seedMessages.map((message) => ({ ...message }));
const demoProviders = seedProviders.map((provider) => ({ ...provider }));
const demoDocuments: SupportDocument[] = [];
const demoPayments: PaymentRecord[] = [];
const demoAuditLogs: AuditLog[] = [];
const demoVerifications: ProviderVerificationRequest[] = [];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertDemoSession() {
  if (!demoSession) throw new Error('Inicia sesión para continuar.');
  return demoSession;
}

function ensureRequest(id: string) {
  const request = demoRequests.find((item) => item.id === id);
  if (!request) throw new Error('No encontramos la solicitud.');
  return request;
}

function ensureProvider(id: string) {
  const provider = demoProviders.find((item) => item.id === id);
  if (!provider) throw new Error('No encontramos el proveedor.');
  return provider;
}

function pushAudit(action: string, entityType: string, entityId?: string, metadata: Record<string, unknown> = {}) {
  const session = demoSession;
  demoAuditLogs.unshift({
    id: nanoid(),
    actorUserId: session?.id,
    actorRole: session?.role,
    action,
    entityType,
    entityId,
    metadata,
    createdAt: nowIso()
  });
}

function visibleDemoRequests(filters: RequestFilters) {
  let visible = demoRequests;
  if (filters.role === 'cliente') visible = visible.filter((request) => request.clientId === filters.clientId);
  if (filters.role === 'proveedor') {
    visible = visible.filter((request) => request.status === 'abierta' || request.providerId === filters.providerId);
  }
  if (filters.category && filters.category !== 'todas') visible = visible.filter((request) => request.categoryId === filters.category);
  if (filters.search) {
    const search = filters.search.toLowerCase();
    visible = visible.filter((request) => `${request.title} ${request.description}`.toLowerCase().includes(search));
  }
  if (filters.maxBudget) visible = visible.filter((request) => request.budget <= Number(filters.maxBudget));
  if (filters.maxDistance) visible = visible.filter((request) => request.distanceKm <= Number(filters.maxDistance));
  return clone(visible.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)));
}

const demoApi = {
  isConfigured: () => false,

  onSessionChanged(callback: (session: UserSession | null) => void) {
    window.setTimeout(() => callback(demoSession), 0);
    return () => undefined;
  },

  async currentSession() {
    return demoSession ? clone(demoSession) : null;
  },

  async login(role: Role, email: string, password = 'Demo123!') {
    const session = seedSessions[role];
    if (email !== session.email || password !== 'Demo123!') {
      throw new Error('En modo demo usa las cuentas sembradas y password Demo123!.');
    }
    demoSession = clone(session);
    return clone(session);
  },

  async signup(payload: SignupPayload) {
    const providerId = payload.role === 'proveedor' ? `prov_${nanoid(8)}` : undefined;
    const session: UserSession = {
      id: `usr_${nanoid(10)}`,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      providerId
    };
    if (providerId) {
      demoProviders.unshift({
        id: providerId,
        name: payload.name,
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
          address: 'Ciudad de México'
        }
      });
    }
    demoSession = session;
    pushAudit('demo.signup', 'user', session.id, { role: session.role });
    return clone(session);
  },

  async logout() {
    demoSession = null;
    return { ok: true };
  },

  async config(): Promise<RuntimeConfig> {
    return {
      mapboxToken: import.meta.env.VITE_MAPBOX_TOKEN as string | undefined,
      paymentProvider: 'local',
      sseReplay: false,
      services: {
        demoMode: true,
        firebase: false
      }
    };
  },

  async categories() {
    return clone(seedCategories);
  },

  async featuredCategories() {
    return clone(seedCategories.filter((category) => category.featured));
  },

  async notifications(role: Role) {
    return clone(seedNotifications.filter((notification) => notification.role === role || notification.role === 'todos'));
  },

  async requests(filters: RequestFilters) {
    assertDemoSession();
    return visibleDemoRequests(filters);
  },

  async createRequest(payload: CreateRequestPayload) {
    assertDemoSession();
    const createdAt = nowIso();
    const request: ServiceRequest = {
      id: `req_${nanoid(10)}`,
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
      escrow: { amount: 0, status: 'sin_pago' }
    };
    demoRequests.unshift(request);
    pushAudit('request.created', 'serviceRequest', request.id);
    return clone(request);
  },

  async request(id: string) {
    assertDemoSession();
    return clone(ensureRequest(id));
  },

  async updateStatus(id: string, role: Role, status: RequestStatus, label: string) {
    assertDemoSession();
    const request = ensureRequest(id);
    request.status = status;
    request.timeline.push({ id: nanoid(), status, label, actor: role, createdAt: nowIso() });
    pushAudit('request.status.updated', 'serviceRequest', id, { status });
    return clone(request);
  },

  async quoteRequest(id: string, providerId: string, amount: number, message: string) {
    assertDemoSession();
    const request = ensureRequest(id);
    request.providerId = providerId;
    request.status = 'cotizada';
    request.quote = { providerId, amount, message };
    request.timeline.push({ id: nanoid(), status: 'cotizada', label: 'Proveedor envió una cotización.', actor: 'proveedor', createdAt: nowIso() });
    pushAudit('quote.created', 'serviceRequest', id, { providerId, amount });
    return clone(request);
  },

  async acceptRequest(id: string, providerId: string, amount: number, message: string) {
    assertDemoSession();
    const request = ensureRequest(id);
    request.providerId = providerId;
    request.status = 'aceptada';
    request.quote = { providerId, amount, message };
    request.escrow = { amount, status: 'sin_pago' };
    request.timeline.push({ id: nanoid(), status: 'aceptada', label: 'Proveedor aceptó el trabajo y preparó el escrow.', actor: 'proveedor', createdAt: nowIso() });
    pushAudit('request.accepted', 'serviceRequest', id, { providerId, amount });
    return clone(request);
  },

  async messages(id: string) {
    assertDemoSession();
    return clone(demoMessages.filter((message) => message.requestId === id));
  },

  async sendMessage(id: string, senderRole: Role, senderName: string, message: string) {
    assertDemoSession();
    const created: ChatMessage = { id: nanoid(), requestId: id, senderRole, senderName, message, createdAt: nowIso() };
    demoMessages.push(created);
    return clone(created);
  },

  async escrow(id: string, role: Role, action: 'pay' | 'release' | 'refund', amount?: number) {
    assertDemoSession();
    const request = ensureRequest(id);
    const nextStatus: EscrowStatus = action === 'pay' ? 'retenido' : action === 'release' ? 'liberado' : 'reembolsado';
    const payment: PaymentRecord = {
      id: `pay_${nanoid(10)}`,
      kind: 'escrow',
      requestId: id,
      providerId: request.providerId,
      userId: demoSession?.id,
      provider: 'local',
      amount: (amount ?? request.escrow.amount) || request.quote?.amount || request.budget,
      currency: 'MXN',
      status: action === 'refund' ? 'refunded' : 'paid',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    request.escrow = { amount: payment.amount, status: nextStatus };
    request.timeline.push({ id: nanoid(), status: action === 'refund' ? 'reembolso' : request.status, label: `Escrow actualizado por ${role}.`, actor: role, createdAt: nowIso() });
    demoPayments.unshift(payment);
    pushAudit(`escrow.${action}`, 'serviceRequest', id, { paymentId: payment.id });
    return clone({ payment, request } satisfies PaymentCheckout);
  },

  async review(id: string, rating: number, comment: string) {
    assertDemoSession();
    const request = ensureRequest(id);
    request.review = { rating, comment };
    pushAudit('review.created', 'serviceRequest', id, { rating });
    return clone(request);
  },

  async dispute(id: string, reason: string) {
    assertDemoSession();
    const request = ensureRequest(id);
    request.status = 'disputa';
    request.dispute = { reason, status: 'abierta' };
    request.timeline.push({ id: nanoid(), status: 'disputa', label: 'Cliente abrió disputa con evidencia.', actor: 'cliente', createdAt: nowIso() });
    pushAudit('dispute.created', 'serviceRequest', id);
    return clone(request);
  },

  async provider(providerId?: string) {
    const session = assertDemoSession();
    return clone(ensureProvider(providerId ?? session.providerId ?? 'prov_1'));
  },

  async providers() {
    assertDemoSession();
    return clone(demoProviders);
  },

  async updateProviderLocation(providerId: string, location: Provider['location']) {
    assertDemoSession();
    const provider = ensureProvider(providerId);
    provider.location = location;
    pushAudit('provider.location.updated', 'provider', providerId);
    return clone(provider);
  },

  async paySubscription(providerId: string, plan: Provider['subscription']['plan'], price: number) {
    assertDemoSession();
    const provider = ensureProvider(providerId);
    provider.subscription = { plan, status: 'activa', renewalDate: '2026-06-20', price };
    const payment: PaymentRecord = {
      id: `pay_${nanoid(10)}`,
      kind: 'subscription',
      providerId,
      provider: 'local',
      amount: price,
      currency: 'MXN',
      status: 'paid',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    demoPayments.unshift(payment);
    return clone({ payment, provider } satisfies PaymentCheckout);
  },

  async documents(requestId: string) {
    assertDemoSession();
    return clone(demoDocuments.filter((document) => document.requestId === requestId));
  },

  async createDocument(requestId: string, payload: Pick<SupportDocument, 'docType' | 'fileName' | 'fileUrl'>) {
    const session = assertDemoSession();
    const document: SupportDocument = {
      id: `doc_${nanoid(10)}`,
      requestId,
      uploadedBy: session.id,
      reviewStatus: 'pendiente',
      storageProvider: 'url',
      uploadStatus: 'attached',
      createdAt: nowIso(),
      ...payload
    };
    demoDocuments.unshift(document);
    pushAudit('supportDocument.created', 'supportDocument', document.id, { requestId });
    return clone(document);
  },

  async uploadDocumentFile(requestId: string, file: File) {
    return this.createDocument(requestId, {
      docType: 'evidencia',
      fileName: file.name,
      fileUrl: URL.createObjectURL(file)
    });
  },

  async providerVerification(providerId: string) {
    assertDemoSession();
    return clone(demoVerifications.find((item) => item.providerId === providerId) ?? null);
  },

  async submitProviderVerification(payload: ProviderVerificationPayload) {
    const session = assertDemoSession();
    const verification: ProviderVerificationRequest = {
      id: payload.providerId,
      providerId: payload.providerId,
      ownerUid: session.id,
      legalName: payload.legalName,
      taxId: payload.taxId,
      address: payload.address,
      notes: payload.notes,
      status: 'pendiente',
      documents: payload.files.map((item) => ({
        id: `kyc_${nanoid(8)}`,
        docType: item.docType,
        fileName: item.file.name,
        fileUrl: URL.createObjectURL(item.file),
        objectKey: `demo/${payload.providerId}/${item.file.name}`,
        uploadedAt: nowIso()
      })),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const existingIndex = demoVerifications.findIndex((item) => item.providerId === payload.providerId);
    if (existingIndex >= 0) demoVerifications.splice(existingIndex, 1, verification);
    else demoVerifications.unshift(verification);
    pushAudit('providerVerification.submitted', 'provider', payload.providerId);
    return clone(verification);
  },

  async metrics() {
    const activeRequests = demoRequests.filter((request) => request.status !== 'cerrada').length;
    const escrowBalance = demoRequests.reduce((total, request) => total + (request.escrow.status === 'retenido' ? request.escrow.amount : 0), 0);
    return clone({ ...seedMetrics, activeRequests, activeProviders: demoProviders.length, escrowBalance });
  },

  async disputes() {
    assertDemoSession();
    return clone(demoRequests.filter((request) => request.status === 'disputa'));
  },

  async verifyProvider(providerId: string, verified: boolean) {
    assertDemoSession();
    const provider = ensureProvider(providerId);
    provider.verified = verified;
    pushAudit('provider.verified.updated', 'provider', providerId, { verified });
    return clone(provider);
  },

  async resolveDispute(requestId: string, resolution: 'release' | 'refund') {
    assertDemoSession();
    const request = ensureRequest(requestId);
    if (request.dispute) request.dispute.status = 'resuelta';
    request.status = resolution === 'release' ? 'cerrada' : 'reembolso';
    request.escrow.status = resolution === 'release' ? 'liberado' : 'reembolsado';
    pushAudit('dispute.resolved', 'serviceRequest', requestId, { resolution });
    return clone(request);
  },

  async auditLogs() {
    assertDemoSession();
    return clone(demoAuditLogs);
  },

  async fraudSignals() {
    const signals: FraudSignal[] = demoRequests
      .filter((request) => request.dispute || (request.fraudScore ?? 0) > 50)
      .map((request) => ({
        id: `fraud_${request.id}`,
        requestId: request.id,
        requestTitle: request.title,
        score: request.fraudScore ?? 70,
        reason: request.dispute ? 'Solicitud en disputa con evidencia pendiente.' : 'Patron operativo requiere revisión.',
        createdAt: request.createdAt
      }));
    return clone(signals);
  },

  async payments() {
    assertDemoSession();
    return clone(demoPayments);
  },

  async reconcilePayments() {
    assertDemoSession();
    pushAudit('payments.reconciled', 'payment');
    return clone(demoPayments);
  },

  async supportDocuments() {
    assertDemoSession();
    return clone(demoDocuments);
  },

  async providerVerifications() {
    assertDemoSession();
    return clone(demoVerifications);
  },

  async reviewProviderVerification(providerId: string, status: 'aprobado' | 'rechazado', reason?: string) {
    assertDemoSession();
    const verification = demoVerifications.find((item) => item.providerId === providerId);
    if (!verification) throw new Error('No encontramos la verificación.');
    verification.status = status;
    verification.rejectionReason = reason;
    verification.reviewedAt = nowIso();
    verification.updatedAt = nowIso();
    ensureProvider(providerId).verified = status === 'aprobado';
    pushAudit('providerVerification.reviewed', 'provider', providerId, { status });
    return clone(verification);
  },

  async operationalAlerts() {
    const alerts: OperationalAlert[] = [];
    const pendingKyc = demoVerifications.filter((item) => item.status === 'pendiente');
    const disputes = demoRequests.filter((request) => request.status === 'disputa');
    if (pendingKyc.length) {
      alerts.push({
        id: 'demo_kyc_pending',
        severity: 'warning',
        title: 'KYC pendiente',
        message: `${pendingKyc.length} proveedor(es) esperan revisión.`,
        source: 'kyc',
        status: 'open',
        createdAt: nowIso()
      });
    }
    if (disputes.length) {
      alerts.push({
        id: 'demo_disputes_open',
        severity: 'warning',
        title: 'Disputas abiertas',
        message: `${disputes.length} caso(s) requieren soporte.`,
        source: 'disputes',
        status: 'open',
        createdAt: nowIso()
      });
    }
    return clone(alerts);
  },

  async heatmap() {
    return clone(seedHeatPoints);
  }
};

export const api = isFirebaseConfigured() ? firebaseRepository : demoApi;

export function usingFirebaseBackend() {
  return isFirebaseConfigured();
}
