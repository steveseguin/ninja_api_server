"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const callback = {};
const sseClients = [];

// Configuration
const HTTP_PORT = process.env.HTTP_PORT || 80;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const USE_HTTPS = process.env.USE_HTTPS === 'true';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const CALLBACK_TIMEOUT = process.env.CALLBACK_TIMEOUT || 5000;
const SSE_PING_INTERVAL = process.env.SSE_PING_INTERVAL || 60000;

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*'
}));

// Create servers
const httpServer = http.createServer(app);
let httpsServer;

if (USE_HTTPS && SSL_KEY_PATH && SSL_CERT_PATH) {
    const sslOptions = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
    };
    httpsServer = https.createServer(sslOptions, app);
}

// WebSocket server
const websocketServer = new WebSocket.Server({
    noServer: true,
    maxPayload: 100 * 1024 // 100KB limit
});

// Handle WebSocket upgrades
const servers = USE_HTTPS && httpsServer ? [httpServer, httpsServer] : [httpServer];
servers.forEach(server => {
    server.on('upgrade', (request, socket, head) => {
        websocketServer.handleUpgrade(request, socket, head, ws => {
            websocketServer.emit('connection', ws, request);
        });
    });
});

// Helper functions
function generatePID() {
    return Math.random().toString(36).substr(2, 9);
}

function createCallbackPromise(pid) {
    return new Promise((resolve, reject) => {
        callback[pid] = { resolve, reject };
        setTimeout(() => {
            if (callback[pid]) {
                callback[pid].resolve('timeout');
                delete callback[pid];
            }
        }, CALLBACK_TIMEOUT, pid);
    });
}

function sendToClients(room, channelNum, message) {
    let counter = 0;
    websocketServer.clients.forEach(client => {
        if (client.room === room) {
            try {
                if (client.inn) {
                    if (client.inn == channelNum) {
                        client.send(message);
                        counter += 1;
                    }
                } else {
                    client.send(message);
                    counter += 1;
                }
            } catch (e) {}
        }
    });
    return counter;
}

function parseUrlEncoded(data) {
    const keyValuePairs = data.split('&');
    const parsedData = {};
    keyValuePairs.forEach((pair) => {
        const [key, value] = pair.split('=');
        parsedData[key] = decodeURIComponent(value || '');
    });
    return parsedData;
}

// Routes
app.get('/', (req, res) => {
    res.send("VDO.Ninja API Server");
});

app.get('/:room', async (req, res) => {
    const room = req.params.room.substring(0, 100); // Limit room name length
    const pid = generatePID();
    const promise = createCallbackPromise(pid);
    
    const { channel } = req.query;
    const channelNum = channel ? parseInt(channel, 10) : 1;
    
    const msg = JSON.stringify({
        action: "getDetails",
        value: "value",
        get: pid
    });
    
    const counter = sendToClients(room, channelNum, msg);
    
    if (counter == 0) {
        res.send("failed");
        if (callback[pid]) {
            callback[pid].resolve('failed');
            delete callback[pid];
        }
    } else {
        const result = await promise;
        res.send(String(result));
        delete callback[pid];
    }
});

app.get('/sse/:roomName', (req, res) => {
    const { roomName } = req.params;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const sseClient = res;
    sseClient.write(':ping\n\n');
    sseClient.room = roomName;
    
    sseClients.push(sseClient);
    
    req.on('close', () => {
        const index = sseClients.indexOf(sseClient);
        if (index !== -1) {
            sseClients.splice(index, 1);
        }
    });
});

