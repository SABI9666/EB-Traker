const { db } = require('../firebase-config');
const { verifyToken } = require('../middleware/auth');

// CORS middleware
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
  // Add error boundary
  try {
    if (req.method === 'GET') {
      return await getDashboardData(req, res);
    } else {
      return res.status(405).json({ 
        success: false,
        error: 'Method not allowed',
        message: 'Only GET method is allowed for this endpoint'
      });
    }
  } catch (error) {
    console.error('Dashboard API error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Get dashboard data based on user role
async function getDashboardData(req, res) {
  // Wrap in try-catch for better error handling
  try {
    await verifyToken(req, res, async () => {
      try {
        const { role, uid } = req.user;
        
        console.log('Loading dashboard for:', { role, uid });

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

      } catch (error) {
        console.error('Get dashboard data error:', error);
        res.status(500).json({ 
          success: false,
          error: 'Failed to load dashboard', 
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });
  } catch (authError) {
    console.error('Authentication error in dashboard:', authError);
    res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: 'Please log in again'
    });
  }
}

// BDM Dashboard
async function getBdmDashboard(uid, db) {
  try {
    console.log('Loading BDM dashboard for UID:', uid);
    
    // Get user's proposals with error handling
    let proposals = [];
    try {
      const proposalsQuery = db.collection('proposals').where('createdBy', '==', uid);
      const proposalsSnapshot = await proposalsQuery.get();
      
      proposalsSnapshot.forEach(doc => {
        const data = doc.data();
        proposals.push({ id: doc.id, ...data });
      });
      
      console.log('Found proposals:', proposals.length);
    } catch (proposalError) {
      console.error('Error fetching proposals:', proposalError);
      // Continue with empty proposals array
    }

    // Calculate stats with fallbacks
    const activeStatuses = ['pending_estimation', 'pending_pricing', 'pending_director_approval'];
    const stats = {
      totalProposals: proposals.length || 0,
      activeProposals: proposals.filter(p => activeStatuses.includes(p.status)).length || 0,
      approvedProposals: proposals.filter(p => p.status === 'approved').length || 0,
      pipelineValue: calculatePipelineValue(proposals) || '$0',
      winRate: calculateWinRate(proposals) || '0%'
    };

    // Get action items
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

    // Get recent activities with error handling
    let recentActivities = [];
    try {
      recentActivities = await getRecentActivities(uid, db, 5);
    } catch (activityError) {
      console.error('Error fetching recent activities:', activityError);
      // Continue with empty activities
    }

    return { 
      stats, 
      actionItems: actionItems || [], 
      recentActivities: recentActivities || [] 
    };
    
  } catch (error) {
    console.error('BDM dashboard error:', error);
    return getDefaultDashboard('bdm');
  }
}

// Estimator Dashboard
async function getEstimatorDashboard(uid, db) {
  try {
    // Get pending estimations
    let pendingEstimations = [];
    try {
      const pendingQuery = db.collection('proposals').where('status', '==', 'pending_estimation');
      const pendingSnapshot = await pendingQuery.get();
      
      pendingSnapshot.forEach(doc => {
        const data = doc.data();
        pendingEstimations.push({ id: doc.id, ...data });
      });
    } catch (error) {
      console.error('Error fetching pending estimations:', error);
    }

    // Get completed estimations by this user
    let completedEstimations = [];
    try {
      const completedQuery = db.collection('proposals').where('estimation.estimatedBy', '==', uid);
      const completedSnapshot = await completedQuery.get();
      
      completedSnapshot.forEach(doc => {
        const data = doc.data();
        completedEstimations.push({ id: doc.id, ...data });
      });
    } catch (error) {
      console.error('Error fetching completed estimations:', error);
    }

    const stats = {
      pendingEstimations: pendingEstimations.length || 0,
      completedThisMonth: getThisMonthCount(completedEstimations) || 0,
      totalCompleted: completedEstimations.length || 0,
      avgTurnaroundTime: '2.3 days'
    };

    const actionItems = pendingEstimations.slice(0, 5).map(p => ({
      type: 'estimation_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: p.priority || 'medium'
    }));

    const recentActivities = await getRecentActivities(uid, db, 5).catch(() => []);

    return { stats, actionItems: actionItems || [], recentActivities: recentActivities || [] };
    
  } catch (error) {
    console.error('Estimator dashboard error:', error);
    return getDefaultDashboard('estimator');
  }
}

// COO Dashboard  
async function getCooDashboard(uid, db) {
  try {
    // Get pending pricing approvals
    let pendingPricing = [];
    try {
      const pricingQuery = db.collection('proposals').where('status', '==', 'pending_pricing');
      const pricingSnapshot = await pricingQuery.get();
      
      pendingPricing = [];
      pricingSnapshot.forEach(doc => {
        const data = doc.data();
        pendingPricing.push({ id: doc.id, ...data });
      });
    } catch (error) {
      console.error('Error fetching pending pricing:', error);
    }

    // Get all proposals with pricing for revenue calculation
    let allProposals = [];
    try {
      const allProposalsSnapshot = await db.collection('proposals').get();
      allProposalsSnapshot.forEach(doc => {
        const data = doc.data();
        allProposals.push({ id: doc.id, ...data });
      });
    } catch (error) {
      console.error('Error fetching all proposals:', error);
    }

    const stats = {
      pendingPricing: pendingPricing.length || 0,
      revenueThisQuarter: calculateQuarterRevenue(allProposals) || '$0',
      averageMargin: calculateAverageMargin(allProposals) || '0%',
      pricingCompletedThisMonth: getThisMonthPricingCount(allProposals) || 0
    };

    const actionItems = pendingPricing.slice(0, 5).map(p => ({
      type: 'pricing_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: p.priority || 'medium'
    }));

    const recentActivities = await getRecentActivities(null, db, 5, 'coo').catch(() => []);

    return { stats, actionItems: actionItems || [], recentActivities: recentActivities || [] };
    
  } catch (error) {
    console.error('COO dashboard error:', error);
    return getDefaultDashboard('coo');
  }
}

// Director Dashboard
async function getDirectorDashboard(uid, db) {
  try {
    // Get pending director approvals
    let pendingApproval = [];
    try {
      const approvalQuery = db.collection('proposals').where('status', '==', 'pending_director_approval');
      const approvalSnapshot = await approvalQuery.get();
      
      pendingApproval = [];
      approvalSnapshot.forEach(doc => {
        const data = doc.data();
        pendingApproval.push({ id: doc.id, ...data });
      });
    } catch (error) {
      console.error('Error fetching pending approvals:', error);
    }

    // Get all proposals for comprehensive stats
    let allProposals = [];
    try {
      const allProposalsSnapshot = await db.collection('proposals').get();
      allProposals = [];
      allProposalsSnapshot.forEach(doc => {
        const data = doc.data();
        allProposals.push({ id: doc.id, ...data });
      });
    } catch (error) {
      console.error('Error fetching all proposals:', error);
    }

    // Get user count
    let activeUsers = 0;
    try {
      const usersSnapshot = await db.collection('users').get();
      activeUsers = usersSnapshot.size;
    } catch (error) {
      console.error('Error fetching users count:', error);
    }

    const stats = {
      pendingApprovals: pendingApproval.length || 0,
      totalPipelineValue: calculateTotalPipeline(allProposals) || '$0',
      approvedValue: calculateApprovedValue(allProposals) || '$0',
      winRate: calculateWinRate(allProposals) || '0%',
      activeUsers: activeUsers || 0,
      totalProjects: allProposals.length || 0
    };

    const actionItems = pendingApproval.slice(0, 3).map(p => ({
      type: 'approval_required',
      proposalId: p.id,
      projectName: p.projectName,
      clientCompany: p.clientCompany,
      priority: p.priority || 'medium'
    }));

    const recentActivities = await getRecentActivities(null, db, 10).catch(() => []);

    return { stats, actionItems: actionItems || [], recentActivities: recentActivities || [] };
    
  } catch (error) {
    console.error('Director dashboard error:', error);
    return getDefaultDashboard('director');
  }
}

// Helper functions
async function getRecentActivities(uid, db, limit, roleFilter = null) {
  try {
    let query = db.collection('activities');
    
    if (uid) {
      query = query.where('performedBy', '==', uid);
    }
    
    if (roleFilter) {
      query = query.where('performedByRole', '==', roleFilter);
    }
    
    const snapshot = await query
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    const activities = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      activities.push(data);
    });
    
    return activities;
  } catch (error) {
    console.error('Recent activities error:', error);
    return [];
  }
}

function calculatePipelineValue(proposals) {
  try {
    const total = proposals.reduce((sum, p) => {
      if (p.pricing && p.pricing.quoteValue) {
        const value = typeof p.pricing.quoteValue === 'string' 
          ? parseFloat(p.pricing.quoteValue.replace(/[,$]/g, ''))
          : p.pricing.quoteValue;
        return sum + (isNaN(value) ? 0 : value);
      }
      return sum;
    }, 0);
    
    return '$' + total.toLocaleString();
  } catch (error) {
    return '$0';
  }
}

function calculateWinRate(proposals) {
  try {
    if (proposals.length === 0) return '0%';
    
    const wonProposals = proposals.filter(p => p.status === 'won' || p.status === 'approved').length;
    const rate = Math.round((wonProposals / proposals.length) * 100);
    return rate + '%';
  } catch (error) {
    return '0%';
  }
}

function calculateTotalPipeline(proposals) {
  try {
    const activeProposals = proposals.filter(p => 
      ['pending_estimation', 'pending_pricing', 'pending_director_approval', 'approved'].includes(p.status)
    );
    return calculatePipelineValue(activeProposals);
  } catch (error) {
    return '$0';
  }
}

function calculateApprovedValue(proposals) {
  try {
    const approvedProposals = proposals.filter(p => p.status === 'approved' || p.status === 'won');
    return calculatePipelineValue(approvedProposals);
  } catch (error) {
    return '$0';
  }
}

function calculateQuarterRevenue(proposals) {
  try {
    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    
    const quarterRevenue = proposals.filter(p => {
      if (!p.clientResponse || p.clientResponse.response !== 'accepted') return false;
      const responseDate = new Date(p.clientResponse.receivedAt);
      return responseDate >= quarterStart;
    }).reduce((sum, p) => {
      const value = p.clientResponse.contractValue || 0;
      return sum + (typeof value === 'string' ? parseFloat(value.replace(/[,$]/g, '')) : value);
    }, 0);

    return '$' + quarterRevenue.toLocaleString();
  } catch (error) {
    return '$0';
  }
}

function calculateAverageMargin(proposals) {
  try {
    const proposalsWithPricing = proposals.filter(p => p.pricing && p.pricing.profitMargin);
    if (proposalsWithPricing.length === 0) return '0%';
    
    const totalMargin = proposalsWithPricing.reduce((sum, p) => {
      const margin = parseFloat(p.pricing.profitMargin);
      return sum + (isNaN(margin) ? 0 : margin);
    }, 0);
    
    const avgMargin = Math.round(totalMargin / proposalsWithPricing.length);
    return avgMargin + '%';
  } catch (error) {
    return '0%';
  }
}

function getThisMonthCount(items) {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    return items.filter(item => {
      const itemDate = new Date(item.estimation?.estimatedAt || item.createdAt);
      return itemDate >= monthStart;
    }).length;
  } catch (error) {
    return 0;
  }
}

function getThisMonthPricingCount(proposals) {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    return proposals.filter(p => {
      if (!p.pricing || !p.pricing.pricedAt) return false;
      const pricedDate = new Date(p.pricing.pricedAt);
      return pricedDate >= monthStart;
    }).length;
  } catch (error) {
    return 0;
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
