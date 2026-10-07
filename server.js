const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const AMD_API_BASE = 'https://developer.amd.com.cn/radeon/api/v1';

const CONFIG = {
    // Per-attempt timeout (ms). Keep below Render's free-tier ~100s platform limit.
    REQUEST_TIMEOUT_MS: 90000,

    // Total attempts per request (1 = no retry). 3 = up to 2 retries.
    MAX_ATTEMPTS: 3,

    // Exponential backoff: delay = min(BASE * 2^(attempt-1), MAX)
    RETRY_BASE_DELAY_MS: 1000,
    RETRY_MAX_DELAY_MS: 8000,

    // Upstream HTTP statuses that trigger a retry
    RETRYABLE_STATUSES: [500, 501, 502, 503, 504],

    // Network-level error codes that trigger a retry
    RETRYABLE_NETWORK_CODES: [
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNREFUSED'
    ],

    // Retry on request timeout? Off by default: a single timeout already burns
    // most of Render's free-tier 100s request budget, so retrying would just
    // cause the client to see Render's 502 before we finish.
    RETRY_ON_TIMEOUT: false
};

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Short random ID so we can trace a single request across its retries.
function requestId() {
    return Math.random().toString(36).slice(2, 10);
}

// Never log the full key. Just the last 4 chars and the length.
function describeKey(apiKey) {
    if (!apiKey) return 'MISSING';
    if (apiKey.length < 6) return 'TOO_SHORT';
    return `...${apiKey.slice(-4)} (length=${apiKey.length})`;
}

// Human-readable explanation of an axios error. Used in logs so you can see
// at a glance what actually went wrong.
function explainError(error) {
    const status = error.response?.status;
    const code = error.code;
    const upstream = error.response?.data;

    // Network / transport layer
    if (code === 'ECONNABORTED') {
        return `TIMEOUT: AMD did not respond within ${CONFIG.REQUEST_TIMEOUT_MS}ms. ` +
               `Likely a cold start, an overloaded model, or too many max_tokens requested.`;
    }
    if (code === 'ECONNRESET') {
        return `CONNECTION RESET by AMD mid-request. Usually a transient upstream/network issue.`;
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return `DNS FAILURE resolving developer.amd.com.cn. Possible DNS/network blip on Render's side.`;
    }
    if (code === 'ECONNREFUSED') {
        return `CONNECTION REFUSED by AMD. Upstream may be down or blocking Render.`;
    }

    // HTTP status explanations
    if (status === 400) {
        return `400 BAD REQUEST from AMD. Usually an unsupported parameter ` +
               `(e.g. frequency_penalty, logit_bias) or a max_tokens value the model rejects.`;
    }
    if (status === 401) {
        return `401 UNAUTHORIZED. AMD rejected the API key. Check: starts with 'rc-', ` +
               `51 chars total, account verified on the AMD portal, and key not rotated.`;
    }
    if (status === 403) {
        return `403 FORBIDDEN. Key may be valid but not entitled to this model, ` +
               `or the account has been suspended.`;
    }
    if (status === 404) {
        return `404 NOT FOUND. Wrong endpoint or wrong model name. ` +
               `Confirm the model ID exactly matches one AMD publishes.`;
    }
    if (status === 408) {
        return `408 REQUEST TIMEOUT from AMD's edge.`;
    }
    if (status === 429) {
        return `429 RATE LIMITED. Either a short-term rate limit or the daily free ` +
               `credit balance is exhausted. Wait and retry.`;
    }
    if (status === 500) {
        return `500 INTERNAL SERVER ERROR from AMD. Their backend hit an unexpected error.`;
    }
    if (status === 501) {
        return `501 NOT IMPLEMENTED. AMD does not support this endpoint or feature.`;
    }
    if (status === 502) {
        return `502 BAD GATEWAY. AMD's gateway could not reach the model backend.`;
    }
    if (status === 503) {
        return `503 SERVICE UNAVAILABLE. AMD reports no available workers for this model ` +
               `("all circuits open or unhealthy"). This is a temporary AMD-side outage — ` +
               `try another model or retry later.`;
    }
    if (status === 504) {
        return `504 GATEWAY TIMEOUT from AMD. The model backend took too long to respond.`;
    }
    if (status && status >= 500) {
        return `${status} SERVER ERROR from AMD.`;
    }

    return error.message || 'Unknown error';
}

// Is this error worth retrying?
function isRetryable(error) {
    const status = error.response?.status;
    if (status && CONFIG.RETRYABLE_STATUSES.includes(status)) return true;
    if (error.code === 'ECONNABORTED' && CONFIG.RETRY_ON_TIMEOUT) return true;
    if (CONFIG.RETRYABLE_NETWORK_CODES.includes(error.code)) return true;
    return false;
}