app.get('/:room/:action/:targetOrValue?/:value?', async (req, res) => {
    const { room, action, targetOrValue, value } = req.params;
    const pid = generatePID();
    const promise = createCallbackPromise(pid);
    
    let target, actualValue;
    if (targetOrValue !== undefined && value === undefined) {
        actualValue = targetOrValue;
        target = undefined;
    } else {
        target = targetOrValue;
        actualValue = value;
    }
    
    const msg = { action, get: pid };
    if (target !== undefined) msg.target = target;
    if (actualValue !== undefined) msg.value = actualValue;
    
    const { channel } = req.query;
    let channelNum = channel ? parseInt(channel, 10) : 1;
    
    // Handle content2-7 actions
    if (msg.action.match(/^content[2-7]$/)) {
        channelNum = parseInt(msg.action.substring(7));
        msg.action = "content";
    }
    
    const counter = sendToClients(room, channelNum, JSON.stringify(msg));
    
    if (counter == 0) {
        const response = channelNum != 1 ? "special" : "failed";
        res.send(response);
        if (callback[pid]) {
            callback[pid].resolve(response);
            delete callback[pid];
        }
    } else {
        const result = await promise;
        res.send(String(result));
        delete callback[pid];
    }
});

app.post('/:room', async (req, res) => {
    const room = req.params.room.substring(0, 100);
    const pid = generatePID();
    const promise = createCallbackPromise(pid);
    
    const { channel } = req.query;
    const channelNum = channel ? parseInt(channel, 10) : 1;
    
    const msg = { ...(req.body || {}), get: pid };
    const counter = sendToClients(room, channelNum, JSON.stringify(msg));
    
    if (counter == 0) {
        res.send("failed");
        if (callback[pid]) {
            callback[pid].resolve('failed');
            delete callback[pid];
        }
    } else {
        const result = await promise;
        res.send(String(result));
        delete callback[pid];
    }
});

app.post('/:room/:action', async (req, res) => {
    const room = req.params.room.substring(0, 100);
    const pid = generatePID();
    const promise = createCallbackPromise(pid);
    
    const { channel } = req.query;
    const channelNum = channel ? parseInt(channel, 10) : 1;
    
    const msg = { get: pid };
    
    if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
        let formData = '';
        req.on('data', (chunk) => {
            formData += chunk;
        });
        req.on('end', async () => {
            msg[req.params.action] = parseUrlEncoded(formData);
            const counter = sendToClients(room, channelNum, JSON.stringify(msg));
            
            if (counter == 0) {
                res.send('failed');
                if (callback[pid]) {
                    callback[pid].resolve('failed');
                    delete callback[pid];
                }
            } else {
                const result = await promise;
                res.send(String(result));
                delete callback[pid];
            }
        });
    } else {
        msg[req.params.action] = req.body || {};
        const counter = sendToClients(room, channelNum, JSON.stringify(msg));
        
        if (counter == 0) {
            res.send('failed');
            if (callback[pid]) {
                callback[pid].resolve('failed');
                delete callback[pid];
            }
        } else {
            const result = await promise;
            res.send(String(result));
            delete callback[pid];
        }
    }
});

app.put('/:room', async (req, res) => {
    const room = req.params.room.substring(0, 100);
    const pid = generatePID();
    const promise = createCallbackPromise(pid);
    
    const { channel } = req.query;
    const channelNum = channel ? parseInt(channel, 10) : 1;
    
    const msg = { ...(req.body || {}), get: pid };
    const counter = sendToClients(room, channelNum, JSON.stringify(msg));
    
    if (counter == 0) {
        const response = channelNum != 1 ? "special" : "failed";
        res.send(response);
        if (callback[pid]) {
            callback[pid].resolve(response);
            delete callback[pid];
        }
    } else {
        const result = await promise;
        res.send(String(result));
        delete callback[pid];
    }
});

app.put('/:room/:action', async (req, res) => {
    const room = req.params.room.substring(0, 100);
    const pid = generatePID();
    const promise = createCallbackPromise(pid);
    
    const { channel } = req.query;
    const channelNum = channel ? parseInt(channel, 10) : 1;
    
    const msg = {
        [req.params.action]: req.body || {},
        get: pid
    };
    
    const counter = sendToClients(room, channelNum, JSON.stringify(msg));
    
    if (counter == 0) {
        const response = channelNum != 1 ? "special" : "failed";
        res.send(response);
        if (callback[pid]) {
            callback[pid].resolve(response);
            delete callback[pid];
        }
    } else {
        const result = await promise;
        res.send(String(result));
        delete callback[pid];
    }
});

