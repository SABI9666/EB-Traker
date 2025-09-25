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
    try {
        if (req.method === 'GET') {
            await util.promisify(verifyToken)(req, res); // Authenticate here
            const { limit = 20, proposalId } = req.query;
            let query = db.collection('activities').orderBy('timestamp', 'desc');

            if (proposalId) {
                query = query.where('proposalId', '==', proposalId);
            }

            const snapshot = await query.limit(parseInt(limit)).get();
            const activities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            return res.json({ success: true, data: activities });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (error) {
        console.error('Activities API error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(handler);

