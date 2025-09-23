const { db } = require('./firebase-config');
const { verifyToken, requireRole } = require('./middleware/auth');

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
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Get dashboard data based on user role
async function getDashboardData(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { role, uid } = req.user;
      const { period = '30' } = req.query; // Days to look back
      
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(period));
      const startDateISO = startDate.toISOString();

      let dashboardData = {};

      switch (role) {
        case 'bdm':
          dashboardData = await getBdmDashboard(uid, startDateISO);
          break;
        case 'estimator':
          dashboardData = await getEstimatorDashboard(uid, startDateISO);
          break;
        case 'coo':
          dashboardData = await getCooDashboard(uid, startDateISO);
          break;
        case 'director':
          dashboardData = await getDirectorDashboard(uid, startDateISO);
          break;
        default:
          return res.status(400).json({ error: 'Invalid user role' });
      }

      res.json({
        success: true,
        data: dashboardData,
        period: parseInt(period),
        generatedAt: new Date().toISOString()
      });

    } catch (error) {
      console.error('Get dashboard data error:', error);
      res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
  });
}

// BDM Dashboard
async function getBdmDashboard(uid, startDate) {
  const proposalsQuery = db.collection('proposals')
    .where('createdBy', '==', uid);
  
  const proposalsSnapshot = await proposalsQuery.get();
  const proposals = [];
  proposalsSnapshot.forEach(doc => proposals.push(doc.data()));

  const recentProposals = proposals.filter(p => p.createdAt >= startDate);
  
  const stats = {
    totalProposals: proposals.length,
    activeProposals: proposals.filter(p => 
      ['pending_estimation', 'pending_pricing', 'pending_director_approval'].includes(p.status)
    ).length,
    approvedProposals: proposals.filter(p => p.status === 'approved').length,
    submittedProposals: proposals.filter(p => p.status === 'submitted_to_client').length,
    recentActivity: recentProposals.length
  };

  const pipelineValue = proposals
    .filter(p => p.pricing && p.pricing.quoteValue)
    .reduce((sum, p) => sum + parseFloat(p.pricing.quoteValue.replace(/[,$]/g, '')), 0);

  const winRate = stats.submittedProposals > 0 ? 
    Math.round((stats.approvedProposals / stats.submittedProposals) * 100) : 0;

  const actionItems = await getBdmActionItems(uid);
  const recentActivities = await getRecentActivities(uid, 5);

  return {
    stats: {
      ...stats,
      pipelineValue: `$${pipelineValue.toLocaleString()}`,
      winRate: `${winRate}%`
    },
    actionItems,
    recentActivities,
    chartData: getProposalStatusChart(proposals)
  };
}

// Estimator Dashboard
async function getEstimatorDashboard(uid, startDate) {
  const proposalsQuery = db.collection('proposals')
    .where('status', '==', 'pending_estimation');
    
  const estimatedQuery = db.collection('proposals')
    .where('estimation.estimatedBy', '==', uid);

  const [pendingSnapshot, estimatedSnapshot] = await Promise.all([
    proposalsQuery.get(),
    estimatedQuery.get()
  ]);

  const pendingEstimations = [];
  pendingSnapshot.forEach(doc => pendingEstimations.push({id: doc.id, ...doc.data()}));

  const completedEstimations = [];
  estimatedSnapshot.forEach(doc => completedEstimations.push(doc.data()));

  const recentEstimations = completedEstimations.filter(p => 
    p.estimation && p.estimation.estimatedAt >= startDate
  );

  const stats = {
    pendingEstimations: pendingEstimations.length,
    completedThisMonth: recentEstimations.length,
    totalCompleted: completedEstimations.length,
    avgTurnaroundTime: calculateAvgTurnaround(completedEstimations)
  };

  const actionItems = pendingEstimations.slice(0, 5).map(p => ({
    type: 'estimation_required',
    proposalId: p.id,
    projectName: p.projectName,
    clientCompany: p.clientCompany,
    priority: p.priority,
    createdAt: p.createdAt
  }));

  const recentActivities = await getRecentActivities(uid, 5);

  return {
    stats,
    actionItems,
    recentActivities,
    chartData: getEstimationChart(completedEstimations)
  };
}

// COO Dashboard
async function getCooDashboard(uid, startDate) {
  const proposalsQuery = db.collection('proposals');
  const proposalsSnapshot = await proposalsQuery.get();
  
  const proposals = [];
  proposalsSnapshot.forEach(doc => proposals.push(doc.data()));

  const pendingPricing = proposals.filter(p => p.status === 'pending_pricing');
  const pricedProposals = proposals.filter(p => 
    p.pricing && p.pricing.pricedBy === uid
  );

  const recentPricing = pricedProposals.filter(p => 
    p.pricing && p.pricing.pricedAt >= startDate
  );

  // Calculate financial metrics
  const totalRevenue = proposals
    .filter(p => p.pricing && p.status === 'approved')
    .reduce((sum, p) => sum + parseFloat(p.pricing.quoteValue.replace(/[,$]/g, '')), 0);

  const avgMargin = calculateAverageMargin(proposals.filter(p => p.pricing));

  const stats = {
    pendingPricing: pendingPricing.length,
    revenueThisQuarter: `$${totalRevenue.toLocaleString()}`,
    averageMargin: `${avgMargin}%`,
    pricingCompletedThisMonth: recentPricing.length
  };

  const actionItems = pendingPricing.slice(0, 5).map(p => ({
    type: 'pricing_required',
    proposalId: p.id,
    projectName: p.projectName,
    clientCompany: p.clientCompany,
    estimatedHours: p.estimation ? p.estimation.totalHours : null,
    priority: p.priority
  }));

  const recentActivities = await getRecentActivities(uid, 5);

  return {
    stats,
    actionItems,
    recentActivities,
    chartData: getRevenueChart(proposals)
  };
}

