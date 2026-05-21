import { describe, expect, it } from 'vitest';
import { api, usingFirebaseBackend } from './api';

describe('data backend facade', () => {
  it('starts without an authenticated session in local demo mode', async () => {
    expect(usingFirebaseBackend()).toBe(false);
    await api.logout();
    await expect(api.currentSession()).resolves.toBeNull();
  });

  it('creates a provider profile during provider signup', async () => {
    const session = await api.signup({
      name: 'Proveedor Firebase Demo',
      email: 'proveedor-demo@example.com',
      password: 'Demo123!',
      role: 'proveedor'
    });

    expect(session.role).toBe('proveedor');
    expect(session.providerId).toBeTruthy();

    const provider = await api.provider(session.providerId);
    expect(provider.name).toBe('Proveedor Firebase Demo');
    expect(provider.verified).toBe(false);
  });

  it('creates a cliente request only after a session exists', async () => {
    const session = await api.signup({
      name: 'Cliente Firebase Demo',
      email: 'cliente-demo@example.com',
      password: 'Demo123!',
      role: 'cliente'
    });

    const request = await api.createRequest({
      clientId: session.id,
      title: 'Validar reglas de solicitud',
      categoryId: 'plomeria',
      address: 'Roma Norte',
      city: 'Ciudad de México',
      dateTime: new Date().toISOString(),
      budget: 1500,
      description: 'Solicitud creada desde pruebas para validar la capa de datos.'
    });

    expect(request.clientId).toBe(session.id);
    expect(request.status).toBe('abierta');
    expect(request.escrow.status).toBe('sin_pago');
  });
});
