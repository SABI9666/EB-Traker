// api/dashboard.js
const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = 'util';

const db = admin.firestore();

const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
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
        const userRole = req.user.role;

        // Fetch all proposals to calculate stats
        const proposalsSnapshot = await db.collection('proposals').get();
        const proposals = proposalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // 1. Calculate Stats
        const approvedProposals = proposals.filter(p => p.status === 'approved').length;
        const submittedProposals = proposals.filter(p => p.status === 'submitted_to_client').length;
        const activeProposals = proposals.filter(p => !['approved', 'rejected', 'submitted_to_client'].includes(p.status));
        const pipelineValue = activeProposals.reduce((sum, p) => sum + (p.pricing?.quoteValue || 0), 0);
        
        const stats = {
            totalProposals: proposals.length,
            activeProposals: activeProposals.length,
            approvedProposals,
            submittedProposals,
            pipelineValue: `$${pipelineValue.toLocaleString()}`,
        };

        // 2. Determine Action Items based on user role
        let actionItems = [];
        let actionQuery;

        switch(userRole) {
            case 'estimator':
                actionQuery = db.collection('proposals').where('status', '==', 'pending_estimation');
                break;
            case 'coo':
                actionQuery = db.collection('proposals').where('status', '==', 'pending_pricing');
                break;
            case 'director':
                actionQuery = db.collection('proposals').where('status', '==', 'pending_director_approval');
                break;
            case 'bdm':
                actionQuery = db.collection('proposals').where('status', '==', 'approved');
                break;
            default:
                actionQuery = null;
        }

        if (actionQuery) {
            const actionSnapshot = await actionQuery.orderBy('createdAt', 'desc').get();
            actionItems = actionSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    proposalId: doc.id,
                    projectName: data.projectName,
                    clientCompany: data.clientCompany,
                    // Map status to a generic action type for the frontend
                    type: {
                        'pending_estimation': 'estimation_required',
                        'pending_pricing': 'pricing_required',
                        'pending_director_approval': 'approval_required',
                        'approved': 'ready_for_client'
                    }[data.status]
                };
            });
        }
        
        // 3. Fetch Recent Activities
        const activitiesSnapshot = await db.collection('activities').orderBy('timestamp', 'desc').limit(5).get();
        const recentActivities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const dashboardData = {
            stats,
            actionItems,
            recentActivities
        };
        
        return res.json({ success: true, data: dashboardData });

    } catch (error) {
        console.error('Dashboard API error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(handler);
