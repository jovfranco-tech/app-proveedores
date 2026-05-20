import type {
  ApiEnvelope,
  AuditLog,
  AuthPayload,
  Category,
  ChatMessage,
  FraudSignal,
  HeatPoint,
  Metrics,
  NotificationEvent,
  PaymentCheckout,
  PaymentRecord,
  Provider,
  RequestStatus,
  Role,
  RuntimeConfig,
  ServiceRequest,
  SupportDocument,
  UploadTarget
} from './types';

type QueryValue = string | number | boolean | undefined | null;

let accessToken = '';

export function setAccessToken(token: string) {
  accessToken = token;
}

async function parseJson<T>(response: Response) {
  return (await response.json().catch(() => null)) as ApiEnvelope<T> | { message?: string } | null;
}

async function apiFetch<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers
  });
  const payload = await parseJson<T>(response);

  if (response.status === 401 && !retried && path !== '/api/auth/refresh' && path !== '/api/auth/login') {
    try {
      const refreshed = await api.refresh();
      accessToken = refreshed.accessToken;
      return apiFetch<T>(path, options, true);
    } catch {
      accessToken = '';
    }
  }

  if (!response.ok) {
    const message = payload && 'message' in payload && payload.message ? payload.message : 'No pudimos completar la accion. Intenta de nuevo.';
    throw new Error(message);
  }

  if (!payload || !('data' in payload)) {
    throw new Error('La respuesta del servidor no tiene el formato esperado.');
  }

  return payload.data;
}

function qs<T extends object>(params: T) {
  const search = new URLSearchParams();
  Object.entries(params as Record<string, QueryValue>).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  });
  const value = search.toString();
  return value ? `?${value}` : '';
}

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

export const api = {
  async login(role: Role, email: string, password = 'Demo123!') {
    const payload = await apiFetch<AuthPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ role, email, password })
    });
    accessToken = payload.accessToken;
    return payload.user;
  },
  async refresh() {
    const payload = await apiFetch<AuthPayload>('/api/auth/refresh', { method: 'POST' }, true);
    accessToken = payload.accessToken;
    return payload;
  },
  logout() {
    accessToken = '';
    return apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },
  config() {
    return apiFetch<RuntimeConfig>('/api/config');
  },
  categories() {
    return apiFetch<Category[]>('/api/categories');
  },
  featuredCategories() {
    return apiFetch<Category[]>('/api/categories/featured');
  },
  notifications(_role: Role) {
    void _role;
    return apiFetch<NotificationEvent[]>('/api/notifications');
  },
  requests(filters: RequestFilters) {
    return apiFetch<ServiceRequest[]>(`/api/requests${qs(filters)}`);
  },
  createRequest(payload: CreateRequestPayload) {
    return apiFetch<ServiceRequest>('/api/requests', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  request(id: string) {
    return apiFetch<ServiceRequest>(`/api/requests/${id}`);
  },
  updateStatus(id: string, _role: Role, status: RequestStatus, label: string) {
    void _role;
    return apiFetch<ServiceRequest>(`/api/requests/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, label })
    });
  },
  quoteRequest(id: string, _providerId: string, amount: number, message: string) {
    return apiFetch<ServiceRequest>(`/api/requests/${id}/quote`, {
      method: 'POST',
      body: JSON.stringify({ amount, message })
    });
  },
  acceptRequest(id: string, _providerId: string, amount: number, message: string) {
    return apiFetch<ServiceRequest>(`/api/requests/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ amount, message })
    });
  },
  messages(id: string) {
    return apiFetch<ChatMessage[]>(`/api/requests/${id}/messages`);
  },
  sendMessage(id: string, _senderRole: Role, _senderName: string, message: string) {
    return apiFetch<ChatMessage>(`/api/requests/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  },
  escrow(id: string, _role: Role, action: 'pay' | 'release' | 'refund', amount?: number) {
    return apiFetch<PaymentCheckout>(`/api/requests/${id}/escrow`, {
      method: 'POST',
      body: JSON.stringify({ action, amount })
    });
  },
  review(id: string, rating: number, comment: string) {
    return apiFetch<ServiceRequest>(`/api/requests/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment })
    });
  },
  dispute(id: string, reason: string) {
    return apiFetch<ServiceRequest>(`/api/requests/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },
  provider(_providerId?: string) {
    void _providerId;
    return apiFetch<Provider>('/api/providers/me');
  },
  providers() {
    return apiFetch<Provider[]>('/api/providers');
  },
  updateProviderLocation(providerId: string, payload: Provider['location']) {
    return apiFetch<Provider>(`/api/providers/${providerId}/location`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  },
  paySubscription(providerId: string, plan: Provider['subscription']['plan'], price: number) {
    return apiFetch<PaymentCheckout>(`/api/providers/${providerId}/subscription/pay`, {
      method: 'POST',
      body: JSON.stringify({ plan, price })
    });
  },
  documents(requestId: string) {
    return apiFetch<SupportDocument[]>(`/api/requests/${requestId}/documents`);
  },
  createDocument(requestId: string, payload: Pick<SupportDocument, 'docType' | 'fileName' | 'fileUrl'>) {
    return apiFetch<SupportDocument>(`/api/requests/${requestId}/documents`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  uploadDocumentTarget(requestId: string, payload: { fileName: string; contentType: string; provider?: 's3' | 'cloudinary' }) {
    return apiFetch<UploadTarget>(`/api/requests/${requestId}/upload-target`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },
  metrics() {
    return apiFetch<Metrics>('/api/admin/metrics');
  },
  disputes() {
    return apiFetch<ServiceRequest[]>('/api/admin/disputes');
  },
  verifyProvider(providerId: string, verified: boolean) {
    return apiFetch<Provider>(`/api/admin/providers/${providerId}/verify`, {
      method: 'PATCH',
      body: JSON.stringify({ verified })
    });
  },
  resolveDispute(requestId: string, resolution: 'release' | 'refund') {
    return apiFetch<ServiceRequest>(`/api/admin/disputes/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolution })
    });
  },
  auditLogs() {
    return apiFetch<AuditLog[]>('/api/admin/audit');
  },
  fraudSignals() {
    return apiFetch<FraudSignal[]>('/api/admin/fraud');
  },
  payments() {
    return apiFetch<PaymentRecord[]>('/api/admin/payments');
  },
  reconcilePayments() {
    return apiFetch<PaymentRecord[]>('/api/admin/payments/reconcile', { method: 'POST' });
  },
  supportDocuments() {
    return apiFetch<SupportDocument[]>('/api/admin/support-documents');
  },
  heatmap() {
    return apiFetch<HeatPoint[]>('/api/insights/heatmap');
  }
};
