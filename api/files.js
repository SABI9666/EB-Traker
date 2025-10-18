const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path'); // Added for file extension checking

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Configure max file size from env, default to 100MB
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024;

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE, // 100MB per file
        files: 10 // Allow up to 10 files at once
    },
    fileFilter: (req, file, cb) => {
        // Validate file types by extension
        const allowedExtRegex = /pdf|docx|xlsx|xls|dwg|jpg|jpeg|png|gif/;
        const extname = allowedExtRegex.test(path.extname(file.originalname).toLowerCase());
        
        // Validate by MIME type as a fallback
        const allowedMimes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
            'application/vnd.ms-excel', // .xls
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'application/acad', // CAD
            'application/x-acad', // CAD
            'image/vnd.dwg' // CAD
        ];
        const mimetype = allowedMimes.includes(file.mimetype);

        if (extname || mimetype) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PDF, DOCX, XLSX, DWG, and images are allowed.'));
        }
    }
});


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

// Helper function to check file access permissions with BDM isolation
async function canAccessFile(file, userRole, userUid, proposalId = null) {
    // Get proposal to check ownership for BDMs
    let proposal = null;
    if (file.proposalId || proposalId) {
        const proposalDoc = await db.collection('proposals').doc(file.proposalId || proposalId).get();
        if (proposalDoc.exists) {
            proposal = proposalDoc.data();
        }
    }
    
    // BDMs can only access files from their own proposals
    if (userRole === 'bdm') {
        if (!proposal || proposal.createdByUid !== userUid) {
            return false;
        }
    }

    // If no proposal linked, files are accessible to non-BDM roles only
    if (!file.proposalId && !proposalId) {
        return userRole !== 'bdm'; // BDMs can only see files linked to their proposals
    }

    // Project files (uploaded by BDM) - accessible based on role
    if (!file.fileType || file.fileType === 'project' || file.fileType === 'link') {
        // For BDMs, already checked above
        // Other roles can access all project files
        return userRole !== 'bdm' || (proposal && proposal.createdByUid === userUid);
    }

    // Estimation files (uploaded by Estimator)
    if (file.fileType === 'estimation') {
        // Estimator, COO, and Director can always access
        if (['estimator', 'coo', 'director'].includes(userRole)) {
            return true;
        }
        
        // BDM can only access after director approval AND only for their own proposals
        if (userRole === 'bdm') {
            const proposalStatus = proposal?.status;
            return (proposal.createdByUid === userUid) && 
                   (proposalStatus === 'approved' || proposalStatus === 'submitted_to_client');
        }
    }

    return false;
}

