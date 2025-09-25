// api/dashboard.js - Updated with robust Firebase handling
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
    let dataSource = 'mock';
    let errorMessage = '';

    // Try Firebase first
    try {
      const firebaseConfig = require('../firebase-config');
      
      if (firebaseConfig.isFirebaseAvailable) {
        // Try to use Firebase
        console.log('Attempting Firebase connection...');
        
        // Mock auth check for now (since we'd need to implement full auth)
        const mockUser = {
          uid: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          role: 'bdm'
        };

        const { db } = firebaseConfig;
        
        // Try a simple Firestore query
        const testQuery = await db.collection('proposals').limit(1).get();
        console.log('Firebase query successful, docs found:', testQuery.size);

        // Get real proposals if available
        let proposalsQuery = db.collection('proposals');
        if (mockUser.role === 'bdm') {
          // In real implementation, filter by user
          // proposalsQuery = proposalsQuery.where('createdBy', '==', mockUser.uid);
        }
        
        const proposalsSnapshot = await proposalsQuery.limit(50).get();
        const proposals = [];
        proposalsSnapshot.forEach(doc => {
          proposals.push({ id: doc.id, ...doc.data() });
        });

        // Calculate real statistics
        const totalProposals = proposals.length;
        const activeProposals = proposals.filter(p => 
          ['pending_estimation', 'pending_pricing', 'pending_director_approval'].includes(p.status)
        ).length;
        const approvedProposals = proposals.filter(p => p.status === 'approved').length;
        const submittedProposals = proposals.filter(p => p.status === 'submitted_to_client').length;

        // Calculate pipeline value
        const pipelineValue = proposals
          .filter(p => p.pricing && p.pricing.quoteValue)
          .reduce((sum, p) => sum + parseFloat(p.pricing.quoteValue || 0), 0);

        // Get recent activities
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
            performedByName: data.performedByName,
            performedByRole: data.performedByRole
          });
        });

        dashboardData = {
          stats: {
            totalProposals,
            activeProposals,
            approvedProposals,
            submittedProposals,
            pipelineValue: `$${pipelineValue.toLocaleString()}`,
            winRate: totalProposals > 0 ? `${Math.round((approvedProposals / totalProposals) * 100)}%` : '0%'
          },
          actionItems: [], // Would be populated based on user role and proposals
          recentActivities
        };

        dataSource = 'firebase';
        console.log('Successfully using Firebase data');

      } else {
        throw new Error('Firebase not initialized');
      }

    } catch (firebaseError) {
      console.log('Firebase error:', firebaseError.message);
      errorMessage = firebaseError.message;

      // Fall back to comprehensive mock data
      dashboardData = {
        stats: {
          totalProposals: 15,
          activeProposals: 8,
          approvedProposals: 5,
          submittedProposals: 2,
          pipelineValue: '$680,000',
          winRate: '33%'
        },
        actionItems: [
          {
            type: 'estimation_required',
            proposalId: 'mock-prop-1',
            projectName: 'Office Building Electrical Upgrade',
            clientCompany: 'TechCorp Industries',
            priority: 'high'
          },
          {
            type: 'pricing_required', 
            proposalId: 'mock-prop-2',
            projectName: 'Factory Automation System',
            clientCompany: 'Manufacturing Ltd',
            priority: 'medium'
          },
          {
            type: 'approval_required',
            proposalId: 'mock-prop-3',
            projectName: 'Data Center Infrastructure',
            clientCompany: 'CloudTech Solutions',
            priority: 'high'
          }
        ],
        recentActivities: [
          {
            id: 'activity-1',
            details: 'New proposal created for TechCorp Industries',
            timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
            performedByName: 'John Smith',
            performedByRole: 'BDM'
          },
          {
            id: 'activity-2', 
            details: 'Estimation completed for Manufacturing Ltd project',
            timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
            performedByName: 'Sarah Johnson',
            performedByRole: 'Estimator'
          },
          {
            id: 'activity-3',
            details: 'Pricing approved for CloudTech Solutions proposal',
            timestamp: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
            performedByName: 'Mike Wilson',
            performedByRole: 'COO'
          },
          {
            id: 'activity-4',
            details: 'Director approval granted for HealthTech Medical Center',
            timestamp: new Date(Date.now() - 1000 * 60 * 360).toISOString(),
            performedByName: 'Director Johnson',
            performedByRole: 'Director'
          }
        ]
      };
    }

    res.status(200).json({
      success: true,
      data: dashboardData,
      generatedAt: new Date().toISOString(),
      dataSource: dataSource,
      message: dataSource === 'firebase' ? 'Using real Firebase data' : `Using mock data - Firebase issue: ${errorMessage}`,
      firebaseStatus: {
        available: dataSource === 'firebase',
        error: dataSource === 'mock' ? errorMessage : null,
        environmentVariables: {
          hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
          hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
          hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL
        }
      }
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
