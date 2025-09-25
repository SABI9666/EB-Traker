const { db, helpers } = require('../firebase-config');
const { verifyToken, requireRole } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

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
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Get proposals
async function getProposals(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { role, uid } = req.user;
      const { id, limit = 50 } = req.query;
      
      if (id) {
        // Get specific proposal
        const proposalDoc = await db.collection('proposals').doc(id).get();
        if (!proposalDoc.exists) {
          return res.status(404).json({ error: 'Proposal not found' });
        }
        
        return res.json({
          success: true,
          data: { id: proposalDoc.id, ...proposalDoc.data() }
        });
      }

      // Get proposals list based on role
      let query = db.collection('proposals');
      
      if (role === 'bdm') {
        query = query.where('createdBy', '==', uid);
      } else if (role === 'estimator') {
        query = query.where('status', '==', 'pending_estimation');
      } else if (role === 'coo') {
        query = query.where('status', '==', 'pending_pricing');
      } else if (role === 'director') {
        // Directors can see all proposals
      }

      const snapshot = await query.orderBy('createdAt', 'desc').limit(parseInt(limit)).get();
      
      const proposals = [];
      snapshot.forEach(doc => {
        proposals.push({ id: doc.id, ...doc.data() });
      });

      res.json({
        success: true,
        data: proposals
      });

    } catch (error) {
      console.error('Get proposals error:', error);
      res.status(500).json({ error: 'Failed to fetch proposals' });
    }
  });
}

// Create new proposal (BDM only)
async function createProposal(req, res) {
  await verifyToken(req, res, async () => {
    try {
      if (req.user.role !== 'bdm') {
        return res.status(403).json({ error: 'Only BDMs can create proposals' });
      }

      const {
        projectName,
        projectType,
        clientCompany,
        scopeOfWork,
        priority = 'Medium'
      } = req.body;

      if (!projectName || !clientCompany || !projectType || !scopeOfWork) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          required: ['projectName', 'clientCompany', 'projectType', 'scopeOfWork']
        });
      }

      const proposalId = uuidv4();
      const currentTimestamp = new Date().toISOString();
      
      const proposalData = {
        id: proposalId,
        projectName: projectName.trim(),
        projectType,
        clientCompany: clientCompany.trim(),
        scopeOfWork: scopeOfWork.trim(),
        priority,
        status: 'pending_estimation',
        currentStage: 'estimation',
        
        createdBy: req.user.uid,
        createdByName: req.user.name,
        createdByEmail: req.user.email,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,

        estimation: null,
        pricing: null,
        directorApproval: null,
        
        changeLog: [{
          timestamp: currentTimestamp,
          action: 'created',
          performedBy: req.user.uid,
          performedByName: req.user.name,
          details: 'Proposal created'
        }]
      };

      await db.collection('proposals').doc(proposalId).set(proposalData);

      // Log activity
      await helpers.logActivity({
        type: 'proposal_created',
        proposalId,
        projectName,
        clientCompany,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: `New proposal created for ${clientCompany}: ${projectName}`
      });

      res.status(201).json({
        success: true,
        message: 'Proposal created successfully',
        proposalId,
        data: proposalData
      });

    } catch (error) {
      console.error('Create proposal error:', error);
      res.status(500).json({ error: 'Failed to create proposal' });
    }
  });
}

// Update proposal (workflow progression)
async function updateProposal(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { id } = req.query;
      const { action, data } = req.body;

      if (!id || !action) {
        return res.status(400).json({ error: 'Missing proposal ID or action' });
      }

      const proposalRef = db.collection('proposals').doc(id);
      const proposalDoc = await proposalRef.get();

      if (!proposalDoc.exists) {
        return res.status(404).json({ error: 'Proposal not found' });
      }

      const proposal = proposalDoc.data();
      const currentTimestamp = new Date().toISOString();
      let updateData = { 
        updatedAt: currentTimestamp
      };

      // Handle different workflow actions
      switch (action) {
        case 'add_estimation':
          if (req.user.role !== 'estimator') {
            return res.status(403).json({ error: 'Only estimators can add estimations' });
          }
          
          updateData = {
            ...updateData,
            status: 'pending_pricing',
            currentStage: 'pricing',
            estimation: {
              totalHours: parseFloat(data.totalHours) || 0,
              quoteType: data.quoteType,
              estimatedBy: req.user.uid,
              estimatedByName: req.user.name,
              estimatedAt: currentTimestamp,
              notes: data.notes || ''
            }
          };
          break;

        case 'set_pricing':
          if (req.user.role !== 'coo') {
            return res.status(403).json({ error: 'Only COO can set pricing' });
          }
          
          updateData = {
            ...updateData,
            status: 'pending_director_approval',
            currentStage: 'director_approval',
            pricing: {
              hourlyRate: parseFloat(data.hourlyRate),
              profitMargin: parseFloat(data.profitMargin),
              quoteValue: parseFloat(data.quoteValue),
              pricedBy: req.user.uid,
              pricedByName: req.user.name,
              pricedAt: currentTimestamp
            }
          };
          break;

        case 'director_approve':
          if (req.user.role !== 'director') {
            return res.status(403).json({ error: 'Only Director can approve' });
          }
          
          updateData = {
            ...updateData,
            status: 'approved',
            currentStage: 'approved',
            directorApproval: {
              approved: true,
              approvedBy: req.user.uid,
              approvedByName: req.user.name,
              approvedAt: currentTimestamp,
              notes: data.notes || ''
            }
          };
          break;

        case 'director_reject':
          if (req.user.role !== 'director') {
            return res.status(403).json({ error: 'Only Director can reject' });
          }
          
          updateData = {
            ...updateData,
            status: 'rejected',
            currentStage: 'rejected',
            directorApproval: {
              approved: false,
              rejectedBy: req.user.uid,
              rejectedByName: req.user.name,
              rejectedAt: currentTimestamp,
              rejectionReason: data.rejectionReason || ''
            }
          };
          break;

        case 'submit_to_client':
          if (req.user.role !== 'bdm') {
            return res.status(403).json({ error: 'Only BDM can submit to client' });
          }
          
          updateData = {
            ...updateData,
            status: 'submitted_to_client',
            currentStage: 'client_review'
          };
          break;

        default:
          return res.status(400).json({ error: 'Invalid action' });
      }

      // Add to change log
      const changeLogEntry = {
        timestamp: currentTimestamp,
        action,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        details: `${action.replace(/_/g, ' ')} completed`
      };

      const changeLog = proposal.changeLog || [];
      changeLog.push(changeLogEntry);
      updateData.changeLog = changeLog;

      await proposalRef.update(updateData);

      // Log activity
      await helpers.logActivity({
        type: `proposal_${action}`,
        proposalId: id,
        projectName: proposal.projectName,
        clientCompany: proposal.clientCompany,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: `${action.replace(/_/g, ' ')} completed for ${proposal.projectName}`
      });

      res.json({
        success: true,
        message: 'Proposal updated successfully'
      });

    } catch (error) {
      console.error('Update proposal error:', error);
      res.status(500).json({ error: 'Failed to update proposal' });
    }
  });
}

module.exports = allowCors(handler);
