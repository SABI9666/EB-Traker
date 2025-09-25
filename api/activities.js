// api/activities.js - Works with REST firebase-config.js
const { db } = require('../firebase-config');

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
      return res.status(501).json({
        success: false,
        error: 'Manual activity creation not implemented',
        message: 'Activities are automatically generated when proposals are updated'
      });
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
      error: 'Internal server error',
      message: error.message
    });
  }
};

async function getActivities(req, res) {
  try {
    const { type, proposalId, limit = 20, offset = 0 } = req.query;
    
    console.log('Getting activities from Firebase...');
    
    // Get all activities from Firebase
    const snapshot = await db.collection('activities').get();
    
    let activities = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      activities.push({ 
        id: doc.id, 
        ...data
      });
    });

    // Apply filters
    if (type) {
      activities = activities.filter(activity => 
        activity.type === type
      );
    }

    if (proposalId) {
      activities = activities.filter(activity => 
        activity.proposalId === proposalId
      );
    }

    // Sort by timestamp (newest first)
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply pagination
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedActivities = activities.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedActivities,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: activities.length,
        hasMore: endIndex < activities.length
      },
      dataSource: 'firebase_rest',
      message: 'Successfully retrieved activities from Firebase'
    });

  } catch (error) {
    console.error('Get activities error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch activities from Firebase',
      message: error.message,
      troubleshooting: {
        checkFirebaseConnection: 'Ensure Firebase API key is configured',
        errorType: error.message.includes('404') ? 'Collection not found' : 
                   error.message.includes('403') ? 'Permission denied' : 'Connection error'
      }
    });
  }
}

module.exports = allowCors(handler);
