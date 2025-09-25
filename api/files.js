const admin = require('./_firebase-admin');
const { v4: uuidv4 } = require('uuid');
const { verifyToken } = require('../middleware/auth');
const multer = require('multer');
const util = require('util');

const db = admin.firestore();
const bucket = admin.storage().bucket();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).array('files');

const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,DELETE,POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

const apiHandler = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await util.promisify(verifyToken)(req, res); // Authenticate here
            await util.promisify(upload)(req, res);

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ success: false, error: 'No files uploaded.' });
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
                            uploadedByUid: req.user.uid,
                            uploadedByName: req.user.name,
                            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                        };
                        await db.collection('files').doc(fileMetadata.id).set(fileMetadata);
                        resolve(fileMetadata);
                    });
                    blobStream.end(file.buffer);
                });
            });

            const results = await Promise.all(uploadPromises);
            return res.status(201).json({ success: true, message: 'Files uploaded successfully', data: results });
        }

        if (req.method === 'GET') {
            await util.promisify(verifyToken)(req, res); // Authenticate here
            const filesSnapshot = await db.collection('files').orderBy('uploadedAt', 'desc').get();
            const files = filesSnapshot.docs.map(doc => doc.data());
            return res.json({ success: true, data: files });
        }

        if (req.method === 'DELETE') {
            await util.promisify(verifyToken)(req, res); // Authenticate here
            const { id } = req.query;
            if (!id) return res.status(400).json({ success: false, error: 'File ID is required' });

            const fileDocRef = db.collection('files').doc(id);
            const fileDoc = await fileDocRef.get();

            if (!fileDoc.exists) {
                return res.status(404).json({ success: false, error: 'File not found' });
            }

            await bucket.file(fileDoc.data().fileName).delete();
            await fileDocRef.delete();
            
            return res.json({ success: true, message: 'File deleted successfully' });
        }

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (error) {
        console.error('Files API error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(apiHandler);

