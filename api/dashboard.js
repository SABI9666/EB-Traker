const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');

const db = admin.firestore();

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
    if (req.method === 'GET') {
        try {
            await util.promisify(verifyToken)(req, res);
            const userRole = req.user.role;
            const userUid = req.user.uid;

            // For BDMs, filter proposals to only their own
            let proposalsQuery = db.collection('proposals');
            if (userRole === 'bdm') {
                proposalsQuery = proposalsQuery.where('createdByUid', '==', userUid);
            }
            
            const proposalsSnapshot = await proposalsQuery.get();
            const proposals = proposalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Calculate statistics
            const wonProposals = proposals.filter(p => p.status === 'won');
            const lostProposals = proposals.filter(p => p.status === 'lost');
            const submittedProposals = proposals.filter(p => p.status === 'submitted_to_client');
            const allWonProposals = proposals.filter(p => p.status === 'submitted_to_client' || p.status === 'won');
            
            const totalWonValue = allWonProposals.reduce((sum, p) => sum + (parseFloat(p.pricing?.quoteValue) || 0), 0);
            const totalProposalsCount = proposals.length;
            const winRate = totalProposalsCount > 0 ? ((wonProposals.length / totalProposalsCount) * 100).toFixed(0) : 0;
            const avgMargin = allWonProposals.length > 0 ? (allWonProposals.reduce((sum, p) => sum + (parseFloat(p.pricing?.profitMargin) || 0), 0) / allWonProposals.length).toFixed(0) : 0;
            const pipelineValue = proposals.filter(p => !['submitted_to_client', 'won', 'rejected', 'lost'].includes(p.status))
                                         .reduce((sum, p) => sum + (parseFloat(p.pricing?.quoteValue) || 0), 0);

            // Get action items based on role
            let actionItemsQuery;
            switch(userRole) {
                case 'estimator':
                    // Estimators see all proposals needing estimation
                    actionItemsQuery = db.collection('proposals')
                        .where('status', 'in', ['pending_estimation', 'revision_required']);
                    break;
                case 'coo':
                    // COOs see all proposals needing pricing
                    actionItemsQuery = db.collection('proposals').where('status', '==', 'pending_pricing');
                    break;
                case 'director':
                    // Directors see all proposals needing approval
                    actionItemsQuery = db.collection('proposals').where('status', '==', 'pending_director_approval');
                    break;
                case 'bdm':
                    // BDMs only see their own approved proposals or revision required
                    actionItemsQuery = db.collection('proposals')
                        .where('createdByUid', '==', userUid)
                        .where('status', 'in', ['approved', 'revision_required']);
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
                        'approved': 'ready_for_client',
                        'revision_required': 'needs_revision'
                    };
                    return {
                        proposalId: doc.id,
                        projectName: data.projectName,
                        clientCompany: data.clientCompany,
                        type: typeMap[data.status],
                        status: data.status
                    };
                });
            }

            // Filter activities based on user role
            let activitiesQuery = db.collection('activities').orderBy('timestamp', 'desc').limit(5);
            if (userRole === 'bdm') {
                // BDMs only see activities related to their proposals
                const proposalIds = proposals.map(p => p.id);
                if (proposalIds.length > 0 && proposalIds.length <= 10) {
                    activitiesQuery = activitiesQuery.where('proposalId', 'in', proposalIds);
                } else if (proposalIds.length > 10) {
                    // Firestore 'in' operator limitation workaround
                    const snapshot = await db.collection('activities')
                        .orderBy('timestamp', 'desc')
                        .limit(20)
                        .get();
                    const recentActivities = snapshot.docs
                        .map(doc => ({ id: doc.id, ...doc.data() }))
                        .filter(activity => proposalIds.includes(activity.proposalId))
                        .slice(0, 5);
                    
                    return res.status(200).json({ 
                        success: true, 
                        data: buildDashboardData(
                            userRole, 
                            proposals, 
                            wonProposals, 
                            lostProposals, 
                            submittedProposals,
                            allWonProposals, 
                            totalWonValue, 
                            pipelineValue, 
                            winRate, 
                            avgMargin,
                            actionItems, 
                            recentActivities
                        ) 
                    });
                } else if (proposalIds.length === 0) {
                    // BDM has no proposals yet
                    return res.status(200).json({ 
                        success: true, 
                        data: buildDashboardData(
                            userRole, 
                            proposals, 
                            wonProposals, 
                            lostProposals, 
                            submittedProposals,
                            allWonProposals, 
                            totalWonValue, 
                            pipelineValue, 
                            winRate, 
                            avgMargin,
                            actionItems, 
                            []
                        ) 
                    });
                }
            }
            
            const activitiesSnapshot = await activitiesQuery.get();
            const recentActivities = activitiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Build dashboard data based on role
            const dashboardData = buildDashboardData(
                userRole, 
                proposals, 
                wonProposals, 
                lostProposals, 
                submittedProposals,
                allWonProposals, 
                totalWonValue, 
                pipelineValue, 
                winRate, 
                avgMargin,
                actionItems, 
                recentActivities
            );

            return res.status(200).json({ success: true, data: dashboardData });

        } catch (error) {
            console.error('Dashboard API error:', error);
            return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
        }
    } else {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
};

