// api/proposals.js - Works with REST firebase-config.js
const { db, helpers } = require('../firebase-config');
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
    if (req.method === 'GET') {
      return await getProposals(req, res);
    } else if (req.method === 'POST') {
      return await createProposal(req, res);
    } else if (req.method === 'PUT') {
      return await updateProposal(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Proposals API error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
};

async function getProposals(req, res) {
  try {
    // For now, work without authentication to test Firebase connection
    const { id } = req.query;
    
    console.log('Getting proposals from Firebase...');
    
    if (id) {
      // Get specific proposal
      const proposalDoc = await db.collection('proposals').doc(id).get();
      if (!proposalDoc.exists) {
        return res.status(404).json({ 
          success: false,
          error: 'Proposal not found' 
        });
      }
      
      return res.json({
        success: true,
        data: { id: proposalDoc.id, ...proposalDoc.data() },
        dataSource: 'firebase_rest'
      });
    }

    // Get all proposals
    const snapshot = await db.collection('proposals').get();
    
    const proposals = [];
    snapshot.forEach(doc => {
      proposals.push({ id: doc.id, ...doc.data() });
    });

    // Sort by creation date (newest first)
    proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      data: proposals,
      dataSource: 'firebase_rest',
      total: proposals.length,
      message: 'Successfully connected to Firebase via REST API'
    });

  } catch (error) {
    console.error('Get proposals error:', error);
    
    // If Firebase fails, return helpful error info
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch proposals from Firebase',
      message: error.message,
      troubleshooting: {
        checkFirebaseProjectId: !!process.env.FIREBASE_PROJECT_ID,
        checkFirebaseApiKey: !!process.env.FIREBASE_API_KEY,
        errorType: error.message.includes('404') ? 'Collection not found' : 
                   error.message.includes('403') ? 'Permission denied' : 'Connection error'
      }
    });
  }
}

async function createProposal(req, res) {
  try {
    const {
      projectName,
      projectType,
      clientCompany,
      scopeOfWork,
      priority = 'Medium'
    } = req.body;

    if (!projectName || !clientCompany || !projectType || !scopeOfWork) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields',
        required: ['projectName', 'clientCompany', 'projectType', 'scopeOfWork']
      });
    }

    const currentTimestamp = new Date().toISOString();
    
    const proposalData = {
      projectName: projectName.trim(),
      projectType,
      clientCompany: clientCompany.trim(),
      scopeOfWork: scopeOfWork.trim(),
      priority,
      status: 'pending_estimation',
      currentStage: 'estimation',
      
      // Mock user data for now
      createdBy: 'demo-user',
      createdByName: 'Demo User',
      createdByEmail: 'demo@edanbrook.com',
      createdAt: currentTimestamp,
      updatedAt: currentTimestamp,

      estimation: null,
      pricing: null,
      directorApproval: null,
      
      changeLog: [{
        timestamp: currentTimestamp,
        action: 'created',
        performedBy: 'demo-user',
        performedByName: 'Demo User',
        details: 'Proposal created via REST API'
      }]
    };

    const docRef = await db.collection('proposals').add(proposalData);

    // Log activity
    await helpers.logActivity({
      type: 'proposal_created',
      proposalId: docRef.id,
      projectName,
      clientCompany,
      performedBy: 'demo-user',
      performedByName: 'Demo User',
      performedByRole: 'bdm',
      details: `New proposal created for ${clientCompany}: ${projectName}`
    });

    res.status(201).json({
      success: true,
      message: 'Proposal created successfully in Firebase',
      proposalId: docRef.id,
      data: { id: docRef.id, ...proposalData }
    });

  } catch (error) {
    console.error('Create proposal error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create proposal in Firebase',
      message: error.message
    });
  }
}

async function updateProposal(req, res) {
  try {
    const { id } = req.query;
    const { action, data } = req.body;

    if (!id || !action) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing proposal ID or action' 
      });
    }

    const proposalDoc = await db.collection('proposals').doc(id).get();

    if (!proposalDoc.exists) {
      return res.status(404).json({ 
        success: false,
        error: 'Proposal not found' 
      });
    }

    const proposal = proposalDoc.data();
    const currentTimestamp = new Date().toISOString();
    let updateData = { 
      updatedAt: currentTimestamp
    };

    // Handle different workflow actions
    switch (action) {
      case 'add_estimation':
        updateData = {
          ...updateData,
          status: 'pending_pricing',
          currentStage: 'pricing',
          estimation: {
            totalHours: parseFloat(data.totalHours) || 0,
            quoteType: data.quoteType,
            estimatedBy: 'demo-estimator',
            estimatedByName: 'Demo Estimator',
            estimatedAt: currentTimestamp,
            notes: data.notes || ''
          }
        };
        break;

      case 'set_pricing':
        updateData = {
          ...updateData,
          status: 'pending_director_approval',
          currentStage: 'director_approval',
          pricing: {
            hourlyRate: parseFloat(data.hourlyRate),
            profitMargin: parseFloat(data.profitMargin),
            quoteValue: parseFloat(data.quoteValue),
            pricedBy: 'demo-coo',
            pricedByName: 'Demo COO',
            pricedAt: currentTimestamp
          }
        };
        break;

      case 'director_approve':
        updateData = {
          ...updateData,
          status: 'approved',
          currentStage: 'approved',
          directorApproval: {
            approved: true,
            approvedBy: 'demo-director',
            approvedByName: 'Demo Director',
            approvedAt: currentTimestamp,
            notes: data.notes || ''
          }
        };
        break;

      case 'director_reject':
        updateData = {
          ...updateData,
          status: 'rejected',
          currentStage: 'rejected',
          directorApproval: {
            approved: false,
            rejectedBy: 'demo-director',
            rejectedByName: 'Demo Director',
            rejectedAt: currentTimestamp,
            rejectionReason: data.rejectionReason || ''
          }
        };
        break;

      case 'submit_to_client':
        updateData = {
          ...updateData,
          status: 'submitted_to_client',
          currentStage: 'client_review'
        };
        break;

      default:
        return res.status(400).json({ 
          success: false,
          error: 'Invalid action' 
        });
    }

    // Add to change log
    const changeLogEntry = {
      timestamp: currentTimestamp,
      action,
      performedBy: 'demo-user',
      performedByName: 'Demo User',
      details: `${action.replace(/_/g, ' ')} completed via REST API`
    };

    const changeLog = proposal.changeLog || [];
    changeLog.push(changeLogEntry);
    updateData.changeLog = changeLog;

    await db.collection('proposals').doc(id).update(updateData);

    // Log activity
    await helpers.logActivity({
      type: `proposal_${action}`,
      proposalId: id,
      projectName: proposal.projectName,
      clientCompany: proposal.clientCompany,
      performedBy: 'demo-user',
      performedByName: 'Demo User',
      performedByRole: 'demo',
      details: `${action.replace(/_/g, ' ')} completed for ${proposal.projectName}`
    });

    res.json({
      success: true,
      message: 'Proposal updated successfully in Firebase',
      data: { id, ...proposal, ...updateData }
    });

  } catch (error) {
    console.error('Update proposal error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update proposal in Firebase',
      message: error.message
    });
  }
}

module.exports = allowCors(handler);
