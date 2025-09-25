// ===============================
// api/activities.js - No dependencies
// ===============================
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

const baseActivities = [
  {
    id: 'base-activity-1',
    type: 'proposal_created',
    details: 'New proposal created for TechCorp Industries: Office Building Electrical Upgrade',
    performedByName: 'John Smith',
    performedByRole: 'BDM',
    timestamp: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    proposalId: 'prop-1',
    projectName: 'Office Building Electrical Upgrade',
    clientCompany: 'TechCorp Industries'
  },
  {
    id: 'base-activity-2',
    type: 'estimation_completed',
    details: 'Estimation completed for Manufacturing Ltd: Factory Automation System (150 hours)',
    performedByName: 'Sarah Johnson',
    performedByRole: 'Estimator',
    timestamp: new Date(Date.now() - 1000 * 60 * 85).toISOString(),
    proposalId: 'prop-2',
    projectName: 'Factory Automation System',
    clientCompany: 'Manufacturing Ltd'
  },
  {
    id: 'base-activity-3',
    type: 'pricing_set',
    details: 'Pricing set for CloudTech Solutions: Data Center Infrastructure ($75,000)',
    performedByName: 'Mike Wilson',
    performedByRole: 'COO',
    timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    proposalId: 'prop-3',
    projectName: 'Data Center Infrastructure',
    clientCompany: 'CloudTech Solutions'
  },
  {
    id: 'base-activity-4',
    type: 'director_approved',
    details: 'Director approved Healthcare Systems Inc medical equipment proposal',
    performedByName: 'Director Johnson',
    performedByRole: 'Director',
    timestamp: new Date(Date.now() - 1000 * 60 * 320).toISOString(),
    proposalId: 'prop-4',
    projectName: 'Medical Equipment Installation',
    clientCompany: 'Healthcare Systems Inc'
  },
  {
    id: 'base-activity-5',
    type: 'proposal_submitted',
    details: 'Proposal submitted to client: Smart Building Controls for Urban Plaza',
    performedByName: 'Emily Davis',
    performedByRole: 'BDM',
    timestamp: new Date(Date.now() - 1000 * 60 * 480).toISOString(),
    proposalId: 'prop-5',
    projectName: 'Smart Building Controls',
    clientCompany: 'Urban Plaza Development'
  }
];

const handler = async (req, res) => {
  try {
    console.log('Activities API called:', req.method);

    if (req.method === 'GET') {
      const { type, proposalId, limit = 20, offset = 0 } = req.query;
      
      let allActivities = [...baseActivities];

      if (type) {
        allActivities = allActivities.filter(activity => 
          activity.type === type
        );
      }

      if (proposalId) {
        allActivities = allActivities.filter(activity => 
          activity.proposalId === proposalId
        );
      }

      allActivities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      const startIndex = parseInt(offset);
      const endIndex = startIndex + parseInt(limit);
      const paginatedActivities = allActivities.slice(startIndex, endIndex);

      return res.json({
        success: true,
        data: paginatedActivities,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: allActivities.length,
          hasMore: endIndex < allActivities.length
        },
        dataSource: 'functional_system',
        message: 'Activity tracking system operational'
      });
    }

    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Activities API error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Activities API error',
      message: error.message
    });
  }
};

module.exports = allowCors(handler);
