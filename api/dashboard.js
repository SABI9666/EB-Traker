const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');

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
    // This structure ensures OPTIONS requests are handled before auth
    if (req.method === 'GET') {
        try {
            await util.promisify(verifyToken)(req, res);
            const userRole = req.user.role;

            const proposalsSnapshot = await db.collection('proposals').get();
            const proposals = proposalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // --- 1. Calculate Executive & BDM Stats ---
            const wonProposals = proposals.filter(p => p.status === 'submitted_to_client' || p.status === 'won'); // Assuming submitted means won for now
            const totalWonValue = wonProposals.reduce((sum, p) => sum + (p.pricing?.quoteValue || 0), 0);
            const totalProposalsCount = proposals.length;
            const winRate = totalProposalsCount > 0 ? ((wonProposals.length / totalProposalsCount) * 100).toFixed(0) : 0;
            const avgMargin = wonProposals.length > 0 ? (wonProposals.reduce((sum, p) => sum + (p.pricing?.profitMargin || 0), 0) / wonProposals.length).toFixed(0) : 0;
            const pipelineValue = proposals.filter(p => !['submitted_to_client', 'won', 'rejected', 'lost'].includes(p.status))
                                         .reduce((sum, p) => sum + (p.pricing?.quoteValue || 0), 0);

            // --- 2. Determine Action Items by Role ---
            let actionItemsQuery;
            switch(userRole) {
                case 'estimator':
                    actionItemsQuery = db.collection('proposals').where('status', '==', 'pending_estimation');
                    break;
                case 'coo':
                    actionItemsQuery = db.collection('proposals').where('status', '==', 'pending_pricing');
                    break;
                case 'director':
                    actionItemsQuery = db.collection('proposals').where('status', '==', 'pending_director_approval');
                    break;
                case 'bdm':
                    actionItemsQuery = db.collection('proposals').where('status', '==', 'approved');
                    break;
                default:
                    actionItemsQuery = null;
            }
            
            let actionItems = [];
            if (actionItemsQuery) {
                const actionSnapshot = await actionItemsQuery.orderBy('createdAt', 'desc').get();
                actionItems = actionSnapshot.docs.map(doc => {
                    const data = doc.data();
                    const typeMap = {
                        'pending_estimation': 'estimation_required',
                        'pending_pricing': 'pricing_required',
                        'pending_director_approval': 'approval_required',
                        'approved': 'ready_for_client'
                    };
                    return {
                        proposalId: doc.id,
                        projectName: data.projectName,
                        clientCompany: data.clientCompany,
                        type: typeMap[data.status]
                    };
                });
            }

            // --- 3. Fetch Recent Activities ---
            const activitiesSnapshot = await db.collection('activities').orderBy('timestamp', 'desc').limit(5).get();
            const recentActivities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // --- 4. Build Role-Specific Dashboard Data ---
            let dashboardData = {};
            if (userRole === 'director') {
                dashboardData = {
                    stats: {
                        'Total Pipeline Value': `$${pipelineValue.toLocaleString()}`,
                        'Win Rate (YTD)': `${winRate}%`,
                        'Avg Profit Margin (YTD)': `${avgMargin}%`,
                        'Strategic Projects Pending': actionItems.length
                    },
                    actionItems,
                    executiveOverview: {
                        'Booked Revenue': `$${totalWonValue.toLocaleString()}`,
                        'Projects Won': wonProposals.length,
                        'Client Satisfaction': '92%', // Static for demo purposes
                        'Resource Utilization': '85%' // Static for demo purposes
                    }
                };
            } else {
                 dashboardData = {
                    stats: {
                        'Active Proposals': proposals.filter(p => !['won','lost','rejected'].includes(p.status)).length,
                        'Pipeline Value': `$${pipelineValue.toLocaleString()}`,
                        'Proposals Won': wonProposals.length,
                        'Win Rate': `${winRate}%`,
                    },
                    actionItems,
                    recentActivities
                };
            }

            return res.status(200).json({ success: true, data: dashboardData });

        } catch (error) {
            console.error('Dashboard API error:', error);
            return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
        }
    } else {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
};

module.exports = allowCors(handler);