// Wrapper that adds retries + structured logging around an axios call.
async function axiosWithRetry({ method, url, data, headers, timeout, label, reqId }) {
    let lastError;

    for (let attempt = 1; attempt <= CONFIG.MAX_ATTEMPTS; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`[${reqId}] [${label}] retry attempt ${attempt}/${CONFIG.MAX_ATTEMPTS}`);
            }
            return await axios({ method, url, data, headers, timeout });
        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            const code = error.code;
            const explanation = explainError(error);
            const retryable = isRetryable(error);
            const hasMoreAttempts = attempt < CONFIG.MAX_ATTEMPTS;

            // Compact structured log line
            console.error(
                `[${reqId}] [${label}] attempt ${attempt}/${CONFIG.MAX_ATTEMPTS} failed ` +
                `| status=${status ?? 'n/a'} | code=${code ?? 'n/a'} | retryable=${retryable}` +
                `\n   reason: ${explanation}` +
                (error.response?.data
                    ? `\n   upstream body: ${JSON.stringify(error.response.data).slice(0, 500)}`
                    : '')
            );

            if (retryable && hasMoreAttempts) {
                const delay = Math.min(
                    CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1),
                    CONFIG.RETRY_MAX_DELAY_MS
                );
                console.log(`[${reqId}] [${label}] waiting ${delay}ms before retry...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            if (!retryable) {
                console.log(`[${reqId}] [${label}] non-retryable error, giving up.`);
            } else {
                console.log(`[${reqId}] [${label}] retries exhausted, giving up.`);
            }
            throw error;
        }
    }

    throw lastError;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'AMD Radeon Cloud Proxy for JanitorAI',
        version: '1.1.0',
        upstream: AMD_API_BASE,
        config: {
            timeoutMs: CONFIG.REQUEST_TIMEOUT_MS,
            maxAttempts: CONFIG.MAX_ATTEMPTS,
            retryableStatuses: CONFIG.RETRYABLE_STATUSES
        }
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Chat completions proxy
app.post('/v1/chat/completions', async (req, res) => {
    const reqId = requestId();
    try {
        const rawAuth = req.headers.authorization || req.headers['x-api-key'] || '';
        const apiKey = rawAuth.replace(/^Bearer\s+/i, '').trim();

        console.log(
            `[${reqId}] [chat/completions] key=${describeKey(apiKey)} model=${req.body?.model} ` +
            `stream=${req.body?.stream ?? false} max_tokens=${req.body?.max_tokens ?? 'unset'}`
        );

        if (!apiKey) {
            console.error(`[${reqId}] [chat/completions] no API key supplied by client`);
            return res.status(401).json({
                error: { message: 'API key is required (Authorization: Bearer <key>)' }
            });
        }

        const response = await axiosWithRetry({
            method: 'post',
            url: `${AMD_API_BASE}/chat/completions`,
            data: req.body,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'AMD-JanitorAI-Proxy/1.1.0'
            },
            timeout: CONFIG.REQUEST_TIMEOUT_MS,
            label: 'chat/completions',
            reqId
        });

        console.log(`[${reqId}] [chat/completions] success status=${response.status}`);
        res.status(response.status).json(response.data);

    } catch (error) {
        const explanation = explainError(error);
        console.error(`[${reqId}] [chat/completions] FINAL FAILURE -> ${explanation}`);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else if (error.code === 'ECONNABORTED') {
            res.status(504).json({
                error: {
                    message:
                        `Proxy timeout: AMD did not respond within ${CONFIG.REQUEST_TIMEOUT_MS}ms. ` +
                        `Try a shorter response, a different model, or retry later.`
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

// Models list proxy
app.get('/v1/models', async (req, res) => {
    const reqId = requestId();
    try {
        const rawAuth = req.headers.authorization || req.headers['x-api-key'] || '';
        const apiKey = rawAuth.replace(/^Bearer\s+/i, '').trim();

        console.log(`[${reqId}] [models] key=${describeKey(apiKey)}`);

        if (!apiKey) {
            console.error(`[${reqId}] [models] no API key supplied by client`);
            return res.status(401).json({
                error: { message: 'API key is required (Authorization: Bearer <key>)' }
            });
        }

        const response = await axiosWithRetry({
            method: 'get',
            url: `${AMD_API_BASE}/models`,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'User-Agent': 'AMD-JanitorAI-Proxy/1.1.0'
            },
            timeout: CONFIG.REQUEST_TIMEOUT_MS,
            label: 'models',
            reqId
        });

        console.log(`[${reqId}] [models] success status=${response.status}`);
        res.json(response.data);

    } catch (error) {
        const explanation = explainError(error);
        console.error(`[${reqId}] [models] FINAL FAILURE -> ${explanation}`);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({
                error: { message: 'Failed to fetch models', details: error.message }
            });
        }
    }
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: { message: 'Internal server error' } });
});

app.use((req, res) => {
    res.status(404).json({
        error: { message: `Endpoint ${req.method} ${req.path} not found` }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`AMD Radeon Cloud Proxy running on http://0.0.0.0:${PORT}`);
    console.log(`Upstream: ${AMD_API_BASE}`);
    console.log(`Per-attempt timeout: ${CONFIG.REQUEST_TIMEOUT_MS}ms`);
    console.log(`Max attempts: ${CONFIG.MAX_ATTEMPTS} (retryable: ${CONFIG.RETRYABLE_STATUSES.join(', ')})`);
    console.log('Health check: GET /health');
    console.log('Chat completions: POST /v1/chat/completions');
    console.log('Models list: GET /v1/models');
    console.log('🔐 Auth: clients must send Authorization: Bearer <amd_api_key>');
    console.log('🌐 CORS: configured for JanitorAI domains and localhost');
});