// SSE ping interval
setInterval(() => {
    sseClients.forEach(sseClient => {
        try {
            sseClient.write(':ping\n\n');
        } catch (e) {
            console.error('Error sending ping:', e);
        }
    });
}, SSE_PING_INTERVAL);

// WebSocket connection handler
websocketServer.on('connection', (webSocketClient, request) => {
    let room = false;
    let out = false;
    
    const pathComponents = request.url.split('/');
    if (pathComponents.length >= 3 && pathComponents[1] === 'join') {
        if (pathComponents[2]) {
            room = pathComponents[2];
            webSocketClient.room = room;
        }
        if (pathComponents.length >= 4) {
            const inChannel = parseInt(pathComponents[3], 10);
            if (!isNaN(inChannel)) {
                webSocketClient.inn = inChannel;
            }
        }
        if (pathComponents.length >= 5) {
            const outChannel = parseInt(pathComponents[4], 10);
            if (!isNaN(outChannel)) {
                webSocketClient.out = outChannel;
                out = outChannel;
            }
        }
    }
    
    webSocketClient.on('message', (message) => {
        try {
            if (!webSocketClient.room) {
                try {
                    const msg = JSON.parse(message);
                    if ("join" in msg) {
                        room = String(msg.join);
                        webSocketClient.room = room;
                        
                        if ("out" in msg) {
                            webSocketClient.out = msg.out;
                            out = msg.out;
                        } else {
                            webSocketClient.out = false;
                        }
                        if ("in" in msg) {
                            webSocketClient.inn = msg.in;
                        } else {
                            webSocketClient.inn = false;
                        }
                    }
                    return;
                } catch (e) {
                    return;
                }
            }
            
            const msg = JSON.parse(message);
            if (msg.callback && ("get" in msg.callback)) {
                if (callback[msg.callback.get]) {
                    if ("result" in msg.callback) {
                        if (typeof msg.callback.result == 'object') {
                            callback[msg.callback.get].resolve(JSON.stringify(msg.callback.result));
                        } else {
                            callback[msg.callback.get].resolve(msg.callback.result);
                        }
                    } else {
                        callback[msg.callback.get].resolve("null");
                    }
                    delete callback[msg.callback.get];
                }
                return;
            }
            
            // Send to SSE clients
            const sseEvent = `data: ${message.toString()}\n\n`;
            sseClients.forEach((sseClient) => {
                try {
                    if (sseClient.room === room) {
                        sseClient.write(sseEvent);
                    }
                } catch (e) {
                    console.error('Error sending SSE message:', e);
                }
            });
            
            // Forward to WebSocket clients
            const outChannel = msg.out || out;
            websocketServer.clients.forEach(client => {
                if (client.room === room && webSocketClient !== client) {
                    if (client.inn && outChannel) {
                        if (client.inn == outChannel) {
                            try {
                                client.send(message.toString());
                            } catch (e) {}
                        }
                    } else if (!client.inn && !outChannel) {
                        try {
                            client.send(message.toString());
                        } catch (e) {}
                    }
                }
            });
        } catch (e) {
            console.error('Error handling message:', e);
        }
    });
    
    webSocketClient.on('close', function(reasonCode, description) {});
});

// Start servers
httpServer.listen(HTTP_PORT, () => {
    console.log(`HTTP Server started on port ${HTTP_PORT}`);
});

if (USE_HTTPS && httpsServer) {
    httpsServer.listen(HTTPS_PORT, () => {
        console.log(`HTTPS Server started on port ${HTTPS_PORT}`);
    });
}