// Helper function to build dashboard data based on role
function buildDashboardData(
    userRole, 
    proposals, 
    wonProposals, 
    lostProposals, 
    submittedProposals,
    allWonProposals, 
    totalWonValue, 
    pipelineValue, 
    winRate, 
    avgMargin,
    actionItems, 
    recentActivities
) {
    let dashboardData = {};
    
    if (userRole === 'director') {
        // Directors see comprehensive company-wide data
        const activeProposals = proposals.filter(p => !['won', 'lost', 'rejected'].includes(p.status));
        const totalTonnage = wonProposals.reduce((sum, p) => sum + (parseFloat(p.estimation?.tonnage) || 0), 0);
        
        dashboardData = {
            stats: {
                'Total Pipeline Value': `$${pipelineValue.toLocaleString()}`,
                'Jobs Won (YTD)': wonProposals.length,
                'Jobs Lost (YTD)': lostProposals.length,
                'Win Rate': `${winRate}%`,
                'Avg Profit Margin': `${avgMargin}%`,
                'Strategic Projects Pending': actionItems.length
            },
            actionItems,
            executiveOverview: {
                'Booked Revenue': `$${totalWonValue.toLocaleString()}`,
                'Projects Won': wonProposals.length,
                'Projects Lost': lostProposals.length,
                'Total Tonnage Won': `${totalTonnage.toFixed(1)} tons`,
                'Active Pipeline': activeProposals.length,
                'Client Satisfaction': '92%'
            },
            recentActivities
        };
    } else if (userRole === 'bdm') {
        // BDMs see only their own data
        const activeProposals = proposals.filter(p => !['won', 'lost', 'rejected'].includes(p.status));
        const myTonnage = wonProposals.reduce((sum, p) => sum + (parseFloat(p.estimation?.tonnage) || 0), 0);
        
        dashboardData = {
            stats: {
                'My Active Proposals': activeProposals.length,
                'My Pipeline Value': `$${pipelineValue.toLocaleString()}`,
                'My Jobs Won': wonProposals.length,
                'My Jobs Lost': lostProposals.length,
                'My Win Rate': `${winRate}%`,
                'My Total Tonnage': `${myTonnage.toFixed(1)} tons`
            },
            actionItems,
            recentActivities
        };
    } else if (userRole === 'coo') {
        // COOs see aggregate data with focus on operations
        const activeProposals = proposals.filter(p => !['won', 'lost', 'rejected'].includes(p.status));
        const totalTonnage = wonProposals.reduce((sum, p) => sum + (parseFloat(p.estimation?.tonnage) || 0), 0);
        const avgTonnagePerProject = wonProposals.length > 0 ? (totalTonnage / wonProposals.length).toFixed(1) : 0;
        
        dashboardData = {
            stats: {
                'Active Proposals': activeProposals.length,
                'Pipeline Value': `$${pipelineValue.toLocaleString()}`,
                'Jobs Won': wonProposals.length,
                'Jobs Lost': lostProposals.length,
                'Win Rate': `${winRate}%`,
                'Avg Tonnage/Project': `${avgTonnagePerProject} tons`,
                'Pending Pricing': actionItems.length
            },
            actionItems,
            recentActivities
        };
    } else {
        // Estimators and other roles see standard aggregate data
        const activeProposals = proposals.filter(p => !['won', 'lost', 'rejected'].includes(p.status));
        
        dashboardData = {
            stats: {
                'Active Proposals': activeProposals.length,
                'Pipeline Value': `$${pipelineValue.toLocaleString()}`,
                'Jobs Won': wonProposals.length,
                'Jobs Lost': lostProposals.length,
                'Win Rate': `${winRate}%`,
                'Pending Estimations': actionItems.length
            },
            actionItems,
            recentActivities
        };
    }
    
    return dashboardData;
}

module.exports = allowCors(handler);
