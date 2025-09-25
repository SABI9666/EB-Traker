const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');

const db = admin.firestore();

const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT');
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

        if (req.method === 'GET') {
            const { id } = req.query;
            if (id) {
                const doc = await db.collection('proposals').doc(id).get();
                if (!doc.exists) return res.status(404).json({ success: false, error: 'Proposal not found' });
                return res.status(200).json({ success: true, data: { id: doc.id, ...doc.data() } });
            }
            const snapshot = await db.collection('proposals').orderBy('createdAt', 'desc').get();
            const proposals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return res.status(200).json({ success: true, data: proposals });
        }

        if (req.method === 'POST') {
            const { projectName, clientCompany, scopeOfWork, projectType, priority, country, timeline } = req.body;
            if (!projectName || !clientCompany || !scopeOfWork) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            const newProposal = {
                projectName: projectName.trim(),
                clientCompany: clientCompany.trim(),
                projectType: projectType || 'Commercial',
                scopeOfWork: scopeOfWork.trim(),
                priority: priority || 'Medium',
                country: country || 'Not Specified',
                timeline: timeline || 'Not Specified',
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
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                proposalId: docRef.id, projectName, clientCompany
            });
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
            let updates = {};
            let activityDetail = '';

            switch (action) {
                case 'add_estimation':
                    updates = { status: 'pending_pricing', estimation: { ...data, estimatedBy: req.user.name, estimatedAt: new Date().toISOString() } };
                    activityDetail = `Estimation added: ${data.totalHours} hours`;
                    break;
                case 'set_pricing':
                    updates = { status: 'pending_director_approval', pricing: { ...data, pricedBy: req.user.name, pricedAt: new Date().toISOString() } };
                    activityDetail = `Pricing set: $${data.quoteValue}`;
                    break;
                case 'director_approve':
                    updates = { status: 'approved', directorApproval: { approved: true, ...data, approvedBy: req.user.name, approvedAt: new Date().toISOString() } };
                    activityDetail = `Director approved proposal`;
                    break;
                case 'director_reject':
                    // This matches the demo logic by sending it back to the COO for revision.
                    updates = { status: 'pending_pricing', directorApproval: { approved: false, ...data, rejectedBy: req.user.name, rejectedAt: new Date().toISOString() } };
                    activityDetail = `Director requested revision on proposal`;
                    break;
                case 'submit_to_client':
                    updates = { status: 'submitted_to_client' };
                    activityDetail = `Proposal submitted to client`;
                    break;
                default:
                    return res.status(400).json({ success: false, error: 'Invalid action' });
            }
            
            updates.changeLog = admin.firestore.FieldValue.arrayUnion({ timestamp: new Date().toISOString(), action: action, performedByName: req.user.name, details: `${action.replace(/_/g, ' ')} completed` });
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            
            await proposalRef.update(updates);
            await db.collection('activities').add({
                type: `proposal_${action}`, details: activityDetail, performedByName: req.user.name, performedByRole: req.user.role,
                timestamp: admin.firestore.FieldValue.serverTimestamp(), proposalId: id, projectName: proposal.projectName, clientCompany: proposal.clientCompany
            });
            return res.status(200).json({ success: true, message: 'Proposal updated successfully' });
        }
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (error) {
        console.error('Proposals API error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(handler);
