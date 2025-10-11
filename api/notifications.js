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
            // Get notifications for the current user
            let query = db.collection('notifications')
                .where('isRead', '==', false)
                .orderBy('createdAt', 'desc')
                .limit(20); // Increased limit to show more notifications
            
            // For BDMs, filter notifications to only those meant for them specifically
            if (req.user.role === 'bdm') {
                query = query.where('recipientUid', '==', req.user.uid);
            } else {
                // For other roles, use role-based filtering
                query = query.where('recipientRole', '==', req.user.role);
            }
                        
            const snapshot = await query.get();
            const notifications = snapshot.docs.map(doc => { 
                const data = doc.data();
                return {
                    id: doc.id, 
                    ...data,
                    // Format timestamp for display
                    formattedTime: data.createdAt ? 
                        new Date(data.createdAt.seconds * 1000).toLocaleString() : 
                        'Just now'
                };
            });
                        
            return res.status(200).json({ success: true, data: notifications });
        }
        
        if (req.method === 'PUT') {
            // Mark notification as read
            const { id } = req.query;
            if (!id) {
                return res.status(400).json({ success: false, error: 'Notification ID required' });
            }
            
            // Verify the notification belongs to this user
            const notificationDoc = await db.collection('notifications').doc(id).get();
            if (!notificationDoc.exists) {
                return res.status(404).json({ success: false, error: 'Notification not found' });
            }
            
            const notificationData = notificationDoc.data();
            
            // Check if user can access this notification
            if (req.user.role === 'bdm') {
                if (notificationData.recipientUid !== req.user.uid) {
                    return res.status(403).json({ success: false, error: 'Access denied to this notification' });
                }
            } else {
                if (notificationData.recipientRole !== req.user.role) {
                    return res.status(403).json({ success: false, error: 'Access denied to this notification' });
                }
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
