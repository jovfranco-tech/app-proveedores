import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { Firestore, connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { FirebaseStorage, connectStorageEmulator, getStorage } from 'firebase/storage';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID as string | undefined
};

export const firebaseFunctionsBaseUrl = env.VITE_FIREBASE_FUNCTIONS_BASE_URL as string | undefined;

export const firebaseEmulators = {
  authHost: env.VITE_FIREBASE_AUTH_EMULATOR_HOST as string | undefined,
  firestoreHost: env.VITE_FIRESTORE_EMULATOR_HOST as string | undefined,
  storageHost: env.VITE_FIREBASE_STORAGE_EMULATOR_HOST as string | undefined
};

export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.storageBucket &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId
  );
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;
let emulatorsConnected = false;

function connectEmulators(nextAuth: Auth, nextDb: Firestore, nextStorage: FirebaseStorage) {
  if (emulatorsConnected) return;

  if (firebaseEmulators.authHost) {
    nextAuth.useDeviceLanguage();
  }

  if (firebaseEmulators.firestoreHost) {
    const [host, port = '8080'] = firebaseEmulators.firestoreHost.split(':');
    connectFirestoreEmulator(nextDb, host, Number(port));
  }

  if (firebaseEmulators.storageHost) {
    const [host, port = '9199'] = firebaseEmulators.storageHost.split(':');
    connectStorageEmulator(nextStorage, host, Number(port));
  }

  emulatorsConnected = true;
}

export function getFirebaseClient() {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase no esta configurado. Revisa las variables VITE_FIREBASE_*.');
  }

  if (!app) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    void setPersistence(auth, browserLocalPersistence);
    connectEmulators(auth, db, storage);
  }

  return {
    app,
    auth: auth as Auth,
    db: db as Firestore,
    storage: storage as FirebaseStorage
  };
}
