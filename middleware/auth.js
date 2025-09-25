// middleware/auth.js - Simple auth without external dependencies

async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false,
        error: 'No authorization token provided',
        message: 'Please include Authorization: Bearer <token> header'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({ 
        success: false,
        error: 'Invalid token format'
      });
    }

    // For the self-contained system, we'll simulate user verification
    // In production, this would verify against Firebase
    
    // Mock user data based on token pattern
    let mockUser;
    
    // You can customize this logic based on your needs
    if (idToken.includes('bdm') || idToken.length > 100) {
      mockUser = {
        uid: 'demo-user-bdm',
        email: 'bdm@edanbrook.com',
        name: 'Demo BDM User',
        role: 'bdm',
        status: 'active'
      };
    } else if (idToken.includes('estimator')) {
      mockUser = {
        uid: 'demo-user-estimator',
        email: 'estimator@edanbrook.com',
        name: 'Demo Estimator',
        role: 'estimator',
        status: 'active'
      };
    } else if (idToken.includes('coo')) {
      mockUser = {
        uid: 'demo-user-coo',
        email: 'coo@edanbrook.com',
        name: 'Demo COO',
        role: 'coo',
        status: 'active'
      };
    } else if (idToken.includes('director')) {
      mockUser = {
        uid: 'demo-user-director',
        email: 'director@edanbrook.com',
        name: 'Demo Director',
        role: 'director',
        status: 'active'
      };
    } else {
      // Default user for any valid-looking token
      mockUser = {
        uid: 'demo-user-default',
        email: 'user@edanbrook.com',
        name: 'Demo User',
        role: 'bdm', // Default role
        status: 'active'
      };
    }

    // Add user info to request
    req.user = mockUser;
    
    console.log(`Auth successful for ${mockUser.name} (${mockUser.role})`);
    next();

  } catch (error) {
    console.error('Auth verification error:', error);
    
    return res.status(401).json({ 
      success: false,
      error: 'Authentication failed',
      message: 'Unable to verify token'
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
        error: 'Insufficient permissions',
        message: `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`,
        required: roles,
        current: req.user.role
      });
    }

    next();
  };
}

// Helper function to check permissions
function hasPermission(user, permission) {
  const rolePermissions = {
    bdm: ['create_proposal', 'view_own_proposals', 'submit_to_client', 'upload_files'],
    estimator: ['view_pending_estimates', 'add_estimation', 'view_estimation_history'],
    coo: ['view_all_proposals', 'set_pricing', 'approve_margins', 'view_financials'],
    director: ['full_access', 'manage_users', 'view_analytics', 'final_approval']
  };

  const userPermissions = rolePermissions[user.role] || [];
  
  // Director has all permissions
  if (user.role === 'director') {
    return true;
  }
  
  return userPermissions.includes(permission);
}

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

module.exports = {
  verifyToken,
  requireRole,
  requirePermission,
  hasPermission
};
