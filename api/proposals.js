// ============= BACKEND FIX: proposals.js =============
// Update the proposals.js handler to handle both JSON and FormData

const admin = require('./_firebase-admin');
const { verifyToken } = require('../middleware/auth');
const util = require('util');
const multer = require('multer');

const db = admin.firestore();
const bucket = admin.storage().bucket();

// Add multer for handling multipart form data
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).array('files');

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

const handler = async (req, res) => {
    try {
        await util.promisify(verifyToken)(req, res);

        if (req.method === 'GET') {
            const { id } = req.query;
            if (id) {
                const doc = await db.collection('proposals').doc(id).get();
                if (!doc.exists) return res.status(404).json({ success: false, error: 'Proposal not found' });
                return res.status(200).json({ success: true, data: { id: doc.id, ...doc.data() } });
            }
            const snapshot = await db.collection('proposals').orderBy('createdAt', 'desc').get();
            const proposals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return res.status(200).json({ success: true, data: proposals });
        }

        if (req.method === 'POST') {
            // Check if this is multipart form data (has files)
            const contentType = req.headers['content-type'] || '';
            
            let proposalData = {};
            let uploadedFiles = [];
            
            if (contentType.includes('multipart/form-data')) {
                // Handle multipart form data with files
                await util.promisify(upload)(req, res);
                
                // Parse the proposal data from form fields
                proposalData = {
                    projectName: req.body.projectName,
                    clientCompany: req.body.clientCompany,
                    scopeOfWork: req.body.scopeOfWork,
                    projectType: req.body.projectType || 'Commercial',
                    priority: req.body.priority || 'Medium',
                    country: req.body.country || 'Not Specified',
                    timeline: req.body.timeline || 'Not Specified'
                };
                
                // Store files temporarily
                uploadedFiles = req.files || [];
            } else {
                // Handle regular JSON request
                proposalData = req.body;
            }
            
            // Validate required fields
            if (!proposalData.projectName || !proposalData.clientCompany || !proposalData.scopeOfWork) {
                return res.status(400).json({ success: false, error: 'Missing required fields' });
            }

            // Create the proposal
            const newProposal = {
                projectName: proposalData.projectName.trim(),
                clientCompany: proposalData.clientCompany.trim(),
                projectType: proposalData.projectType || 'Commercial',
                scopeOfWork: proposalData.scopeOfWork.trim(),
                priority: proposalData.priority || 'Medium',
                country: proposalData.country || 'Not Specified',
                timeline: proposalData.timeline || 'Not Specified',
                status: 'pending_estimation',
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                createdByUid: req.user.uid,
                createdByName: req.user.name,
                createdByRole: req.user.role,
                changeLog: [{
                    timestamp: new Date().toISOString(),
                    action: 'created',
                    performedByName: req.user.name,
                    details: 'Proposal created'
                }]
            };

            const docRef = await db.collection('proposals').add(newProposal);
            const proposalId = docRef.id;

            // Upload files if any
            if (uploadedFiles.length > 0) {
                for (const file of uploadedFiles) {
                    const uniqueFilename = `${proposalId}-${Date.now()}-${file.originalname}`;
                    const blob = bucket.file(uniqueFilename);
                    
                    const blobStream = blob.createWriteStream({
                        metadata: {
                            contentType: file.mimetype,
                            metadata: {
                                firebaseStorageDownloadTokens: require('uuid').v4()
                            }
                        },
                        public: true
                    });

                    await new Promise((resolve, reject) => {
                        blobStream.on('error', reject);
                        blobStream.on('finish', async () => {
                            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
                            
                            // Save file metadata
                            await db.collection('files').add({
                                originalName: file.originalname,
                                fileName: uniqueFilename,
                                fileSize: file.size,
                                mimeType: file.mimetype,
                                url: publicUrl,
                                proposalId: proposalId,
                                fileType: 'project',
                                uploadedByUid: req.user.uid,
                                uploadedByName: req.user.name,
                                uploadedByRole: req.user.role,
                                uploadedAt: admin.firestore.FieldValue.serverTimestamp()
                            });
                            resolve();
                        });
                        blobStream.end(file.buffer);
                    });
                }
            }

            // Add activity
            await db.collection('activities').add({
                type: 'proposal_created',
                details: `New proposal created: ${proposalData.projectName} for ${proposalData.clientCompany}`,
                performedByName: req.user.name,
                performedByRole: req.user.role,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                proposalId: proposalId,
                projectName: proposalData.projectName,
                clientCompany: proposalData.clientCompany
            });

            return res.status(201).json({ 
                success: true, 
                data: { 
                    id: proposalId, 
                    ...newProposal,
                    createdAt: new Date()
                } 
            });
        }

        // ... rest of the PUT and DELETE methods remain the same ...

        return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (error) {
        console.error('Proposals API error:', error);
        return res.status(500).json({ success: false, error: 'Internal Server Error', message: error.message });
    }
};

module.exports = allowCors(handler);

// ============= FRONTEND FIX: Updated Create Proposal Function =============
// Replace the showCreateProposalModal function in your index.html with this:

function showCreateProposalModal() {
    const projectTypes = [
        'Steel Detailing', 'Miscellaneous Steel', 'Connection Design', 'PE Stamping',
        'Joist Detailing', 'As-built Drawings'
    ];
    
    const modalHtml = `
        <div class="modal-overlay">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Create New Proposal</h2>
                    <div class="subtitle">Start a new project with file uploads</div>
                </div>
                
                <form id="createProposalForm" class="modal-form">
                    <div class="form-section">
                        <h4>Project Information</h4>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Project Name *</label>
                                <input type="text" id="projectName" class="form-control" placeholder="Enter project name" required>
                            </div>
                            <div class="form-group">
                                <label>Client Company *</label>
                                <input type="text" id="clientCompany" class="form-control" placeholder="Enter client company" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Project Type</label>
                                <select id="projectType" class="form-control">
                                    <option value="">Select Type</option>
                                    ${projectTypes.map(type => `<option value="${type}">${type}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Timeline (Days)</label>
                                <input type="text" id="timeline" class="form-control" placeholder="Project timeline">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Country</label>
                                <select id="country" class="form-control">
                                    <option value="">Select Country</option>
                                    <option value="Australia">Australia</option>
                                    <option value="USA">USA</option>
                                    <option value="Canada">Canada</option>
                                    <option value="UK">UK</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Priority</label>
                                <select id="priority" class="form-control">
                                    <option value="Medium">Medium</option>
                                    <option value="High">High</option>
                                    <option value="Low">Low</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label>Scope of Work *</label>
                        <textarea id="scopeOfWork" class="form-control" rows="4" placeholder="Describe the project scope..." required></textarea>
                    </div>
                    
                    <div class="form-section">
                        <h4>Upload Project Files (RFQ, Tender Documents, Drawings)</h4>
                        <div class="upload-area" id="uploadArea">
                            <div class="upload-icon">📁</div>
                            <p>Click to upload or drag and drop files</p>
                            <div style="font-size: 0.9rem; color: var(--text-light); margin-top: 0.5rem;">
                                Supported: PDF, DOCX, XLSX, DWG
                            </div>
                            <input type="file" id="fileInput" multiple style="display: none;">
                        </div>
                        <div id="filePreview"></div>
                    </div>
                    
                    <div style="display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem;">
                        <button type="button" onclick="closeModal()" class="btn btn-outline">Cancel</button>
                        <button type="submit" class="btn btn-primary">Create Proposal</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Setup file upload
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    uploadArea.onclick = () => fileInput.click();
    
    let selectedFiles = [];
    
    fileInput.onchange = function() {
        selectedFiles = Array.from(this.files);
        if (selectedFiles.length > 0) {
            document.getElementById('filePreview').innerHTML = 
                '<h5>Files to Upload:</h5>' + 
                selectedFiles.map(f => `<p>📄 ${f.name} (${(f.size / 1024 / 1024).toFixed(2)} MB)</p>`).join('');
        }
    };
    
    // Handle form submission
    document.getElementById('createProposalForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        try {
            showLoading();
            
            // Option 1: Create proposal with files in single request
            if (selectedFiles.length > 0) {
                // Use FormData to send both proposal data and files
                const formData = new FormData();
                formData.append('projectName', document.getElementById('projectName').value);
                formData.append('clientCompany', document.getElementById('clientCompany').value);
                formData.append('projectType', document.getElementById('projectType').value || 'Commercial');
                formData.append('country', document.getElementById('country').value || 'Not Specified');
                formData.append('timeline', document.getElementById('timeline').value || 'Not Specified');
                formData.append('priority', document.getElementById('priority').value || 'Medium');
                formData.append('scopeOfWork', document.getElementById('scopeOfWork').value);
                
                // Append files
                selectedFiles.forEach(file => formData.append('files', file));
                
                const response = await apiCall('proposals', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.success) {
                    alert('Proposal created successfully with files!');
                    closeModal();
                    showProposals();
                }
            } else {
                // Option 2: Create proposal without files (JSON request)
                const proposalData = {
                    projectName: document.getElementById('projectName').value,
                    clientCompany: document.getElementById('clientCompany').value,
                    projectType: document.getElementById('projectType').value || 'Commercial',
                    country: document.getElementById('country').value || 'Not Specified',
                    timeline: document.getElementById('timeline').value || 'Not Specified',
                    priority: document.getElementById('priority').value || 'Medium',
                    scopeOfWork: document.getElementById('scopeOfWork').value
                };
                
                const response = await apiCall('proposals', {
                    method: 'POST',
                    body: JSON.stringify(proposalData)
                });
                
                if (response.success) {
                    alert('Proposal created successfully!');
                    closeModal();
                    showProposals();
                }
            }
        } catch (error) {
            alert(`Creation failed: ${error.message}`);
        } finally {
            hideLoading();
        }
    });
}
module.exports = allowCors(handler);
