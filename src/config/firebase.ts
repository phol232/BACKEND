import admin from 'firebase-admin';
import { config } from './index';

let initialized = false;

export function initializeFirebase() {
  if (initialized) return;

  // Check if credentials are available
  if (!config.firebase.clientEmail || !config.firebase.privateKey) {
    console.warn('⚠️  Firebase Admin not initialized (missing credentials)');
    console.warn('⚠️  Add FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY to .env');
    return;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
    });

    initialized = true;
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed:', error);
    console.error('⚠️  Check your credentials in .env');
  }
}

export const db = () => admin.firestore();
export const auth = () => admin.auth();
