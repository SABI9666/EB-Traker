// Replace your api/dashboard.js with this more robust version

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
  // Set JSON content type first
  res.setHeader('Content-Type', 'application/json');
  
  try {
    console.log('Dashboard API called');
    console.log('Method:', req.method);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));

    if (req.method !== 'GET') {
      return res.status(405).json({ 
        success: false,
        error: 'Method not allowed',
        message: 'Only GET method is allowed for this endpoint'
      });
    }

    // Check environment variables
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY || !process.env.FIREBASE_CLIENT_EMAIL) {
      console.error('Missing Firebase environment variables');
      return res.status(500).json({
        success: false,
        error: 'Server configuration error',
        message: 'Firebase configuration missing'
      });
    }

    // Import Firebase config with error handling
    let db, verifyToken;
    try {
      const firebaseConfig = require('../firebase-config');
      db = firebaseConfig.db;
      
      const authMiddleware = require('../middleware/auth');
      verifyToken = authMiddleware.verifyToken;
    } catch (importError) {
      console.error('Import error:', importError);
      return res.status(500).json({
        success: false,
        error: 'Server configuration error',
        message: 'Failed to load required modules'
      });
    }

    // Wrap in promise to handle auth middleware properly
    return new Promise((resolve) => {
      verifyToken(req, res, async () => {
        try {
          const { role, uid } = req.user;
          console.log('User authenticated:', { role, uid });

          let dashboardData;
          
          switch (role) {
            case 'bdm':
              dashboardData = await getBdmDashboard(uid, db);
              break;
            case 'estimator':
              dashboardData = await getEstimatorDashboard(uid, db);
              break;
            case 'coo':
              dashboardData = await getCooDashboard(uid, db);
              break;
            case 'director':
              dashboardData = await getDirectorDashboard(uid, db);
              break;
            default:
              return res.status(400).json({ 
                success: false,
                error: 'Invalid user role',
                role: role 
              });
          }

          res.status(200).json({
            success: true,
            data: dashboardData,
            generatedAt: new Date().toISOString(),
            userRole: role
          });
          resolve();

        } catch (dashboardError) {
          console.error('Dashboard data error:', dashboardError);
          res.status(500).json({ 
            success: false,
            error: 'Failed to load dashboard', 
            message: dashboardError.message,
            details: process.env.NODE_ENV === 'development' ? dashboardError.stack : undefined
          });
          resolve();
        }
      });
    });

  } catch (error) {
    console.error('Dashboard handler error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Dashboard functions with robust error handling
async function getBdmDashboard(uid, db) {
  try {
    console.log('Loading BDM dashboard for UID:', uid);
    
    let proposals = [];
    try {
      const proposalsQuery = db.collection('proposals').where('createdBy', '==', uid);
      const proposalsSnapshot = await proposalsQuery.get();
      
      proposalsSnapshot.forEach(doc => {
        proposals.push({ id: doc.id, ...doc.data() });
      });
      console.log(`Found ${proposals.length} proposals`);
    } catch (error) {
      console.error('Error fetching proposals:', error);
      // Continue with empty array
    }

    const stats = {
      totalProposals: proposals.length,
      activeProposals: proposals.filter(p => 
        ['pending_estimation', 'pending_pricing', 'pending_director_approval'].includes(p.status)
      ).length,
      approvedProposals: proposals.filter(p => p.status === 'approved').length,
      pipelineValue: '$0',
      winRate: '0%'
    };

    const actionItems = proposals
      .filter(p => p.status === 'approved')
      .slice(0, 3)
      .map(p => ({
        type: 'ready_for_client',
        proposalId: p.id,
        projectName: p.projectName,
        clientCompany: p.clientCompany,
        priority: 'medium'
      }));

    return { 
      stats, 
      actionItems,
      recentActivities: []
    };
    
  } catch (error) {
    console.error('BDM dashboard error:', error);
    return getDefaultDashboard('bdm');
  }
}

async function getEstimatorDashboard(uid, db) {
  try {
    let pendingEstimations = [];
    try {
      const pendingQuery = db.collection('proposals').where('status', '==', 'pending_estimation');
      const pendingSnapshot = await pendingQuery.get();
      
      pendingSnapshot.forEach(doc => {
        pendingEstimations.push({ id: doc.id, ...doc.data() });
      });
    } catch (error) {
      console.error('Error fetching pending estimations:', error);
    }

    const stats = {
      pendingEstimations: pendingEstimations.length,
      completedThisMonth: 0,
      totalCompleted: 0,
      avgTurnaroundTime: '0 days'
    };

    const actionItems = pendingEstimations.slice(0, 5).map(p => ({
      type: 'estimation_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: 'medium'
    }));

    return { stats, actionItems, recentActivities: [] };
    
  } catch (error) {
    console.error('Estimator dashboard error:', error);
    return getDefaultDashboard('estimator');
  }
}

async function getCooDashboard(uid, db) {
  try {
    let pendingPricing = [];
    try {
      const pricingQuery = db.collection('proposals').where('status', '==', 'pending_pricing');
      const pricingSnapshot = await pricingQuery.get();
      
      pendingSnapshot.forEach(doc => {
        pendingPricing.push({ id: doc.id, ...doc.data() });
      });
    } catch (error) {
      console.error('Error fetching pending pricing:', error);
    }

    const stats = {
      pendingPricing: pendingPricing.length,
      revenueThisQuarter: '$0',
      averageMargin: '0%',
      pricingCompletedThisMonth: 0
    };

    const actionItems = pendingPricing.slice(0, 5).map(p => ({
      type: 'pricing_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: 'medium'
    }));

    return { stats, actionItems, recentActivities: [] };
    
  } catch (error) {
    console.error('COO dashboard error:', error);
    return getDefaultDashboard('coo');
  }
}

async function getDirectorDashboard(uid, db) {
  try {
    let pendingApproval = [];
    try {
      const approvalQuery = db.collection('proposals').where('status', '==', 'pending_director_approval');
      const approvalSnapshot = await approvalQuery.get();
      
      approvalSnapshot.forEach(doc => {
        pendingApproval.push({ id: doc.id, ...doc.data() });
      });
    } catch (error) {
      console.error('Error fetching pending approvals:', error);
    }

    const stats = {
      pendingApprovals: pendingApproval.length,
      totalPipelineValue: '$0',
      approvedValue: '$0',
      winRate: '0%',
      activeUsers: 0,
      totalProjects: 0
    };

    const actionItems = pendingApproval.slice(0, 3).map(p => ({
      type: 'approval_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: 'medium'
    }));

    return { stats, actionItems, recentActivities: [] };
    
  } catch (error) {
    console.error('Director dashboard error:', error);
    return getDefaultDashboard('director');
  }
}

function getDefaultDashboard(role) {
  const defaultStats = {
    'bdm': {
      totalProposals: 0,
      activeProposals: 0,
      approvedProposals: 0,
      pipelineValue: '$0',
      winRate: '0%'
    },
    'estimator': {
      pendingEstimations: 0,
      completedThisMonth: 0,
      totalCompleted: 0,
      avgTurnaroundTime: '0 days'
    },
    'coo': {
      pendingPricing: 0,
      revenueThisQuarter: '$0',
      averageMargin: '0%',
      pricingCompletedThisMonth: 0
    },
    'director': {
      pendingApprovals: 0,
      totalPipelineValue: '$0',
      approvedValue: '$0',
      winRate: '0%',
      activeUsers: 0,
      totalProjects: 0
    }
  };

  return {
    stats: defaultStats[role] || {},
    actionItems: [],
    recentActivities: []
  };
}

module.exports = allowCors(handler);