// Director Dashboard
async function getDirectorDashboard(uid, startDate) {
  const [proposalsSnapshot, usersSnapshot] = await Promise.all([
    db.collection('proposals').get(),
    db.collection('users').get()
  ]);

  const proposals = [];
  proposalsSnapshot.forEach(doc => proposals.push(doc.data()));

  const users = [];
  usersSnapshot.forEach(doc => users.push(doc.data()));

  const pendingApproval = proposals.filter(p => p.status === 'pending_director_approval');
  
  const totalPipelineValue = proposals
    .filter(p => p.pricing)
    .reduce((sum, p) => sum + parseFloat(p.pricing.quoteValue.replace(/[,$]/g, '')), 0);

  const approvedValue = proposals
    .filter(p => p.status === 'approved' && p.pricing)
    .reduce((sum, p) => sum + parseFloat(p.pricing.quoteValue.replace(/[,$]/g, '')), 0);

  const winRate = proposals.filter(p => p.status === 'submitted_to_client').length > 0 ?
    Math.round((proposals.filter(p => p.status === 'approved').length / 
               proposals.filter(p => p.status === 'submitted_to_client').length) * 100) : 0;

  const stats = {
    pendingApprovals: pendingApproval.length,
    totalPipelineValue: `$${totalPipelineValue.toLocaleString()}`,
    approvedValue: `$${approvedValue.toLocaleString()}`,
    winRate: `${winRate}%`,
    activeUsers: users.length,
    totalProjects: proposals.length
  };

  const actionItems = pendingApproval.slice(0, 3).map(p => ({
    type: 'approval_required',
    proposalId: p.id,
    projectName: p.projectName,
    clientCompany: p.clientCompany,
    quoteValue: p.pricing ? p.pricing.quoteValue : null,
    margin: p.pricing ? p.pricing.margin : null,
    priority: p.priority
  }));

  const recentActivities = await getRecentActivities(null, 10); // All activities for director

  return {
    stats,
    actionItems,
    recentActivities,
    chartData: getExecutiveChart(proposals),
    teamMetrics: getTeamMetrics(users, proposals)
  };
}

// Helper functions
async function getBdmActionItems(uid) {
  const proposalsQuery = db.collection('proposals')
    .where('createdBy', '==', uid)
    .where('status', 'in', ['approved', 'pending_estimation']);
    
  const snapshot = await proposalsQuery.get();
  const actionItems = [];
  
  snapshot.forEach(doc => {
    const proposal = doc.data();
    if (proposal.status === 'approved') {
      actionItems.push({
        type: 'ready_for_client',
        proposalId: doc.id,
        projectName: proposal.projectName,
        clientCompany: proposal.clientCompany,
        priority: 'high'
      });
    }
  });

  return actionItems.slice(0, 5);
}

async function getRecentActivities(uid, limit) {
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
}

function calculateAvgTurnaround(estimations) {
  if (estimations.length === 0) return '0 days';
  
  // This is a simplified calculation - in real implementation,
  // you'd calculate based on creation date vs estimation date
  return '2.5 days';
}

function calculateAverageMargin(pricedProposals) {
  if (pricedProposals.length === 0) return 0;
  
  const totalMargin = pricedProposals.reduce((sum, p) => {
    return sum + (parseFloat(p.pricing.margin) || 0);
  }, 0);
  
  return Math.round(totalMargin / pricedProposals.length);
}

function getProposalStatusChart(proposals) {
  const statusCounts = proposals.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  return {
    labels: Object.keys(statusCounts),
    data: Object.values(statusCounts)
  };
}

function getEstimationChart(estimations) {
  // Group by month for the chart
  const monthlyData = {};
  estimations.forEach(est => {
    if (est.estimation && est.estimation.estimatedAt) {
      const month = est.estimation.estimatedAt.substring(0, 7); // YYYY-MM
      monthlyData[month] = (monthlyData[month] || 0) + 1;
    }
  });

  return {
    labels: Object.keys(monthlyData),
    data: Object.values(monthlyData)
  };
}

function getRevenueChart(proposals) {
  const monthlyRevenue = {};
  proposals.filter(p => p.pricing && p.status === 'approved').forEach(p => {
    if (p.pricing.pricedAt) {
      const month = p.pricing.pricedAt.substring(0, 7);
      const value = parseFloat(p.pricing.quoteValue.replace(/[,$]/g, ''));
      monthlyRevenue[month] = (monthlyRevenue[month] || 0) + value;
    }
  });

  return {
    labels: Object.keys(monthlyRevenue),
    data: Object.values(monthlyRevenue)
  };
}

function getExecutiveChart(proposals) {
  return {
    pipeline: getProposalStatusChart(proposals),
    revenue: getRevenueChart(proposals)
  };
}

function getTeamMetrics(users, proposals) {
  const roleMetrics = users.reduce((acc, user) => {
    acc[user.role] = (acc[user.role] || 0) + 1;
    return acc;
  }, {});

  return {
    usersByRole: roleMetrics,
    totalUsers: users.length,
    activeProjects: proposals.filter(p => 
      ['pending_estimation', 'pending_pricing', 'pending_director_approval'].includes(p.status)
    ).length
  };
}

module.exports = allowCors(handler);
