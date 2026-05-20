# Componentes

- `ServiceRequestForm`: formulario accesible y reutilizable para publicar solicitudes. Recibe categorias reales del API, valida campos criticos y emite un payload tipado.
- Los componentes de pantalla viven en `src/App.tsx` porque comparten estado de sesion, SSE y recarga de datos. Si el producto crece, los paneles `Cliente`, `Proveedor`, `Detalle`, `Admin` y `Mapa` son los primeros candidatos a moverse a modulos propios.

Convenciones:

- Botones de accion usan iconos de `lucide-react` con texto visible.
- Estados loading, empty, error y success se muestran cerca de la accion afectada.
- Todo campo interactivo tiene label, foco visible y mensajes amigables.
- Los paneles consumen API autenticada; no confian en `role`, `clientId` o `providerId` enviados por el cliente para permisos.
