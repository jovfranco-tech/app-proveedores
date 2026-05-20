# Unificacion App Proveedores 3

## Base elegida

Se uso `App proveedores 2 5.5` como base porque ya tenia la arquitectura mas cercana a produccion: React + TypeScript, API Express, persistencia SQLite/Postgres, pagos, uploads, observabilidad, Docker, Caddy, CI, pruebas unitarias y e2e.

## Piezas rescatadas de App Proveedores

- Branding `App Proveedores` para que la nueva version conserve el nombre del producto.
- PWA: `manifest.webmanifest`, `sw.js`, `offline.html` e icono instalable, adaptados al build moderno de Vite.
- Enfoque visual tipo catalogo: se mantiene el carrusel de destacados, grid de categorias y cards de publicaciones con imagenes por categoria.
- Idea de demo-first: la app entra en sesion de cliente automaticamente y permite cambiar a proveedor/admin desde el home.

## Piezas conservadas de App proveedores 2 5.5

- Seguridad: JWT de corta duracion, refresh cookie httpOnly, RBAC, Helmet, CORS y rate limit.
- Negocio: solicitudes, cotizaciones, aceptacion de trabajos, chat, timeline, escrow, resenas y disputas.
- Proveedores: plan de suscripcion, estatus activo/pendiente, ubicacion y filtros por categoria, presupuesto y distancia.
- Admin: metricas, verificacion de proveedores, disputas, pagos, auditoria, antifraude y documentos.
- Produccion: Postgres, Docker, Caddy, GitHub Actions, production doctor, smoke tests, Mapbox, Stripe, Mercado Pago, S3 y Cloudinary.

## Resultado

`App proveedores 3` queda como la version recomendada para seguir desarrollando: tiene mejor estructura tecnica que la primera app, conserva la identidad y experiencia demo, y esta lista para avanzar hacia staging/produccion cuando se definan dominio, base de datos y credenciales reales.
