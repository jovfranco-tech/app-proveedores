import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let testEnv: RulesTestEnvironment;

const projectId = 'app-proveedores-rules-test';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8')
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/client_1'), {
      id: 'client_1',
      name: 'Cliente',
      email: 'cliente@example.com',
      role: 'cliente',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    });
    await setDoc(doc(db, 'users/provider_user_1'), {
      id: 'provider_user_1',
      name: 'Proveedor',
      email: 'proveedor@example.com',
      role: 'proveedor',
      providerId: 'provider_1',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    });
    await setDoc(doc(db, 'users/admin_1'), {
      id: 'admin_1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    });
    await setDoc(doc(db, 'serviceRequests/request_1'), {
      clientId: 'client_1',
      providerId: 'provider_1',
      title: 'Solicitud protegida',
      categoryId: 'plomeria',
      status: 'aceptada',
      budget: 1200,
      escrow: { amount: 1200, status: 'retenido' },
      createdAt: '2026-05-20T00:00:00.000Z'
    });
    await setDoc(doc(db, 'payments/payment_1'), {
      userId: 'client_1',
      providerId: 'provider_1',
      requestId: 'request_1',
      amount: 1200,
      status: 'paid'
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

function authed(uid: string, token: Record<string, unknown> = {}) {
  return testEnv.authenticatedContext(uid, token).firestore();
}

describe('Firestore security rules', () => {
  it('prevents admin self-assignment on profile creation', async () => {
    const db = authed('new_user');
    await assertFails(
      setDoc(doc(db, 'users/new_user'), {
        id: 'new_user',
        name: 'Nuevo Admin',
        email: 'nuevo@example.com',
        role: 'admin',
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z'
      })
    );
  });

  it('allows a client to create an unpaid open request for themselves', async () => {
    const db = authed('client_1');
    await assertSucceeds(
      setDoc(doc(db, 'serviceRequests/request_new'), {
        clientId: 'client_1',
        title: 'Nueva solicitud',
        categoryId: 'cerrajeria',
        status: 'abierta',
        budget: 900,
        escrow: { amount: 0, status: 'sin_pago' },
        createdAt: '2026-05-20T00:00:00.000Z'
      })
    );
  });

  it('blocks client-side spoofing of escrow/payment fields', async () => {
    const db = authed('client_1');
    await assertFails(updateDoc(doc(db, 'serviceRequests/request_1'), { escrow: { amount: 1200, status: 'liberado' } }));
    await assertFails(setDoc(doc(db, 'payments/payment_spoof'), { requestId: 'request_1', amount: 1, status: 'paid' }));
  });

  it('allows participants to read messages and blocks outsiders', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'messages/message_1'), {
        requestId: 'request_1',
        senderId: 'client_1',
        senderRole: 'cliente',
        message: 'Hola',
        createdAt: '2026-05-20T00:00:00.000Z'
      });
      await setDoc(doc(context.firestore(), 'users/outsider'), {
        id: 'outsider',
        name: 'Fuera',
        email: 'fuera@example.com',
        role: 'cliente',
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z'
      });
    });

    await assertSucceeds(getDoc(doc(authed('client_1'), 'messages/message_1')));
    await assertSucceeds(getDoc(doc(authed('provider_user_1'), 'messages/message_1')));
    await assertFails(getDoc(doc(authed('outsider'), 'messages/message_1')));
  });

  it('prevents normal users from modifying audit logs', async () => {
    const db = authed('client_1');
    await assertFails(setDoc(doc(db, 'auditLogs/audit_1'), { action: 'tamper' }));
    await assertFails(deleteDoc(doc(db, 'auditLogs/audit_1')));
  });

  it('allows custom-claim admins to manage operational collections', async () => {
    const db = authed('admin_1', { admin: true, role: 'admin' });
    await assertSucceeds(updateDoc(doc(db, 'payments/payment_1'), { status: 'refunded' }));
    const payment = await getDoc(doc(db, 'payments/payment_1'));
    expect(payment.data()?.status).toBe('refunded');
  });

  it('allows providers to submit only their own KYC expediente', async () => {
    const db = authed('provider_user_1');
    await assertSucceeds(
      setDoc(doc(db, 'providerVerificationRequests/provider_1'), {
        id: 'provider_1',
        providerId: 'provider_1',
        ownerUid: 'provider_user_1',
        legalName: 'Proveedor SA de CV',
        taxId: 'ABC010203XYZ',
        address: 'CDMX',
        status: 'pendiente',
        documents: [],
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z'
      })
    );

    await assertFails(
      setDoc(doc(db, 'providerVerificationRequests/provider_2'), {
        id: 'provider_2',
        providerId: 'provider_2',
        ownerUid: 'provider_user_1',
        legalName: 'Otro proveedor',
        taxId: 'ABC010203XYZ',
        address: 'CDMX',
        status: 'pendiente',
        documents: [],
        createdAt: '2026-05-20T00:00:00.000Z',
        updatedAt: '2026-05-20T00:00:00.000Z'
      })
    );
  });
});
