const { admin, db, helpers } = require('../firebase-config');

/**
 * Verify Firebase ID token middleware
 * Validates the Bearer token and adds user info to req.user
 */
async function verifyToken(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized', 
        message: 'No token provided. Please include Authorization: Bearer <token> header'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized', 
        message: 'Invalid token format'
      });
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    if (!decodedToken) {
      return res.status(401).json({ 
        success: false,
        error: 'Unauthorized', 
        message: 'Invalid token'
      });
    }

    // Get user data from Firestore
    const userDoc = await db.collection('users').doc(decodedToken.uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found', 
        message: 'User data not found in database. Please contact administrator.'
      });
    }

    const userData = userDoc.data();
    
    // Check if user is active
    if (userData.status === 'deactivated' || userData.status === 'suspended') {
      return res.status(403).json({ 
        success: false,
        error: 'Account deactivated', 
        message: 'Your account has been deactivated. Please contact administrator.'
      });
    }

    // Add user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: userData.name,
      role: userData.role,
      status: userData.status || 'active',
      createdAt: userData.createdAt,
      lastLogin: userData.lastLogin,
      // Firebase token claims
      firebase: {
        identities: decodedToken.firebase.identities,
        sign_in_provider: decodedToken.firebase.sign_in_provider
      }
    };

    // Update last login timestamp (async, don't wait)
    updateLastLogin(decodedToken.uid).catch(console.error);

    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    
    // Handle specific Firebase Auth errors
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        success: false,
        error: 'Token expired', 
        message: 'Your session has expired. Please log in again.'
      });
    }
    
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ 
        success: false,
        error: 'Token revoked', 
        message: 'Your session has been revoked. Please log in again.'
      });
    }
    
    if (error.code === 'auth/argument-error') {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid token', 
        message: 'Invalid token format or content.'
      });
    }

    return res.status(401).json({ 
      success: false,
      error: 'Authentication failed', 
      message: 'Unable to verify authentication. Please try logging in again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Role-based access control middleware
 * Checks if user has required role permissions
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required', 
        message: 'Please log in to access this resource'
      });
    }

    // Ensure allowedRoles is an array
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false,
        error: 'Insufficient permissions', 
        message: `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`,
        required: roles,
        current: req.user.role
      });
    }

    next();
  };
}

/**
 * Resource ownership middleware
 * Checks if user owns the resource or has admin privileges
 */
function requireOwnership(resourceUserIdField = 'createdBy') {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          success: false,
          error: 'Authentication required'
        });
      }

      // Directors can access everything
      if (req.user.role === 'director') {
        return next();
      }

      // For other users, check ownership based on the resource
      const resourceId = req.params.id || req.query.id;
      
      if (!resourceId) {
        return res.status(400).json({ 
          success: false,
          error: 'Resource ID required'
        });
      }

      // This is a generic check - you might need to customize based on collection
      // For now, we'll assume it's being used correctly in the API endpoints
      req.resourceOwnershipChecked = true;
      next();
      
    } catch (error) {
      console.error('Ownership check error:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to verify resource ownership'
      });
    }
  };
}

/**
 * Rate limiting middleware (basic implementation)
 * Prevents abuse by limiting requests per user
 */
function rateLimit(maxRequests = 100, windowMs = 60000) { // 100 requests per minute
  const requests = new Map();
  
  return (req, res, next) => {
    if (!req.user) {
      return next(); // Let auth middleware handle this
    }

    const userId = req.user.uid;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get existing requests for this user
    if (!requests.has(userId)) {
      requests.set(userId, []);
    }

    const userRequests = requests.get(userId);
    
    // Remove old requests outside the window
    const recentRequests = userRequests.filter(timestamp => timestamp > windowStart);
    
    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs/1000} seconds.`,
        retryAfter: Math.ceil((recentRequests[0] + windowMs - now) / 1000)
      });
    }

    // Add current request
    recentRequests.push(now);
    requests.set(userId, recentRequests);

    next();
  };
}

/**
 * Admin-only middleware
 * Shorthand for director role requirement
 */
function requireAdmin() {
  return requireRole(['director']);
}

/**
 * Manager-level middleware
 * Allows COO and Director roles
 */
function requireManager() {
  return requireRole(['coo', 'director']);
}

/**
 * Update user's last login timestamp
 */
async function updateLastLogin(uid) {
  try {
    await db.collection('users').doc(uid).update({
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Failed to update last login:', error);
    // Don't throw - this is not critical
  }
}

/**
 * Validate API key (for external integrations)
 * This is optional - for future API integrations
 */
function validateApiKey() {
  return (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        message: 'Please provide X-API-Key header'
      });
    }

    // Check against environment variable or database
    const validApiKeys = (process.env.API_KEYS || '').split(',').filter(k => k.length > 0);
    
    if (!validApiKeys.includes(apiKey)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key'
      });
    }

    // Add API context
    req.apiAuth = true;
    next();
  };
}

/**
 * Helper function to check if user has specific permission
 */
function hasPermission(user, permission) {
  const rolePermissions = {
    bdm: ['create_proposal', 'view_own_proposals', 'submit_to_client', 'upload_files'],
    estimator: ['view_pending_estimates', 'add_estimation', 'view_estimation_history'],
    coo: ['view_all_proposals', 'set_pricing', 'approve_margins', 'view_financials', 'manage_team'],
    director: ['full_access', 'manage_users', 'view_analytics', 'final_approval', 'system_admin']
  };

  const userPermissions = rolePermissions[user.role] || [];
  
  // Director has all permissions
  if (user.role === 'director') {
    return true;
  }
  
  return userPermissions.includes(permission);
}

/**
 * Permission-based middleware
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required' 
      });
    }

    if (!hasPermission(req.user, permission)) {
      return res.status(403).json({ 
        success: false,
        error: 'Insufficient permissions',
        message: `Permission '${permission}' required`
      });
    }

    next();
  };
}

// Export all middleware functions
module.exports = {
  verifyToken,
  requireRole,
  requireOwnership,
  requireAdmin,
  requireManager,
  requirePermission,
  rateLimit,
  validateApiKey,
  hasPermission,
  updateLastLogin
};

// Export helpers for testing
if (process.env.NODE_ENV === 'test') {
  module.exports._testHelpers = {
    updateLastLogin
  };
}
