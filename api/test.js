// Simple test endpoint to verify API is working

const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  return await fn(req, res);
};

const handler = async (req, res) => {
  try {
    // Simple test response
    const testData = {
      success: true,
      message: 'API is working correctly',
      timestamp: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        hasFirebaseConfig: {
          projectId: !!process.env.FIREBASE_PROJECT_ID,
          privateKey: !!process.env.FIREBASE_PRIVATE_KEY,
          clientEmail: !!process.env.FIREBASE_CLIENT_EMAIL
        }
      },
      request: {
        method: req.method,
        url: req.url,
        headers: {
          contentType: req.headers['content-type'],
          authorization: req.headers.authorization ? 'Bearer [HIDDEN]' : 'Not provided',
          userAgent: req.headers['user-agent']
        }
      }
    };

    res.status(200).json(testData);
    
  } catch (error) {
    console.error('Test API error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Test API failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

module.exports = allowCors(handler);
