const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');
const db = admin.firestore();

const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
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
            // Get notifications for the current user's role
            const snapshot = await db.collection('notifications')
                .where('recipientRole', '==', req.user.role)
                .where('isRead', '==', false)
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get();
                        
            const notifications = snapshot.docs.map(doc => ({ 
                id: doc.id, 
                ...doc.data() 
            }));
                        
            return res.status(200).json({ success: true, data: notifications });
        }
        
        if (req.method === 'PUT') {
            // Mark notification as read
            const { id } = req.query;
            if (!id) {
                return res.status(400).json({ success: false, error: 'Notification ID required' });
            }
                        
            await db.collection('notifications').doc(id).update({
                isRead: true,
                readAt: admin.firestore.FieldValue.serverTimestamp()
            });
                        
            return res.status(200).json({ success: true, message: 'Notification marked as read.' });
        }
        
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (error) {
        console.error('Notifications API error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(handler);
