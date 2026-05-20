# App Proveedores 3

App Proveedores 3 es la version unificada de las dos bases que tenias: toma la arquitectura mas completa de `App proveedores 2 5.5` y rescata de `App Proveedores` la identidad PWA/offline, iconografia, enfoque de catalogo visual y experiencia demo.

Es un marketplace web en espanol de Mexico para conectar clientes con proveedores de servicios verificados. Incluye API real, JWT con refresh cookie, SSE con replay, paneles por rol, chat persistente, escrow con pasarelas configurables, admin, mapa Mapbox opcional, auditoria, antifraude, observabilidad, PWA y pruebas.

## Que unifica

- Base tecnica de `App proveedores 2 5.5`: TypeScript, React/Vite, Express, SQLite local, Postgres productivo, Docker, Caddy, GitHub Actions, tests unitarios/e2e y production doctor.
- Experiencia de `App Proveedores`: branding App Proveedores, modo demo rapido, manifiesto PWA, service worker, pantalla offline e icono instalable.
- Catalogo visual: categorias con imagenes fijas para cerrajeria, plomeria, CCTV, carpinteria, albercas, jardineria, albanileria y climatizacion.
- Flujo comercial completo: cliente publica, proveedor cotiza/acepta, chat, timeline, pagos retenidos, resenas, disputas y admin.
- Camino a produccion: secretos por entorno, HTTPS, Postgres, webhooks, storage documental, observabilidad y smoke tests.

## Scripts

- `npm install`
- `cp .env.example .env`
- `npm run db:migrate` inicializa SQLite y datos semilla
- `npm run db:backup` crea un respaldo de `data/conectapro.sqlite`
- `npm run db:postgres:migrate` aplica el schema Postgres si defines `POSTGRES_URL`
- `npm run db:postgres:backup` crea un backup con `pg_dump`
- `npm run db:postgres:smoke` valida que el runtime arranque usando Postgres
- `npm run prod:doctor` revisa configuracion obligatoria para produccion
- `npm run prod:doctor:live` valida credenciales reales contra Stripe, Mercado Pago, Mapbox, S3 y Cloudinary
- `npm run dev` inicia API en `http://localhost:5174` y web en `http://localhost:5173`
- `npm run build` compila TypeScript y genera `dist/`
- `npm test` ejecuta pruebas unitarias
- `npm run test:e2e` ejecuta smoke y seguridad con Playwright en puertos aislados `6173/6174`
- `npm run test:load` ejecuta una carga ligera contra endpoints criticos

## Usuarios de demo

- Cliente: `cliente@conectapro.mx`
- Proveedor: `proveedor@conectapro.mx`
- Admin: `admin@conectapro.mx`
- Password: `Demo123!`

La autenticacion usa JWT de corta duracion, refresh token httpOnly y RBAC en servidor. Las acciones principales usan endpoints reales bajo `/api`. En local el default sigue siendo SQLite, pero el runtime ya cambia a Postgres cuando defines `DB_DRIVER=postgres`, `POSTGRES_URL` o un `DATABASE_URL` no-SQLite. Para varias instancias o muchos usuarios usa Postgres y valida el arranque con `npm run db:postgres:smoke`.

## Integraciones reales

- `PAYMENT_PROVIDER=local` confirma pagos localmente para desarrollo.
- `PAYMENT_PROVIDER=stripe` usa Checkout Sessions con `STRIPE_SECRET_KEY` y valida webhooks con `STRIPE_WEBHOOK_SECRET`.
- `PAYMENT_PROVIDER=mercadopago` crea preferencias Checkout Pro via REST con `MERCADOPAGO_ACCESS_TOKEN`.
- `VITE_MAPBOX_TOKEN` activa Mapbox GL JS en la vista de mapa; sin token queda el mapa visual fallback.
- Google OAuth se activa con `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `OAUTH_REDIRECT_BASE_URL`.
- Apple OAuth se activa con `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` y `APPLE_PRIVATE_KEY` o `APPLE_PRIVATE_KEY_PATH`.
- S3 genera URLs presignadas con `AWS_REGION` y `AWS_S3_BUCKET`.
- Cloudinary genera uploads firmados con `CLOUDINARY_URL` o `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Observabilidad: logs estructurados con Pino, `/metrics` Prometheus y export OTLP si defines `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Produccion y staging

- Copia `.env.example` a `.env` localmente, pero en servidores usa secretos del proveedor de hosting.
- Usa `.env.staging.example` como plantilla para staging con Postgres, HTTPS, webhooks publicos y credenciales reales.
- `NODE_ENV=production` exige secretos JWT reales y URLs HTTPS para `APP_ORIGIN` y `PUBLIC_WEBHOOK_BASE_URL`.
- `Dockerfile`, `docker-compose.production.yml` y `Caddyfile` dejan un camino de despliegue con HTTPS y Postgres.
- `.github/workflows/ci.yml` ejecuta lint, unitarias, build, e2e, audit y build de imagen.
- `.github/workflows/deploy-staging.yml` despliega por SSH a un servidor staging con Docker Compose.
- `.github/workflows/live-smoke.yml` ejecuta validaciones live contra staging cuando cargues los secretos en GitHub Actions.

## Corte a produccion

Antes de exponer trafico real, carga credenciales de Stripe/Mercado Pago/Mapbox/OAuth/S3/Cloudinary en el entorno del host, define `POSTGRES_URL`, `STAGING_URL` y `CUSTOM_DOMAIN`, y ejecuta `npm run prod:doctor:live`. Ese comando debe pasar en verde contra servicios reales; localmente es normal que falle o marque skips si aun no hay secretos.
