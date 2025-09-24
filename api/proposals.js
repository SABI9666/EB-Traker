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
    if (req.method === 'POST') {
      return await createProposal(req, res);
    } else if (req.method === 'GET') {
      return await getProposals(req, res);
    } else if (req.method === 'PUT') {
      return await updateProposal(req, res);
    } else if (req.method === 'DELETE') {
      return await deleteProposal(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Proposals API error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// Create new proposal (BDM only)
async function createProposal(req, res) {
  await verifyToken(req, res, async () => {
    try {
      // Check if user is BDM
      if (req.user.role !== 'bdm') {
        return res.status(403).json({ error: 'Only BDMs can create proposals' });
      }

      const {
        projectName,
        projectType,
        clientCompany,
        clientContact,
        clientEmail,
        clientPhone,
        country,
        scopeOfWork,
        timeline,
        priority,
        estimatedValue,
        requirements,
        deliverables,
        constraints,
        assumptions
      } = req.body;

      // Validate required fields
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
        // Basic Info
        projectName: projectName.trim(),
        projectType,
        clientCompany: clientCompany.trim(),
        clientContact: clientContact || null,
        clientEmail: clientEmail || null,
        clientPhone: clientPhone || null,
        country,
        scopeOfWork: scopeOfWork.trim(),
        timeline,
        priority: priority || 'Medium',
        estimatedValue: estimatedValue || null,
        requirements: requirements || null,
        deliverables: deliverables || null,
        constraints: constraints || null,
        assumptions: assumptions || null,

        // Status and Workflow
        status: 'pending_estimation',
        currentStage: 'estimation',
        
        // Creator Info
        createdBy: req.user.uid,
        createdByName: req.user.name,
        createdByEmail: req.user.email,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,

        // Workflow Tracking
        workflow: {
          bdm_submitted: {
            status: 'completed',
            completedAt: currentTimestamp,
            completedBy: req.user.uid,
            completedByName: req.user.name
          },
          estimation: { 
            status: 'pending',
            assignedAt: currentTimestamp
          },
          coo_pricing: { status: 'pending' },
          director_approval: { status: 'pending' },
          client_submission: { status: 'pending' }
        },

        // Data containers
        estimation: null,
        pricing: null,
        directorApproval: null,
        clientSubmission: null,
        
        // File organization
        files: {
          requirements: [],
          proposals: [],
          contracts: [],
          presentations: []
        },

        // Metadata
        version: 1,
        tags: [],
        notes: [],
        changeLog: [{
          timestamp: currentTimestamp,
          action: 'created',
          performedBy: req.user.uid,
          performedByName: req.user.name,
          details: 'Proposal created'
        }]
      };

      // Save to Firestore
      await db.collection('proposals').doc(proposalId).set(proposalData);

      // Create activity log
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

      // Create notifications for estimators
      await createWorkflowNotifications(proposalId, null, 'pending_estimation', proposalData);

      res.status(201).json({
        success: true,
        message: 'Proposal created successfully',
        proposalId,
        data: proposalData
      });

    } catch (error) {
      console.error('Create proposal error:', error);
      res.status(500).json({ error: 'Failed to create proposal', details: error.message });
    }
  });
}

// Get proposals based on user role
async function getProposals(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { role, uid } = req.user;
      const { 
        id,
        status, 
        clientCompany,
        projectType,
        priority,
        limit = 50, 
        offset = 0,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        search,
        dateFrom,
        dateTo,
        detailed = false
      } = req.query;
      
      // If requesting specific proposal by ID
      if (id) {
        const proposalDoc = await db.collection('proposals').doc(id).get();
        if (!proposalDoc.exists) {
          return res.status(404).json({ error: 'Proposal not found' });
        }
        
        const proposalData = proposalDoc.data();
        
        // Check access permissions
        const hasAccess = checkProposalAccess(proposalData, role, uid);
        if (!hasAccess) {
          return res.status(403).json({ error: 'Access denied' });
        }
        
        return res.json({
          success: true,
          data: { id: proposalDoc.id, ...proposalData }
        });
      }
      
      let query = db.collection('proposals');

      // Role-based filtering
      switch (role) {
        case 'bdm':
          query = query.where('createdBy', '==', uid);
          break;
        case 'estimator':
          query = query.where('status', 'in', ['pending_estimation']);
          break;
        case 'coo':
          query = query.where('status', 'in', ['pending_pricing']);
          break;
        case 'director':
          // Directors can see all proposals
          break;
        default:
          return res.status(403).json({ error: 'Invalid role' });
      }

      // Status filtering
      if (status) {
        const statusArray = status.split(',');
        if (statusArray.length === 1) {
          query = query.where('status', '==', status);
        } else {
          query = query.where('status', 'in', statusArray);
        }
      }

      // Other filters
      if (clientCompany) {
        query = query.where('clientCompany', '==', clientCompany);
      }
      if (projectType) {
        query = query.where('projectType', '==', projectType);
      }
      if (priority) {
        query = query.where('priority', '==', priority);
      }

      // Date range filtering
      if (dateFrom) {
        query = query.where('createdAt', '>=', dateFrom);
      }
      if (dateTo) {
        query = query.where('createdAt', '<=', dateTo);
      }

      // Sorting
      const validSortFields = ['createdAt', 'updatedAt', 'projectName', 'clientCompany'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      const order = sortOrder === 'asc' ? 'asc' : 'desc';
      
      query = query.orderBy(sortField, order);

      // Pagination
      if (offset > 0) {
        query = query.offset(parseInt(offset));
      }
      query = query.limit(parseInt(limit));

      const snapshot = await query.get();

      let proposals = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        
        if (detailed === 'true') {
          // Return full data
          proposals.push({ id: doc.id, ...data });
        } else {
          // Return summary data
          proposals.push({
            id: doc.id,
            projectName: data.projectName,
            clientCompany: data.clientCompany,
            projectType: data.projectType,
            status: data.status,
            priority: data.priority,
            estimatedValue: data.estimatedValue,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            createdByName: data.createdByName,
            currentStage: data.currentStage,
            timeline: data.timeline
          });
        }
      });

      // Client-side search filtering
      if (search) {
        const searchTerm = search.toLowerCase();
        proposals = proposals.filter(proposal =>
          proposal.projectName.toLowerCase().includes(searchTerm) ||
          proposal.clientCompany.toLowerCase().includes(searchTerm) ||
          (proposal.scopeOfWork && proposal.scopeOfWork.toLowerCase().includes(searchTerm))
        );
      }

      // Get summary statistics
      const summary = {
        total: proposals.length,
        byStatus: {},
        byPriority: {},
        byType: {}
      };

      proposals.forEach(proposal => {
        summary.byStatus[proposal.status] = (summary.byStatus[proposal.status] || 0) + 1;
        summary.byPriority[proposal.priority] = (summary.byPriority[proposal.priority] || 0) + 1;
        summary.byType[proposal.projectType] = (summary.byType[proposal.projectType] || 0) + 1;
      });

      res.json({
        success: true,
        data: proposals,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: proposals.length,
          hasMore: proposals.length === parseInt(limit)
        },
        summary,
        filters: {
          role,
          status,
          clientCompany,
          projectType,
          priority,
          search,
          dateFrom,
          dateTo
        }
      });

    } catch (error) {
      console.error('Get proposals error:', error);
      res.status(500).json({ error: 'Failed to fetch proposals', details: error.message });
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
        updatedAt: currentTimestamp,
        version: (proposal.version || 1) + 1
      };

      // Handle different workflow actions
      switch (action) {
        case 'add_estimation':
          if (req.user.role !== 'estimator') {
            return res.status(403).json({ error: 'Only estimators can add estimations' });
          }
          
          if (proposal.status !== 'pending_estimation') {
            return res.status(400).json({ error: 'Proposal is not in estimation stage' });
          }

          updateData = {
            ...updateData,
            status: 'pending_pricing',
            currentStage: 'pricing',
            estimation: {
              designHours: parseFloat(data.designHours) || 0,
              installHours: parseFloat(data.installHours) || 0,
              testingHours: parseFloat(data.testingHours) || 0,
              pmHours: parseFloat(data.pmHours) || 0,
              totalHours: parseFloat(data.totalHours) || 0,
              quoteType: data.quoteType,
              complexity: data.complexity || 'Medium',
              riskFactors: data.riskFactors || [],
              assumptions: data.assumptions || '',
              estimatedBy: req.user.uid,
              estimatedByName: req.user.name,
              estimatedAt: currentTimestamp,
              notes: data.notes || '',
              breakdown: data.breakdown || null
            },
            'workflow.estimation': {
              status: 'completed',
              completedAt: currentTimestamp,
              completedBy: req.user.uid,
              completedByName: req.user.name
            },
            'workflow.coo_pricing': { 
              status: 'pending',
              assignedAt: currentTimestamp
            }
          };

          // Add to change log
          if (!updateData['changeLog']) {
            updateData['changeLog'] = proposal.changeLog || [];
          }
          updateData['changeLog'].push({
            timestamp: currentTimestamp,
            action: 'estimation_completed',
            performedBy: req.user.uid,
            performedByName: req.user.name,
            details: `Estimation completed: ${data.totalHours} total hours`
          });
          break;

        case 'set_pricing':
          if (req.user.role !== 'coo') {
            return res.status(403).json({ error: 'Only COO can set pricing' });
          }
          
          if (proposal.status !== 'pending_pricing') {
            return res.status(400).json({ error: 'Proposal is not in pricing stage' });
          }
          
          const laborCost = proposal.estimation ? proposal.estimation.totalHours * parseFloat(data.hourlyRate) : 0;
          const materialsCost = parseFloat(data.materialsCost) || 0;
          const overheadCost = parseFloat(data.overheadCost) || 0;
          const subtotal = laborCost + materialsCost + overheadCost;
          const totalAmount = parseFloat(data.quoteValue);
          const profitAmount = totalAmount - subtotal;

          updateData = {
            ...updateData,
            status: 'pending_director_approval',
            currentStage: 'director_approval',
            pricing: {
              hourlyRate: parseFloat(data.hourlyRate),
              materialsCost: materialsCost,
              overheadCost: overheadCost,
              profitMargin: parseFloat(data.profitMargin),
              quoteValue: totalAmount,
              currency: data.currency || 'USD',
              validityPeriod: data.validityPeriod || '30 days',
              paymentTerms: data.paymentTerms || 'Net 30',
              breakdown: {
                laborCost,
                materialsCost,
                overheadCost,
                subtotal,
                profitAmount,
                totalAmount,
                profitMargin: subtotal > 0 ? ((profitAmount / subtotal) * 100) : 0
              },
              pricedBy: req.user.uid,
              pricedByName: req.user.name,
              pricedAt: currentTimestamp,
              notes: data.notes || '',
              riskAdjustments: data.riskAdjustments || []
            },
            'workflow.coo_pricing': {
              status: 'completed',
              completedAt: currentTimestamp,
              completedBy: req.user.uid,
              completedByName: req.user.name
            },
            'workflow.director_approval': { 
              status: 'pending',
              assignedAt: currentTimestamp
            }
          };

          if (!updateData['changeLog']) {
            updateData['changeLog'] = proposal.changeLog || [];
          }
          updateData['changeLog'].push({
            timestamp: currentTimestamp,
            action: 'pricing_set',
            performedBy: req.user.uid,
            performedByName: req.user.name,
            details: `Pricing set: ${data.currency || 'USD'} ${data.quoteValue} with ${data.profitMargin}% margin`
          });
          break;

        case 'director_approve':
          if (req.user.role !== 'director') {
            return res.status(403).json({ error: 'Only Director can provide final approval' });
          }
          
          if (proposal.status !== 'pending_director_approval') {
            return res.status(400).json({ error: 'Proposal is not in director approval stage' });
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
              notes: data.notes || '',
              conditions: data.conditions || [],
              strategicValue: data.strategicValue || 'Medium',
              riskAssessment: data.riskAssessment || 'Low',
              competitiveAdvantage: data.competitiveAdvantage || '',
              expectedOutcome: data.expectedOutcome || ''
            },
            'workflow.director_approval': {
              status: 'completed',
              completedAt: currentTimestamp,
              completedBy: req.user.uid,
              completedByName: req.user.name
            },
            'workflow.client_submission': { 
              status: 'ready',
              readyAt: currentTimestamp
            }
          };

          if (!updateData['changeLog']) {
            updateData['changeLog'] = proposal.changeLog || [];
          }
          updateData['changeLog'].push({
            timestamp: currentTimestamp,
            action: 'director_approved',
            performedBy: req.user.uid,
            performedByName: req.user.name,
            details: 'Executive approval granted'
          });
          break;

        case 'director_reject':
          if (req.user.role !== 'director') {
            return res.status(403).json({ error: 'Only Director can reject proposals' });
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
              rejectionReason: data.rejectionReason || '',
              notes: data.notes || '',
              suggestedActions: data.suggestedActions || []
            },
            'workflow.director_approval': {
              status: 'rejected',
              completedAt: currentTimestamp,
              completedBy: req.user.uid,
              completedByName: req.user.name
            }
          };

          if (!updateData['changeLog']) {
            updateData['changeLog'] = proposal.changeLog || [];
          }
          updateData['changeLog'].push({
            timestamp: currentTimestamp,
            action: 'director_rejected',
            performedBy: req.user.uid,
            performedByName: req.user.name,
            details: `Proposal rejected: ${data.rejectionReason}`
          });
          break;

        case 'submit_to_client':
          if (req.user.role !== 'bdm') {
            return res.status(403).json({ error: 'Only BDM can submit to client' });
          }
          
          if (proposal.status !== 'approved') {
            return res.status(400).json({ error: 'Proposal must be approved before client submission' });
          }
          
          updateData = {
            ...updateData,
            status: 'submitted_to_client',
            currentStage: 'client_review',
            clientSubmission: {
              submittedBy: req.user.uid,
              submittedByName: req.user.name,
              submittedAt: currentTimestamp,
              submissionMethod: data.method || 'email',
              clientContact: data.clientContact || proposal.clientContact,
              clientEmail: data.clientEmail || proposal.clientEmail,
              followUpDate: data.followUpDate || null,
              notes: data.notes || '',
              attachments: data.attachments || []
            },
            'workflow.client_submission': {
              status: 'completed',
              completedAt: currentTimestamp,
              completedBy: req.user.uid,
              completedByName: req.user.name
            }
          };

          if (!updateData['changeLog']) {
            updateData['changeLog'] = proposal.changeLog || [];
          }
          updateData['changeLog'].push({
            timestamp: currentTimestamp,
            action: 'submitted_to_client',
            performedBy: req.user.uid,
            performedByName: req.user.name,
            details: `Submitted to client via ${data.method || 'email'}`
          });
          break;

        default:
          return res.status(400).json({ error: 'Invalid action' });
      }

      // Update the proposal
      await proposalRef.update(updateData);

      // Create activity log
      await helpers.logActivity({
        type: `proposal_${action}`,
        proposalId: id,
        projectName: proposal.projectName,
        clientCompany: proposal.clientCompany,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: `${action.replace(/_/g, ' ')} completed for ${proposal.projectName}`,
        metadata: { action, previousStatus: proposal.status, newStatus: updateData.status }
      });

      // Create workflow notifications if status changed
      if (updateData.status && updateData.status !== proposal.status) {
        await createWorkflowNotifications(id, proposal.status, updateData.status, proposal);
      }

      res.json({
        success: true,
        message: 'Proposal updated successfully',
        data: {
          id,
          previousStatus: proposal.status,
          newStatus: updateData.status,
          action,
          updatedAt: updateData.updatedAt
        }
      });

    } catch (error) {
      console.error('Update proposal error:', error);
      res.status(500).json({ error: 'Failed to update proposal', details: error.message });
    }
  });
}

