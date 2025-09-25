// middleware/auth.js - REST-based authentication (no dependencies)
const { verifyIdToken, helpers } = require('../firebase-rest-config');

async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'No authorization token provided'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid token format'
      });
    }
    
    // Verify the Firebase ID token using REST API
    const decodedToken = await verifyIdToken(idToken);
    
    // Get user data from Firestore
    const userData = await helpers.getUserById(decodedToken.uid);
    
    if (!userData) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found in database'
      });
    }
    
    // Add user info to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: userData.name,
      role: userData.role,
      status: userData.status || 'active'
    };

    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    
    if (error.message.includes('Token verification failed')) {
      return res.status(401).json({ 
        success: false,
        error: 'Token expired or invalid'
      });
    }
    
    return res.status(401).json({ 
      success: false,
      error: 'Authentication failed',
      details: error.message
    });
  }
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required'
      });
    }

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
}

module.exports = {
  verifyToken,
  requireRole
};
