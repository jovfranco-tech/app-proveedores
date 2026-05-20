export type Role = 'cliente' | 'proveedor' | 'admin';

export type RequestStatus =
  | 'abierta'
  | 'cotizada'
  | 'aceptada'
  | 'en_camino'
  | 'en_progreso'
  | 'pendiente_pago'
  | 'cerrada'
  | 'disputa'
  | 'reembolso';

export type EscrowStatus = 'sin_pago' | 'retenido' | 'liberado' | 'reembolsado';

export type SubscriptionStatus = 'activa' | 'vencida' | 'pendiente';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  accent: string;
  averagePrice: number;
  emergency: boolean;
  featured: boolean;
}

export interface ServiceRequest {
  id: string;
  title: string;
  categoryId: string;
  clientId: string;
  providerId?: string;
  address: string;
  city: string;
  dateTime: string;
  budget: number;
  distanceKm: number;
  status: RequestStatus;
  description: string;
  location?: {
    lat: number;
    lng: number;
  };
  createdAt: string;
  timeline: TimelineEvent[];
  escrow: {
    amount: number;
    status: EscrowStatus;
  };
  quote?: {
    providerId: string;
    amount: number;
    message: string;
  };
  review?: {
    rating: number;
    comment: string;
  };
  dispute?: {
    reason: string;
    status: 'abierta' | 'resuelta';
  };
  fraudScore?: number;
}

export interface TimelineEvent {
  id: string;
  status: RequestStatus;
  label: string;
  actor: Role;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  requestId: string;
  senderRole: Role;
  senderName: string;
  message: string;
  createdAt: string;
}

export interface Provider {
  id: string;
  name: string;
  trade: string;
  categoryIds: string[];
  verified: boolean;
  rating: number;
  jobsCompleted: number;
  subscription: {
    plan: 'Basico' | 'Pro' | 'Elite';
    status: SubscriptionStatus;
    renewalDate: string;
    price: number;
  };
  location: {
    lat: number;
    lng: number;
    address: string;
  };
}

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: Role;
  providerId?: string;
}

export interface AuthPayload {
  user: UserSession;
  accessToken: string;
  expiresAt: string;
}

export interface NotificationEvent {
  id: string;
  title: string;
  message: string;
  role: Role | 'todos';
  createdAt: string;
}

export interface Metrics {
  activeRequests: number;
  activeProviders: number;
  escrowBalance: number;
  disputesOpen: number;
  conversionRate: number;
}

export interface HeatPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  intensity: number;
  categoryId: string;
}

export interface PaymentRecord {
  id: string;
  kind: 'escrow' | 'subscription';
  requestId?: string;
  providerId?: string;
  userId?: string;
  provider: 'local' | 'stripe' | 'mercadopago';
  providerRef?: string;
  amount: number;
  currency: 'MXN';
  status: 'pending' | 'requires_action' | 'paid' | 'failed' | 'refunded';
  checkoutUrl?: string;
  rawPayload?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentCheckout {
  payment: PaymentRecord;
  request?: ServiceRequest;
  provider?: Provider;
}

export interface AuditLog {
  id: string;
  actorUserId?: string;
  actorRole?: Role;
  action: string;
  entityType: string;
  entityId?: string;
  metadata: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: string;
}

export interface SupportDocument {
  id: string;
  requestId: string;
  uploadedBy: string;
  docType: 'foto' | 'factura' | 'identificacion' | 'contrato' | 'evidencia';
  fileName: string;
  fileUrl: string;
  reviewStatus: 'pendiente' | 'aprobado' | 'rechazado';
  storageProvider?: 'url' | 's3' | 'cloudinary';
  objectKey?: string;
  uploadStatus?: 'pending' | 'uploaded' | 'attached';
  createdAt: string;
}

export interface FraudSignal {
  id: string;
  requestId: string;
  requestTitle: string;
  score: number;
  reason: string;
  createdAt: string;
}

export interface RuntimeConfig {
  mapboxToken?: string;
  paymentProvider: 'local' | 'stripe' | 'mercadopago';
  sseReplay: boolean;
  services?: Record<string, boolean>;
}

export interface UploadTarget {
  provider: 's3' | 'cloudinary';
  uploadUrl?: string;
  publicUrl?: string;
  objectKey: string;
  fields?: Record<string, string | number>;
  expiresInSeconds: number;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiError {
  message: string;
}
