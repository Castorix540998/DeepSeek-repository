const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// AMD Radeon Cloud API base URL
const AMD_API_BASE = 'https://developer.amd.com.cn/radeon/api/v1';

// CORS configuration for JanitorAI
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        // Check if origin matches JanitorAI domains
        const janitorPattern = /^https:\/\/(www\.|[\w-]+\.)?janitorai\.com$/;
        const localhostPattern = /^http:\/\/localhost:\d+$/;

        if (janitorPattern.test(origin) || localhostPattern.test(origin)) {
            return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Small helper to safely describe a key in logs without leaking it
function describeKey(apiKey) {
    if (!apiKey) return 'MISSING';
    if (apiKey.length < 6) return 'TOO_SHORT';
    return `...${apiKey.slice(-4)} (length=${apiKey.length})`;
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'AMD Radeon Cloud Proxy for JanitorAI',
        version: '1.0.0',
        upstream: AMD_API_BASE
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// AMD Radeon Cloud chat completions proxy endpoint
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const rawAuth = req.headers.authorization || req.headers['x-api-key'] || '';
        const apiKey = rawAuth.replace(/^Bearer\s+/i, '').trim();

        console.log(`[chat/completions] incoming key: ${describeKey(apiKey)}, model: ${req.body?.model}`);

        if (!apiKey) {
            return res.status(401).json({
                error: {
                    message: 'API key is required (Authorization: Bearer <key>)'
                }
            });
        }

        // Forward the request to AMD Radeon Cloud API
        const response = await axios.post(`${AMD_API_BASE}/chat/completions`, req.body, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'AMD-JanitorAI-Proxy/1.0.0'
            },
            timeout: 60000 // 60 second timeout
        });

        // Forward the response back to JanitorAI
        res.status(response.status).json(response.data);

    } catch (error) {
        console.error('AMD API Error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });

        if (error.response) {
            // Forward AMD API errors verbatim so JanitorAI shows the real reason
            res.status(error.response.status).json(error.response.data);
        } else if (error.code === 'ECONNABORTED') {
            res.status(504).json({
                error: {
                    message: 'Request timeout - AMD API did not respond within 60 seconds'
                }
            });
        } else {
            res.status(500).json({
                error: {
                    message: 'Internal proxy error',
                    details: error.message
                }
            });
        }
    }
});

// Handle models endpoint
app.get('/v1/models', async (req, res) => {
    try {
        const rawAuth = req.headers.authorization || req.headers['x-api-key'] || '';
        const apiKey = rawAuth.replace(/^Bearer\s+/i, '').trim();

        console.log(`[models] incoming key: ${describeKey(apiKey)}`);

        if (!apiKey) {
            return res.status(401).json({
                error: {
                    message: 'API key is required (Authorization: Bearer <key>)'
                }
            });
        }

        const response = await axios.get(`${AMD_API_BASE}/models`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'User-Agent': 'AMD-JanitorAI-Proxy/1.0.0'
            }
        });

        res.json(response.data);

    } catch (error) {
        console.error('AMD Models API Error:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({
                error: {
                    message: 'Failed to fetch models'
                }
            });
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: {
            message: 'Internal server error'
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: {
            message: `Endpoint ${req.method} ${req.path} not found`
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`AMD Radeon Cloud Proxy running on http://0.0.0.0:${PORT}`);
    console.log(`Upstream: ${AMD_API_BASE}`);
    console.log('Health check: GET /health');
    console.log('Chat completions: POST /v1/chat/completions');
    console.log('Models list: GET /v1/models');
    console.log('🔐 Auth: clients must send Authorization: Bearer <amd_api_key>');
    console.log('🌐 CORS: configured for JanitorAI domains and localhost');
});
