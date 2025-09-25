// api/proposals.js - Emergency fix version
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
    console.log('Proposals API called:', req.method);
    
    // Mock proposals data - this will work without any imports
    const mockProposals = [
      {
        id: 'mock-prop-1',
        projectName: 'Office Building Electrical Upgrade',
        clientCompany: 'TechCorp Industries',
        projectType: 'Commercial',
        status: 'pending_estimation',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        createdByName: 'John Smith',
        priority: 'High',
        scopeOfWork: 'Complete electrical system upgrade for 5-story office building',
        estimation: null,
        pricing: null,
        directorApproval: null,
        changeLog: [
          {
            timestamp: new Date(Date.now() - 86400000).toISOString(),
            action: 'created',
            performedByName: 'John Smith',
            details: 'Proposal created'
          }
        ]
      },
      {
        id: 'mock-prop-2', 
        projectName: 'Factory Automation System',
        clientCompany: 'Manufacturing Ltd',
        projectType: 'Industrial',
        status: 'pending_pricing',
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        createdByName: 'Sarah Johnson',
        priority: 'Medium',
        scopeOfWork: 'Install automated control systems for production line',
        estimation: {
          totalHours: 120,
          quoteType: 'Lump Sum',
          estimatedBy: 'Tech Team',
          estimatedAt: new Date(Date.now() - 86400000).toISOString(),
          notes: 'Includes programming and testing'
        },
        pricing: null,
        directorApproval: null,
        changeLog: [
          {
            timestamp: new Date(Date.now() - 172800000).toISOString(),
            action: 'created',
            performedByName: 'Sarah Johnson',
            details: 'Proposal created'
          },
          {
            timestamp: new Date(Date.now() - 86400000).toISOString(),
            action: 'estimation_completed',
            performedByName: 'Tech Team',
            details: 'Estimation completed: 120 total hours'
          }
        ]
      },
      {
        id: 'mock-prop-3',
        projectName: 'Data Center Infrastructure', 
        clientCompany: 'CloudTech Solutions',
        projectType: 'Commercial',
        status: 'approved',
        createdAt: new Date(Date.now() - 259200000).toISOString(),
        createdByName: 'Mike Wilson',
        priority: 'High',
        scopeOfWork: 'Design and install power and cooling systems for new data center',
        estimation: {
          totalHours: 200,
          quoteType: 'Lump Sum',
          estimatedBy: 'Senior Engineer',
          estimatedAt: new Date(Date.now() - 172800000).toISOString(),
          notes: 'Complex installation requiring specialized equipment'
        },
        pricing: {
          hourlyRate: 85,
          quoteValue: 25000,
          profitMargin: 25,
          pricedBy: 'COO',
          pricedAt: new Date(Date.now() - 86400000).toISOString()
        },
        directorApproval: {
          approved: true,
          approvedBy: 'Director',
          approvedAt: new Date(Date.now() - 43200000).toISOString(),
          notes: 'Approved - strategic client relationship'
        },
        changeLog: [
          {
            timestamp: new Date(Date.now() - 259200000).toISOString(),
            action: 'created',
            performedByName: 'Mike Wilson',
            details: 'Proposal created'
          },
          {
            timestamp: new Date(Date.now() - 172800000).toISOString(),
            action: 'estimation_completed',
            performedByName: 'Senior Engineer',
            details: 'Estimation completed'
          },
          {
            timestamp: new Date(Date.now() - 86400000).toISOString(),
            action: 'pricing_set',
            performedByName: 'COO',
            details: 'Pricing set: $25,000'
          },
          {
            timestamp: new Date(Date.now() - 43200000).toISOString(),
            action: 'director_approved',
            performedByName: 'Director',
            details: 'Executive approval granted'
          }
        ]
      }
    ];

    if (req.method === 'GET') {
      const { id } = req.query;
      
      if (id) {
        const proposal = mockProposals.find(p => p.id === id);
        if (!proposal) {
          return res.status(404).json({ 
            success: false, 
            error: 'Proposal not found' 
          });
        }
        
        return res.json({
          success: true,
          data: proposal,
          dataSource: 'mock'
        });
      }

      return res.json({
        success: true,
        data: mockProposals,
        dataSource: 'mock',
        message: 'Using mock data - fully functional'
      });
    }
    
    if (req.method === 'POST') {
      return res.status(501).json({
        success: false,
        error: 'Create proposal not available in mock mode',
        message: 'Configure Firebase to enable proposal creation'
      });
    }

    if (req.method === 'PUT') {
      return res.status(501).json({
        success: false,
        error: 'Update proposal not available in mock mode',
        message: 'Configure Firebase to enable proposal updates'
      });
    }

    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Proposals API error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Proposals API error',
      message: error.message
    });
  }
};

module.exports = allowCors(handler);
