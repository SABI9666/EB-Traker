const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');

const db = admin.firestore();
const bucket = admin.storage().bucket();

const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

const handler = async (req, res) => {
    try {
        await util.promisify(verifyToken)(req, res);

        // Parse JSON body for POST/PUT requests
        if ((req.method === 'POST' || req.method === 'PUT') && req.headers['content-type'] === 'application/json') {
            await new Promise((resolve) => {
                const chunks = [];
                req.on('data', (chunk) => chunks.push(chunk));
                req.on('end', () => {
                    try {
                        const bodyBuffer = Buffer.concat(chunks);
                        req.body = bodyBuffer.length > 0 ? JSON.parse(bodyBuffer.toString()) : {};
                    } catch (e) {
                        console.error("Error parsing JSON body:", e);
                        req.body = {};
                    }
                    resolve();
                });
            });
        }

        if (req.method === 'GET') {
            const { id } = req.query;
            if (id) {
                const doc = await db.collection('proposals').doc(id).get();
                if (!doc.exists) return res.status(404).json({ success: false, error: 'Proposal not found' });
                
                const proposalData = doc.data();
                
                // BDM isolation: Check if BDM can access this proposal
                if (req.user.role === 'bdm' && proposalData.createdByUid !== req.user.uid) {
                    return res.status(403).json({ success: false, error: 'Access denied. You can only view your own proposals.' });
                }
                
                return res.status(200).json({ success: true, data: { id: doc.id, ...proposalData } });
            }
            
            // Get all proposals with BDM isolation
            let query = db.collection('proposals').orderBy('createdAt', 'desc');
            
            // BDMs only see their own proposals
            if (req.user.role === 'bdm') {
                query = query.where('createdByUid', '==', req.user.uid);
            }
            
            const snapshot = await query.get();
            const proposals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return res.status(200).json({ success: true, data: proposals });
        }

        if (req.method === 'POST') {
            const { projectName, clientCompany, scopeOfWork, projectType, priority, country, timeline, projectLinks, comments } = req.body;
            if (!projectName || !clientCompany || !scopeOfWork) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            const newProposal = {
                projectName: projectName.trim(),
                clientCompany: clientCompany.trim(),
                projectType: projectType || 'Commercial',
                scopeOfWork: scopeOfWork.trim(),
                comments: comments ? comments.trim() : '', // NEW: Add comments field
                priority: priority || 'Medium',
                country: country || 'Not Specified',
                timeline: timeline || 'Not Specified',
                projectLinks: projectLinks || [], // Store project links
                status: 'pending_estimation',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                createdByUid: req.user.uid,
                createdByName: req.user.name,
                changeLog: [{ timestamp: new Date().toISOString(), action: 'created', performedByName: req.user.name, details: 'Proposal created' }]
            };

            const docRef = await db.collection('proposals').add(newProposal);
            await db.collection('activities').add({
                type: 'proposal_created',
                details: `New proposal created: ${projectName} for ${clientCompany}`,
                performedByName: req.user.name,
                performedByRole: req.user.role,
                performedByUid: req.user.uid, // Add UID for activity isolation
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                proposalId: docRef.id, projectName, clientCompany
            });
            // Return new proposal with its ID for file linking on frontend
            return res.status(201).json({ success: true, data: { id: docRef.id, ...newProposal } });
        }

        if (req.method === 'PUT') {
            const { id } = req.query;
            const { action, data } = req.body;
            if (!id || !action) return res.status(400).json({ success: false, error: 'Missing proposal ID or action' });

            const proposalRef = db.collection('proposals').doc(id);
            const proposalDoc = await proposalRef.get();
            if (!proposalDoc.exists) return res.status(404).json({ success: false, error: 'Proposal not found' });
            
            const proposal = proposalDoc.data();
            
            // BDM isolation: Check if BDM can modify this proposal
            if (req.user.role === 'bdm' && proposal.createdByUid !== req.user.uid && action !== 'view') {
                return res.status(403).json({ success: false, error: 'Access denied. You can only modify your own proposals.' });
            }
            
            let updates = {};
            let activityDetail = '';

            switch (action) {
                case 'edit_proposal':
                    // NEW: Allow BDM to edit proposal only if status is pending_estimation
                    if (req.user.role !== 'bdm') {
                        return res.status(403).json({ success: false, error: 'Only BDMs can edit proposals' });
                    }
                    if (proposal.status !== 'pending_estimation') {
                        return res.status(403).json({ 
                            success: false, 
                            error: 'Cannot edit proposal after estimation has been submitted' 
                        });
                    }
                    
                    updates = {
                        projectName: data.projectName,
                        clientCompany: data.clientCompany,
                        projectType: data.projectType,
                        country: data.country,
                        timeline: data.timeline,
                        priority: data.priority,
                        scopeOfWork: data.scopeOfWork,
                        comments: data.comments || '',
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };
                    activityDetail = `Proposal edited by ${req.user.name}`;
                    break;
                
                case 'add_links':
                    // Allow adding/updating project links
                    updates = { 
                        projectLinks: data.links || [],
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    };
                    activityDetail = `Added ${data.links?.length || 0} project links`;
                    break;
                    
                case 'add_estimation':
                    updates = { 
                        status: 'pending_pricing', 
                        estimation: { 
                            ...data, 
                            estimatedBy: req.user.name, 
                            estimatedAt: new Date().toISOString() 
                        } 
                    };
                    activityDetail = `Estimation added: ${data.totalHours} hours, ${data.tonnage || 0} tons`;
                    break;
                    
                case 'set_pricing':
                    updates = { 
                        status: 'pending_director_approval', 
                        pricing: { 
                            ...data, 
                            pricedBy: req.user.name, 
                            pricedAt: new Date().toISOString() 
                        } 
                    };
                    // If COO updated the services, apply the change
                    if (data.updatedServices) {
                        updates['estimation.services'] = data.updatedServices;
                    }
                    activityDetail = `Pricing set: ${data.currency || 'USD'} ${data.quoteValue}`;
                    break;
                    
                case 'director_approve':
                    updates = { 
                        status: 'approved', 
                        directorApproval: { 
                            approved: true, 
                            ...data, 
                            approvedBy: req.user.name, 
                            approvedAt: new Date().toISOString(),
                            comments: data.comments || ''
                        } 
                    };
                    activityDetail = `Director approved proposal${data.comments ? ': ' + data.comments : ''}`;
                    const stakeholders = ['bdm', 'estimator', 'coo'];
                    for (const role of stakeholders) {
                        await db.collection('notifications').add({
                            type: 'proposal_approved',
                            recipientRole: role,
                            recipientUid: role === 'bdm' ? proposal.createdByUid : null, // Target specific BDM
                            proposalId: id,
                            message: `${proposal.projectName} has been approved by Director`,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            isRead: false
                        });
                    }
                    break;
                    
                case 'director_reject':
                    updates = { 
                        status: 'revision_required',
                        directorApproval: { 
                            approved: false, 
                            ...data, 
                            rejectedBy: req.user.name, 
                            rejectedAt: new Date().toISOString(),
                            comments: data.comments || '',
                            requiresRevisionBy: data.requiresRevisionBy || 'estimator'
                        } 
                    };
                    activityDetail = `Director requested revision: ${data.comments}`;
                    await db.collection('notifications').add({
                        type: 'revision_required',
                        recipientRole: data.requiresRevisionBy,
                        recipientUid: data.requiresRevisionBy === 'bdm' ? proposal.createdByUid : null, // Target specific BDM
                        proposalId: id,
                        message: `Revision required for ${proposal.projectName}: ${data.comments}`,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        isRead: false
                    });
                    break;
                    
                case 'resubmit_after_revision':
                    updates = {
                        status: 'pending_director_approval',
                        revisionHistory: admin.firestore.FieldValue.arrayUnion({
                            revisedBy: req.user.name,
                            revisedAt: new Date().toISOString(),
                            revisionNotes: data.notes
                        })
                    };
                    activityDetail = `Revision completed and resubmitted by ${req.user.name}`;
                    break;
                    
                case 'submit_to_client':
                    updates = { status: 'submitted_to_client' };
                    activityDetail = `Proposal submitted to client`;
                    break;
                    
                case 'mark_job_won':
                    // NEW: Mark job as won
                    if (req.user.role !== 'bdm') {
                        return res.status(403).json({ success: false, error: 'Only BDMs can mark jobs as won/lost' });
                    }
                    
                    updates = { 
                        status: 'won',
                        jobOutcome: {
                            result: 'won',
                            markedBy: req.user.name,
                            markedAt: new Date().toISOString()
                        }
                    };
                    activityDetail = `Job marked as WON by ${req.user.name}`;
                    
                    // Notify COO and Director
                    for (const role of ['coo', 'director']) {
                        await db.collection('notifications').add({
                            type: 'job_won',
                            recipientRole: role,
                            recipientUid: null,
                            proposalId: id,
                            message: `🎉 Job WON: ${proposal.projectName} for ${proposal.clientCompany}`,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            isRead: false
                        });
                    }
                    break;
                    
                case 'mark_job_lost':
                    // NEW: Mark job as lost
                    if (req.user.role !== 'bdm') {
                        return res.status(403).json({ success: false, error: 'Only BDMs can mark jobs as won/lost' });
                    }
                    
                    updates = { 
                        status: 'lost',
                        jobOutcome: {
                            result: 'lost',
                            reason: data.reason || 'Not specified',
                            markedBy: req.user.name,
                            markedAt: new Date().toISOString()
                        }
                    };
                    activityDetail = `Job marked as LOST by ${req.user.name}. Reason: ${data.reason || 'Not specified'}`;
                    
                    // Notify COO and Director
                    for (const role of ['coo', 'director']) {
                        await db.collection('notifications').add({
                            type: 'job_lost',
                            recipientRole: role,
                            recipientUid: null,
                            proposalId: id,
                            message: `Job LOST: ${proposal.projectName}. Reason: ${data.reason || 'Not specified'}`,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            isRead: false
                        });
                    }
                    break;
                    
                default:
                    return res.status(400).json({ success: false, error: 'Invalid action' });
            }
            
            updates.changeLog = admin.firestore.FieldValue.arrayUnion({ 
                timestamp: new Date().toISOString(), 
                action: action, 
                performedByName: req.user.name, 
                details: `${action.replace(/_/g, ' ')} completed` 
            });
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            
            await proposalRef.update(updates);
            await db.collection('activities').add({
                type: `proposal_${action}`, 
                details: activityDetail, 
                performedByName: req.user.name, 
                performedByRole: req.user.role,
                performedByUid: req.user.uid, // Add UID for activity isolation
                timestamp: admin.firestore.FieldValue.serverTimestamp(), 
                proposalId: id, 
                projectName: proposal.projectName, 
                clientCompany: proposal.clientCompany
            });
            return res.status(200).json({ success: true, message: 'Proposal updated successfully' });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ success: false, error: 'Missing proposal ID' });

            const proposalRef = db.collection('proposals').doc(id);
            const proposalDoc = await proposalRef.get();
            if (!proposalDoc.exists) return res.status(404).json({ success: false, error: 'Proposal not found' });
            
            const proposalData = proposalDoc.data();
            // Security check: Only creator or a director can delete
            if (proposalData.createdByUid !== req.user.uid && req.user.role !== 'director') {
                return res.status(403).json({ success: false, error: 'You are not authorized to delete this proposal.' });
            }

            // Delete associated files from storage and Firestore
            const filesSnapshot = await db.collection('files').where('proposalId', '==', id).get();
            if (!filesSnapshot.empty) {
                const deletePromises = filesSnapshot.docs.map(doc => {
                    const fileData = doc.data();
                    // Skip deletion for link-type files (they don't have physical storage)
                    if (fileData.fileType === 'link') {
                        return doc.ref.delete(); // Just delete from Firestore
                    }
                    return Promise.all([
                        bucket.file(fileData.fileName).delete(), // Delete from storage
                        doc.ref.delete() // Delete from 'files' collection
                    ]);
                });
                await Promise.all(deletePromises);
            }

            // Delete the proposal document
            await proposalRef.delete();
            
            return res.status(200).json({ success: true, message: 'Proposal and all associated files deleted successfully' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (error) {
        console.error('Proposals API error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(handler);
