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
    if (req.method === 'POST') {
      return await uploadFile(req, res);
    } else if (req.method === 'GET') {
      return await getFiles(req, res);
    } else if (req.method === 'DELETE') {
      return await deleteFile(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Files API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Upload files (simplified - stores metadata only)
async function uploadFile(req, res) {
  await verifyToken(req, res, async () => {
    try {
      // For now, we'll simulate file upload by storing metadata
      // In a real implementation, you'd use multer and Firebase Storage
      
      return res.status(501).json({
        success: false,
        error: 'File upload not implemented yet',
        message: 'File upload requires Firebase Storage configuration'
      });
      
    } catch (error) {
      console.error('File upload error:', error);
      res.status(500).json({ error: 'Failed to upload files' });
    }
  });
}

// Get files with filtering
async function getFiles(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { 
        proposalId, 
        category, 
        limit = 50, 
        offset = 0 
      } = req.query;
      const { role, uid } = req.user;
      
      let query = db.collection('files').where('status', '==', 'active');

      // Filter by proposal if specified
      if (proposalId) {
        query = query.where('proposalId', '==', proposalId);
      }

      // Filter by category if specified
      if (category) {
        query = query.where('category', '==', category);
      }

      // Role-based access control
      if (role === 'bdm') {
        // BDM can see files they uploaded or files from their proposals
        query = query.where('uploadedBy', '==', uid);
      }

      const snapshot = await query
        .orderBy('uploadedAt', 'desc')
        .limit(parseInt(limit))
        .get();

      const files = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        files.push({ 
          id: doc.id, 
          ...data,
          // Convert Firestore timestamp if needed
          uploadedAt: data.uploadedAt && data.uploadedAt.toDate ? 
            data.uploadedAt.toDate().toISOString() : 
            data.uploadedAt
        });
      });

      // Calculate total file size
      const totalSize = files.reduce((sum, file) => sum + (file.fileSize || 0), 0);

      res.json({
        success: true,
        data: files,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: files.length
        },
        summary: {
          totalFiles: files.length,
          totalSize: totalSize,
          categories: [...new Set(files.map(f => f.category))],
          mimeTypes: [...new Set(files.map(f => f.mimeType))]
        }
      });

    } catch (error) {
      console.error('Get files error:', error);
      res.status(500).json({ error: 'Failed to fetch files' });
    }
  });
}

// Delete file
async function deleteFile(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'File ID required' });
      }

      const fileRef = db.collection('files').doc(id);
      const fileDoc = await fileRef.get();

      if (!fileDoc.exists) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileData = fileDoc.data();

      // Check permissions
      if (fileData.uploadedBy !== req.user.uid && 
          !['director', 'coo'].includes(req.user.role)) {
        return res.status(403).json({ error: 'You can only delete files you uploaded' });
      }

      // Soft delete
      await fileRef.update({
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        deletedBy: req.user.uid
      });

      // Log activity
      await helpers.logActivity({
        type: 'file_deleted',
        fileId: id,
        fileName: fileData.originalName,
        proposalId: fileData.proposalId,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        performedByRole: req.user.role,
        details: `File deleted: ${fileData.originalName}`
      });

      res.json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      console.error('Delete file error:', error);
      res.status(500).json({ error: 'Failed to delete file' });
    }
  });
}

module.exports = allowCors(handler);
