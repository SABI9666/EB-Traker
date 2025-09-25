const admin = require('firebase-admin');

// Initialize Firebase Admin SDK only once
if (!admin.apps.length) {
  try {
    // Check if we have the required environment variables
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
      throw new Error('Missing required Firebase environment variables: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL');
    }

    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID
    });

    console.log('Firebase Admin SDK initialized successfully');
    
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    throw error;
  }
}

// Export Firebase services
const db = admin.firestore();
const auth = admin.auth();

// Configure Firestore settings
db.settings({
  ignoreUndefinedProperties: true
});

// Helper functions
const helpers = {
  async getUserById(uid) {
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        return { uid, ...userDoc.data() };
      }
      return null;
    } catch (error) {
      console.error('Error getting user by ID:', error);
      throw error;
    }
  },

  async logActivity(activityData) {
    try {
      const activity = {
        ...activityData,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };
      
      const docRef = await db.collection('activities').add(activity);
      return docRef.id;
    } catch (error) {
      console.error('Error logging activity:', error);
      throw error;
    }
  },

  serverTimestamp() {
    return admin.firestore.FieldValue.serverTimestamp();
  },

  arrayUnion(elements) {
    return admin.firestore.FieldValue.arrayUnion(...elements);
  },

  arrayRemove(elements) {
    return admin.firestore.FieldValue.arrayRemove(...elements);
  }
};

module.exports = { 
  admin, 
  db, 
  auth, 
  helpers 
};
