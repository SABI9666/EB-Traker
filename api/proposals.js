
// =================================
// api/proposals.js - No dependencies
// =================================
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

// In-memory database (persists during session)
let proposalsDB = [
  {
    id: 'prop-1',
    projectName: 'Office Building Electrical Upgrade',
    clientCompany: 'TechCorp Industries',
    projectType: 'Commercial',
    status: 'pending_estimation',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    createdByName: 'John Smith',
    priority: 'High',
    scopeOfWork: 'Complete electrical system upgrade for 5-story office building including panel replacement, wiring updates, and LED lighting conversion.',
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
    id: 'prop-2',
    projectName: 'Factory Automation System',
    clientCompany: 'Manufacturing Ltd',
    projectType: 'Industrial',
    status: 'pending_pricing',
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    createdByName: 'Sarah Johnson',
    priority: 'Medium',
    scopeOfWork: 'Install automated control systems for production line including PLC programming and HMI interfaces.',
    estimation: {
      totalHours: 150,
      quoteType: 'Lump Sum',
      estimatedBy: 'Technical Team',
      estimatedAt: new Date(Date.now() - 86400000).toISOString(),
      notes: 'Includes programming, testing, and 2-week commissioning period'
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
        performedByName: 'Technical Team',
        details: 'Estimation completed: 150 total hours'
      }
    ]
  },
  {
    id: 'prop-3',
    projectName: 'Data Center Infrastructure',
    clientCompany: 'CloudTech Solutions',
    projectType: 'Commercial',
    status: 'pending_director_approval',
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    createdByName: 'Mike Wilson',
    priority: 'High',
    scopeOfWork: 'Design and install power and cooling systems for new data center including UPS, generators, and precision cooling units.',
    estimation: {
      totalHours: 280,
      quoteType: 'Lump Sum',
      estimatedBy: 'Senior Engineer',
      estimatedAt: new Date(Date.now() - 172800000).toISOString(),
      notes: 'Complex installation requiring specialized equipment and certified technicians'
    },
    pricing: {
      hourlyRate: 95,
      quoteValue: 75000,
      profitMargin: 28,
      pricedBy: 'COO',
      pricedAt: new Date(Date.now() - 86400000).toISOString(),
      breakdown: {
        laborCost: 26600,
        materialsCost: 35000,
        overheadCost: 8400,
        profitAmount: 21000
      }
    },
    directorApproval: null,
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
        details: 'Estimation completed: 280 total hours'
      },
      {
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        action: 'pricing_set',
        performedByName: 'COO',
        details: 'Pricing set: $75,000 with 28% margin'
      }
    ]
  },
  {
    id: 'prop-4',
    projectName: 'Medical Equipment Installation',
    clientCompany: 'Healthcare Systems Inc',
    projectType: 'Commercial',
    status: 'approved',
    createdAt: new Date(Date.now() - 345600000).toISOString(),
    createdByName: 'Emily Davis',
    priority: 'Medium',
    scopeOfWork: 'Install electrical systems for new MRI and CT scan equipment including isolated power systems.',
    estimation: {
      totalHours: 180,
      quoteType: 'Lump Sum',
      estimatedBy: 'Medical Specialist',
      estimatedAt: new Date(Date.now() - 259200000).toISOString(),
      notes: 'Requires hospital-grade isolated power systems and emergency backup'
    },
    pricing: {
      hourlyRate: 105,
      quoteValue: 45000,
      profitMargin: 22,
      pricedBy: 'COO',
      pricedAt: new Date(Date.now() - 172800000).toISOString()
    },
    directorApproval: {
      approved: true,
      approvedBy: 'Director Johnson',
      approvedAt: new Date(Date.now() - 43200000).toISOString(),
      notes: 'Approved - excellent client with repeat business potential'
    },
    changeLog: [
      {
        timestamp: new Date(Date.now() - 345600000).toISOString(),
        action: 'created',
        performedByName: 'Emily Davis',
        details: 'Proposal created'
      },
      {
        timestamp: new Date(Date.now() - 259200000).toISOString(),
        action: 'estimation_completed',
        performedByName: 'Medical Specialist',
        details: 'Estimation completed with medical equipment requirements'
      },
      {
        timestamp: new Date(Date.now() - 172800000).toISOString(),
        action: 'pricing_set',
        performedByName: 'COO',
        details: 'Pricing set: $45,000'
      },
      {
        timestamp: new Date(Date.now() - 43200000).toISOString(),
        action: 'director_approved',
        performedByName: 'Director Johnson',
        details: 'Executive approval granted'
      }
    ]
  }
];

let activitiesDB = [];
let nextProposalId = 5;
let nextActivityId = 1;

