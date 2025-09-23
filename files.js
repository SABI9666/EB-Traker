const { db, storage, helpers } = require('./firebase-config');
const { verifyToken, requireRole } = require('./middleware/auth');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

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

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 5 // Maximum 5 files at once
  },
  fileFilter: (req, file, cb) => {
    // Allow common document and image types
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'text/plain',
      'text/csv',
      'application/zip',
      'application/x-zip-compressed',
      'application/json'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, images, TXT, CSV, ZIP, and JSON files are allowed.`));
    }
  }
});

const handler = async (req, res) => {
  try {
    if (req.method === 'POST') {
      return await uploadFile(req, res);
    } else if (req.method === 'GET') {
      return await getFiles(req, res);
    } else if (req.method === 'DELETE') {
      return await deleteFile(req, res);
    } else if (req.method === 'PUT') {
      return await updateFile(req, res);
    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Files API error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

// Upload single or multiple files
async function uploadFile(req, res) {
  await verifyToken(req, res, async () => {
    // Use multer middleware for single file upload
    upload.array('files', 5)(req, res, async (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large. Maximum size is 10MB per file.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: 'Too many files. Maximum 5 files per upload.' });
        }
        return res.status(400).json({ error: err.message });
      }
      
      if (err) {
        return res.status(400).json({ error: err.message });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      try {
        const { proposalId, category = 'general', description = '', tags = '' } = req.body;
        
        const uploadPromises = req.files.map(async (file) => {
          // Generate unique filename
          const fileId = uuidv4();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileExtension = file.originalname.split('.').pop();
          const fileName = `${timestamp}_${fileId}.${fileExtension}`;
          
          const filePath = proposalId ? 
            `proposals/${proposalId}/${category}/${fileName}` : 
            `general/${req.user.uid}/${category}/${fileName}`;

          // Upload to Firebase Storage
          const bucket = storage.bucket();
          const storageFile = bucket.file(filePath);
          
          await storageFile.save(file.buffer, {
            metadata: {
              contentType: file.mimetype,
              metadata: {
                uploadedBy: req.user.uid,
                originalName: file.originalname,
                fileId: fileId,
                uploadedAt: new Date().toISOString()
              }
            }
          });

          // Get download URL
          const [url] = await storageFile.getSignedUrl({
            action: 'read',
            expires: '03-09-2491' // Far future date
          });

          // Prepare file metadata for Firestore
          const fileData = {
            id: fileId,
            originalName: file.originalname,
            fileName: fileName,
            filePath: filePath,
            fileSize: file.size,
            mimeType: file.mimetype,
            category: category,
            description: description,
            tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
            proposalId: proposalId || null,
            downloadUrl: url,
            uploadedBy: req.user.uid,
            uploadedByName: req.user.name,
            uploadedAt: new Date().toISOString(),
            accessLevel: 'internal', // internal, client, public
            status: 'active',
            downloadCount: 0,
            lastAccessedAt: null
          };

          // Save to Firestore
          await db.collection('files').doc(fileId).set(fileData);

          return fileData;
        });

        const uploadedFiles = await Promise.all(uploadPromises);

        // If linked to proposal, update proposal with file references
        if (proposalId) {
          const proposalRef = db.collection('proposals').doc(proposalId);
          const proposalDoc = await proposalRef.get();
          
          if (proposalDoc.exists) {
            const fileIds = uploadedFiles.map(f => f.id);
            await proposalRef.update({
              [`files.${category}`]: helpers.arrayUnion(fileIds),
              updatedAt: new Date().toISOString()
            });

            // Log activity for each file
            for (const fileData of uploadedFiles) {
              await helpers.logActivity({
                type: 'file_uploaded',
                proposalId: proposalId,
                fileId: fileData.id,
                fileName: fileData.originalName,
                category: category,
                performedBy: req.user.uid,
                performedByName: req.user.name,
                details: `File uploaded: ${fileData.originalName}`
              });
            }
          }
        } else {
          // Log activity for general file uploads
          for (const fileData of uploadedFiles) {
            await helpers.logActivity({
              type: 'file_uploaded',
              fileId: fileData.id,
              fileName: fileData.originalName,
              category: category,
              performedBy: req.user.uid,
              performedByName: req.user.name,
              details: `General file uploaded: ${fileData.originalName}`
            });
          }
        }

        res.status(201).json({
          success: true,
          message: `${uploadedFiles.length} file(s) uploaded successfully`,
          data: uploadedFiles
        });

      } catch (error) {
        console.error('File upload error:', error);
        res.status(500).json({ error: 'Failed to upload files', details: error.message });
      }
    });
  });
}

// Get files with advanced filtering
async function getFiles(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { 
        proposalId, 
        category, 
        mimeType,
        uploadedBy,
        tags,
        limit = 50, 
        offset = 0,
        sortBy = 'uploadedAt',
        sortOrder = 'desc',
        search
      } = req.query;
      
      let query = db.collection('files').where('status', '==', 'active');

      // Filter by proposal if specified
      if (proposalId) {
        query = query.where('proposalId', '==', proposalId);
      }

      // Filter by category if specified
      if (category) {
        query = query.where('category', '==', category);
      }

      // Filter by mime type if specified
      if (mimeType) {
        query = query.where('mimeType', '==', mimeType);
      }

      // Filter by uploader if specified
      if (uploadedBy) {
        query = query.where('uploadedBy', '==', uploadedBy);
      }

      // Role-based access control
      if (req.user.role === 'bdm') {
        // BDM can only see files they uploaded or files from their proposals
        const bdmProposalsSnapshot = await db.collection('proposals')
          .where('createdBy', '==', req.user.uid)
          .get();
        
        const bdmProposalIds = [];
        bdmProposalsSnapshot.forEach(doc => bdmProposalIds.push(doc.id));
        
        if (!proposalId) {
          // If no specific proposal requested, filter by user's files or proposals
          query = query.where('uploadedBy', '==', req.user.uid);
        }
      }

      // Apply sorting
      const validSortFields = ['uploadedAt', 'originalName', 'fileSize'];
      const sortField = validSortFields.includes(sortBy) ? sortBy : 'uploadedAt';
      const order = sortOrder === 'asc' ? 'asc' : 'desc';
      
      query = query.orderBy(sortField, order);

      // Apply pagination
      if (offset > 0) {
        query = query.offset(parseInt(offset));
      }
      query = query.limit(parseInt(limit));

      const snapshot = await query.get();

      let files = [];
      snapshot.forEach(doc => {
        files.push({ id: doc.id, ...doc.data() });
      });

      // Apply client-side filters that can't be done in Firestore
      if (tags) {
        const searchTags = tags.split(',').map(tag => tag.trim().toLowerCase());
        files = files.filter(file => 
          file.tags && file.tags.some(tag => 
            searchTags.some(searchTag => tag.toLowerCase().includes(searchTag))
          )
        );
      }

      if (search) {
        const searchTerm = search.toLowerCase();
        files = files.filter(file => 
          file.originalName.toLowerCase().includes(searchTerm) ||
          (file.description && file.description.toLowerCase().includes(searchTerm)) ||
          (file.tags && file.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
        );
      }

      // Calculate total file size
      const totalSize = files.reduce((sum, file) => sum + (file.fileSize || 0), 0);

      res.json({
        success: true,
        data: files,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: files.length,
          hasMore: files.length === parseInt(limit)
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
      res.status(500).json({ error: 'Failed to fetch files', details: error.message });
    }
  });
}

// Update file metadata
async function updateFile(req, res) {
  await verifyToken(req, res, async () => {
    try {
      const { id } = req.query;
      const { description, tags, category, accessLevel } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'File ID required' });
      }

      const fileRef = db.collection('files').doc(id);
      const fileDoc = await fileRef.get();

      if (!fileDoc.exists) {
        return res.status(404).json({ error: 'File not found' });
      }

      const fileData = fileDoc.data();

      // Check permissions - only uploader, director, or COO can update
      if (fileData.uploadedBy !== req.user.uid && 
          !['director', 'coo'].includes(req.user.role)) {
        return res.status(403).json({ error: 'You can only update files you uploaded' });
      }

      const updateData = {
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.uid
      };

      if (description !== undefined) updateData.description = description;
      if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : tags.split(',').map(tag => tag.trim()).filter(tag => tag);
      if (category !== undefined) updateData.category = category;
      if (accessLevel !== undefined) updateData.accessLevel = accessLevel;

      await fileRef.update(updateData);

      res.json({
        success: true,
        message: 'File updated successfully'
      });

    } catch (error) {
      console.error('Update file error:', error);
      res.status(500).json({ error: 'Failed to update file', details: error.message });
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

      // Check permissions - only uploader, director, or COO can delete
      if (fileData.uploadedBy !== req.user.uid && 
          !['director', 'coo'].includes(req.user.role)) {
        return res.status(403).json({ error: 'You can only delete files you uploaded' });
      }

      try {
        // Delete from Firebase Storage
        const bucket = storage.bucket();
        const file = bucket.file(fileData.filePath);
        await file.delete();
      } catch (storageError) {
        console.error('Storage deletion error:', storageError);
        // Continue with database deletion even if storage fails
      }

      // Mark as deleted in Firestore (soft delete)
      await fileRef.update({
        status: 'deleted',
        deletedAt: new Date().toISOString(),
        deletedBy: req.user.uid
      });

      // If linked to proposal, remove from proposal files array
      if (fileData.proposalId) {
        const proposalRef = db.collection('proposals').doc(fileData.proposalId);
        await proposalRef.update({
          [`files.${fileData.category}`]: helpers.arrayRemove([id]),
          updatedAt: new Date().toISOString()
        });
      }

      // Log activity
      await helpers.logActivity({
        type: 'file_deleted',
        fileId: id,
        fileName: fileData.originalName,
        proposalId: fileData.proposalId,
        performedBy: req.user.uid,
        performedByName: req.user.name,
        details: `File deleted: ${fileData.originalName}`
      });

      res.json({
        success: true,
        message: 'File deleted successfully'
      });

    } catch (error) {
      console.error('Delete file error:', error);
      res.status(500).json({ error: 'Failed to delete file', details: error.message });
    }
  });
}

module.exports = allowCors(handler);
