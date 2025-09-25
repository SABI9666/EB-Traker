// api/_firebase-admin.js
const admin = require('firebase-admin');

// This prevents re-initializing the app on every hot-reload
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });
  } catch (error) {
    console.error('Firebase admin initialization error', error.stack);
  }
}

module.exports = admin;