const handler = async (req, res) => {
  try {
    console.log('Proposals API called:', req.method);

    if (req.method === 'GET') {
      const { id } = req.query;
      
      if (id) {
        const proposal = proposalsDB.find(p => p.id === id);
        if (!proposal) {
          return res.status(404).json({ 
            success: false, 
            error: 'Proposal not found' 
          });
        }
        
        return res.json({
          success: true,
          data: proposal,
          dataSource: 'functional_system'
        });
      }

      return res.json({
        success: true,
        data: proposalsDB,
        dataSource: 'functional_system',
        message: 'Fully functional proposal management system'
      });
    }
    
    if (req.method === 'POST') {
      const {
        projectName,
        clientCompany,
        projectType,
        scopeOfWork,
        priority = 'Medium'
      } = req.body;

      if (!projectName || !clientCompany || !scopeOfWork) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          required: ['projectName', 'clientCompany', 'scopeOfWork']
        });
      }

      const proposalId = `prop-${nextProposalId++}`;
      const currentTimestamp = new Date().toISOString();

      const newProposal = {
        id: proposalId,
        projectName: projectName.trim(),
        clientCompany: clientCompany.trim(),
        projectType: projectType || 'Commercial',
        scopeOfWork: scopeOfWork.trim(),
        priority,
        status: 'pending_estimation',
        createdAt: currentTimestamp,
        createdByName: 'Demo User',
        estimation: null,
        pricing: null,
        directorApproval: null,
        changeLog: [
          {
            timestamp: currentTimestamp,
            action: 'created',
            performedByName: 'Demo User',
            details: 'Proposal created'
          }
        ]
      };

      proposalsDB.unshift(newProposal);

      // Add activity
      activitiesDB.unshift({
        id: `activity-${nextActivityId++}`,
        type: 'proposal_created',
        details: `New proposal created: ${projectName} for ${clientCompany}`,
        performedByName: 'Demo User',
        performedByRole: 'BDM',
        timestamp: currentTimestamp,
        proposalId: proposalId,
        projectName: projectName,
        clientCompany: clientCompany
      });

      return res.status(201).json({
        success: true,
        message: 'Proposal created successfully',
        data: newProposal
      });
    }

    if (req.method === 'PUT') {
      const { id } = req.query;
      const { action, data } = req.body;

      if (!id || !action) {
        return res.status(400).json({
          success: false,
          error: 'Missing proposal ID or action'
        });
      }

      const proposalIndex = proposalsDB.findIndex(p => p.id === id);
      if (proposalIndex === -1) {
        return res.status(404).json({
          success: false,
          error: 'Proposal not found'
        });
      }

      const proposal = proposalsDB[proposalIndex];
      const currentTimestamp = new Date().toISOString();
      let updates = {};
      let activityDetail = '';

      switch (action) {
        case 'add_estimation':
          updates = {
            status: 'pending_pricing',
            estimation: {
              totalHours: parseInt(data.totalHours) || 0,
              quoteType: data.quoteType || 'Lump Sum',
              estimatedBy: 'Demo User',
              estimatedAt: currentTimestamp,
              notes: data.notes || ''
            }
          };
          activityDetail = `Estimation added: ${data.totalHours} hours for ${proposal.projectName}`;
          break;

        case 'set_pricing':
          updates = {
            status: 'pending_director_approval',
            pricing: {
              hourlyRate: parseFloat(data.hourlyRate) || 0,
              profitMargin: parseFloat(data.profitMargin) || 0,
              quoteValue: parseFloat(data.quoteValue) || 0,
              pricedBy: 'Demo User',
              pricedAt: currentTimestamp
            }
          };
          activityDetail = `Pricing set: $${data.quoteValue} with ${data.profitMargin}% margin`;
          break;

        case 'director_approve':
          updates = {
            status: 'approved',
            directorApproval: {
              approved: true,
              approvedBy: 'Demo User',
              approvedAt: currentTimestamp,
              notes: data.notes || 'Approved'
            }
          };
          activityDetail = `Director approved ${proposal.projectName}`;
          break;

        case 'director_reject':
          updates = {
            status: 'rejected',
            directorApproval: {
              approved: false,
              rejectedBy: 'Demo User',
              rejectedAt: currentTimestamp,
              rejectionReason: data.rejectionReason || 'Not specified'
            }
          };
          activityDetail = `Director rejected ${proposal.projectName}`;
          break;

        case 'submit_to_client':
          updates = {
            status: 'submitted_to_client'
          };
          activityDetail = `Proposal submitted to client: ${proposal.projectName}`;
          break;

        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid action'
          });
      }

      const updatedProposal = { ...proposal, ...updates };
      
      const changeLogEntry = {
        timestamp: currentTimestamp,
        action: action,
        performedByName: 'Demo User',
        details: `${action.replace(/_/g, ' ')} completed`
      };
      
      updatedProposal.changeLog = [...(proposal.changeLog || []), changeLogEntry];
      updatedProposal.updatedAt = currentTimestamp;

      proposalsDB[proposalIndex] = updatedProposal;

      // Add activity
      activitiesDB.unshift({
        id: `activity-${nextActivityId++}`,
        type: `proposal_${action}`,
        details: activityDetail,
        performedByName: 'Demo User',
        performedByRole: 'Demo',
        timestamp: currentTimestamp,
        proposalId: id,
        projectName: proposal.projectName,
        clientCompany: proposal.clientCompany
      });

      return res.json({
        success: true,
        message: `Proposal ${action.replace(/_/g, ' ')} completed successfully`,
        data: updatedProposal
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
