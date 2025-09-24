const admin = require('firebase-admin');

// Initialize Firebase Admin SDK only once
if (!admin.apps.length) {
  try {
    // For Vercel deployment - using environment variables
    const serviceAccount = {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID || "eb-tracker-42881",
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
    };

    // Validate required environment variables
    const requiredEnvVars = [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_PRIVATE_KEY',
      'FIREBASE_CLIENT_EMAIL'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || "eb-tracker-42881",
      storageBucket: `${process.env.FIREBASE_PROJECT_ID || "eb-tracker-42881"}.appspot.com`
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
const storage = admin.storage();

// Configure Firestore settings
db.settings({
  ignoreUndefinedProperties: true,
  timestampsInSnapshots: true
});

// Helper functions for common operations
const helpers = {
  // Get user by UID
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

  // Get user by email
  async getUserByEmail(email) {
    try {
      const userSnapshot = await db.collection('users').where('email', '==', email).get();
      if (!userSnapshot.empty) {
        const userDoc = userSnapshot.docs[0];
        return { uid: userDoc.id, ...userDoc.data() };
      }
      return null;
    } catch (error) {
      console.error('Error getting user by email:', error);
      throw error;
    }
  },

  // Create activity log
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

  // Generate signed URL for file download
  async getFileDownloadUrl(filePath, expirationTime = '03-09-2491') {
    try {
      const bucket = storage.bucket();
      const file = bucket.file(filePath);
      
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: expirationTime
      });
      
      return url;
    } catch (error) {
      console.error('Error generating download URL:', error);
      throw error;
    }
  },

  // Check if file exists in storage
  async fileExists(filePath) {
    try {
      const bucket = storage.bucket();
      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      return exists;
    } catch (error) {
      console.error('Error checking file existence:', error);
      return false;
    }
  },

  // Delete file from storage
  async deleteFile(filePath) {
    try {
      const bucket = storage.bucket();
      const file = bucket.file(filePath);
      await file.delete();
      return true;
    } catch (error) {
      console.error('Error deleting file:', error);
      throw error;
    }
  },

  // Batch operations helper
  getBatch() {
    return db.batch();
  },

  // Server timestamp
  serverTimestamp() {
    return admin.firestore.FieldValue.serverTimestamp();
  },

  // Array operations
  arrayUnion(elements) {
    return admin.firestore.FieldValue.arrayUnion(...elements);
  },

  arrayRemove(elements) {
    return admin.firestore.FieldValue.arrayRemove(...elements);
  },

  // Increment operation
  increment(value = 1) {
    return admin.firestore.FieldValue.increment(value);
  }
};

// Export everything needed
module.exports = { 
  admin, 
  db, 
  auth, 
  storage, 
  helpers 
};

// For debugging - log configuration (without sensitive data)
if (process.env.NODE_ENV === 'development') {
  console.log('Firebase Configuration Status:', {
    projectId: process.env.FIREBASE_PROJECT_ID,
    hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
    adminAppsCount: admin.apps.length
  });
}
