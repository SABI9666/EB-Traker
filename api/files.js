const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');
const multer = require('multer');
// const sharp = require('sharp'); // REMOVED sharp requirement
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
    res.setHeader('Access-Control-Allow-Origin', '*'); // Adjust in production if needed
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
    // Get proposal to check ownership for BDMs and status
    let proposal = null;
    let proposalStatus = null;
    const effectiveProposalId = file.proposalId || proposalId; // Use file's ID first

    if (effectiveProposalId) {
        try {
            const proposalDoc = await db.collection('proposals').doc(effectiveProposalId).get();
            if (proposalDoc.exists) {
                proposal = proposalDoc.data();
                proposalStatus = proposal.status;
            }
        } catch (error) {
            console.error(`Error fetching proposal ${effectiveProposalId} for file access check:`, error);
            // If proposal fetch fails, deny access as a precaution
            return false;
        }
    }

    // BDMs can only access files from their own proposals
    if (userRole === 'bdm') {
        if (!proposal || proposal.createdByUid !== userUid) {
            return false; // Not their proposal or no proposal linked
        }
    }

    // If no proposal linked, non-BDM roles can access (e.g., general files)
    if (!effectiveProposalId && userRole !== 'bdm') {
        return true;
    }

    // Project files & Links (uploaded by BDM)
    if (!file.fileType || file.fileType === 'project' || file.fileType === 'link') {
        // For BDMs, ownership already checked above.
        // Other roles can access all project files/links if linked to a proposal.
        return true; // Access granted if it passed BDM check or user is not BDM
    }

    // Estimation files (uploaded by Estimator)
    if (file.fileType === 'estimation') {
        // Estimator, COO, and Director can always access
        if (['estimator', 'coo', 'director'].includes(userRole)) {
            return true;
        }

        // BDM can only access after director approval (or if job is won/submitted)
        // AND only for their own proposals (checked earlier)
        if (userRole === 'bdm') {
            return ['approved', 'submitted_to_client', 'won'].includes(proposalStatus);
        }
    }

    // Default deny
    return false;
}


// Helper function to filter files based on user permissions
async function filterFilesForUser(files, userRole, userUid) {
    const filteredFiles = [];
    const proposalCache = {}; // Cache proposal data to reduce reads

    for (const file of files) {
        let proposalData = null;
        if (file.proposalId && !proposalCache[file.proposalId]) {
            try {
                const proposalDoc = await db.collection('proposals').doc(file.proposalId).get();
                if (proposalDoc.exists) {
                    proposalCache[file.proposalId] = proposalDoc.data();
                }
            } catch (error) {
                 console.error(`Error fetching proposal ${file.proposalId} during file filtering:`, error);
                 // Continue without proposal data for this file if fetch fails
            }
        }
        proposalData = proposalCache[file.proposalId];

        // Determine access based on cached proposal data
        const canAccess = await canAccessFile(file, userRole, userUid, file.proposalId); // Pass proposalId context

        if (canAccess) {
            // Add access control metadata
            filteredFiles.push({
                ...file,
                canView: true,
                canDownload: file.fileType !== 'link', // Cannot download links
                canDelete: file.uploadedByUid === userUid || userRole === 'director'
            });
        }
    }

    return filteredFiles;
}


