# VDO.Ninja API Server

A lightweight WebSocket and HTTP API server for VDO.Ninja clients and other similar services. This server enables message routing between clients in rooms with support for channeled communication.

## Features

- **WebSocket Support**: Real-time bidirectional communication
- **HTTP REST API**: RESTful endpoints for sending messages to WebSocket clients
- **Room-based Communication**: Clients join rooms to communicate
- **Channel Support**: Route messages to specific channels within rooms
- **Server-Sent Events (SSE)**: Subscribe to room events via SSE
- **CORS Enabled**: Cross-origin resource sharing support
- **Callback System**: Request-response pattern over WebSocket

## Installation

1. Clone the repository:
```bash
git clone https://github.com/steveseguin/ninja_api_server
cd vdo-ninja-api
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables (optional):
```bash
cp .env.example .env
```

## Configuration

The server can be configured using environment variables:

- `HTTP_PORT` - HTTP server port (default: 80)
- `HTTPS_PORT` - HTTPS server port (default: 443)
- `USE_HTTPS` - Enable HTTPS server (default: false)
- `SSL_KEY_PATH` - Path to SSL private key file
- `SSL_CERT_PATH` - Path to SSL certificate file
- `CALLBACK_TIMEOUT` - Callback timeout in milliseconds (default: 5000)
- `SSE_PING_INTERVAL` - SSE ping interval in milliseconds (default: 60000)

## Usage

### Starting the Server

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev
```

### WebSocket Connection

Connect to the WebSocket server:
```
ws://localhost/join/{room}/{inChannel}/{outChannel}
```

Or join a room after connecting:
```javascript
ws.send(JSON.stringify({
  join: "roomName",
  in: 1,    // optional: input channel
  out: 2    // optional: output channel
}));
```

### HTTP API Endpoints

#### GET /:room
Get details from clients in a room
```bash
curl http://localhost/myroom?channel=1
```

#### GET /:room/:action/:target/:value
Send an action with parameters
```bash
curl http://localhost/myroom/play/video1/true
```

#### POST /:room
Send JSON data to a room
```bash
curl -X POST http://localhost/myroom \
  -H "Content-Type: application/json" \
  -d '{"action":"update","data":"value"}'
```

#### POST /:room/:action
Send data as a specific action
```bash
curl -X POST http://localhost/myroom/notification \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello World"}'
```

#### PUT /:room and PUT /:room/:action
Similar to POST but returns "special" for non-default channels when no clients are found

#### GET /sse/:roomName
Subscribe to Server-Sent Events for a room
```javascript
const eventSource = new EventSource('http://localhost/sse/myroom');
eventSource.onmessage = (event) => {
  console.log('Received:', event.data);
};
```

### Channel Communication

Channels allow targeted message routing within rooms:

- `channel` query parameter in HTTP requests targets specific input channels
- WebSocket clients can specify `in` and `out` channels
- Messages are routed based on matching input/output channels

## Security Considerations

**Important**: This is a basic implementation. For production use, consider:

1. **Authentication**: Add API key or token-based authentication
2. **Rate Limiting**: Implement request throttling (or use Cloudflare)
3. **Input Validation**: Validate and sanitize all inputs
4. **HTTPS**: Always use HTTPS in production
5. **Message Size Limits**: The server limits WebSocket messages to 100KB

## Deployment

### Using PM2

```bash
npm install -g pm2
pm2 start apiserver.js --name vdo-ninja-api
pm2 save
pm2 startup
```

### Using Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 80 443
CMD ["node", "apiserver.js"]
```

### Behind a Reverse Proxy (Nginx)

```nginx
location / {
    proxy_pass http://localhost:80;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For issues and feature requests, please use the GitHub issue tracker.
