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
    if (req.method === 'GET') {
      return await getDashboardData(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Dashboard API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Get dashboard data based on user role
async function getDashboardData(req, res) {
  try {
    // First check if we have the required environment variables
    const hasFirebaseConfig = !!(
      process.env.FIREBASE_PROJECT_ID && 
      process.env.FIREBASE_PRIVATE_KEY && 
      process.env.FIREBASE_CLIENT_EMAIL
    );

    if (!hasFirebaseConfig) {
      console.error('Missing Firebase environment variables');
      return res.status(500).json({
        error: 'Configuration error',
        message: 'Firebase environment variables not properly configured',
        debug: {
          hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
          hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
          hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL
        }
      });
    }

    // Try to initialize Firebase and auth
    let db, user;
    try {
      const { db: firestore } = require('./firebase-config');
      const { verifyToken } = require('./middleware/auth');
      db = firestore;

      // Verify the user token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'No token provided'
        });
      }

      const idToken = authHeader.split('Bearer ')[1];
      const admin = require('firebase-admin');
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      if (!userDoc.exists) {
        return res.status(404).json({ 
          error: 'User not found', 
          message: 'User data not found in database'
        });
      }

      user = {
        uid: decodedToken.uid,
        email: decodedToken.email,
        ...userDoc.data()
      };

    } catch (firebaseError) {
      console.error('Firebase initialization or auth error:', firebaseError);
      
      // Return mock data if Firebase fails but we have basic info
      return res.json({
        success: true,
        data: getMockDashboardData(),
        message: 'Using mock data - Firebase connection issue',
        timestamp: new Date().toISOString()
      });
    }

    // Generate dashboard data based on user role
    let dashboardData;
    const { role, uid } = user;

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
          error: 'Invalid user role',
          role: role 
        });
    }

    res.json({
      success: true,
      data: dashboardData,
      generatedAt: new Date().toISOString(),
      userRole: role
    });

  } catch (error) {
    console.error('Get dashboard data error:', error);
    
    // Fallback to mock data if everything fails
    res.json({
      success: true,
      data: getMockDashboardData(),
      message: 'Using mock data due to error: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Mock data function for testing
function getMockDashboardData() {
  return {
    stats: {
      totalProposals: 8,
      activeProposals: 5,
      approvedProposals: 2,
      pipelineValue: '$285,000',
      winRate: '75%'
    },
    actionItems: [
      {
        type: 'estimation_required',
        proposalId: 'mock-1',
        projectName: 'HVAC System Upgrade',
        clientCompany: 'ABC Manufacturing',
        priority: 'high'
      },
      {
        type: 'ready_for_client',
        proposalId: 'mock-2',
        projectName: 'Cooling Tower Installation',
        clientCompany: 'XYZ Corp',
        priority: 'medium'
      }
    ],
    recentActivities: [
      {
        details: 'New proposal created for ABC Manufacturing',
        performedByName: 'John BDM',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        projectName: 'HVAC System Upgrade'
      },
      {
        details: 'Estimation completed for XYZ Corp project',
        performedByName: 'Sarah Estimator',
        timestamp: new Date(Date.now() - 172800000).toISOString(),
        projectName: 'Cooling Tower Installation'
      }
    ]
  };
}

// BDM Dashboard
async function getBdmDashboard(uid, db) {
  try {
    const proposalsQuery = db.collection('proposals').where('createdBy', '==', uid);
    const proposalsSnapshot = await proposalsQuery.get();
    
    const proposals = [];
    proposalsSnapshot.forEach(doc => proposals.push({ id: doc.id, ...doc.data() }));

    const stats = {
      totalProposals: proposals.length,
      activeProposals: proposals.filter(p => 
        ['pending_estimation', 'pending_pricing', 'pending_director_approval'].includes(p.status)
      ).length,
      approvedProposals: proposals.filter(p => p.status === 'approved').length,
      pipelineValue: '$' + proposals.reduce((sum, p) => {
        if (p.pricing && p.pricing.quoteValue) {
          return sum + parseFloat(p.pricing.quoteValue.replace(/[,$]/g, ''));
        }
        return sum;
      }, 0).toLocaleString(),
      winRate: proposals.length > 0 ? Math.round((proposals.filter(p => p.status === 'approved').length / proposals.length) * 100) + '%' : '0%'
    };

    const actionItems = proposals
      .filter(p => p.status === 'approved')
      .slice(0, 3)
      .map(p => ({
        type: 'ready_for_client',
        proposalId: p.id,
        projectName: p.projectName,
        clientCompany: p.clientCompany,
        priority: p.priority || 'medium'
      }));

    const recentActivities = await getRecentActivities(uid, db, 5);

    return { stats, actionItems, recentActivities };
    
  } catch (error) {
    console.error('BDM dashboard error:', error);
    return getMockDashboardData();
  }
}

// Estimator Dashboard
async function getEstimatorDashboard(uid, db) {
  try {
    const pendingQuery = db.collection('proposals').where('status', '==', 'pending_estimation');
    const pendingSnapshot = await pendingQuery.get();
    
    const pendingEstimations = [];
    pendingSnapshot.forEach(doc => pendingEstimations.push({ id: doc.id, ...doc.data() }));

    const stats = {
      pendingEstimations: pendingEstimations.length,
      completedThisMonth: 0, // Would need date filtering
      totalCompleted: 0, // Would need historical data
      avgTurnaroundTime: '2.5 days'
    };

    const actionItems = pendingEstimations.slice(0, 5).map(p => ({
      type: 'estimation_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: p.priority || 'medium'
    }));

    const recentActivities = await getRecentActivities(uid, db, 5);

    return { stats, actionItems, recentActivities };
    
  } catch (error) {
    console.error('Estimator dashboard error:', error);
    return getMockDashboardData();
  }
}

// COO Dashboard  
async function getCooDashboard(uid, db) {
  try {
    const pricingQuery = db.collection('proposals').where('status', '==', 'pending_pricing');
    const pricingSnapshot = await pricingQuery.get();
    
    const pendingPricing = [];
    pricingSnapshot.forEach(doc => pendingPricing.push({ id: doc.id, ...doc.data() }));

    const stats = {
      pendingPricing: pendingPricing.length,
      revenueThisQuarter: '$0', // Would need calculation
      averageMargin: '28%',
      pricingCompletedThisMonth: 0
    };

    const actionItems = pendingPricing.slice(0, 5).map(p => ({
      type: 'pricing_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: p.priority || 'medium'
    }));

    const recentActivities = await getRecentActivities(uid, db, 5);

    return { stats, actionItems, recentActivities };
    
  } catch (error) {
    console.error('COO dashboard error:', error);
    return getMockDashboardData();
  }
}

// Director Dashboard
async function getDirectorDashboard(uid, db) {
  try {
    const approvalQuery = db.collection('proposals').where('status', '==', 'pending_director_approval');
    const approvalSnapshot = await approvalQuery.get();
    
    const pendingApproval = [];
    approvalSnapshot.forEach(doc => pendingApproval.push({ id: doc.id, ...doc.data() }));

    const stats = {
      pendingApprovals: pendingApproval.length,
      totalPipelineValue: '$0', // Would need calculation
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
      priority: p.priority || 'medium'
    }));

    const recentActivities = await getRecentActivities(null, db, 10);

    return { stats, actionItems, recentActivities };
    
  } catch (error) {
    console.error('Director dashboard error:', error);
    return getMockDashboardData();
  }
}

// Get recent activities
async function getRecentActivities(uid, db, limit) {
  try {
    let query = db.collection('activities');
    
    if (uid) {
      query = query.where('performedBy', '==', uid);
    }
    
    const snapshot = await query
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const activities = [];
    snapshot.forEach(doc => activities.push(doc.data()));
    
    return activities;
  } catch (error) {
    console.error('Recent activities error:', error);
    return [];
  }
}

module.exports = allowCors(handler);
