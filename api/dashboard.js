const { db } = require('../firebase-config');
const { verifyToken } = require('../middleware/auth');

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
    await verifyToken(req, res, async () => {
      const { role } = req.user;
      
      const dashboardData = {
        stats: {
          totalProposals: 0,
          activeProposals: 0,
          approvedProposals: 0,
          pipelineValue: '$0',
          winRate: '0%'
        },
        actionItems: [],
        recentActivities: []
      };

      res.status(200).json({
        success: true,
        data: dashboardData,
        generatedAt: new Date().toISOString(),
        userRole: role
      });
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: 'Internal server error', 
      message: error.message
    });
  }
};

module.exports = allowCors(handler);
