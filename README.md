# DeepSeek Proxy for JanitorAI

A Node.js proxy server that allows JanitorAI to connect to DeepSeek's API. This proxy handles authentication, CORS, and request forwarding between JanitorAI and the DeepSeek API.

## Features

- **API Proxy**: Forwards requests from JanitorAI to DeepSeek API
- **CORS Support**: Configured to work with JanitorAI's domain
- **Authentication**: Handles DeepSeek API key authentication
- **Error Handling**: Proper error responses and logging
- **Health Checks**: Health monitoring endpoints

## API Endpoints

- `GET /` - Service status and information
- `GET /health` - Health check endpoint
- `POST /v1/chat/completions` - Chat completions proxy to DeepSeek
- `GET /v1/models` - Available models from DeepSeek

## Usage with JanitorAI

1. Deploy this proxy server
2. In JanitorAI, set your API endpoint to your deployed proxy URL
3. **Important**: You must provide your DeepSeek API key in JanitorAI's API key field - the proxy requires authentication via the `Authorization: Bearer <your-deepseek-key>` header

## Security

- **Authentication Required**: All API endpoints require a valid DeepSeek API key in the Authorization header
- **CORS Protection**: Only allows requests from JanitorAI domains and localhost for development
- **No Server-Side API Key**: The proxy does not store or use a server-side API key - clients must provide their own

## Running Locally

```bash
npm install
npm start
```

The server will start on port 3000 by default.
