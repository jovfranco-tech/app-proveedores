import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  categories,
  chatMessages,
  heatPoints,
  notifications,
  providers,
  requests,
  sessions
} from '../server/seed';

const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

function initializeAdmin() {
  if (getApps().length) return;

  if (serviceAccountJson) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson) as Parameters<typeof cert>[0]),
      projectId
    });
    return;
  }

  initializeApp({
    credential: applicationDefault(),
    projectId
  });
}

async function upsertAuthUser(session: (typeof sessions)[keyof typeof sessions]) {
  const auth = getAuth();
  let uid = session.id;

  try {
    const existing = await auth.getUserByEmail(session.email);
    uid = existing.uid;
  } catch {
    await auth.createUser({
      uid,
      email: session.email,
      password: process.env.DEMO_PASSWORD ?? 'Demo123!',
      displayName: session.name,
      emailVerified: true
    });
  }

  await auth.setCustomUserClaims(uid, {
    role: session.role,
    admin: session.role === 'admin',
    providerId: session.providerId ?? null
  });

  return { ...session, id: uid };
}

async function main() {
  initializeAdmin();
  const db = getFirestore();

  const seededSessions = {
    cliente: await upsertAuthUser(sessions.cliente),
    proveedor: await upsertAuthUser(sessions.proveedor),
    admin: await upsertAuthUser(sessions.admin)
  };

  await Promise.all(
    Object.values(seededSessions).map((session) =>
      db.collection('users').doc(session.id).set(
        {
          ...session,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          onboardingComplete: true
        },
        { merge: true }
      )
    )
  );

  await Promise.all(categories.map((category) => db.collection('categories').doc(category.id).set(category, { merge: true })));
  await Promise.all(
    providers.map((provider) =>
      db.collection('providers').doc(provider.id).set(
        {
          ...provider,
          ownerUid: provider.id === seededSessions.proveedor.providerId ? seededSessions.proveedor.id : null,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      )
    )
  );
  await Promise.all(requests.map((serviceRequest) => db.collection('serviceRequests').doc(serviceRequest.id).set(serviceRequest, { merge: true })));
  await Promise.all(chatMessages.map((message) => db.collection('messages').doc(message.id).set(message, { merge: true })));
  await Promise.all(notifications.map((notification) => db.collection('notifications').doc(notification.id).set(notification, { merge: true })));
  await Promise.all(heatPoints.map((point) => db.collection('runtimeConfig').doc(`heat_${point.id}`).set(point, { merge: true })));

  await db.collection('runtimeConfig').doc('public').set(
    {
      paymentProvider: process.env.PAYMENT_PROVIDER ?? 'local',
      seededAt: new Date().toISOString()
    },
    { merge: true }
  );

  console.log('Firebase seed complete for App Proveedores.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
