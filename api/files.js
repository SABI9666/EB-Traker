const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');

const db = admin.firestore();
const bucket = admin.storage().bucket();

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

// Helper function to check file access permissions
async function canAccessFile(file, userRole, proposalId = null) {
    // If no proposal linked, files are accessible to all authenticated users
    if (!file.proposalId && !proposalId) {
        return true;
    }

    // Get proposal status if we have a proposal ID
    let proposalStatus = null;
    if (file.proposalId || proposalId) {
        const proposalDoc = await db.collection('proposals').doc(file.proposalId || proposalId).get();
        if (proposalDoc.exists) {
            proposalStatus = proposalDoc.data().status;
        }
    }

    // Project files (uploaded by BDM) - accessible to all roles
    if (!file.fileType || file.fileType === 'project') {
        return true;
    }

    // Estimation files (uploaded by Estimator)
    if (file.fileType === 'estimation') {
        // Estimator, COO, and Director can always access
        if (['estimator', 'coo', 'director'].includes(userRole)) {
            return true;
        }
        
        // BDM can only access after director approval
        if (userRole === 'bdm') {
            return proposalStatus === 'approved' || proposalStatus === 'submitted_to_client';
        }
    }

    return false;
}

// Helper function to filter files based on user permissions
async function filterFilesForUser(files, userRole) {
    const filteredFiles = [];
    
    for (const file of files) {
        const canAccess = await canAccessFile(file, userRole);
        if (canAccess) {
            // Add access control metadata
            filteredFiles.push({
                ...file,
                canView: true,
                canDownload: true,
                canDelete: file.uploadedByUid === userRole || userRole === 'director'
            });
        }
    }
    
    return filteredFiles;
}

const handler = async (req, res) => {
    try {
        await util.promisify(verifyToken)(req, res);

        if (req.method === 'GET') {
            const { proposalId, fileId } = req.query;
            
            if (fileId) {
                // Get specific file
                const fileDoc = await db.collection('files').doc(fileId).get();
                if (!fileDoc.exists) {
                    return res.status(404).json({ success: false, error: 'File not found' });
                }
                
                const fileData = fileDoc.data();
                const canAccess = await canAccessFile(fileData, req.user.role);
                
                if (!canAccess) {
                    return res.status(403).json({ 
                        success: false, 
                        error: 'Access denied. You do not have permission to view this file.' 
                    });
                }
                
                return res.status(200).json({ 
                    success: true, 
                    data: { 
                        id: fileDoc.id, 
                        ...fileData,
                        canView: true,
                        canDownload: true,
                        canDelete: fileData.uploadedByUid === req.user.uid || req.user.role === 'director'
                    } 
                });
            }
            
            // Get all files or files for a specific proposal
            let query = db.collection('files').orderBy('uploadedAt', 'desc');
            
            if (proposalId) {
                query = query.where('proposalId', '==', proposalId);
            }
            
            const snapshot = await query.get();
            const allFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Filter files based on user permissions
            const filteredFiles = await filterFilesForUser(allFiles, req.user.role);
            
            return res.status(200).json({ success: true, data: filteredFiles });
        }

        if (req.method === 'POST') {
            // Handle file upload
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ success: false, error: 'No files provided' });
            }

            const { proposalId, fileType = 'project' } = req.body;
            const uploadedFiles = [];

            // Validate file type permissions
            if (fileType === 'estimation' && req.user.role !== 'estimator') {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Only estimators can upload estimation files' 
                });
            }

            if (fileType === 'project' && req.user.role !== 'bdm') {
                return res.status(403).json({ 
                    success: false, 
                    error: 'Only BDMs can upload project files' 
                });
            }

            for (const file of req.files) {
                const fileName = `${proposalId || 'general'}/${Date.now()}-${file.originalname}`;
                const fileRef = bucket.file(fileName);
                
                await fileRef.save(file.buffer, {
                    metadata: {
                        contentType: file.mimetype,
                    },
                });

                // Make file publicly accessible
                await fileRef.makePublic();
                
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

                // Save file metadata to Firestore
                const fileData = {
                    fileName,
                    originalName: file.originalname,
                    url: publicUrl,
                    mimeType: file.mimetype,
                    fileSize: file.size,
                    proposalId: proposalId || null,
                    fileType: fileType,
                    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                    uploadedByUid: req.user.uid,
                    uploadedByName: req.user.name,
                    uploadedByRole: req.user.role
                };

                const docRef = await db.collection('files').add(fileData);
                uploadedFiles.push({ id: docRef.id, ...fileData });

                // Log activity
                await db.collection('activities').add({
                    type: 'file_uploaded',
                    details: `File uploaded: ${file.originalname}${proposalId ? ` for proposal ${proposalId}` : ''}`,
                    performedByName: req.user.name,
                    performedByRole: req.user.role,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    proposalId: proposalId || null,
                    fileId: docRef.id
                });
            }

            return res.status(201).json({ 
                success: true, 
                data: uploadedFiles,
                message: `${uploadedFiles.length} file(s) uploaded successfully` 
            });
        }

        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) {
                return res.status(400).json({ success: false, error: 'File ID required' });
            }

            const fileDoc = await db.collection('files').doc(id).get();
            if (!fileDoc.exists) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }

            const fileData = fileDoc.data();

            // Check delete permissions
            if (fileData.uploadedByUid !== req.user.uid && req.user.role !== 'director') {
                return res.status(403).json({ 
                    success: false, 
                    error: 'You can only delete files you uploaded, or you must be a director' 
                });
            }

            try {
                // Delete from storage
                await bucket.file(fileData.fileName).delete();
            } catch (storageError) {
                console.warn('File not found in storage, continuing with database deletion');
            }

            // Delete from Firestore
            await fileDoc.ref.delete();

            // Log activity
            await db.collection('activities').add({
                type: 'file_deleted',
                details: `File deleted: ${fileData.originalName}`,
                performedByName: req.user.name,
                performedByRole: req.user.role,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                proposalId: fileData.proposalId || null
            });

            return res.status(200).json({ 
                success: true, 
                message: 'File deleted successfully' 
            });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (error) {
        console.error('Files API error:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error', 
            message: error.message 
        });
    }
};

module.exports = allowCors(handler);
