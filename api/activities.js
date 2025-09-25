const { db, helpers } = require('../firebase-config');
const { verifyToken } = require('../middleware/auth');

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
      return await getActivities(req, res);
    } else if (req.method === 'POST') {
      return await createActivity(req, res);
    } else {
      return res.status(405).json({ 
        success: false,
        error: 'Method not allowed' 
      });
    }
  } catch (error) {
    console.error('Activities API error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
};

// Get activities for dashboard
async function getActivities(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { type, proposalId, limit = 20, offset = 0 } = req.query;
      const { role, uid } = req.user;
      
      let query = db.collection('activities');

      // Role-based filtering
      if (role === 'bdm') {
        query = query.where('performedBy', '==', uid);
      }

      // Type filtering
      if (type) {
        query = query.where('type', '==', type);
      }

      // Proposal filtering
      if (proposalId) {
        query = query.where('proposalId', '==', proposalId);
      }

      const snapshot = await query
        .orderBy('timestamp', 'desc')
        .limit(parseInt(limit))
        .get();

      const activities = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        activities.push({ 
          id: doc.id, 
          ...data,
          // Convert Firestore timestamp to ISO string if needed
          timestamp: data.timestamp && data.timestamp.toDate ? 
            data.timestamp.toDate().toISOString() : 
            data.timestamp
        });
      });

      res.json({
        success: true,
        data: activities,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: activities.length
        }
      });

    } catch (error) {
      console.error('Get activities error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to fetch activities' 
      });
    }
  });
}

// Create activity log
async function createActivity(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const {
        type,
        proposalId,
        projectName,
        clientCompany,
        details,
        metadata = {}
      } = req.body;

      if (!type || !details) {
        return res.status(400).json({ 
          success: false,
          error: 'Missing required fields: type, details' 
        });
      }

      const activityData = {
        type,
        proposalId,
        projectName,
        clientCompany,
        details,
        metadata,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        timestamp: new Date().toISOString()
      };

      const docRef = await db.collection('activities').add(activityData);

      res.status(201).json({
        success: true,
        message: 'Activity logged successfully',
        activityId: docRef.id,
        data: activityData
      });

    } catch (error) {
      console.error('Create activity error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to create activity' 
      });
    }
  });
}

module.exports = allowCors(handler);
