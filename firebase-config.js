// api/firebase-test.js - Diagnostic API to check Firebase status
const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

const handler = async (req, res) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    checks: {}
  };

  // Check 1: Environment Variables
  diagnostics.checks.environmentVariables = {
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    values: {
      projectId: process.env.FIREBASE_PROJECT_ID || 'NOT_SET',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL ? 'SET' : 'NOT_SET',
      privateKeyLength: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.length : 0
    }
  };

  // Check 2: Firebase Admin Import
  try {
    const admin = require('firebase-admin');
    diagnostics.checks.firebaseAdminImport = {
      success: true,
      appsLength: admin.apps.length,
      hasApps: admin.apps.length > 0
    };
  } catch (error) {
    diagnostics.checks.firebaseAdminImport = {
      success: false,
      error: error.message
    };
  }

  // Check 3: Firebase Config Import
  try {
    const firebaseConfig = require('../firebase-config');
    diagnostics.checks.firebaseConfigImport = {
      success: true,
      hasDb: !!firebaseConfig.db,
      hasAuth: !!firebaseConfig.auth,
      hasHelpers: !!firebaseConfig.helpers
    };
  } catch (error) {
    diagnostics.checks.firebaseConfigImport = {
      success: false,
      error: error.message
    };
  }

  // Check 4: Firestore Connection Test
  if (diagnostics.checks.firebaseConfigImport?.success) {
    try {
      const { db } = require('../firebase-config');
      // Try to get a document (this will fail if credentials are wrong)
      const testDoc = await db.collection('_test').doc('connection').get();
      diagnostics.checks.firestoreConnection = {
        success: true,
        canConnect: true,
        note: 'Connection test passed'
      };
    } catch (error) {
      diagnostics.checks.firestoreConnection = {
        success: false,
        error: error.message,
        code: error.code
      };
    }
  }

  // Check 5: Auth Test
  if (req.headers.authorization) {
    try {
      const { verifyToken } = require('../middleware/auth');
      
      await new Promise((resolve, reject) => {
        const mockRes = {
          status: () => ({ json: reject }),
          json: reject
        };
        verifyToken(req, mockRes, resolve);
      });

      diagnostics.checks.authTest = {
        success: true,
        hasValidToken: true
      };
    } catch (error) {
      diagnostics.checks.authTest = {
        success: false,
        error: error.message || 'Auth validation failed'
      };
    }
  } else {
    diagnostics.checks.authTest = {
      skipped: true,
      reason: 'No Authorization header provided'
    };
  }

  // Determine overall status
  const criticalChecks = ['environmentVariables', 'firebaseAdminImport', 'firebaseConfigImport'];
  const failedCritical = criticalChecks.filter(check => 
    diagnostics.checks[check] && !diagnostics.checks[check].success
  );

  diagnostics.overall = {
    status: failedCritical.length === 0 ? 'READY' : 'NOT_CONFIGURED',
    failedChecks: failedCritical,
    recommendation: failedCritical.length === 0 ? 
      'Firebase is configured and ready' : 
      `Configure: ${failedCritical.join(', ')}`
  };

  res.status(200).json({
    success: true,
    diagnostics
  });
};

module.exports = allowCors(handler);
