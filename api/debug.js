// A special diagnostic tool to check Vercel environment variables.
const allowCors = fn => async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // Allow all origins for debugging
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return await fn(req, res);
};

const handler = (req, res) => {
    try {
        // Check for the new Base64 key first
        const hasBase64Key = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
        
        // Check for the old individual keys
        const hasProjectId = !!process.env.FIREBASE_PROJECT_ID;
        const hasClientEmail = !!process.env.FIREBASE_CLIENT_EMAIL;
        const hasPrivateKey = !!process.env.FIREBASE_PRIVATE_KEY;
        const hasStorageBucket = !!process.env.FIREBASE_STORAGE_BUCKET;

        let serviceAccountStatus = '🔴 NOT CONFIGURED.';
        let serviceAccountDetails = {};

        if (hasBase64Key) {
            serviceAccountStatus = '🟢 Base64 key is present.';
            try {
                const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64, 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                serviceAccountDetails = {
                    isKeyValidJson: true,
                    projectIdInKey: parsed.project_id,
                    clientEmailInKey: parsed.client_email,
                };
            } catch (e) {
                serviceAccountStatus = '🔴 ERROR: Base64 key is present but CORRUPTED or invalid.';
            }
        } else if (hasProjectId && hasClientEmail && hasPrivateKey) {
            serviceAccountStatus = '🟢 Individual keys are present.';
        }

        res.status(200).json({
            message: "EBTracker Debug Endpoint",
            environmentVariableCheck: {
                serviceAccountStatus,
                isStorageBucketPresent: hasStorageBucket,
            },
            serviceAccountDetails,
            individualKeyCheck: {
                hasProjectId,
                hasClientEmail,
                hasPrivateKey,
            }
        });

    } catch (error) {
        res.status(500).json({
            error: "Debug endpoint failed unexpectedly.",
            message: error.message,
        });
    }
};

module.exports = allowCors(handler);