const handler = async (req, res) => {
    try {
        await util.promisify(verifyToken)(req, res); // Authenticate first

        // --- GET Request Handling ---
        if (req.method === 'GET') {
            const { proposalId, fileId } = req.query;

            // --- Get Specific File by ID ---
            if (fileId) {
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
                        canDownload: fileData.fileType !== 'link',
                        canDelete: fileData.uploadedByUid === req.user.uid || req.user.role === 'director'
                    }
                });
            }

            // --- Get Files (All Accessible or for a Specific Proposal) ---
            let query = db.collection('files').orderBy('uploadedAt', 'desc');

            if (proposalId) {
                // If requesting files for a specific proposal, first check BDM access to that proposal
                if (req.user.role === 'bdm') {
                    const proposalDoc = await db.collection('proposals').doc(proposalId).get();
                    if (!proposalDoc.exists || proposalDoc.data().createdByUid !== req.user.uid) {
                        return res.status(403).json({
                            success: false,
                            error: 'Access denied. You can only view files from your own proposals.'
                        });
                    }
                }
                // Filter files by the given proposalId
                query = query.where('proposalId', '==', proposalId);
            } else if (req.user.role === 'bdm') {
                // If BDM requests all files, filter to only those linked to their proposals
                const proposalsSnapshot = await db.collection('proposals')
                    .where('createdByUid', '==', req.user.uid)
                    .get();
                const proposalIds = proposalsSnapshot.docs.map(doc => doc.id);

                if (proposalIds.length === 0) {
                    // BDM has no proposals, so no files to show
                    return res.status(200).json({ success: true, data: [] });
                }

                 // Firestore 'in' query limit is 30 as of recent updates
                 if (proposalIds.length <= 30) {
                    query = query.where('proposalId', 'in', proposalIds);
                 } else {
                     // Handle more than 30 proposals if necessary (e.g., multiple queries or different strategy)
                     // For now, we'll limit the query implicitly by filtering later if needed,
                     // but a better approach might be needed for very large numbers.
                     console.warn(`User ${req.user.uid} has > 30 proposals. File query might be broad.`);
                     // No specific proposal filter here, will rely on filterFilesForUser
                 }
            }
             // For non-BDMs requesting all files, no additional filters needed here.

            const snapshot = await query.limit(500).get(); // Limit query size for performance
            const allFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Crucially, filter the results based on detailed access rules
            const filteredFiles = await filterFilesForUser(allFiles, req.user.role, req.user.uid);

            return res.status(200).json({ success: true, data: filteredFiles });
        }

        // --- POST Request Handling (File Uploads & Link Adding) ---
        if (req.method === 'POST') {
            const contentType = req.headers['content-type'];

            // --- Handle Link Adding (JSON Body) ---
            if (contentType && contentType.includes('application/json')) {
                // Need to manually parse JSON body in Vercel serverless functions
                 await new Promise((resolve, reject) => {
                    let body = '';
                    req.on('data', chunk => body += chunk.toString());
                    req.on('end', () => {
                        try {
                            req.body = JSON.parse(body || '{}');
                            resolve();
                        } catch (e) {
                            console.error("Error parsing JSON body for link:", e);
                            // Set empty body and reject? Or handle differently?
                            req.body = {};
                            reject(new Error("Invalid JSON format for adding links."));
                            // Or return error response directly:
                            // res.status(400).json({ success: false, error: 'Invalid JSON format' });
                        }
                    });
                     req.on('error', (err) => { reject(err); });
                });

                const { links, proposalId } = req.body;
                 const fileType = 'link'; // Explicitly set type

                if (!links || !Array.isArray(links) || links.length === 0) {
                    return res.status(400).json({ success: false, error: 'No links provided in the request body.' });
                }

                // Check BDM permissions if linking to a specific proposal
                if (req.user.role === 'bdm' && proposalId) {
                    const proposalDoc = await db.collection('proposals').doc(proposalId).get();
                    if (!proposalDoc.exists || proposalDoc.data().createdByUid !== req.user.uid) {
                        return res.status(403).json({
                            success: false,
                            error: 'You can only add links to your own proposals.'
                        });
                    }
                }

                const batch = db.batch(); // Use batch for efficiency
                const addedLinks = [];
                const activityPromises = [];

                for (const link of links) {
                     if (!link.url) continue; // Skip if URL is missing
                    const docRef = db.collection('files').doc(); // Generate new doc ref
                    const linkData = {
                        fileName: null,
                        originalName: link.title || link.url,
                        url: link.url,
                        mimeType: 'text/url',
                        fileSize: 0,
                        proposalId: proposalId || null,
                        fileType: fileType, // 'link'
                        linkDescription: link.description || '',
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                        uploadedByUid: req.user.uid,
                        uploadedByName: req.user.name,
                        uploadedByRole: req.user.role
                    };
                    batch.set(docRef, linkData);
                    addedLinks.push({ id: docRef.id, ...linkData });

                     // Log activity (prepare promise)
                    const activityRef = db.collection('activities').doc();
                    activityPromises.push(batch.set(activityRef, {
                        type: 'link_added',
                        details: `Link added: ${link.title || link.url}${proposalId ? ` for proposal ${proposalId}` : ''}`,
                        performedByName: req.user.name,
                        performedByRole: req.user.role,
                        performedByUid: req.user.uid,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        proposalId: proposalId || null,
                        fileId: docRef.id
                    }));
                }

                await batch.commit(); // Commit all writes

                return res.status(201).json({
                    success: true,
                    data: addedLinks,
                    message: `${addedLinks.length} link(s) added successfully.`
                });
            }
             // --- Handle File Upload (Multipart Form Data) ---
            else {
                return new Promise((resolve, reject) => {
                    // Use multer middleware to handle multipart/form-data
                    upload.array('files', 10)(req, res, async (err) => {
                        if (err) {
                            console.error('Multer error:', err);
                            // Handle specific multer errors more gracefully
                            if (err.message.includes('Invalid file type')) {
                                return res.status(415).json({ success: false, error: err.message });
                            }
                            if (err.code === 'LIMIT_FILE_SIZE') {
                                return res.status(413).json({ success: false, error: `File too large. Max size is ${MAX_FILE_SIZE / 1024 / 1024}MB.` });
                            }
                            if (err.code === 'LIMIT_FILE_COUNT') {
                                return res.status(413).json({ success: false, error: 'Too many files. Max 10 files allowed at once.' });
                            }
                             // General multer/upload error
                            return res.status(400).json({ success: false, error: 'File upload error: ' + err.message });
                        }

                        // --- Multer processed successfully, now handle file storage and DB entry ---
                        try {
                            if (!req.files || req.files.length === 0) {
                                return res.status(400).json({ success: false, error: 'No files were uploaded.' });
                            }

                            const { proposalId } = req.body;
                            // Determine fileType based on uploader role unless specified (and allowed)
                            let fileType = req.body.fileType;
                            if (!fileType) {
                                fileType = (req.user.role === 'bdm') ? 'project' : (req.user.role === 'estimator' ? 'estimation' : 'general'); // Default type based on role
                            }

                             // --- Permission Checks ---
                            if (req.user.role === 'bdm' && proposalId) {
                                const proposalDoc = await db.collection('proposals').doc(proposalId).get();
                                if (!proposalDoc.exists || proposalDoc.data().createdByUid !== req.user.uid) {
                                    return res.status(403).json({
                                        success: false,
                                        error: 'You can only add files to your own proposals.'
                                    });
                                }
                            }
                             // Only specific roles can upload specific types
                             if (fileType === 'estimation' && req.user.role !== 'estimator') {
                                return res.status(403).json({ success: false, error: 'Only Estimators can upload Estimation files.' });
                             }
                             if (fileType === 'project' && req.user.role !== 'bdm') {
                                 // Allow upload without proposalId if not BDM? Or restrict? Let's restrict for now.
                                 if (proposalId) {
                                    return res.status(403).json({ success: false, error: 'Only BDMs can upload Project files to proposals.' });
                                 }
                                 // If no proposalId, maybe allow COO/Director to upload 'general' project files?
                                 // For now, let's keep it simple: project files are primarily by BDMs.
                                 fileType = 'general'; // Reclassify if not BDM
                             }


                            // --- Process and Upload Each File ---
                            const uploadPromises = req.files.map(async (file) => {
                                // REMOVED Image Compression Logic Block

                                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
                                const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'); // Sanitize filename
                                const fileName = `${proposalId || 'general'}/${uniqueSuffix}-${safeOriginalName}`;
                                const fileRef = bucket.file(fileName);

                                // Upload buffer to GCS
                                await fileRef.save(file.buffer, {
                                    metadata: { contentType: file.mimetype },
                                    public: true, // Make file publicly readable
                                    // Consider adding resumable uploads for large files if needed
                                });

                                // Get public URL (simpler method)
                                const publicUrl = fileRef.publicUrl();

                                // Save metadata to Firestore
                                const fileData = {
                                    fileName,
                                    originalName: file.originalname,
                                    url: publicUrl,
                                    mimeType: file.mimetype,
                                    fileSize: file.size, // Use size after potential compression
                                    proposalId: proposalId || null,
                                    fileType: fileType,
                                    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                                    uploadedByUid: req.user.uid,
                                    uploadedByName: req.user.name,
                                    uploadedByRole: req.user.role
                                };

                                const docRef = await db.collection('files').add(fileData);

                                // Log activity
                                await db.collection('activities').add({
                                    type: 'file_uploaded',
                                    details: `File uploaded: ${file.originalname}${proposalId ? ` for proposal ${proposalId}` : ''} (${fileType})`,
                                    performedByName: req.user.name,
                                    performedByRole: req.user.role,
                                    performedByUid: req.user.uid,
                                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                                    proposalId: proposalId || null,
                                    fileId: docRef.id
                                });

                                return { id: docRef.id, ...fileData }; // Return data for response
                            });

                            const uploadedFiles = await Promise.all(uploadPromises);

                            return res.status(201).json({
                                success: true,
                                data: uploadedFiles,
                                message: `${uploadedFiles.length} file(s) uploaded successfully.`
                            });

                        } catch (uploadError) {
                             console.error('Error during file processing/upload:', uploadError);
                            return res.status(500).json({
                                success: false,
                                error: 'Internal Server Error during file upload.',
                                message: uploadError.message
                            });
                        }
                    });
                }); // End Promise wrapper for multer
            } // End else block for file upload
        } // End POST handler


        // --- DELETE Request Handling ---
        if (req.method === 'DELETE') {
            const { id } = req.query; // File document ID from Firestore
            if (!id) {
                return res.status(400).json({ success: false, error: 'File ID required in query parameters.' });
            }

            const fileDocRef = db.collection('files').doc(id);
            const fileDoc = await fileDocRef.get();

            if (!fileDoc.exists) {
                return res.status(404).json({ success: false, error: 'File metadata not found in database.' });
            }

            const fileData = fileDoc.data();

            // --- Permission Check ---
            if (fileData.uploadedByUid !== req.user.uid && req.user.role !== 'director') {
                return res.status(403).json({
                    success: false,
                    error: 'Permission denied. You can only delete files you uploaded, or you must be a director.'
                });
            }

            // --- Delete from Storage (if not a link) ---
            if (fileData.fileType !== 'link' && fileData.fileName) {
                try {
                     console.log(`Deleting file from storage: ${fileData.fileName}`);
                    await bucket.file(fileData.fileName).delete();
                     console.log(`Successfully deleted from storage: ${fileData.fileName}`);
                } catch (storageError) {
                    // Log error but proceed if file not found (maybe deleted manually?)
                     if (storageError.code === 404) {
                        console.warn(`File not found in storage during deletion: ${fileData.fileName}. Proceeding to delete Firestore record.`);
                     } else {
                        console.error(`Storage deletion error for ${fileData.fileName}:`, storageError);
                        // Optionally, stop here if storage deletion failure is critical
                        // return res.status(500).json({ success: false, error: 'Failed to delete file from storage.' });
                     }
                }
            }

            // --- Delete from Firestore ---
             console.log(`Deleting Firestore record for file ID: ${id}`);
            await fileDocRef.delete();
             console.log(`Successfully deleted Firestore record for file ID: ${id}`);

            // --- Log Activity ---
            await db.collection('activities').add({
                type: fileData.fileType === 'link' ? 'link_deleted' : 'file_deleted',
                details: `${fileData.fileType === 'link' ? 'Link' : 'File'} deleted: ${fileData.originalName}`,
                performedByName: req.user.name,
                performedByRole: req.user.role,
                performedByUid: req.user.uid,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                proposalId: fileData.proposalId || null
                // No fileId here as it's being deleted
            });

            return res.status(200).json({
                success: true,
                message: `${fileData.fileType === 'link' ? 'Link' : 'File'} deleted successfully.`
            });
        } // End DELETE handler


        // --- Method Not Allowed ---
        return res.status(405).json({ success: false, error: `Method ${req.method} not allowed.` });

    } catch (error) {
         // --- Global Error Handler ---
        console.error('Files API Error:', error);
         // Handle specific auth errors that might slip through promisify
         if (error.code && error.code.startsWith('auth/')) {
            return res.status(401).json({ success: false, error: 'Authentication failed: ' + error.message });
         }
        return res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: error.message // Include error message for debugging
        });
    }
};

module.exports = allowCors(handler); // Wrap final handler with CORS
