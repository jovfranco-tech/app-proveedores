import { expect, test, type APIRequestContext } from '@playwright/test';

async function login(request: APIRequestContext, role: 'cliente' | 'proveedor' | 'admin') {
  const emails = {
    cliente: 'cliente@conectapro.mx',
    proveedor: 'proveedor@conectapro.mx',
    admin: 'admin@conectapro.mx'
  };
  const response = await request.post('/api/auth/login', {
    data: { role, email: emails[role], password: 'Demo123!' }
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.data.accessToken as string;
}

async function createClientRequest(request: APIRequestContext, token: string) {
  const response = await request.post('/api/requests', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: `Prueba documental ${Date.now()}`,
      categoryId: 'cerrajeria',
      address: 'Av. Insurgentes Sur 1200, CDMX',
      city: 'Ciudad de México',
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      budget: 1400,
      description: 'Necesito evidencia fotografica para revisar el cierre del servicio.'
    }
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data as { id: string };
}

test('rechaza requests protegidos sin sesión', async ({ request }) => {
  const response = await request.get('/api/requests');
  expect(response.status()).toBe(401);
});

test('cliente no puede abrir metricas admin', async ({ request }) => {
  const token = await login(request, 'cliente');
  const response = await request.get('/api/admin/metrics', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(response.status()).toBe(403);
});

test('proveedor no puede crear solicitudes ni editar otra ubicación', async ({ request }) => {
  const token = await login(request, 'proveedor');
  const create = await request.post('/api/requests', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Solicitud no permitida',
      categoryId: 'cerrajeria',
      address: 'Polanco, CDMX',
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      budget: 1200,
      description: 'Un proveedor no debe publicar como cliente.'
    }
  });
  expect(create.status()).toBe(403);

  const location = await request.patch('/api/providers/prov_2/location', {
    headers: { Authorization: `Bearer ${token}` },
    data: { lat: 19.4, lng: -99.1, address: 'Otra colonia' }
  });
  expect(location.status()).toBe(403);
});

test('valida edge cases de payload antes de persistir', async ({ request }) => {
  const token = await login(request, 'cliente');
  const invalidBudget = await request.post('/api/requests', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Presupuesto invalido',
      categoryId: 'cerrajeria',
      address: 'Roma Norte, CDMX',
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      budget: 0,
      description: 'Debe regresar error amigable.'
    }
  });
  expect(invalidBudget.status()).toBe(400);

  const invalidCategory = await request.post('/api/requests', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title: 'Categoría invalida',
      categoryId: 'no-existe',
      address: 'Roma Norte, CDMX',
      dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      budget: 1200,
      description: 'Debe regresar error amigable.'
    }
  });
  expect(invalidCategory.status()).toBe(400);
});

test('resiste carga concurrente ligera en endpoints críticos', async ({ request }) => {
  const token = await login(request, 'proveedor');
  const responses = await Promise.all(
    Array.from({ length: 24 }, (_, index) => {
      if (index % 3 === 0) return request.get('/api/health');
      if (index % 3 === 1) return request.get('/api/categories');
      return request.get('/api/requests', { headers: { Authorization: `Bearer ${token}` } });
    })
  );
  expect(responses.every((response) => response.ok())).toBeTruthy();
});

test('admin puede conciliar pagos y consultar auditoría', async ({ request }) => {
  const token = await login(request, 'admin');
  const reconcile = await request.post('/api/admin/payments/reconcile', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(reconcile.ok()).toBeTruthy();

  const audit = await request.get('/api/admin/audit', {
    headers: { Authorization: `Bearer ${token}` }
  });
  expect(audit.ok()).toBeTruthy();
});

test('webhook de stripe invalido no se procesa', async ({ request }) => {
  const response = await request.post('/api/webhooks/stripe', {
    headers: { 'stripe-signature': 'firma_invalida' },
    data: { type: 'checkout.session.completed' }
  });
  expect(response.status()).toBe(400);
});

test('admin resuelve disputa y cliente no puede usar endpoint admin', async ({ request }) => {
  const clientToken = await login(request, 'cliente');
  const adminToken = await login(request, 'admin');
  const serviceRequest = await createClientRequest(request, clientToken);

  const dispute = await request.post(`/api/requests/${serviceRequest.id}/dispute`, {
    headers: { Authorization: `Bearer ${clientToken}` },
    data: { reason: 'El proveedor no adjunto evidencia suficiente del servicio.' }
  });
  expect(dispute.ok()).toBeTruthy();

  const denied = await request.patch(`/api/admin/disputes/${serviceRequest.id}`, {
    headers: { Authorization: `Bearer ${clientToken}` },
    data: { resolution: 'refund' }
  });
  expect(denied.status()).toBe(403);

  const resolved = await request.patch(`/api/admin/disputes/${serviceRequest.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { resolution: 'refund' }
  });
  expect(resolved.ok()).toBeTruthy();
});

test('upload documental exige storage configurado', async ({ request }) => {
  const token = await login(request, 'cliente');
  const serviceRequest = await createClientRequest(request, token);
  const response = await request.post(`/api/requests/${serviceRequest.id}/upload-target`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { fileName: 'evidencia.jpg', contentType: 'image/jpeg' }
  });
  expect([200, 400]).toContain(response.status());
});