// Delete proposal (BDM only, and only if not in workflow)
async function deleteProposal(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'Proposal ID required' });
      }

      const proposalRef = db.collection('proposals').doc(id);
      const proposalDoc = await proposalRef.get();

      if (!proposalDoc.exists) {
        return res.status(404).json({ error: 'Proposal not found' });
      }

      const proposal = proposalDoc.data();

      // Only allow deletion if user created it or is director
      if (proposal.createdBy !== req.user.uid && req.user.role !== 'director') {
        return res.status(403).json({ error: 'You can only delete your own proposals' });
      }

      // Only allow deletion if proposal hasn't progressed beyond estimation
      if (proposal.status !== 'pending_estimation' && req.user.role !== 'director') {
        return res.status(400).json({ error: 'Cannot delete proposals that have entered the workflow. Contact director for assistance.' });
      }

      // Soft delete - mark as deleted instead of removing
      await proposalRef.update({
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        deletedBy: req.user.uid,
        deletedByName: req.user.name
      });

      // Log activity
      await helpers.logActivity({
        type: 'proposal_deleted',
        proposalId: id,
        projectName: proposal.projectName,
        clientCompany: proposal.clientCompany,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: `Proposal deleted: ${proposal.projectName}`
      });

      res.json({
        success: true,
        message: 'Proposal deleted successfully'
      });

    } catch (error) {
      console.error('Delete proposal error:', error);
      res.status(500).json({ error: 'Failed to delete proposal', details: error.message });
    }
  });
}

