import {
  Activity,
  BadgeCheck,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  Filter,
  LayoutDashboard,
  LockKeyhole,
  LogIn,
  LogOut,
  Map,
  MapPin,
  MessageCircle,
  Navigation,
  Search,
  SendHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  UserPlus,
  UsersRound,
  Wrench
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { api, CreateRequestPayload, ProviderVerificationPayload, RequestFilters, SignupPayload, usingFirebaseBackend } from './api';
import { ServiceRequestForm } from './components/ServiceRequestForm';
import { addAppBreadcrumb, captureAppError, setObservabilityUser, trackRoleNavigation } from './observability';
import type {
  AuditLog,
  Category,
  ChatMessage,
  FraudSignal,
  HeatPoint,
  Metrics,
  NotificationEvent as AppNotification,
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
} from './types';

type View = 'home' | 'catalogo' | 'cliente' | 'proveedor' | 'detalle' | 'admin' | 'mapa';
type Toast = { type: 'success' | 'error' | 'info'; message: string };

const roleLabels: Record<Role, string> = {
  cliente: 'Cliente',
  proveedor: 'Proveedor',
  admin: 'Admin'
};

const demoEmails: Record<Role, string> = {
  cliente: 'cliente@conectapro.mx',
  proveedor: 'proveedor@conectapro.mx',
  admin: 'admin@conectapro.mx'
};

const statusLabels: Record<RequestStatus, string> = {
  abierta: 'Abierta',
  cotizada: 'Cotizada',
  aceptada: 'Aceptada',
  en_camino: 'En camino',
  en_progreso: 'En progreso',
  pendiente_pago: 'Pendiente de pago',
  cerrada: 'Cerrada',
  disputa: 'En disputa',
  reembolso: 'Reembolso'
};

const statusTone: Record<RequestStatus, string> = {
  abierta: 'info',
  cotizada: 'warning',
  aceptada: 'success',
  en_camino: 'info',
  en_progreso: 'success',
  pendiente_pago: 'warning',
  cerrada: 'neutral',
  disputa: 'danger',
  reembolso: 'neutral'
};

const moneyFormatter = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short'
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

function getCategory(categories: Category[], id: string) {
  return categories.find((category) => category.id === id);
}

function lonLatToTile(lng: number, lat: number, zoom: number) {
  const scale = 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

function categoryPhotoStyle(category: Category): CSSProperties {
  return {
    backgroundImage: `url("${category.image}")`,
    backgroundPosition: 'center'
  };
}

function routeForRole(role: Role): View {
  return role === 'cliente' ? 'cliente' : role === 'proveedor' ? 'proveedor' : 'admin';
}

function isViewAllowed(session: UserSession | null, view: View) {
  if (!session) return view === 'home' || view === 'catalogo' || view === 'mapa';
  if (view === 'cliente') return session.role === 'cliente';
  if (view === 'proveedor') return session.role === 'proveedor';
  if (view === 'admin') return session.role === 'admin';
  return true;
}

function LoadingBlock({ label = 'Cargando informacion...' }: { label?: string }) {
  return (
    <div className="state-block" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <Sparkles aria-hidden="true" size={24} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-banner" role="alert">
      <strong>No pudimos cargar esta seccion.</strong>
      <span>{message}</span>
      {onRetry ? (
        <button className="ghost-button" type="button" onClick={onRetry}>
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: RequestStatus }) {
  return <span className={`pill ${statusTone[status]}`}>{statusLabels[status]}</span>;
}

function AppHeader({
  session,
  activeView,
  notifications,
  onNavigate,
  onLogout
}: {
  session: UserSession | null;
  activeView: View;
  notifications: AppNotification[];
  onNavigate: (view: View) => void;
  onLogout: () => void;
}) {
  const navItems: Array<{ view: View; label: string; icon: ElementType; roles?: Role[] }> = [
    { view: 'home', label: 'Inicio', icon: LayoutDashboard },
    { view: 'catalogo', label: 'Catalogo', icon: Wrench },
    { view: 'cliente', label: 'Cliente', icon: UsersRound, roles: ['cliente'] },
    { view: 'proveedor', label: 'Proveedor', icon: ShieldCheck, roles: ['proveedor'] },
    { view: 'admin', label: 'Admin', icon: Activity, roles: ['admin'] },
    { view: 'mapa', label: 'Mapa', icon: Map }
  ];

  return (
    <header className="app-header">
      <a className="brand" href="#home" onClick={() => onNavigate('home')} aria-label="Ir al inicio de App Proveedores">
        <span className="brand-mark" aria-hidden="true">
          CP
        </span>
        <span>
          <strong>App Proveedores</strong>
          <small>Servicios verificados</small>
        </span>
      </a>
      <nav className="top-nav" aria-label="Navegacion principal">
        {navItems
          .filter((item) => !item.roles || (session && item.roles.includes(session.role)))
          .map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.view}
                className={activeView === item.view ? 'active' : ''}
                type="button"
                onClick={() => onNavigate(item.view)}
              >
                <Icon aria-hidden="true" size={17} />
                {item.label}
              </button>
            );
          })}
      </nav>
      <div className="header-status" aria-live="polite">
        <Bell aria-hidden="true" size={18} />
        <span>{notifications.length}</span>
        <strong>{session ? roleLabels[session.role] : usingFirebaseBackend() ? 'Sin sesion' : 'Demo local'}</strong>
        {session ? (
          <button className="icon-header-button" type="button" onClick={onLogout} aria-label="Cerrar sesion">
            <LogOut aria-hidden="true" size={17} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function HomeView({
  featured,
  categories,
  session,
  metrics,
  runtimeConfig,
  onNavigate,
  onLogin,
  onSignup
}: {
  featured: Category[];
  categories: Category[];
  session: UserSession | null;
  metrics: Metrics | null;
  runtimeConfig: RuntimeConfig | null;
  onNavigate: (view: View) => void;
  onLogin: (role: Role, email: string, password: string) => Promise<void>;
  onSignup: (payload: SignupPayload) => Promise<void>;
}) {
  return (
    <>
      <section className="hero" id="home" aria-labelledby="hero-title">
        <div className="hero-content">
          <span className="eyebrow">
            <BadgeCheck aria-hidden="true" size={18} />
            Marketplace premium para servicios locales
          </span>
          <h1 id="hero-title">App Proveedores</h1>
          <p>
            Clientes publican trabajos con presupuesto protegido. Proveedores con suscripcion activa reciben solicitudes cercanas,
            aceptan, conversan y cobran al cierre.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={() => onNavigate(session?.role ? routeForRole(session.role) : 'cliente')}>
              <SendHorizontal aria-hidden="true" size={18} />
              Publicar o aceptar trabajo
            </button>
            <button className="secondary-button" type="button" onClick={() => onNavigate('catalogo')}>
              Ver categorias
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
          <dl className="hero-stats" aria-label="Indicadores operativos">
            <div>
              <dt>{metrics ? metrics.activeRequests : 42}</dt>
              <dd>solicitudes activas</dd>
            </div>
            <div>
              <dt>{metrics ? metrics.activeProviders : 318}</dt>
              <dd>proveedores</dd>
            </div>
            <div>
              <dt>{metrics ? `${metrics.conversionRate}%` : '68%'}</dt>
              <dd>conversion a cierre</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="content-section auth-section" aria-labelledby="login-title">
        <div>
          <p className="section-kicker">Acceso por rol</p>
          <h2 id="login-title">Opera como cliente, proveedor o admin</h2>
        </div>
        <AuthPanel session={session} runtimeConfig={runtimeConfig} onLogin={onLogin} onSignup={onSignup} />
      </section>

      <section className="content-section" aria-labelledby="featured-title">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Servicios destacados</p>
            <h2 id="featured-title">Categorias con mayor demanda hoy</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => onNavigate('catalogo')}>
            Abrir catalogo
          </button>
        </div>
        <div className="featured-carousel" aria-label="Carrusel de servicios destacados">
          {featured.map((category) => (
            <article className="featured-card" key={category.id}>
              <div
                className="photo-tile"
                role="img"
                aria-label={`Trabajo profesional de ${category.name}`}
                style={categoryPhotoStyle(category)}
              />
              <div className="featured-card-body">
                <span style={{ backgroundColor: category.accent }} />
                <h3>{category.name}</h3>
                <p>{category.description}</p>
                <strong>{formatMoney(category.averagePrice)} promedio</strong>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section compact-catalog" aria-label="Vista rapida de categorias">
        {categories.slice(0, 4).map((category) => (
          <button className="category-chip" key={category.id} type="button" onClick={() => onNavigate('catalogo')}>
            <span style={{ backgroundColor: category.accent }} aria-hidden="true" />
            {category.name}
          </button>
        ))}
      </section>
    </>
  );
}

function AuthPanel({
  session,
  runtimeConfig,
  onLogin,
  onSignup
}: {
  session: UserSession | null;
  runtimeConfig: RuntimeConfig | null;
  onLogin: (role: Role, email: string, password: string) => Promise<void>;
  onSignup: (payload: SignupPayload) => Promise<void>;
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [role, setRole] = useState<Role>(session?.role ?? 'cliente');
  const [name, setName] = useState(session?.name ?? '');
  const [email, setEmail] = useState(demoEmails[session?.role ?? 'cliente']);
  const [password, setPassword] = useState('Demo123!');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) {
      setRole(session.role);
      setEmail(session.email);
      setName(session.name);
    }
  }, [session]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (role === 'admin') throw new Error('El rol admin se asigna desde una operacion privilegiada.');
        await onSignup({ name, email, password, role });
      } else {
        await onLogin(role, email, password);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-panel" onSubmit={submit} aria-label="Inicio de sesion por rol">
      <div className="segmented" role="group" aria-label="Modo de acceso">
        <button className={mode === 'login' ? 'active' : ''} type="button" aria-label="Usar modo entrar" onClick={() => setMode('login')}>
          Entrar
        </button>
        <button className={mode === 'signup' ? 'active' : ''} type="button" aria-label="Usar modo crear cuenta" onClick={() => setMode('signup')}>
          Crear cuenta
        </button>
      </div>
      <div className="segmented" role="group" aria-label="Selecciona rol">
        {(['cliente', 'proveedor', ...(mode === 'login' ? ['admin' as Role] : [])] as Role[]).map((item) => (
          <button
            key={item}
            className={role === item ? 'active' : ''}
            type="button"
            onClick={() => {
              setRole(item);
              if (!usingFirebaseBackend()) setEmail(demoEmails[item]);
            }}
          >
            {roleLabels[item]}
          </button>
        ))}
      </div>
      {mode === 'signup' ? (
        <label>
          Nombre
          <input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      ) : null}
      <label>
        Correo
        <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Contraseña
        <input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button className="primary-button" type="submit" disabled={busy} aria-label={mode === 'signup' ? 'Enviar formulario para crear cuenta' : 'Enviar formulario para entrar'}>
        {mode === 'signup' ? <UserPlus aria-hidden="true" size={18} /> : <LogIn aria-hidden="true" size={18} />}
        {mode === 'signup' ? 'Crear cuenta' : 'Entrar'}
      </button>
      <p className="auth-mode-note">
        {usingFirebaseBackend()
          ? 'Firebase Auth activo. El rol admin requiere asignacion segura.'
          : 'Modo demo local: cliente/proveedor/admin usan Demo123!.'}
      </p>
      {runtimeConfig?.services?.googleOAuth || runtimeConfig?.services?.appleOAuth ? (
        <div className="oauth-actions" aria-label="Inicio de sesion OAuth">
          {runtimeConfig.services.googleOAuth ? (
            <a className="secondary-button" href="/api/auth/oauth/google/start">
              Google
            </a>
          ) : null}
          {runtimeConfig.services.appleOAuth ? (
            <a className="secondary-button" href="/api/auth/oauth/apple/start">
              Apple
            </a>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function CatalogView({
  categories,
  session,
  onNavigate
}: {
  categories: Category[];
  session: UserSession | null;
  onNavigate: (view: View) => void;
}) {
  return (
    <section className="content-section" aria-labelledby="catalog-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Catalogo visual</p>
          <h2 id="catalog-title">Categorias con proveedores especializados</h2>
        </div>
        <button className="secondary-button" type="button" onClick={() => onNavigate(session ? routeForRole(session.role) : 'home')}>
          {session?.role === 'proveedor' ? 'Ver solicitudes' : 'Crear solicitud'}
        </button>
      </div>
      <div className="category-grid">
        {categories.map((category) => (
          <article className="category-card" key={category.id}>
            <div
              className="photo-tile"
              role="img"
              aria-label={`Servicio profesional de ${category.name}`}
              style={categoryPhotoStyle(category)}
            />
            <div className="category-card-body">
              <span className="category-accent" style={{ backgroundColor: category.accent }} />
              <div>
                <h3>{category.name}</h3>
                <p>{category.description}</p>
              </div>
              <dl>
                <div>
                  <dt>Promedio</dt>
                  <dd>{formatMoney(category.averagePrice)}</dd>
                </div>
                <div>
                  <dt>Urgencia</dt>
                  <dd>{category.emergency ? 'Alta' : 'Programada'}</dd>
                </div>
              </dl>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RequestListCard({
  request,
  category,
  actions
}: {
  request: ServiceRequest;
  category?: Category;
  actions: ReactNode;
}) {
  return (
    <article className="request-card">
      <div className="request-card-main">
        <span className="service-tag" style={{ borderColor: category?.accent }}>
          {category?.name ?? 'Servicio'}
        </span>
        <h3>{request.title}</h3>
        <p>{request.description}</p>
        <div className="meta-row">
          <span>
            <CalendarClock aria-hidden="true" size={16} />
            {formatDate(request.dateTime)}
          </span>
          <span>
            <MapPin aria-hidden="true" size={16} />
            {request.address}
          </span>
          <span>
            <Navigation aria-hidden="true" size={16} />
            {request.distanceKm.toFixed(1)} km
          </span>
        </div>
      </div>
      <div className="request-card-side">
        <StatusPill status={request.status} />
        <strong>{formatMoney(request.budget)}</strong>
        {actions}
      </div>
    </article>
  );
}

function ClientPanel({
  session,
  categories,
  requests,
  loading,
  busy,
  onCreate,
  onOpenDetail
}: {
  session: UserSession;
  categories: Category[];
  requests: ServiceRequest[];
  loading: boolean;
  busy: boolean;
  onCreate: (payload: CreateRequestPayload) => Promise<void>;
  onOpenDetail: (id: string) => void;
}) {
  const active = requests.filter((request) => request.status !== 'cerrada');

  return (
    <section className="dashboard-shell" aria-labelledby="client-title">
      <div className="dashboard-hero">
        <div>
          <p className="section-kicker">Panel cliente</p>
          <h2 id="client-title">Publica solicitudes y controla pagos protegidos</h2>
        </div>
        <div className="mini-metrics">
          <div>
            <strong>{active.length}</strong>
            <span>activas</span>
          </div>
          <div>
            <strong>{requests.length}</strong>
            <span>publicadas</span>
          </div>
        </div>
      </div>
      <div className="dashboard-grid">
        <section className="workspace-panel" aria-labelledby="new-request-title">
          <h3 id="new-request-title">Nueva solicitud</h3>
          <ServiceRequestForm categories={categories} clientId={session.id} busy={busy} onCreate={onCreate} />
        </section>
        <section className="workspace-panel" aria-labelledby="my-posts-title">
          <h3 id="my-posts-title">Mis publicaciones</h3>
          {loading ? <LoadingBlock /> : null}
          {!loading && requests.length === 0 ? (
            <EmptyState title="Aun no hay publicaciones" text="Tu primera solicitud aparecera aqui con seguimiento y pagos." />
          ) : null}
          <div className="request-stack">
            {requests.map((request) => (
              <RequestListCard
                key={request.id}
                request={request}
                category={getCategory(categories, request.categoryId)}
                actions={
                  <button className="ghost-button" type="button" onClick={() => onOpenDetail(request.id)}>
                    Ver detalle
                  </button>
                }
              />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function ProviderPanel({
  provider,
  verification,
  categories,
  requests,
  filters,
  loading,
  busy,
  onFiltersChange,
  onApplyFilters,
  onPayPlan,
  onUpdateLocation,
  onSubmitVerification,
  onAccept,
  onQuote,
  onOpenDetail
}: {
  provider: Provider | null;
  verification: ProviderVerificationRequest | null;
  categories: Category[];
  requests: ServiceRequest[];
  filters: RequestFilters;
  loading: boolean;
  busy: boolean;
  onFiltersChange: (filters: RequestFilters) => void;
  onApplyFilters: () => void;
  onPayPlan: (plan: Provider['subscription']['plan'], price: number) => void;
  onUpdateLocation: (address: string) => void;
  onSubmitVerification: (payload: ProviderVerificationPayload) => void;
  onAccept: (request: ServiceRequest) => void;
  onQuote: (request: ServiceRequest) => void;
  onOpenDetail: (id: string) => void;
}) {
  const [location, setLocation] = useState(provider?.location.address ?? '');

  useEffect(() => {
    setLocation(provider?.location.address ?? '');
  }, [provider]);

  return (
    <section className="dashboard-shell" aria-labelledby="provider-title">
      <div className="dashboard-hero">
        <div>
          <p className="section-kicker">Panel proveedor</p>
          <h2 id="provider-title">Solicitudes abiertas para proveedores activos</h2>
        </div>
        <div className="mini-metrics">
          <div>
            <strong>{requests.length}</strong>
            <span>oportunidades</span>
          </div>
          <div>
            <strong>{provider?.rating.toFixed(1) ?? '4.8'}</strong>
            <span>rating</span>
          </div>
        </div>
      </div>
      <div className="provider-layout">
        <aside className="workspace-panel sidebar-panel" aria-label="Suscripcion y ubicacion">
          {provider ? (
            <>
              <div className="plan-block">
                <span className={`pill ${provider.subscription.status === 'activa' ? 'success' : 'warning'}`}>
                  {provider.subscription.status}
                </span>
                <h3>Plan {provider.subscription.plan}</h3>
                <p>Renueva el {provider.subscription.renewalDate}</p>
                <strong>{formatMoney(provider.subscription.price)} / mes</strong>
                <button className="primary-button" type="button" disabled={busy} onClick={() => onPayPlan('Pro', 499)}>
                  <CreditCard aria-hidden="true" size={18} />
                  Pagar suscripcion
                </button>
              </div>
              <form
                className="location-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onUpdateLocation(location);
                }}
              >
                <label>
                  Ubicacion de trabajo
                  <input value={location} onChange={(event) => setLocation(event.target.value)} />
                </label>
                <button className="secondary-button" type="submit" disabled={busy}>
                  <MapPin aria-hidden="true" size={18} />
                  Actualizar
                </button>
              </form>
              <ProviderKycPanel provider={provider} verification={verification} busy={busy} onSubmitVerification={onSubmitVerification} />
            </>
          ) : (
            <LoadingBlock label="Cargando proveedor..." />
          )}
        </aside>

        <section className="workspace-panel" aria-labelledby="open-requests-title">
          <div className="panel-heading">
            <h3 id="open-requests-title">Solicitudes abiertas</h3>
            <Filter aria-hidden="true" size={20} />
          </div>
          <div className="filters-grid">
            <label>
              Categoria
              <select value={filters.category ?? 'todas'} onChange={(event) => onFiltersChange({ ...filters, category: event.target.value })}>
                <option value="todas">Todas</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Busqueda
              <span className="input-icon">
                <Search aria-hidden="true" size={18} />
                <input value={filters.search ?? ''} onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })} />
              </span>
            </label>
            <label>
              Presupuesto max.
              <input
                type="number"
                min={200}
                value={filters.maxBudget ?? 8000}
                onChange={(event) => onFiltersChange({ ...filters, maxBudget: Number(event.target.value) })}
              />
            </label>
            <label>
              Distancia max. km
              <input
                type="number"
                min={1}
                value={filters.maxDistance ?? 25}
                onChange={(event) => onFiltersChange({ ...filters, maxDistance: Number(event.target.value) })}
              />
            </label>
            <button className="secondary-button" type="button" onClick={onApplyFilters}>
              <SlidersHorizontal aria-hidden="true" size={18} />
              Aplicar filtros
            </button>
          </div>
          {loading ? <LoadingBlock /> : null}
          {!loading && requests.length === 0 ? (
            <EmptyState title="No hay trabajos con estos filtros" text="Ajusta categoria, presupuesto o distancia para ampliar oportunidades." />
          ) : null}
          <div className="request-stack">
            {requests.map((request) => (
              <RequestListCard
                key={request.id}
                request={request}
                category={getCategory(categories, request.categoryId)}
                actions={
                  <>
                    <button className="primary-button compact" type="button" disabled={busy} onClick={() => onAccept(request)}>
                      Aceptar
                    </button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => onQuote(request)}>
                      Cotizar
                    </button>
                    <button className="ghost-button" type="button" onClick={() => onOpenDetail(request.id)}>
                      Detalle
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function ProviderKycPanel({
  provider,
  verification,
  busy,
  onSubmitVerification
}: {
  provider: Provider;
  verification: ProviderVerificationRequest | null;
  busy: boolean;
  onSubmitVerification: (payload: ProviderVerificationPayload) => void;
}) {
  const [legalName, setLegalName] = useState(verification?.legalName ?? provider.name);
  const [taxId, setTaxId] = useState(verification?.taxId ?? '');
  const [address, setAddress] = useState(verification?.address ?? provider.location.address);
  const [notes, setNotes] = useState(verification?.notes ?? '');
  const [files, setFiles] = useState<ProviderVerificationPayload['files']>([]);

  useEffect(() => {
    setLegalName(verification?.legalName ?? provider.name);
    setTaxId(verification?.taxId ?? '');
    setAddress(verification?.address ?? provider.location.address);
    setNotes(verification?.notes ?? '');
  }, [provider, verification]);

  function setDocFile(docType: ProviderVerificationDocument['docType'], file?: File) {
    setFiles((current) => [...current.filter((item) => item.docType !== docType), ...(file ? [{ docType, file }] : [])]);
  }

  const canSubmit = legalName.trim().length > 2 && taxId.trim().length >= 12 && address.trim().length > 6 && files.length >= 2;
  const status = verification?.status ?? (provider.verified ? 'aprobado' : 'sin_enviar');

  return (
    <form
      className="kyc-form"
      aria-label="Verificacion documental de proveedor"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmitVerification({ providerId: provider.id, legalName, taxId, address, notes, files });
      }}
    >
      <div className="panel-heading">
        <h3>KYC proveedor</h3>
        <span className={`pill ${status === 'aprobado' ? 'success' : status === 'rechazado' ? 'danger' : status === 'pendiente' ? 'warning' : 'neutral'}`}>
          {status}
        </span>
      </div>
      <p>Sube identificacion y RFC/comprobante para verificacion real por admin.</p>
      <label>
        Nombre legal
        <input required minLength={3} value={legalName} onChange={(event) => setLegalName(event.target.value)} />
      </label>
      <label>
        RFC
        <input required minLength={12} maxLength={13} value={taxId} onChange={(event) => setTaxId(event.target.value.toUpperCase())} />
      </label>
      <label>
        Domicilio fiscal
        <input required minLength={7} value={address} onChange={(event) => setAddress(event.target.value)} />
      </label>
      <label>
        Notas para revision
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <label>
        Identificacion oficial
        <input required={!verification} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setDocFile('identificacion', event.target.files?.[0])} />
      </label>
      <label>
        RFC o comprobante
        <input required={!verification} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => setDocFile('rfc', event.target.files?.[0])} />
      </label>
      {verification?.rejectionReason ? <p className="error-text">Motivo de rechazo: {verification.rejectionReason}</p> : null}
      <button className="secondary-button" disabled={busy || !canSubmit} type="submit">
        Enviar KYC
      </button>
    </form>
  );
}

function DetailView({
  session,
  request,
  messages,
  documents,
  categories,
  loading,
  busy,
  onStatus,
  onEscrow,
  onSendMessage,
  onCreateDocument,
  onUploadDocument,
  onReview,
  onDispute,
  onQuote,
  onAccept
}: {
  session: UserSession;
  request: ServiceRequest | null;
  messages: ChatMessage[];
  documents: SupportDocument[];
  categories: Category[];
  loading: boolean;
  busy: boolean;
  onStatus: (status: RequestStatus, label: string) => void;
  onEscrow: (action: 'pay' | 'release' | 'refund') => void;
  onSendMessage: (message: string) => void;
  onCreateDocument: (payload: Pick<SupportDocument, 'docType' | 'fileName' | 'fileUrl'>) => void;
  onUploadDocument: (file: File) => void;
  onReview: (rating: number, comment: string) => void;
  onDispute: (reason: string) => void;
  onQuote: (request: ServiceRequest) => void;
  onAccept: (request: ServiceRequest) => void;
}) {
  const [chatText, setChatText] = useState('');
  const [reviewText, setReviewText] = useState('Servicio puntual y con buena comunicacion.');
  const [disputeText, setDisputeText] = useState('Necesito revision porque el servicio no quedo como se acordo.');
  const [docUrl, setDocUrl] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);

  if (loading) return <LoadingBlock label="Cargando detalle..." />;
  if (!request) return <EmptyState title="Selecciona una solicitud" text="Abre una publicacion para ver timeline, chat y pagos." />;

  const category = getCategory(categories, request.categoryId);
  const canProviderAct = session.role === 'proveedor' && ['abierta', 'cotizada', 'aceptada', 'en_camino', 'en_progreso'].includes(request.status);
  const canClientPay = session.role === 'cliente' && request.escrow.status === 'sin_pago' && (request.quote || request.status === 'cotizada');
  const canClientRelease = session.role === 'cliente' && request.escrow.status === 'retenido';

  return (
    <section className="detail-shell" aria-labelledby="detail-title">
      <div className="detail-hero">
        <div>
          <span className="service-tag" style={{ borderColor: category?.accent }}>
            {category?.name ?? 'Servicio'}
          </span>
          <h2 id="detail-title">{request.title}</h2>
          <p>{request.description}</p>
        </div>
        <div className="detail-summary">
          <StatusPill status={request.status} />
          <strong>{formatMoney(request.quote?.amount ?? request.budget)}</strong>
          <span>{request.address}</span>
        </div>
      </div>

      <div className="detail-grid">
        <section className="workspace-panel" aria-labelledby="timeline-title">
          <h3 id="timeline-title">Timeline de estados</h3>
          <ol className="timeline">
            {request.timeline.map((event) => (
              <li key={event.id}>
                <span aria-hidden="true" />
                <div>
                  <strong>{statusLabels[event.status]}</strong>
                  <p>{event.label}</p>
                  <small>
                    {roleLabels[event.actor]} · {formatDate(event.createdAt)}
                  </small>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="workspace-panel" aria-labelledby="actions-title">
          <h3 id="actions-title">Acciones disponibles</h3>
          <div className="action-stack">
            {canProviderAct ? (
              <>
                <button className="secondary-button" disabled={busy} type="button" onClick={() => onQuote(request)}>
                  <CircleDollarSign aria-hidden="true" size={18} />
                  Enviar cotizacion
                </button>
                <button className="primary-button" disabled={busy} type="button" onClick={() => onAccept(request)}>
                  <CheckCircle2 aria-hidden="true" size={18} />
                  Aceptar trabajo
                </button>
                <button className="ghost-button" disabled={busy} type="button" onClick={() => onStatus('en_camino', 'Proveedor va en camino al domicilio.')}>
                  Marcar en camino
                </button>
                <button className="ghost-button" disabled={busy} type="button" onClick={() => onStatus('en_progreso', 'Proveedor inicio el trabajo en sitio.')}>
                  Iniciar trabajo
                </button>
                <button className="ghost-button" disabled={busy} type="button" onClick={() => onStatus('pendiente_pago', 'Proveedor solicito liberacion de pago.')}>
                  Solicitar pago
                </button>
              </>
            ) : null}
            {canClientPay ? (
              <button className="primary-button" disabled={busy} type="button" onClick={() => onEscrow('pay')}>
                <LockKeyhole aria-hidden="true" size={18} />
                Pagar en escrow
              </button>
            ) : null}
            {canClientRelease ? (
              <button className="primary-button" disabled={busy} type="button" onClick={() => onEscrow('release')}>
                <CreditCard aria-hidden="true" size={18} />
                Liberar pago
              </button>
            ) : null}
            {session.role === 'admin' && request.escrow.status === 'retenido' ? (
              <>
                <button className="primary-button" disabled={busy} type="button" onClick={() => onEscrow('release')}>
                  Liberar como admin
                </button>
                <button className="danger-button" disabled={busy} type="button" onClick={() => onEscrow('refund')}>
                  Reembolsar
                </button>
              </>
            ) : null}
            {session.role === 'cliente' ? (
              <>
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onReview(5, reviewText);
                  }}
                >
                  <label>
                    Resena
                    <textarea value={reviewText} onChange={(event) => setReviewText(event.target.value)} />
                  </label>
                  <button className="secondary-button" disabled={busy} type="submit">
                    <Star aria-hidden="true" size={18} />
                    Enviar resena
                  </button>
                </form>
                <form
                  className="inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onDispute(disputeText);
                  }}
                >
                  <label>
                    Disputa
                    <textarea value={disputeText} onChange={(event) => setDisputeText(event.target.value)} />
                  </label>
                  <button className="danger-button" disabled={busy} type="submit">
                    Abrir disputa
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </section>

        <section className="workspace-panel" aria-labelledby="escrow-title">
          <h3 id="escrow-title">Escrow</h3>
          <div className="escrow-box">
            <CircleDollarSign aria-hidden="true" size={28} />
            <div>
              <strong>{formatMoney(request.escrow.amount || request.quote?.amount || request.budget)}</strong>
              <span>{request.escrow.status.replace('_', ' ')}</span>
            </div>
          </div>
          {request.review ? (
            <div className="review-box">
              <strong>{request.review.rating}/5</strong>
              <p>{request.review.comment}</p>
            </div>
          ) : null}
          {request.dispute ? (
            <div className="dispute-box">
              <strong>Disputa {request.dispute.status}</strong>
              <p>{request.dispute.reason}</p>
            </div>
          ) : null}
          <div className="document-box">
            <h4>Soporte documental</h4>
            {documents.length === 0 ? <p className="muted">Aun no hay evidencias cargadas.</p> : null}
            {documents.map((doc) => (
              <a key={doc.id} href={doc.fileUrl} target="_blank" rel="noreferrer">
                {doc.fileName} · {doc.reviewStatus}
              </a>
            ))}
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!docUrl.trim()) return;
                onCreateDocument({
                  docType: 'evidencia',
                  fileName: 'Evidencia del servicio',
                  fileUrl: docUrl
                });
                setDocUrl('');
              }}
            >
              <label>
                URL de evidencia
                <input value={docUrl} onChange={(event) => setDocUrl(event.target.value)} placeholder="https://..." />
              </label>
              <button className="secondary-button" disabled={busy} type="submit">
                Adjuntar
              </button>
            </form>
            <form
              className="inline-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (docFile) onUploadDocument(docFile);
                setDocFile(null);
              }}
            >
              <label>
                Subir archivo
                <input type="file" onChange={(event) => setDocFile(event.target.files?.[0] ?? null)} />
              </label>
              <button className="secondary-button" disabled={busy || !docFile} type="submit">
                Subir evidencia
              </button>
            </form>
          </div>
        </section>

        <section className="workspace-panel chat-panel" aria-labelledby="chat-title">
          <h3 id="chat-title">Chat</h3>
          <div className="messages" aria-live="polite">
            {messages.length === 0 ? <p className="muted">Aun no hay mensajes en esta solicitud.</p> : null}
            {messages.map((message) => (
              <div className={`message ${message.senderRole === session.role ? 'mine' : ''}`} key={message.id}>
                <strong>{message.senderName}</strong>
                <p>{message.message}</p>
                <small>{formatDate(message.createdAt)}</small>
              </div>
            ))}
          </div>
          <form
            className="chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!chatText.trim()) return;
              onSendMessage(chatText);
              setChatText('');
            }}
          >
            <label className="sr-only" htmlFor="chat-message">
              Mensaje
            </label>
            <input
              id="chat-message"
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              placeholder="Escribe un mensaje"
            />
            <button className="primary-button icon-only" disabled={busy} type="submit" aria-label="Enviar mensaje">
              <MessageCircle aria-hidden="true" size={18} />
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}

function AdminPanel({
  metrics,
  providers,
  disputes,
  auditLogs,
  fraudSignals,
  payments,
  supportDocuments,
  providerVerifications,
  operationalAlerts,
  categories,
  loading,
  busy,
  onVerify,
  onResolve,
  onReviewVerification,
  onReconcile,
  onOpenDetail
}: {
  metrics: Metrics | null;
  providers: Provider[];
  disputes: ServiceRequest[];
  auditLogs: AuditLog[];
  fraudSignals: FraudSignal[];
  payments: PaymentRecord[];
  supportDocuments: SupportDocument[];
  providerVerifications: ProviderVerificationRequest[];
  operationalAlerts: OperationalAlert[];
  categories: Category[];
  loading: boolean;
  busy: boolean;
  onVerify: (provider: Provider) => void;
  onResolve: (request: ServiceRequest, resolution: 'release' | 'refund') => void;
  onReviewVerification: (providerId: string, status: 'aprobado' | 'rechazado', reason?: string) => void;
  onReconcile: () => void;
  onOpenDetail: (id: string) => void;
}) {
  return (
    <section className="dashboard-shell" aria-labelledby="admin-title">
      <div className="dashboard-hero">
        <div>
          <p className="section-kicker">Panel admin</p>
          <h2 id="admin-title">Operacion, verificacion y disputas</h2>
        </div>
        <ShieldCheck aria-hidden="true" size={34} />
      </div>
      {loading ? <LoadingBlock /> : null}
      <div className="metric-grid" aria-label="Metricas">
        <MetricCard label="Solicitudes activas" value={metrics?.activeRequests ?? 0} />
        <MetricCard label="Proveedores activos" value={metrics?.activeProviders ?? 0} />
        <MetricCard label="Escrow retenido" value={formatMoney(metrics?.escrowBalance ?? 0)} />
        <MetricCard label="Disputas abiertas" value={metrics?.disputesOpen ?? 0} />
      </div>
      <section className="workspace-panel alerts-panel" aria-labelledby="alerts-title">
        <div className="panel-heading">
          <h3 id="alerts-title">Alertas operativas</h3>
          <Activity aria-hidden="true" size={20} />
        </div>
        {operationalAlerts.length === 0 ? <p className="muted">Sin alertas abiertas. El tablero operativo se ve saludable.</p> : null}
        <div className="ops-list">
          {operationalAlerts.map((alert) => (
            <article className={`alert-row ${alert.severity}`} key={alert.id}>
              <strong>{alert.title}</strong>
              <p>{alert.message}</p>
              <small>{alert.source} · {alert.severity}</small>
            </article>
          ))}
        </div>
      </section>
      <div className="admin-grid">
        <section className="workspace-panel" aria-labelledby="verify-title">
          <h3 id="verify-title">Verificar proveedores</h3>
          <div className="provider-list">
            {providers.map((provider) => (
              <article key={provider.id} className="provider-row">
                <div>
                  <strong>{provider.name}</strong>
                  <p>{provider.trade}</p>
                  <small>
                    {provider.jobsCompleted} trabajos · {provider.rating.toFixed(1)} rating
                  </small>
                </div>
                <button className={provider.verified ? 'ghost-button' : 'primary-button'} disabled={busy} type="button" onClick={() => onVerify(provider)}>
                  {provider.verified ? 'Quitar verificacion' : 'Verificar'}
                </button>
              </article>
            ))}
          </div>
        </section>
        <section className="workspace-panel" aria-labelledby="kyc-review-title">
          <h3 id="kyc-review-title">Revision KYC</h3>
          {providerVerifications.length === 0 ? <EmptyState title="Sin expedientes KYC" text="Los envios documentales de proveedores apareceran aqui." /> : null}
          <div className="provider-list">
            {providerVerifications.map((verification) => (
              <article key={verification.id} className="provider-row">
                <div>
                  <strong>{verification.legalName}</strong>
                  <p>{verification.taxId} · {verification.status}</p>
                  <small>{verification.documents.length} documento(s) · {verification.address}</small>
                  <div className="document-links">
                    {verification.documents.map((document) => (
                      <a key={document.id} href={document.fileUrl} target="_blank" rel="noreferrer">
                        {document.docType}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="row-actions">
                  <button className="primary-button compact" disabled={busy || verification.status === 'aprobado'} type="button" onClick={() => onReviewVerification(verification.providerId, 'aprobado')}>
                    Aprobar
                  </button>
                  <button className="danger-button compact" disabled={busy || verification.status === 'rechazado'} type="button" onClick={() => onReviewVerification(verification.providerId, 'rechazado', 'Documentacion incompleta o inconsistente.')}>
                    Rechazar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="workspace-panel" aria-labelledby="disputes-title">
          <h3 id="disputes-title">Resolver disputas</h3>
          {disputes.length === 0 ? <EmptyState title="Sin disputas abiertas" text="Las solicitudes con revision apareceran aqui." /> : null}
          <div className="request-stack">
            {disputes.map((request) => (
              <RequestListCard
                key={request.id}
                request={request}
                category={getCategory(categories, request.categoryId)}
                actions={
                  <>
                    <button className="ghost-button" type="button" onClick={() => onOpenDetail(request.id)}>
                      Ver caso
                    </button>
                    <button className="primary-button compact" disabled={busy} type="button" onClick={() => onResolve(request, 'release')}>
                      Liberar
                    </button>
                    <button className="danger-button compact" disabled={busy} type="button" onClick={() => onResolve(request, 'refund')}>
                      Reembolso
                    </button>
                  </>
                }
              />
            ))}
          </div>
        </section>
      </div>
      <div className="admin-grid admin-ops-grid">
        <section className="workspace-panel" aria-labelledby="fraud-title">
          <h3 id="fraud-title">Antifraude y trazabilidad</h3>
          <div className="ops-list">
            {fraudSignals.slice(0, 5).map((signal) => (
              <article key={signal.id}>
                <strong>{signal.score}/100 · {signal.requestTitle}</strong>
                <p>{signal.reason}</p>
              </article>
            ))}
            {fraudSignals.length === 0 ? <p className="muted">Sin alertas antifraude activas.</p> : null}
          </div>
        </section>
        <section className="workspace-panel" aria-labelledby="payments-title">
          <div className="panel-heading">
            <h3 id="payments-title">Pagos y conciliacion</h3>
            <button className="ghost-button" type="button" disabled={busy} onClick={onReconcile}>
              Conciliar
            </button>
          </div>
          <div className="ops-list">
            {payments.slice(0, 5).map((payment) => (
              <article key={payment.id}>
                <strong>{payment.provider} · {payment.status}</strong>
                <p>{payment.kind} por {formatMoney(payment.amount)}</p>
              </article>
            ))}
            {payments.length === 0 ? <p className="muted">Aun no hay pagos registrados.</p> : null}
          </div>
        </section>
        <section className="workspace-panel" aria-labelledby="docs-title">
          <h3 id="docs-title">Soporte documental</h3>
          <div className="ops-list">
            {supportDocuments.slice(0, 5).map((doc) => (
              <article key={doc.id}>
                <strong>{doc.fileName}</strong>
                <p>{doc.docType} · {doc.reviewStatus}</p>
              </article>
            ))}
            {supportDocuments.length === 0 ? <p className="muted">Sin documentos pendientes.</p> : null}
          </div>
        </section>
        <section className="workspace-panel" aria-labelledby="audit-title">
          <h3 id="audit-title">Auditoria</h3>
          <div className="ops-list">
            {auditLogs.slice(0, 6).map((log) => (
              <article key={log.id}>
                <strong>{log.action}</strong>
                <p>{log.entityType}{log.entityId ? ` · ${log.entityId}` : ''}</p>
              </article>
            ))}
            {auditLogs.length === 0 ? <p className="muted">La actividad sensible aparecera aqui.</p> : null}
          </div>
        </section>
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MapboxDemandMap({ points, categories, token }: { points: HeatPoint[]; categories: Category[]; token: string }) {
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mapRef.current) return undefined;
    let cleanup = () => undefined;
    let cancelled = false;

    async function mountMap() {
      await import('mapbox-gl/dist/mapbox-gl.css');
      const mod = await import('mapbox-gl');
      if (cancelled || !mapRef.current) return;
      const mapboxgl = mod.default;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: mapRef.current,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [-99.1332, 19.4326],
        zoom: 10.5
      });
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

      const markers = points.map((point) => {
        const category = getCategory(categories, point.categoryId);
        const el = document.createElement('button');
        el.className = 'mapbox-marker';
        el.type = 'button';
        el.style.backgroundColor = category?.accent ?? '#0f766e';
        el.textContent = String(point.intensity);
        el.setAttribute('aria-label', `${point.label}, ${category?.name ?? 'servicio'}, demanda ${point.intensity}`);
        return new mapboxgl.Marker({ element: el })
          .setLngLat([point.lng, point.lat])
          .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(`<strong>${point.label}</strong><p>${category?.name ?? 'Servicio'} · ${point.intensity}/100</p>`))
          .addTo(map);
      });

      cleanup = () => {
        markers.forEach((marker) => marker.remove());
        map.remove();
      };
    }

    mountMap();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [categories, points, token]);

  return <div className="mapbox-map" ref={mapRef} role="img" aria-label="Mapa Mapbox con demanda geolocalizada" />;
}

function OpenStreetDemandMap({ points, categories }: { points: HeatPoint[]; categories: Category[] }) {
  const zoom = 11;
  const center = lonLatToTile(-99.1332, 19.4326, zoom);
  const centerX = Math.floor(center.x);
  const centerY = Math.floor(center.y);
  const tileSpan = 3;
  const tiles = [-1, 0, 1].flatMap((dy) =>
    [-1, 0, 1].map((dx) => ({
      key: `${centerX + dx}-${centerY + dy}`,
      x: centerX + dx,
      y: centerY + dy,
      left: ((dx + 1) / tileSpan) * 100,
      top: ((dy + 1) / tileSpan) * 100
    }))
  );

  return (
    <div className="osm-map" role="img" aria-label="Mapa OpenStreetMap con demanda geolocalizada">
      {tiles.map((tile) => (
        <img
          alt=""
          aria-hidden="true"
          className="osm-tile"
          key={tile.key}
          loading="lazy"
          src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`}
          style={{ left: `${tile.left}%`, top: `${tile.top}%` }}
        />
      ))}
      {points.map((point) => {
        const pointTile = lonLatToTile(point.lng, point.lat, zoom);
        const left = Math.max(6, Math.min(94, 50 + ((pointTile.x - center.x) / tileSpan) * 100));
        const top = Math.max(6, Math.min(88, 50 + ((pointTile.y - center.y) / tileSpan) * 100));
        const category = getCategory(categories, point.categoryId);
        return (
          <button
            className="osm-marker"
            key={point.id}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              '--heat-color': category?.accent ?? '#0f766e',
              '--heat-size': `${34 + point.intensity / 2}px`
            } as CSSProperties}
            type="button"
            aria-label={`${point.label}, intensidad ${point.intensity}, categoria ${category?.name ?? 'servicio'}`}
          >
            <span>{point.intensity}</span>
            <small>{point.label}</small>
          </button>
        );
      })}
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap
      </a>
    </div>
  );
}

function MapInsights({ points, categories, mapboxToken }: { points: HeatPoint[]; categories: Category[]; mapboxToken?: string }) {
  return (
    <section className="content-section" aria-labelledby="map-title">
      <div className="section-heading">
        <div>
          <p className="section-kicker">Mapa e insights</p>
          <h2 id="map-title">Zonas calientes y puntos geolocalizados</h2>
        </div>
      </div>
      <div className="insights-layout">
        {mapboxToken ? (
          <MapboxDemandMap points={points} categories={categories} token={mapboxToken} />
        ) : (
          <OpenStreetDemandMap points={points} categories={categories} />
        )}
        <div className="workspace-panel">
          <h3>Insights operativos</h3>
          <div className="insight-list">
            {points.map((point) => {
              const category = getCategory(categories, point.categoryId);
              return (
                <article key={point.id}>
                  <span style={{ backgroundColor: category?.accent ?? '#0f766e' }} />
                  <div>
                    <strong>{point.label}</strong>
                    <p>
                      {category?.name ?? 'Servicio'} · demanda {point.intensity}/100
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [view, setView] = useState<View>('home');
  const [categories, setCategories] = useState<Category[]>([]);
  const [featured, setFeatured] = useState<Category[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [providerVerification, setProviderVerification] = useState<ProviderVerificationRequest | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerVerifications, setProviderVerifications] = useState<ProviderVerificationRequest[]>([]);
  const [operationalAlerts, setOperationalAlerts] = useState<OperationalAlert[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [disputes, setDisputes] = useState<ServiceRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [fraudSignals, setFraudSignals] = useState<FraudSignal[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [supportDocuments, setSupportDocuments] = useState<SupportDocument[]>([]);
  const [heatPoints, setHeatPoints] = useState<HeatPoint[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<ServiceRequest | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [documents, setDocuments] = useState<SupportDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleLoading, setRoleLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [filters, setFilters] = useState<RequestFilters>({
    role: 'proveedor',
    providerId: 'prov_1',
    category: 'todas',
    search: '',
    maxBudget: 8000,
    maxDistance: 25
  });

  const showToast = useCallback((type: Toast['type'], message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    setObservabilityUser(session);
  }, [session]);

  const loadCore = useCallback(async (role?: Role) => {
    setLoading(true);
    setError(null);
    try {
      const [configData, categoryData, featuredData, heatData, metricsData, notificationsData] = await Promise.all([
        api.config(),
        api.categories(),
        api.featuredCategories(),
        api.heatmap(),
        role === 'admin' ? api.metrics() : Promise.resolve(null),
        role ? api.notifications(role) : Promise.resolve([])
      ]);
      setRuntimeConfig(configData);
      setCategories(categoryData);
      setFeatured(featuredData);
      setHeatPoints(heatData);
      setMetrics(metricsData);
      setNotifications(notificationsData);
    } catch (err) {
      captureAppError(err, 'loadCore', { role });
      setError(err instanceof Error ? err.message : 'Error inesperado al cargar catalogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRoleData = useCallback(
    async (activeSession = session) => {
      if (!activeSession) return;
      setRoleLoading(true);
      setError(null);
      try {
        if (activeSession.role === 'cliente') {
          const data = await api.requests({ role: 'cliente', clientId: activeSession.id });
          setRequests(data);
        }
        if (activeSession.role === 'proveedor') {
          const providerId = activeSession.providerId ?? 'prov_1';
          const [providerData, requestData, verificationData] = await Promise.all([
            api.provider(providerId),
            api.requests({ ...filters, role: 'proveedor', providerId }),
            api.providerVerification(providerId)
          ]);
          setProvider(providerData);
          setRequests(requestData);
          setProviderVerification(verificationData);
        }
        if (activeSession.role === 'admin') {
          const [metricsData, providerData, verificationData, alertData, disputeData, requestData, auditData, fraudData, paymentData, supportData] = await Promise.all([
            api.metrics(),
            api.providers(),
            api.providerVerifications(),
            api.operationalAlerts(),
            api.disputes(),
            api.requests({ role: 'admin' }),
            api.auditLogs(),
            api.fraudSignals(),
            api.payments(),
            api.supportDocuments()
          ]);
          setMetrics(metricsData);
          setProviders(providerData);
          setProviderVerifications(verificationData);
          setOperationalAlerts(alertData);
          setDisputes(disputeData);
          setRequests(requestData);
          setAuditLogs(auditData);
          setFraudSignals(fraudData);
          setPayments(paymentData);
          setSupportDocuments(supportData);
        }
      } catch (err) {
        captureAppError(err, 'loadRoleData', { role: activeSession.role });
        setError(err instanceof Error ? err.message : 'Error al cargar datos del rol.');
      } finally {
        setRoleLoading(false);
      }
    },
    [filters, session]
  );

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const [requestData, messageData, documentData] = await Promise.all([api.request(id), api.messages(id), api.documents(id)]);
      setSelectedRequest(requestData);
      setMessages(messageData);
      setDocuments(documentData);
    } catch (err) {
      captureAppError(err, 'loadDetail', { id });
      setError(err instanceof Error ? err.message : 'No pudimos cargar el detalle.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      setLoading(true);
      try {
        const initialSession = await api.currentSession();
        const [configData, categoryData, featuredData, heatData, notificationsData] = await Promise.all([
          api.config(),
          api.categories(),
          api.featuredCategories(),
          api.heatmap(),
          initialSession ? api.notifications(initialSession.role) : Promise.resolve([])
        ]);

        if (!alive) return;
        setRuntimeConfig(configData);
        setSession(initialSession);
        setCategories(categoryData);
        setFeatured(featuredData);
        setHeatPoints(heatData);
        setNotifications(notificationsData);
        if (initialSession) {
          setView(routeForRole(initialSession.role));
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'No pudimos cargar la app.');
      } finally {
        if (alive) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    void loadRoleData(session);
  }, [loadRoleData, session]);

  useEffect(() => {
    if (!usingFirebaseBackend()) return undefined;
    return api.onSessionChanged((nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setRequests([]);
        setProvider(null);
        setProviderVerification(null);
        setProviders([]);
        setProviderVerifications([]);
        setOperationalAlerts([]);
        setView('home');
      }
    });
  }, []);

  useEffect(() => {
    if (selectedRequestId) {
      loadDetail(selectedRequestId);
    }
  }, [loadDetail, selectedRequestId]);

  async function handleLogin(role: Role, email: string, password: string) {
    setBusy(true);
    try {
      const nextSession = await api.login(role, email, password);
      setSession(nextSession);
      setView(routeForRole(nextSession.role));
      await loadCore(nextSession.role);
      await loadRoleData(nextSession);
      addAppBreadcrumb('login_success', { role: nextSession.role });
      showToast('success', `Sesion activa como ${roleLabels[nextSession.role]}.`);
    } catch (err) {
      captureAppError(err, 'login', { role });
      showToast('error', err instanceof Error ? err.message : 'No pudimos iniciar sesion.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSignup(payload: SignupPayload) {
    setBusy(true);
    try {
      const nextSession = await api.signup(payload);
      setSession(nextSession);
      setView(routeForRole(nextSession.role));
      await loadCore(nextSession.role);
      await loadRoleData(nextSession);
      addAppBreadcrumb('signup_success', { role: nextSession.role });
      showToast('success', `Cuenta creada como ${roleLabels[nextSession.role]}.`);
    } catch (err) {
      captureAppError(err, 'signup', { role: payload.role });
      showToast('error', err instanceof Error ? err.message : 'No pudimos crear la cuenta.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await api.logout();
      setSession(null);
      setRequests([]);
      setProvider(null);
      setProviderVerification(null);
      setProviders([]);
      setProviderVerifications([]);
      setOperationalAlerts([]);
      setSelectedRequest(null);
      setSelectedRequestId(null);
      setMessages([]);
      setDocuments([]);
      setNotifications([]);
      setView('home');
      await loadCore();
      showToast('success', 'Sesion cerrada.');
    } catch (err) {
      captureAppError(err, 'logout');
      showToast('error', err instanceof Error ? err.message : 'No pudimos cerrar sesion.');
    } finally {
      setBusy(false);
    }
  }

  const runAction = useCallback(async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      if (session) await loadRoleData(session);
      if (selectedRequestId) await loadDetail(selectedRequestId);
      showToast('success', success);
    } catch (err) {
      captureAppError(err, 'runAction', { success });
      showToast('error', err instanceof Error ? err.message : 'No pudimos completar la accion.');
    } finally {
      setBusy(false);
    }
  }, [loadDetail, loadRoleData, selectedRequestId, session, showToast]);

  const handleCreateRequest = useCallback(async (payload: CreateRequestPayload) => {
    await runAction(async () => {
      const created = await api.createRequest(payload);
      setSelectedRequestId(created.id);
      setView('detalle');
    }, 'Solicitud publicada. Los proveedores activos ya pueden verla.');
  }, [runAction]);

  function openDetail(id: string) {
    setSelectedRequestId(id);
    setView('detalle');
  }

  function handleNavigate(nextView: View) {
    if (!isViewAllowed(session, nextView)) {
      showToast('error', 'Cambia de rol para abrir esa vista.');
      return;
    }
    trackRoleNavigation(session?.role ?? 'anonymous', nextView);
    setView(nextView);
  }

  const handleCheckoutResult = useCallback((checkout: PaymentCheckout) => {
    if (checkout.payment.checkoutUrl && checkout.payment.status !== 'paid') {
      window.open(checkout.payment.checkoutUrl, '_blank', 'noopener,noreferrer');
      showToast('info', 'Abrimos el checkout seguro en una nueva pestaña.');
    }
    if (checkout.provider) setProvider(checkout.provider);
    if (checkout.request) setSelectedRequest(checkout.request);
  }, [showToast]);

  const activeProviderId = session?.providerId ?? provider?.id ?? 'prov_1';

  const roleSpecificView = useMemo(() => {
    if (!session) return null;

    if (view === 'cliente' && session.role === 'cliente') {
      return (
        <ClientPanel
          session={session}
          categories={categories}
          requests={requests}
          loading={roleLoading}
          busy={busy}
          onCreate={handleCreateRequest}
          onOpenDetail={openDetail}
        />
      );
    }

    if (view === 'proveedor' && session.role === 'proveedor') {
      return (
        <ProviderPanel
          provider={provider}
          verification={providerVerification}
          categories={categories}
          requests={requests}
          filters={filters}
          loading={roleLoading}
          busy={busy}
          onFiltersChange={setFilters}
          onApplyFilters={() => loadRoleData(session)}
          onPayPlan={(plan, price) =>
            runAction(async () => {
              const checkout = await api.paySubscription(activeProviderId, plan, price);
              handleCheckoutResult(checkout);
            }, 'Suscripcion procesada correctamente.')
          }
          onUpdateLocation={(address) =>
            runAction(async () => {
              await api.updateProviderLocation(activeProviderId, {
                address,
                lat: provider?.location.lat ?? 19.4328,
                lng: provider?.location.lng ?? -99.1333
              });
            }, 'Ubicacion actualizada.')
          }
          onSubmitVerification={(payload) =>
            runAction(async () => {
              const verification = await api.submitProviderVerification(payload);
              setProviderVerification(verification);
            }, 'Expediente KYC enviado para revision.')
          }
          onAccept={(request) =>
            runAction(async () => {
              const accepted = await api.acceptRequest(
                request.id,
                activeProviderId,
                request.budget,
                'Acepto el trabajo con agenda confirmada y garantia de servicio.'
              );
              setSelectedRequestId(accepted.id);
              setView('detalle');
            }, 'Trabajo aceptado y escrow preparado.')
          }
          onQuote={(request) =>
            runAction(async () => {
              const quoted = await api.quoteRequest(
                request.id,
                activeProviderId,
                request.budget,
                'Cotizacion enviada con mano de obra, materiales basicos y visita incluidos.'
              );
              setSelectedRequestId(quoted.id);
              setView('detalle');
            }, 'Cotizacion enviada al cliente.')
          }
          onOpenDetail={openDetail}
        />
      );
    }

    if (view === 'admin' && session.role === 'admin') {
      return (
        <AdminPanel
          metrics={metrics}
          providers={providers}
          disputes={disputes}
          auditLogs={auditLogs}
          fraudSignals={fraudSignals}
          payments={payments}
          supportDocuments={supportDocuments}
          providerVerifications={providerVerifications}
          operationalAlerts={operationalAlerts}
          categories={categories}
          loading={roleLoading}
          busy={busy}
          onVerify={(selectedProvider) =>
            runAction(async () => {
              await api.verifyProvider(selectedProvider.id, !selectedProvider.verified);
            }, 'Estatus de proveedor actualizado.')
          }
          onResolve={(request, resolution) =>
            runAction(async () => {
              await api.resolveDispute(request.id, resolution);
            }, 'Disputa resuelta.')
          }
          onReviewVerification={(providerId, status, reason) =>
            runAction(async () => {
              const reviewed = await api.reviewProviderVerification(providerId, status, reason);
              setProviderVerifications((current) => current.map((item) => (item.id === reviewed.id ? reviewed : item)));
              const refreshedProviders = await api.providers();
              setProviders(refreshedProviders);
            }, status === 'aprobado' ? 'Proveedor verificado.' : 'Verificacion rechazada.')
          }
          onReconcile={() =>
            runAction(async () => {
              const reconciled = await api.reconcilePayments();
              setPayments(reconciled);
            }, 'Conciliacion ejecutada.')
          }
          onOpenDetail={openDetail}
        />
      );
    }

    return null;
  }, [
    activeProviderId,
    auditLogs,
    busy,
    categories,
    disputes,
    filters,
    fraudSignals,
    handleCheckoutResult,
    handleCreateRequest,
    loadRoleData,
    metrics,
    operationalAlerts,
    payments,
    provider,
    providerVerification,
    providerVerifications,
    providers,
    requests,
    roleLoading,
    runAction,
    session,
    supportDocuments,
    view
  ]);

  return (
    <div className="app">
      <AppHeader session={session} activeView={view} notifications={notifications} onNavigate={handleNavigate} onLogout={handleLogout} />
      <main>
        {error ? <ErrorBanner message={error} onRetry={() => loadCore(session?.role)} /> : null}
        {loading ? <LoadingBlock label="Preparando App Proveedores..." /> : null}
        {!loading && view === 'home' ? (
          <HomeView
            featured={featured}
            categories={categories}
            session={session}
            metrics={metrics}
            runtimeConfig={runtimeConfig}
            onNavigate={handleNavigate}
            onLogin={handleLogin}
            onSignup={handleSignup}
          />
        ) : null}
        {!loading && view === 'catalogo' ? <CatalogView categories={categories} session={session} onNavigate={handleNavigate} /> : null}
        {!loading && roleSpecificView}
        {!loading && view === 'detalle' && session ? (
          <DetailView
            session={session}
            request={selectedRequest}
            messages={messages}
            documents={documents}
            categories={categories}
            loading={detailLoading}
            busy={busy}
            onStatus={(status, label) =>
              selectedRequestId
                ? runAction(async () => {
                    await api.updateStatus(selectedRequestId, session.role, status, label);
                  }, 'Estado actualizado.')
                : undefined
            }
            onEscrow={(action) =>
              selectedRequestId
                ? runAction(async () => {
                    const checkout = await api.escrow(selectedRequestId, session.role, action);
                    handleCheckoutResult(checkout);
                  }, 'Escrow actualizado.')
                : undefined
            }
            onSendMessage={(message) =>
              selectedRequestId
                ? runAction(async () => {
                    await api.sendMessage(selectedRequestId, session.role, session.name, message);
                  }, 'Mensaje enviado.')
                : undefined
            }
            onCreateDocument={(payload) =>
              selectedRequestId
                ? runAction(async () => {
                    await api.createDocument(selectedRequestId, payload);
                  }, 'Documento agregado al caso.')
                : undefined
            }
            onUploadDocument={(file) =>
              selectedRequestId
                ? runAction(async () => {
                    await api.uploadDocumentFile(selectedRequestId, file);
                  }, 'Archivo subido y adjuntado al caso.')
                : undefined
            }
            onReview={(rating, comment) =>
              selectedRequestId
                ? runAction(async () => {
                    await api.review(selectedRequestId, rating, comment);
                  }, 'Resena enviada.')
                : undefined
            }
            onDispute={(reason) =>
              selectedRequestId
                ? runAction(async () => {
                    await api.dispute(selectedRequestId, reason);
                  }, 'Disputa abierta para revision.')
                : undefined
            }
            onQuote={(request) =>
              runAction(async () => {
                await api.quoteRequest(
                  request.id,
                  activeProviderId,
                  request.budget,
                  'Cotizacion enviada con disponibilidad confirmada y garantia incluida.'
                );
              }, 'Cotizacion enviada.')
            }
            onAccept={(request) =>
              runAction(async () => {
                await api.acceptRequest(
                  request.id,
                  activeProviderId,
                  request.budget,
                  'Acepto el trabajo con horario confirmado.'
                );
              }, 'Trabajo aceptado.')
            }
          />
        ) : null}
        {!loading && view === 'mapa' ? (
          <MapInsights points={heatPoints} categories={categories} mapboxToken={runtimeConfig?.mapboxToken} />
        ) : null}
      </main>
      {toast ? (
        <div className={`toast ${toast.type}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