// Helper function to filter files based on user permissions
async function filterFilesForUser(files, userRole, userUid) {
    const filteredFiles = [];
    
    for (const file of files) {
        const canAccess = await canAccessFile(file, userRole, userUid);
        if (canAccess) {
            // Add access control metadata
            filteredFiles.push({
                ...file,
                canView: true,
                canDownload: true,
                canDelete: file.uploadedByUid === userUid || userRole === 'director'
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
                const canAccess = await canAccessFile(fileData, req.user.role, req.user.uid);
                
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
                // Check if BDM can access this proposal
                if (req.user.role === 'bdm') {
                    const proposalDoc = await db.collection('proposals').doc(proposalId).get();
                    if (!proposalDoc.exists || proposalDoc.data().createdByUid !== req.user.uid) {
                        return res.status(403).json({ 
                            success: false, 
                            error: 'Access denied. You can only view files from your own proposals.' 
                        });
                    }
                }
                query = query.where('proposalId', '==', proposalId);
            } else if (req.user.role === 'bdm') {
                // BDMs should only see files from their own proposals
                // First get all their proposals
                const proposalsSnapshot = await db.collection('proposals')
                    .where('createdByUid', '==', req.user.uid)
                    .get();
                const proposalIds = proposalsSnapshot.docs.map(doc => doc.id);
                
                if (proposalIds.length === 0) {
                    return res.status(200).json({ success: true, data: [] });
                }
                
                // Then get files for those proposals
                query = query.where('proposalId', 'in', proposalIds);
            }
            
            const snapshot = await query.get();
            const allFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Filter files based on user permissions
            const filteredFiles = await filterFilesForUser(allFiles, req.user.role, req.user.uid);
            
            return res.status(200).json({ success: true, data: filteredFiles });
        }

        if (req.method === 'POST') {
            // Check if this is a link upload or file upload
            const contentType = req.headers['content-type'];
            
            if (contentType && contentType.includes('application/json')) {
                // Handle link upload
                await new Promise((resolve) => {
                    const chunks = [];
                    req.on('data', (chunk) => chunks.push(chunk));
                    req.on('end', () => {
                        try {
                            const bodyBuffer = Buffer.concat(chunks);
                            req.body = bodyBuffer.length > 0 ? JSON.parse(bodyBuffer.toString()) : {};
                        } catch (e) {
                            console.error("Error parsing JSON body:", e);
                            req.body = {};
                        }
                        resolve();
                    });
                });
                
                const { links, proposalId, fileType = 'link' } = req.body;
                
                if (!links || !Array.isArray(links) || links.length === 0) {
                    return res.status(400).json({ success: false, error: 'No links provided' });
                }
                
                // Check if BDM can upload to this proposal
                if (req.user.role === 'bdm' && proposalId) {
                    const proposalDoc = await db.collection('proposals').doc(proposalId).get();
                    if (!proposalDoc.exists || proposalDoc.data().createdByUid !== req.user.uid) {
                        return res.status(403).json({ 
                            success: false, 
                            error: 'You can only add files to your own proposals.' 
                        });
                    }
                }
                
                const uploadedLinks = [];
                
                for (const link of links) {
                    const linkData = {
                        fileName: null, // No physical file
                        originalName: link.title || link.url,
                        url: link.url,
                        mimeType: 'text/url',
                        fileSize: 0,
                        proposalId: proposalId || null,
                        fileType: 'link',
                        linkDescription: link.description || '',
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                        uploadedByUid: req.user.uid,
                        uploadedByName: req.user.name,
                        uploadedByRole: req.user.role
                    };
                    
                    const docRef = await db.collection('files').add(linkData);
                    uploadedLinks.push({ id: docRef.id, ...linkData });
                    
                    // Log activity
                    await db.collection('activities').add({
                        type: 'link_added',
                        details: `Link added: ${link.title || link.url}${proposalId ? ` for proposal ${proposalId}` : ''}`,
                        performedByName: req.user.name,
                        performedByRole: req.user.role,
                        performedByUid: req.user.uid,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        proposalId: proposalId || null,
                        fileId: docRef.id
                    });
                }
                
                return res.status(201).json({ 
                    success: true, 
                    data: uploadedLinks,
                    message: `${uploadedLinks.length} link(s) added successfully` 
                });
                
            } else {
                // Handle file upload with multer
                return new Promise((resolve, reject) => {
                    upload.array('files', 10)(req, res, async (err) => {
                        if (err) {
                            console.error('Multer error:', err);
                            // Handle specific multer errors
                            if (err.message.includes('Invalid file type')) { // Updated error message check
                                return res.status(415).json({ success: false, error: err.message }); // 415 Unsupported Media Type
                            }
                            if (err.code === 'LIMIT_FILE_SIZE') {
                                return res.status(413).json({ success: false, error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` }); // 413 Payload Too Large
                            }
                            if (err.code === 'LIMIT_FILE_COUNT') { // Added error for file count
                                return res.status(413).json({ success: false, error: 'Too many files. Max 10 files allowed at once.' });
                            }
                            return res.status(400).json({ success: false, error: 'File upload error: ' + err.message });
                        }

                        try {
                            // Check if files were uploaded
                            if (!req.files || req.files.length === 0) {
                                return res.status(400).json({ success: false, error: 'No files provided' });
                            }

                            const { proposalId, fileType = 'project' } = req.body;
                            const uploadedFiles = [];

                            // Check if BDM can upload to this proposal
                            if (req.user.role === 'bdm' && proposalId) {
                                const proposalDoc = await db.collection('proposals').doc(proposalId).get();
                                if (!proposalDoc.exists || proposalDoc.data().createdByUid !== req.user.uid) {
                                    return res.status(403).json({ 
                                        success: false, 
                                        error: 'You can only add files to your own proposals.' 
                                    });
                                }
                            }

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
                                
                                // --- START: Image Compression Logic ---
                                try {
                                    if (file.mimetype.startsWith('image/')) {
                                        // Compress image if it's larger than 2MB
                                        if (file.size > 2 * 1024 * 1024) {
                                            const compressedBuffer = await sharp(file.buffer)
                                                .jpeg({ quality: 85 })
                                                .toBuffer();
                                            file.buffer = compressedBuffer;
                                            file.size = compressedBuffer.length;
                                        }
                                    }
                                } catch (compressError) {
                                    console.warn(`Could not compress image ${file.originalname}: ${compressError.message}. Uploading original.`);
                                    // If compression fails, continue with the original buffer
                                }
                                // --- END: Image Compression Logic ---

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
                                    performedByUid: req.user.uid,
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

                        } catch (error) {
                            console.error('File upload error:', error);
                            return res.status(500).json({ 
                                success: false, 
                                error: 'Internal Server Error', 
                                message: error.message 
                            });
                        }
                    });
                });
            }
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

            // Only delete from storage if it's not a link
            if (fileData.fileType !== 'link' && fileData.fileName) {
                try {
                    await bucket.file(fileData.fileName).delete();
                } catch (storageError) {
                    console.warn('File not found in storage, continuing with database deletion');
                }
            }

            // Delete from Firestore
            await fileDoc.ref.delete();

            // Log activity
            await db.collection('activities').add({
                type: fileData.fileType === 'link' ? 'link_deleted' : 'file_deleted',
                details: `${fileData.fileType === 'link' ? 'Link' : 'File'} deleted: ${fileData.originalName}`,
                performedByName: req.user.name,
                performedByRole: req.user.role,
                performedByUid: req.user.uid,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                proposalId: fileData.proposalId || null
            });

            return res.status(200).json({ 
                success: true, 
                message: `${fileData.fileType === 'link' ? 'Link' : 'File'} deleted successfully` 
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
