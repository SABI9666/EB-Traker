const admin = require('./_firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../middleware/auth');
const multer = require('multer');
const util = require('util');

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Configure multer to handle file parsing in memory, with a 10MB file size limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).array('files'); // This allows for multiple file uploads with the field name 'files'

const allowCors = fn => async (req, res) => {
    res.setHeader('Access-control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

// Function to check file access based on user role
const canAccessFile = (file, userRole, userId) => {
    // Directors can access all files
    if (userRole === 'director') return true;
    // COO can access all files
    if (userRole === 'coo') return true;
    // BDM can access project files and approved estimation files
    if (userRole === 'bdm') {
        if (file.fileType === 'project') return true;
        if (file.fileType === 'estimation' && file.status === 'approved') return true;
        return false;
    }
    // Estimator can access project files and their own estimation files
    if (userRole === 'estimator') {
        if (file.fileType === 'project') return true;
        if (file.fileType === 'estimation' && file.uploadedByUid === userId) return true;
        return false;
    }
    return false;
};

const handler = async (req, res) => {
    try {
        // Authentication is run for all methods except OPTIONS
        await util.promisify(verifyToken)(req, res);

        if (req.method === 'GET') {
            const { proposalId, fileType } = req.query;
            let query = db.collection('files');
        
            if (proposalId) {
                query = query.where('proposalId', '==', proposalId);
            }
        
            if (fileType) {
                query = query.where('fileType', '==', fileType);
            }
        
            const filesSnapshot = await query.orderBy('uploadedAt', 'desc').get();
            let files = filesSnapshot.docs.map(doc => doc.data());
        
            // Filter files based on user role and permissions
            files = files.filter(file => canAccessFile(file, req.user.role, req.user.uid));
        
            // Add access permission flag for frontend
            files = files.map(file => ({
                ...file,
                canDownload: canAccessFile(file, req.user.role, req.user.uid),
                canDelete: file.uploadedByUid === req.user.uid || req.user.role === 'director'
            }));
        
            return res.status(200).json({ success: true, data: files });
        }

        if (req.method === 'POST') {
            await util.promisify(upload)(req, res);
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ success: false, error: 'No files were uploaded.' });
            }
            
            const uploadPromises = req.files.map(file => {
                const uniqueFilename = `${uuidv4()}-${file.originalname}`;
                const blob = bucket.file(uniqueFilename);
                const blobStream = blob.createWriteStream({ metadata: { contentType: file.mimetype } });

                return new Promise((resolve, reject) => {
                    blobStream.on('error', err => reject(err));
                    blobStream.on('finish', async () => {
                        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
                        const fileMetadata = {
                            id: uuidv4(),
                            originalName: file.originalname,
                            fileName: uniqueFilename,
                            fileSize: file.size,
                            mimeType: file.mimetype,
                            url: publicUrl,
                            proposalId: req.body.proposalId || null,
                            fileType: req.body.fileType || 'project', // 'project' or 'estimation'
                            status: req.body.fileType === 'estimation' ? 'pending' : 'active', // Track approval status
                            uploadedByUid: req.user.uid,
                            uploadedByName: req.user.name,
                            uploadedByRole: req.user.role, // Add role for tracking
                            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                        };
                        await db.collection('files').doc(fileMetadata.id).set(fileMetadata);
                        resolve(fileMetadata);
                    });
                    blobStream.end(file.buffer);
                });
            });

            const results = await Promise.all(uploadPromises);
            return res.status(201).json({ success: true, message: 'Files uploaded successfully.', data: results });
        }

        if (req.method === 'PUT') {
            const { id, action } = req.query;
        
            if (!id || !action) {
                return res.status(400).json({ success: false, error: 'File ID and action are required.' });
            }
        
            if (action === 'approve' && req.user.role === 'director') {
                const fileRef = db.collection('files').doc(id);
                const fileDoc = await fileRef.get();
        
                if (!fileDoc.exists) {
                    return res.status(404).json({ success: false, error: 'File not found' });
                }
        
                await fileRef.update({
                    status: 'approved',
                    approvedBy: req.user.name,
                    approvedAt: admin.firestore.FieldValue.serverTimestamp()
                });
        
                // Notify BDM that estimation file is approved
                if (fileDoc.data().fileType === 'estimation') {
                    await db.collection('notifications').add({
                        type: 'estimation_approved',
                        recipientRole: 'bdm',
                        message: `Estimation file approved for proposal ${fileDoc.data().proposalId}`,
                        fileId: id,
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        isRead: false
                    });
                }
        
                return res.status(200).json({ success: true, message: 'File approved successfully' });
            }
        
            return res.status(400).json({ success: false, error: 'Invalid action or insufficient permissions' });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ success: false, error: 'A file ID is required.' });

            const fileDocRef = db.collection('files').doc(id);
            const fileDoc = await fileDocRef.get();
            if (!fileDoc.exists) return res.status(404).json({ success: false, error: 'File not found.' });
            
            await bucket.file(fileDoc.data().fileName).delete();
            await fileDocRef.delete();
            
            return res.status(200).json({ success: true, message: 'File deleted successfully.' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed.' });

    } catch (error) {
        console.error(`${req.method} /api/files error:`, error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(handler);