// Helper functions
function checkProposalAccess(proposal, role, uid) {
  switch (role) {
    case 'bdm':
      return proposal.createdBy === uid;
    case 'estimator':
      return proposal.status === 'pending_estimation';
    case 'coo':
      return ['pending_pricing', 'pending_director_approval', 'approved'].includes(proposal.status);
    case 'director':
      return true; // Directors can access all proposals
    default:
      return false;
  }
}

// Helper function to create workflow notifications
async function createWorkflowNotifications(proposalId, fromStatus, toStatus, proposalData) {
  try {
    const notifications = {
      'pending_estimation': {
        targetRole: 'estimator',
        title: 'New Estimation Required',
        message: `Please estimate hours for "${proposalData.projectName}" from ${proposalData.clientCompany}`,
        priority: 'high'
      },
      'pending_pricing': {
        targetRole: 'coo',
        title: 'Pricing Approval Required',
        message: `Please set pricing for "${proposalData.projectName}" from ${proposalData.clientCompany}`,
        priority: 'high'
      },
      'pending_director_approval': {
        targetRole: 'director',
        title: 'Executive Approval Required',
        message: `Please review and approve "${proposalData.projectName}" from ${proposalData.clientCompany}`,
        priority: 'high'
      },
      'approved': {
        targetRole: 'bdm',
        targetUserId: proposalData.createdBy,
        title: 'Proposal Approved',
        message: `"${proposalData.projectName}" has been approved and is ready for client submission`,
        priority: 'medium'
      }
    };

    const notification = notifications[toStatus];
    if (!notification) return;

    // Create notifications for target users
    let targetUsers = [];
    
    if (notification.targetUserId) {
      // Specific user notification
      targetUsers = [{ id: notification.targetUserId }];
    } else if (notification.targetRole) {
      // Role-based notification
      const usersSnapshot = await db.collection('users')
        .where('role', '==', notification.targetRole)
        .where('status', '==', 'active')
        .get();
      
      targetUsers = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    // Create notification documents
    const batch = db.batch();
    
    targetUsers.forEach(user => {
      const notificationRef = db.collection('notifications').doc();
      batch.set(notificationRef, {
        recipientId: user.id,
        type: 'workflow_progression',
        title: notification.title,
        message: notification.message,
        proposalId: proposalId,
        priority: notification.priority,
        read: false,
        actionUrl: `/proposals/${proposalId}`,
        metadata: {
          fromStatus,
          toStatus,
          projectName: proposalData.projectName,
          clientCompany: proposalData.clientCompany
        },
        createdAt: new Date().toISOString()
      });
    });

    if (targetUsers.length > 0) {
      await batch.commit();
    }

  } catch (error) {
    console.error('Error creating workflow notifications:', error);
    // Don't throw error as this is not critical for the main workflow
  }
}

module.exports = allowCors(handler);
