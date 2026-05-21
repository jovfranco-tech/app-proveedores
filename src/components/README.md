# Componentes

- `ServiceRequestForm`: formulario accesible y reutilizable para publicar solicitudes. Recibe categorías reales del API, valida campos críticos y emite un payload tipado.
- Los componentes de pantalla viven en `src/App.tsx` porque comparten estado de sesión, SSE y recarga de datos. Si el producto crece, los paneles `Cliente`, `Proveedor`, `Detalle`, `Admin` y `Mapa` son los primeros candidatos a moverse a módulos propios.

Convenciones:

- Botones de acción usan iconos de `lucide-react` con texto visible.
- Estados loading, empty, error y success se muestran cerca de la acción afectada.
- Todo campo interactivo tiene label, foco visible y mensajes amigables.
- Los paneles consumen API autenticada; no confian en `role`, `clientId` o `providerId` enviados por el cliente para permisos.
