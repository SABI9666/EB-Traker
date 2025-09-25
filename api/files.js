// ===============================
// api/files.js - No dependencies
// ===============================
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

const mockFiles = [
  {
    id: 'file-1',
    originalName: 'office_building_electrical_plans.pdf',
    fileName: '2024-09-25_office_building_electrical_plans.pdf',
    fileSize: 2048000,
    mimeType: 'application/pdf',
    category: 'requirements',
    description: 'Complete electrical plans and specifications for TechCorp office building upgrade',
    tags: ['electrical', 'plans', 'commercial', 'techcorp'],
    proposalId: 'prop-1',
    uploadedBy: 'user-123',
    uploadedByName: 'John Smith',
    uploadedAt: new Date(Date.now() - 86400000).toISOString(),
    downloadCount: 8,
    status: 'active'
  },
  {
    id: 'file-2',
    originalName: 'factory_automation_specs.docx',
    fileName: '2024-09-24_factory_automation_specs.docx',
    fileSize: 756000,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    category: 'requirements',
    description: 'Detailed technical specifications for Manufacturing Ltd factory automation project',
    tags: ['industrial', 'automation', 'manufacturing', 'plc'],
    proposalId: 'prop-2',
    uploadedBy: 'user-456',
    uploadedByName: 'Sarah Johnson',
    uploadedAt: new Date(Date.now() - 172800000).toISOString(),
    downloadCount: 12,
    status: 'active'
  },
  {
    id: 'file-3',
    originalName: 'datacenter_infrastructure_drawings.pdf',
    fileName: '2024-09-23_datacenter_infrastructure_drawings.pdf',
    fileSize: 3072000,
    mimeType: 'application/pdf',
    category: 'proposals',
    description: 'Comprehensive infrastructure drawings for CloudTech data center project',
    tags: ['datacenter', 'infrastructure', 'cooling', 'power'],
    proposalId: 'prop-3',
    uploadedBy: 'user-789',
    uploadedByName: 'Mike Wilson',
    uploadedAt: new Date(Date.now() - 259200000).toISOString(),
    downloadCount: 15,
    status: 'active'
  },
  {
    id: 'file-4',
    originalName: 'medical_equipment_installation_guide.pdf',
    fileName: '2024-09-22_medical_equipment_installation_guide.pdf',
    fileSize: 1536000,
    mimeType: 'application/pdf',
    category: 'requirements',
    description: 'Installation guidelines and safety requirements for medical equipment electrical systems',
    tags: ['medical', 'healthcare', 'safety', 'installation'],
    proposalId: 'prop-4',
    uploadedBy: 'user-101',
    uploadedByName: 'Emily Davis',
    uploadedAt: new Date(Date.now() - 345600000).toISOString(),
    downloadCount: 6,
    status: 'active'
  },
  {
    id: 'file-5',
    originalName: 'electrical_code_compliance_checklist.xlsx',
    fileName: '2024-09-21_electrical_code_compliance_checklist.xlsx',
    fileSize: 384000,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    category: 'general',
    description: 'Comprehensive checklist for electrical code compliance across all project types',
    tags: ['compliance', 'electrical-code', 'safety', 'checklist'],
    proposalId: null,
    uploadedBy: 'user-456',
    uploadedByName: 'Sarah Johnson',
    uploadedAt: new Date(Date.now() - 432000000).toISOString(),
    downloadCount: 25,
    status: 'active'
  },
  {
    id: 'file-6',
    originalName: 'proposal_presentation_template.pptx',
    fileName: '2024-09-20_proposal_presentation_template.pptx',
    fileSize: 2048000,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    category: 'templates',
    description: 'Standard presentation template for client proposal meetings',
    tags: ['template', 'presentation', 'client', 'proposal'],
    proposalId: null,
    uploadedBy: 'user-123',
    uploadedByName: 'John Smith',
    uploadedAt: new Date(Date.now() - 518400000).toISOString(),
    downloadCount: 18,
    status: 'active'
  }
];

const handler = async (req, res) => {
  try {
    console.log('Files API called:', req.method);

    if (req.method === 'GET') {
      const { proposalId, category, search, limit = 50, offset = 0 } = req.query;
      
      let filteredFiles = [...mockFiles];

      if (proposalId) {
        filteredFiles = filteredFiles.filter(file => 
          file.proposalId === proposalId
        );
      }

      if (category) {
        filteredFiles = filteredFiles.filter(file => 
          file.category === category
        );
      }

      if (search) {
        const searchTerm = search.toLowerCase();
        filteredFiles = filteredFiles.filter(file => 
          file.originalName.toLowerCase().includes(searchTerm) ||
          (file.description && file.description.toLowerCase().includes(searchTerm)) ||
          (file.tags && file.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
        );
      }

      const startIndex = parseInt(offset);
      const endIndex = startIndex + parseInt(limit);
      const paginatedFiles = filteredFiles.slice(startIndex, endIndex);

      const totalSize = filteredFiles.reduce((sum, file) => sum + file.fileSize, 0);
      const categories = [...new Set(filteredFiles.map(f => f.category))];
      const mimeTypes = [...new Set(filteredFiles.map(f => f.mimeType))];
      const totalDownloads = filteredFiles.reduce((sum, file) => sum + file.downloadCount, 0);

      return res.json({
        success: true,
        data: paginatedFiles,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: filteredFiles.length,
          hasMore: endIndex < filteredFiles.length
        },
        summary: {
          totalFiles: filteredFiles.length,
          totalSize: totalSize,
          totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
          categories: categories,
          mimeTypes: mimeTypes,
          totalDownloads: totalDownloads,
          averageFileSize: filteredFiles.length > 0 ? Math.round(totalSize / filteredFiles.length) : 0
        },
        dataSource: 'functional_system',
        message: 'Document management system operational'
      });
    }

    if (req.method === 'POST') {
      return res.status(501).json({
        success: false,
        error: 'File upload requires storage configuration',
        message: 'Configure cloud storage to enable file uploads',
        supportedFormats: ['PDF', 'DOCX', 'XLSX', 'PPTX', 'Images']
      });
    }

    if (req.method === 'DELETE') {
      return res.status(501).json({
        success: false,
        error: 'File deletion requires storage configuration',
        message: 'Configure cloud storage to enable file management'
      });
    }

    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Files API error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Files API error',
      message: error.message
    });
  }
};

module.exports = allowCors(handler);
