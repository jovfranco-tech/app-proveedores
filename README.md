# ConectaPro

Marketplace web para conectar clientes con proveedores locales verificados en Mexico. La app conserva el valor del producto original: solicitudes de servicio, panel de proveedor, panel admin, chat, escrow/pagos, disputas, auditoria, antifraude, PWA/offline y una experiencia demo local.

La ruta de produccion ahora es Firebase-backed:

```text
Usuario
  -> Vercel / React + Vite
  -> Firebase Auth para sesion y registro
  -> Cloud Firestore para datos operativos
  -> Firebase Storage para evidencias y documentos
  -> Cloud Functions para pagos, webhooks, roles admin, auditoria sensible
  -> Stripe / Mercado Pago desde Functions, nunca desde el frontend
```

Produccion actual: https://conectapro-mx.vercel.app

## Servicios Firebase

- Firebase Authentication: email/password, sesion persistida, perfiles por rol.
- Cloud Firestore: `users`, `providers`, `categories`, `serviceRequests`, `quotes`, `messages`, `notifications`, `payments`, `disputes`, `reviews`, `auditLogs`, `fraudSignals`, `supportDocuments`, `runtimeConfig` y `appSettings`.
- Firebase Storage: evidencias/documentos bajo `supportDocuments/{requestId}/{documentId}/{fileName}`.
- Security Rules: reglas deny-by-default para Firestore y Storage.
- Cloud Functions: endpoints preparados para custom claims, escrow, pagos/webhooks y auditoria.
- Firebase Emulator Suite: Auth, Firestore, Storage, Functions y Emulator UI.
- Mapa: Mapbox cuando `VITE_MAPBOX_TOKEN` existe; OpenStreetMap como fallback publico sin token.
- Observabilidad: Sentry opcional en frontend y Functions, breadcrumbs de sesion/rol, ErrorBoundary y alertas operativas en admin.
- KYC: proveedores suben identificacion/RFC a Firebase Storage y admin aprueba/rechaza desde Functions.

## Desarrollo Local

```bash
npm install
cp .env.example .env
npm run dev
```

Si no defines variables `VITE_FIREBASE_*`, la app entra en modo demo local en memoria. Las cuentas demo son:

- Cliente: `cliente@conectapro.mx`
- Proveedor: `proveedor@conectapro.mx`
- Admin: `admin@conectapro.mx`
- Password: `Demo123!`

## Emuladores Firebase

1. Instala Firebase CLI si no lo tienes: `npm install -g firebase-tools`.
2. Copia `.firebaserc.example` a `.firebaserc` y coloca tu project id.
3. Arranca emuladores:

```bash
npm run firebase:emulators
```

4. En `.env`, usa:

```bash
VITE_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
VITE_FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
```

5. Si quieres sembrar datos en Firebase real o emulador:

```bash
FIREBASE_PROJECT_ID=tu-project-id npm run firebase:seed
```

Para emuladores, exporta también `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` y `FIREBASE_STORAGE_EMULATOR_HOST` en tu shell.

## Variables De Entorno

Frontend Vite/Vercel, solo config publica:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID` opcional
- `VITE_FIREBASE_FUNCTIONS_BASE_URL`
- `VITE_MAPBOX_TOKEN` opcional
- `VITE_SENTRY_DSN` opcional
- `VITE_SENTRY_ENVIRONMENT` opcional
- `VITE_SENTRY_TRACES_SAMPLE_RATE` opcional
- `VITE_SENTRY_REPLAY_SAMPLE_RATE` opcional

Backend/scripts/Functions, nunca en frontend:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON` solo para seed/scripts fuera de Google Cloud
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `SENTRY_DSN` opcional
- `SENTRY_ENVIRONMENT` opcional

## Configuracion Firebase Manual

