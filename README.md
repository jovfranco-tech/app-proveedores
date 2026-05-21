# ConectaPro

Marketplace web para conectar clientes con proveedores locales verificados en México. La app conserva el valor del producto original: solicitudes de servicio, panel de proveedor, panel admin, chat, escrow/pagos, disputas, auditoría, antifraude, PWA/offline y una experiencia demo local.

La ruta de producción ahora es Firebase-backed:

```text
Usuario
  -> Vercel / React + Vite
  -> Firebase Auth para sesión y registro
  -> Cloud Firestore para datos operativos
  -> Firebase Storage para evidencias y documentos
  -> Cloud Functions para pagos, webhooks, roles admin, auditoría sensible
  -> Stripe / Mercado Pago desde Functions, nunca desde el frontend
```

Producción actual: https://conectapro-mx.vercel.app

## Servicios Firebase

- Firebase Authentication: email/password, sesión persistida, perfiles por rol.
- Cloud Firestore: `users`, `providers`, `categories`, `serviceRequests`, `quotes`, `messages`, `notifications`, `payments`, `disputes`, `reviews`, `auditLogs`, `fraudSignals`, `supportDocuments`, `runtimeConfig` y `appSettings`.
- Firebase Storage: evidencias/documentos bajo `supportDocuments/{requestId}/{documentId}/{fileName}`.
- Security Rules: reglas deny-by-default para Firestore y Storage.
- Cloud Functions: endpoints preparados para custom claims, escrow, pagos/webhooks y auditoría.
- Firebase Emulator Suite: Auth, Firestore, Storage, Functions y Emulator UI.
- Mapa: Mapbox cuando `VITE_MAPBOX_TOKEN` existe; OpenStreetMap como fallback público sin token.
- Observabilidad: Sentry opcional en frontend y Functions, breadcrumbs de sesión/rol, ErrorBoundary y alertas operativas en admin.
- KYC: proveedores suben identificación/RFC a Firebase Storage y admin aprueba/rechaza desde Functions.
- Legal y confianza: vista pública con lineamientos de privacidad, pagos protegidos, KYC, disputas y reglas operativas.

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

Frontend Vite/Vercel, solo config pública:

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
- `APP_ORIGIN`
- `PAYMENT_PROVIDER`: `local`, `stripe` o `mercadopago`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_SECRET`
- `MERCADOPAGO_WEBHOOK_URL`
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

En Functions v2, configura también los params `APP_ORIGIN=https://conectapro-mx.vercel.app`, `PAYMENT_PROVIDER=mercadopago` y `MERCADOPAGO_WEBHOOK_URL=https://us-central1-chambeale-708cb.cloudfunctions.net/mercadoPagoWebhook` durante el deploy o con el archivo/env de tu entorno.

9. Ejecuta `npm run firebase:seed` para demo users/categorías/solicitudes si necesitas datos iniciales.
10. En Vercel, redeploy de frontend después de configurar env vars.

## Seguridad

- Admin no es self-assignable desde el frontend.
- Usuarios solo editan campos permitidos de su perfil.
- Clientes crean y leen sus propias solicitudes.
- Proveedores leen solicitudes abiertas y las asignadas/cotizadas según la lógica del marketplace.
- Mensajes y documentos se autorizan por acceso a la solicitud.
- KYC se autoriza por `providerId`/`ownerUid`; los documentos viven bajo `providerKyc/{providerId}` en Storage.
- `payments` solo permite escritura admin/Functions.
- `auditLogs` no permite escritura de clientes/proveedores.
- Firestore y Storage tienen fallback deny-by-default.
- Secretos de pago y credenciales Admin SDK quedan fuera de Vite.
- La vista Legal resume reglas operativas para usuarios y admins, pero debe respaldarse con documentos legales revisados por abogado antes de operación comercial a gran escala.

## Pagos Y Escrow

El frontend conserva el concepto de escrow, pero en modo Firebase no marca pagos como pagados/liberados/reembolsados directamente. Esos cambios pasan por Cloud Functions:

- `escrowPayment`
- `stripeWebhook`
- `mercadoPagoWebhook`
- `setUserRole`

Los webhooks incluidos validan firma, reciben eventos, escriben auditoría y actualizan `payments`, escrow de `serviceRequests` y suscripciones de proveedor desde lógica confiable. El cliente solo crea el checkout; no puede marcar pagos como aprobados.

