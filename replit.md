# DeepSeek Proxy for JanitorAI

## Overview

This is a Node.js proxy server that acts as an intermediary between JanitorAI and DeepSeek's API. The proxy handles authentication, CORS configuration, and request forwarding to enable JanitorAI users to access DeepSeek's language models. The application is designed as a stateless proxy service that requires clients to provide their own DeepSeek API keys for authentication.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Architecture
- **Framework**: Express.js-based REST API server
- **Language**: Node.js with CommonJS modules
- **Request Handling**: JSON body parsing with 10MB limit for large payloads
- **Error Handling**: Centralized error responses with proper HTTP status codes

### Security and Authentication
- **Client-Side Authentication**: Requires DeepSeek API key in Authorization header from clients
- **No Server-Side Secrets**: Proxy does not store or manage API keys server-side
- **CORS Protection**: Restricted to JanitorAI domains and localhost for development
- **Header Validation**: Supports Authorization, Content-Type, and X-API-Key headers

### API Design
- **Proxy Pattern**: Forwards requests to DeepSeek API while handling authentication
- **Health Monitoring**: Dedicated health check endpoints for service monitoring
- **RESTful Endpoints**: Standard REST API structure with versioned paths
- **Request Forwarding**: Maintains original request structure while adding authentication

### Network Configuration
- **CORS Policy**: Configured for JanitorAI domain patterns and localhost development
- **Request Methods**: Supports GET, POST, PUT, DELETE, and OPTIONS
- **Port Configuration**: Configurable port with default fallback to 3000

## External Dependencies

### Core Dependencies
- **Express**: Web framework for HTTP server and routing
- **CORS**: Cross-Origin Resource Sharing middleware for browser security
- **Axios**: HTTP client for making requests to DeepSeek API
- **Dotenv**: Environment variable management for configuration

### External Services
- **DeepSeek API**: Target API service for language model completions
- **JanitorAI**: Client application that consumes this proxy service

### API Integrations
- **DeepSeek Chat Completions**: `/v1/chat/completions` endpoint proxy
- **DeepSeek Models**: `/v1/models` endpoint for available model information
- **Authentication**: Bearer token authentication forwarding to DeepSeek