1. Crea un proyecto en Firebase Console.
2. Habilita Authentication con Email/Password.
3. Crea Cloud Firestore en modo production.
4. Habilita Firebase Storage.
5. Registra una Web App y copia su config a Vercel como variables `VITE_FIREBASE_*`.
6. Despliega reglas e indices:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage:rules
```

7. Instala y despliega Functions:

```bash
cd functions
npm install
npm run build
firebase deploy --only functions
```

8. Configura secrets de Functions para pagos:

```bash
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
firebase functions:secrets:set MERCADOPAGO_ACCESS_TOKEN
firebase functions:secrets:set MERCADOPAGO_WEBHOOK_SECRET
```

En Functions v2, configura tambien los params `APP_ORIGIN` y `PAYMENT_PROVIDER` durante el deploy o con el archivo/env de tu entorno.

9. Ejecuta `npm run firebase:seed` para demo users/categorias/solicitudes si necesitas datos iniciales.
10. En Vercel, redeploy de frontend despues de configurar env vars.

## Seguridad

- Admin no es self-assignable desde el frontend.
- Usuarios solo editan campos permitidos de su perfil.
- Clientes crean y leen sus propias solicitudes.
- Proveedores leen solicitudes abiertas y las asignadas/cotizadas segun la logica del marketplace.
- Mensajes y documentos se autorizan por acceso a la solicitud.
- KYC se autoriza por `providerId`/`ownerUid`; los documentos viven bajo `providerKyc/{providerId}` en Storage.
- `payments` solo permite escritura admin/Functions.
- `auditLogs` no permite escritura de clientes/proveedores.
- Firestore y Storage tienen fallback deny-by-default.
- Secretos de pago y credenciales Admin SDK quedan fuera de Vite.

## Pagos Y Escrow

El frontend conserva el concepto de escrow, pero en modo Firebase no marca pagos como pagados/liberados/reembolsados directamente. Esos cambios pasan por Cloud Functions:

- `escrowPayment`
- `stripeWebhook`
- `mercadoPagoWebhook`
- `setUserRole`

Los webhooks incluidos son una base de produccion: reciben eventos, escriben auditoria y dejan el punto claro para validar firmas y actualizar `payments`/`serviceRequests` con logica especifica de Stripe o Mercado Pago.

Webhook Stripe configurado para Firebase Functions:

- `https://us-central1-chambeale-708cb.cloudfunctions.net/stripeWebhook`
- Eventos: `checkout.session.completed`, `payment_intent.succeeded`
- El signing secret debe vivir en `STRIPE_WEBHOOK_SECRET` dentro de Firebase Secret Manager.

## Migracion Desde SQLite/Postgres

El modelo relacional anterior se mapea asi:

- `users` -> `users/{uid}`
- `providers` -> `providers/{providerId}`
- `service_requests` -> `serviceRequests/{requestId}`
- `chat_messages` -> `messages/{messageId}` con `requestId`
- `payments` -> `payments/{paymentId}`
- `audit_log` -> `auditLogs/{auditId}`
- `support_documents` -> `supportDocuments/{documentId}` y archivo en Storage
- `notifications`, `reviews`, `disputes`, `fraudSignals` quedan como colecciones top-level

Para migrar datos reales, exporta filas SQL a JSON, conserva ids estables cuando existan, reemplaza ids de usuarios por Firebase Auth UIDs y usa Admin SDK o `npm run firebase:seed` como plantilla.

## Validacion

```bash
npm run lint
npm test
npm run build
cd functions && npm run build
```

Para validar la app ya desplegada contra Firebase/Vercel:

```bash
npm run test:e2e:prod
```

Ese flujo cubre catalogo/mapa publico, login de cliente/proveedor/admin y una solicitud real creada por cliente y cotizada por proveedor.

Para validar reglas con emulador:

```bash
npm run test:rules
```

Ese comando requiere Java en el `PATH` porque Firestore Emulator corre sobre JVM.

Smoke test posterior a deploy:

- Crear cuenta cliente y publicar solicitud.
- Crear cuenta proveedor y cotizar/aceptar solicitud abierta.
- Enviar expediente KYC de proveedor y aprobarlo desde admin.
- Confirmar que Storage permite subir evidencia del caso.
- Confirmar que cliente/proveedor no pueden leer panel admin.
- Confirmar que cliente no puede escribir `payments` ni `auditLogs`.
- Confirmar webhook de pago actualiza escrow desde Functions.
- Confirmar que Sentry recibe errores si `VITE_SENTRY_DSN`/`SENTRY_DSN` estan configurados.

## Limitaciones Conocidas

- Los webhooks de Stripe/Mercado Pago ya validan firma y actualizan escrow cuando el proveedor confirma un pago aprobado. Falta probarlos con eventos reales de cada cuenta antes de abrir trafico productivo.
- Falta rotar la secret key de Stripe desde el Dashboard/Workbench de Stripe y actualizar `STRIPE_SECRET_KEY` en Firebase Secret Manager.
- `conectapro.vercel.app` esta ocupado fuera del scope actual de Vercel; produccion usa `conectapro-mx.vercel.app` hasta liberar ese alias exacto o configurar dominio propio.
- La suite `test:rules` usa `@firebase/rules-unit-testing`, pero necesita Java/Firebase Emulator Suite instalado para correr localmente o en CI.
- El backend Express/SQLite sigue en el repo como referencia y compatibilidad local, pero el frontend ya usa Firebase cuando `VITE_FIREBASE_*` esta configurado.
