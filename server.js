const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        service: 'DeepSeek Proxy for JanitorAI',
        version: '1.0.0'
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// DeepSeek API proxy endpoint
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const apiKey = req.headers.authorization?.replace('Bearer ', '');
        
        if (!apiKey) {
            return res.status(401).json({ 
                error: { 
                    message: 'API key is required' 
                } 
            });
        }

        // Forward the request to DeepSeek API
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', req.body, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'DeepSeek-Proxy/1.0.0'
            },
            timeout: 60000 // 60 second timeout
        });

        // Forward the response back to JanitorAI
        res.status(response.status).json(response.data);
        
    } catch (error) {
        console.error('DeepSeek API Error:', {
            message: error.message,
            status: error.response?.status,
            // Don't log response data to avoid leaking sensitive content
            hasData: !!error.response?.data
        });

        if (error.response) {
            // Forward DeepSeek API errors
            res.status(error.response.status).json(error.response.data);
        } else if (error.code === 'ECONNABORTED') {
            res.status(504).json({ 
                error: { 
                    message: 'Request timeout - DeepSeek API did not respond within 60 seconds' 
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
        const apiKey = req.headers.authorization?.replace('Bearer ', '');
        
        if (!apiKey) {
            return res.status(401).json({ 
                error: { 
                    message: 'API key is required' 
                } 
            });
        }

        const response = await axios.get('https://api.deepseek.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'User-Agent': 'DeepSeek-Proxy/1.0.0'
            }
        });

        res.json(response.data);
        
    } catch (error) {
        console.error('DeepSeek Models API Error:', error.message);
        
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
    console.log(`DeepSeek Proxy Server running on http://0.0.0.0:${PORT}`);
    console.log('Health check: GET /health');
    console.log('Chat completions: POST /v1/chat/completions');
    console.log('Models list: GET /v1/models');
    
    console.log('🔐 Authentication: Clients must provide Authorization: Bearer <deepseek_api_key> header');
    console.log('🌐 CORS: Configured for JanitorAI domains and localhost development');
});