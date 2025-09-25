// api/proposals.js - Real Firebase functionality via REST API
const { db, helpers } = require('../firebase-rest-config');
const { verifyToken } = require('../middleware/auth');
const crypto = require('crypto');

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
  await verifyToken(req, res, async () => {
    try {
      const { role, uid } = req.user;
      const { id, limit = 50 } = req.query;
      
      console.log(`Getting proposals for user ${req.user.name} (${role})`);
      
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

      // Get proposals list based on role
      let query = db.collection('proposals');
      
      // For now, get all proposals and filter client-side
      // In production, implement server-side filtering
      const snapshot = await query.get();
      
      let proposals = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        
        // Role-based filtering
        let includeProposal = false;
        
        if (role === 'bdm' && data.createdBy === uid) {
          includeProposal = true;
        } else if (role === 'estimator' && data.status === 'pending_estimation') {
          includeProposal = true;
        } else if (role === 'coo' && ['pending_pricing', 'pending_director_approval', 'approved'].includes(data.status)) {
          includeProposal = true;
        } else if (role === 'director') {
          includeProposal = true; // Directors see all
        }
        
        if (includeProposal) {
          proposals.push({ id: doc.id, ...data });
        }
      });

      // Sort by creation date (newest first)
      proposals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      // Apply limit
      proposals = proposals.slice(0, parseInt(limit));

      res.json({
        success: true,
        data: proposals,
        dataSource: 'firebase_rest',
        total: proposals.length
      });

    } catch (error) {
      console.error('Get proposals error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to fetch proposals',
        message: error.message
      });
    }
  });
}

async function createProposal(req, res) {
  await verifyToken(req, res, async () => {
    try {
      if (req.user.role !== 'bdm') {
        return res.status(403).json({ 
          success: false,
          error: 'Only BDMs can create proposals' 
        });
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
          success: false,
          error: 'Missing required fields',
          required: ['projectName', 'clientCompany', 'projectType', 'scopeOfWork']
        });
      }

      const proposalId = crypto.randomUUID();
      const currentTimestamp = new Date().toISOString();
      
      const proposalData = {
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
        data: { id: proposalId, ...proposalData }
      });

    } catch (error) {
      console.error('Create proposal error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to create proposal',
        message: error.message
      });
    }
  });
}

async function updateProposal(req, res) {
  await verifyToken(req, res, async () => {
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
          if (req.user.role !== 'estimator') {
            return res.status(403).json({ 
              success: false,
              error: 'Only estimators can add estimations' 
            });
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
            return res.status(403).json({ 
              success: false,
              error: 'Only COO can set pricing' 
            });
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
            return res.status(403).json({ 
              success: false,
              error: 'Only Director can approve' 
            });
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
            return res.status(403).json({ 
              success: false,
              error: 'Only Director can reject' 
            });
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
            return res.status(403).json({ 
              success: false,
              error: 'Only BDM can submit to client' 
            });
          }
          
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
        performedBy: req.user.uid,
        performedByName: req.user.name,
        details: `${action.replace(/_/g, ' ')} completed`
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
        performedBy: req.user.uid,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: `${action.replace(/_/g, ' ')} completed for ${proposal.projectName}`
      });

      res.json({
        success: true,
        message: 'Proposal updated successfully',
        data: { id, ...proposal, ...updateData }
      });

    } catch (error) {
      console.error('Update proposal error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to update proposal',
        message: error.message
      });
    }
  });
}

module.exports = allowCors(handler);
