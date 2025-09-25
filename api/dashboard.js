// api/dashboard.js - Temporary mock version for testing
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
    console.log('Mock dashboard API called');
    
    // Mock data that matches your frontend expectations
    const mockData = {
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
        },
        {
          type: 'approval_required',
          proposalId: 'mock-proposal-3', 
          projectName: 'Data Center Infrastructure',
          clientCompany: 'CloudTech Solutions'
        }
      ],
      recentActivities: [
        {
          id: 'activity-1',
          details: 'New proposal created for TechCorp Industries',
          timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 mins ago
          performedByName: 'John Smith',
          performedByRole: 'BDM'
        },
        {
          id: 'activity-2', 
          details: 'Estimation completed for Manufacturing Ltd project',
          timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), // 2 hours ago
          performedByName: 'Sarah Johnson',
          performedByRole: 'Estimator'
        },
        {
          id: 'activity-3',
          details: 'Pricing approved for CloudTech Solutions proposal',
          timestamp: new Date(Date.now() - 1000 * 60 * 240).toISOString(), // 4 hours ago
          performedByName: 'Mike Wilson',
          performedByRole: 'COO'
        }
      ]
    };

    res.status(200).json({
      success: true,
      data: mockData,
      generatedAt: new Date().toISOString(),
      message: 'Using mock data - replace with Firebase integration',
      userRole: 'bdm' // Mock role
    });

  } catch (error) {
    console.error('Mock dashboard error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Mock API error', 
      message: error.message
    });
  }
};

module.exports = allowCors(handler);