Webhook Stripe configurado para Firebase Functions:

- `https://us-central1-chambeale-708cb.cloudfunctions.net/stripeWebhook`
- Eventos: `checkout.session.completed`, `payment_intent.succeeded`
- El signing secret debe vivir en `STRIPE_WEBHOOK_SECRET` dentro de Firebase Secret Manager.

### Mercado Pago

Mercado Pago está cableado para Checkout Pro desde Cloud Functions:

- Escrow de solicitudes: `/payments/escrow` crea una preferencia de pago.
- Suscripciones de proveedor: `/payments/subscription` crea una preferencia y solo activa el plan cuando el webhook confirma `approved`.
- Webhook público: `https://us-central1-chambeale-708cb.cloudfunctions.net/mercadoPagoWebhook`
- Eventos esperados en Mercado Pago: pagos/notificaciones de `payment`.
- Secretos: `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET` deben vivir en Firebase Secret Manager, nunca en Vercel ni en código frontend.
- Documentación oficial útil: [notificaciones de pago](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/payment-notifications) y [preferencias de Checkout Pro](https://www.mercadopago.com.mx/developers/en/docs/checkout-pro/checkout-customization/preferences).

Checklist de activación:

1. En Mercado Pago Developers, usa una aplicación de producción o sandbox y copia el Access Token del entorno correcto.
2. En Firebase Console, ve a Secret Manager y crea/actualiza `MERCADOPAGO_ACCESS_TOKEN`.
3. En Mercado Pago Developers, registra el webhook `https://us-central1-chambeale-708cb.cloudfunctions.net/mercadoPagoWebhook`, activa eventos de pago y copia la clave secreta de webhook.
4. En Firebase Secret Manager, crea/actualiza `MERCADOPAGO_WEBHOOK_SECRET`.
5. Configura Functions con `PAYMENT_PROVIDER=mercadopago` y `APP_ORIGIN=https://conectapro-mx.vercel.app`.
6. Despliega Functions con `firebase deploy --only functions`.
7. Haz un pago sandbox y confirma en Firestore que `payments/{paymentId}.status` pase a `paid` y que el escrow o la suscripción se actualicen.

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

Ese flujo cubre catálogo/mapa público, login de cliente/proveedor/admin y una solicitud real creada por cliente y cotizada por proveedor.

Para validar reglas con emulador:

```bash
npm run test:rules
```

Ese comando requiere Java en el `PATH` porque Firestore Emulator corre sobre JVM.
En CI se instala Java y se ejecuta `npm run test:rules` para bloquear cambios que debiliten reglas Firestore.

Smoke test posterior a deploy:

- Crear cuenta cliente y publicar solicitud.
- Crear cuenta proveedor y cotizar/aceptar solicitud abierta.
- Enviar expediente KYC de proveedor y aprobarlo desde admin.
- Confirmar que Storage permite subir evidencia del caso.
- Confirmar que cliente/proveedor no pueden leer panel admin.
- Confirmar que cliente no puede escribir `payments` ni `auditLogs`.
- Confirmar webhook de pago actualiza escrow desde Functions.
- Confirmar que Sentry recibe errores si `VITE_SENTRY_DSN`/`SENTRY_DSN` están configurados.

## Limitaciones Conocidas

- Los webhooks de Stripe/Mercado Pago ya validan firma y actualizan escrow/suscripciones cuando el proveedor confirma un pago aprobado. Falta probarlos con eventos reales de cada cuenta antes de abrir tráfico productivo.
- Mercado Pago queda listo en código, pero no queda activo en producción hasta guardar `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` y `PAYMENT_PROVIDER=mercadopago` en Firebase Functions.
- Falta rotar la secret key de Stripe desde el Dashboard/Workbench de Stripe y actualizar `STRIPE_SECRET_KEY` en Firebase Secret Manager.
- `conectapro.vercel.app` está ocupado fuera del scope actual de Vercel; producción usa `conectapro-mx.vercel.app` hasta liberar ese alias exacto o configurar dominio propio.
- La suite `test:rules` usa `@firebase/rules-unit-testing`, pero necesita Java/Firebase Emulator Suite instalado para correr localmente o en CI.
- El backend Express/SQLite sigue en el repo como referencia y compatibilidad local, pero el frontend ya usa Firebase cuando `VITE_FIREBASE_*` está configurado.
