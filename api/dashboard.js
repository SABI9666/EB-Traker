// api/dashboard.js - Hybrid approach with Firebase fallback to mock data
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
    let dashboardData;
    let dataSource = 'mock'; // Track data source for debugging
    
    // Try Firebase first, fall back to mock data if it fails
    try {
      const { db, helpers } = require('../firebase-config');
      const { verifyToken } = require('../middleware/auth');

      // Try Firebase authentication and data fetch
      await new Promise((resolve, reject) => {
        verifyToken(req, res, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // If auth succeeds, try to get real data
      const { role, uid } = req.user;
      
      let proposalsQuery = db.collection('proposals');
      if (role === 'bdm') {
        proposalsQuery = proposalsQuery.where('createdBy', '==', uid);
      }
      
      const proposalsSnapshot = await proposalsQuery.get();
      const proposals = [];
      proposalsSnapshot.forEach(doc => {
        proposals.push({ id: doc.id, ...doc.data() });
      });

      // Calculate real stats
      const totalProposals = proposals.length;
      const activeProposals = proposals.filter(p => 
        ['pending_estimation', 'pending_pricing', 'pending_director_approval'].includes(p.status)
      ).length;
      const approvedProposals = proposals.filter(p => p.status === 'approved').length;

      // Get real activities
      const activitiesSnapshot = await db.collection('activities')
        .orderBy('timestamp', 'desc')
        .limit(5)
        .get();
      
      const recentActivities = [];
      activitiesSnapshot.forEach(doc => {
        const data = doc.data();
        recentActivities.push({
          id: doc.id,
          details: data.details,
          timestamp: data.timestamp,
          performedByName: data.performedByName
        });
      });

      dashboardData = {
        stats: {
          totalProposals,
          activeProposals,
          approvedProposals,
          pipelineValue: '$0', // Calculate when pricing data available
          winRate: totalProposals > 0 ? `${Math.round((approvedProposals / totalProposals) * 100)}%` : '0%'
        },
        actionItems: [], // Will be populated based on role and proposals
        recentActivities
      };

      dataSource = 'firebase';
      console.log('Successfully fetched Firebase data');

    } catch (firebaseError) {
      console.log('Firebase unavailable, using mock data:', firebaseError.message);
      
      // Fall back to mock data
      dashboardData = {
        stats: {
          totalProposals: 12,
          activeProposals: 5,
          approvedProposals: 7,
          submittedProposals: 3,
          pipelineValue: '$450,000',
          winRate: '58%'
        },
        actionItems: [
          {
            type: 'estimation_required',
            proposalId: 'mock-proposal-1',
            projectName: 'Office Building Electrical Upgrade',
            clientCompany: 'TechCorp Industries'
          },
          {
            type: 'pricing_required', 
            proposalId: 'mock-proposal-2',
            projectName: 'Factory Automation System',
            clientCompany: 'Manufacturing Ltd'
          }
        ],
        recentActivities: [
          {
            id: 'activity-1',
            details: 'New proposal created for TechCorp Industries',
            timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            performedByName: 'John Smith'
          },
          {
            id: 'activity-2', 
            details: 'Estimation completed for Manufacturing Ltd project',
            timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
            performedByName: 'Sarah Johnson'
          }
        ]
      };
    }

    res.status(200).json({
      success: true,
      data: dashboardData,
      generatedAt: new Date().toISOString(),
      dataSource: dataSource,
      message: dataSource === 'mock' ? 'Using mock data - Firebase not configured' : 'Real Firebase data'
    });

  } catch (error) {
    console.error('Dashboard API error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Dashboard API error', 
      message: error.message
    });
  }
};

module.exports = allowCors(handler);
