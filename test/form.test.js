"use strict";

const assert = require("assert").strict;
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { URLSearchParams } = require("url");

// Exercise the real POST handler without opening ports or loading dependencies.
// Transport and Express registration are inert; routing, parsing and callbacks
// execute unchanged from apiserver.js.
function loadServer() {
    const routes = new Map();
    const app = { use() {} };
    for (const method of ["get", "post", "put"]) {
        app[method] = (route, handler) => routes.set(`${method} ${route}`, handler);
    }
    const express = () => app;
    express.json = () => () => {};
    let wss;
    class WebSocketServer extends EventEmitter {
        constructor() {
            super();
            this.clients = new Set();
            wss = this;
        }
    }
    const server = new EventEmitter();
    server.listen = () => {};
    const timers = [];
    const dependencies = {
        fs,
        http: { createServer: () => server },
        https: { createServer: () => server },
        express,
        ws: { Server: WebSocketServer },
        cors: () => () => {},
        crypto: require("crypto")
    };
    const context = {
        require(name) {
            assert.ok(Object.prototype.hasOwnProperty.call(dependencies, name), name);
            return dependencies[name];
        },
        process: { env: { FORM_URLENCODED_MAX_BYTES: "128" } },
        console,
        URLSearchParams,
        setInterval() {},
        setTimeout(fn) { timers.push(fn); }
    };
    const filename = path.join(__dirname, "..", "apiserver.js");
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });

    const messages = [];
    const peer = new EventEmitter();
    peer.send = raw => {
        const message = JSON.parse(raw);
        messages.push(message);
        peer.emit("message", JSON.stringify({ callback: { get: message.get, result: "ok" } }));
    };
    wss.clients.add(peer);
    wss.emit("connection", peer, { url: "/join/studio/1/1" });

    return {
        messages,
        async post(body, contentType = "application/x-www-form-urlencoded", room = "studio") {
            const req = new EventEmitter();
            req.params = { room, action: "notification" };
            req.query = {};
            req.headers = { "content-type": contentType };
            const response = { statusCode: 200 };
            const res = {
                status(code) { response.statusCode = code; return this; },
                send(value) { response.body = value; }
            };
            if (contentType === "application/json") req.body = body;
            await routes.get("post /:room/:action")(req, res);
            if (req.listenerCount("end")) {
                req.emit("data", Buffer.from(body));
                // Await the actual async listener to expose parsing failures as
                // test failures. EventEmitter itself does not handle rejections.
                await req.listeners("end")[0]();
            }
            for (const timer of timers) timer();
            assert.ok(Object.prototype.hasOwnProperty.call(response, "body"), "response completed");
            return response;
        }
    };
}

const tests = [
    ["decodes standard form spaces, encoded keys and embedded equals", async () => {
        const server = loadServer();
        const response = await server.post("first%20name=Jane+Doe&token=a=b==&unicode=%E2%9C%93");
        assert.equal(response.body, "ok");
        assert.deepEqual(server.messages[0].notification, {
            "first name": "Jane Doe", token: "a=b==", unicode: "✓"
        });
    }],
    ["accepts the charset parameter sent by browser form requests", async () => {
        const server = loadServer();
        await server.post("message=Hello+World", "application/x-www-form-urlencoded;charset=UTF-8");
        assert.deepEqual(server.messages[0].notification, { message: "Hello World" });
    }],
    ["malformed percent escapes do not reject the request handler", async () => {
        const server = loadServer();
        const response = await server.post("message=100%&incomplete=%E0%A4%A");
        assert.equal(response.body, "ok");
        assert.deepEqual(server.messages[0].notification, { message: "100%", incomplete: "�%A" });
    }],
    ["preserves last-value wins and empty values", async () => {
        const server = loadServer();
        await server.post("message=first&message=last&empty=&bare");
        assert.deepEqual(server.messages[0].notification, { message: "last", empty: "", bare: "" });
    }],
    ["preserves a literal question mark in the first form field name", async () => {
        const server = loadServer();
        await server.post("?name=value");
        assert.deepEqual(server.messages[0].notification, { "?name": "value" });
    }],
    ["keeps special field names as data", async () => {
        const server = loadServer();
        await server.post("__proto__=value&constructor=other");
        assert.equal(server.messages[0].notification.__proto__, "value");
        assert.equal(server.messages[0].notification.constructor, "other");
    }],
    ["retains form size limits without forwarding oversized messages", async () => {
        const server = loadServer();
        const response = await server.post("message=" + "a".repeat(128));
        assert.deepEqual(response, { statusCode: 413, body: "payload-too-large" });
        assert.deepEqual(server.messages, []);
    }],
    ["keeps JSON action posts and empty-room responses working", async () => {
        const server = loadServer();
        assert.equal((await server.post({ message: "JSON" }, "application/json")).body, "ok");
        assert.deepEqual(server.messages[0].notification, { message: "JSON" });
        assert.equal((await server.post("message=hello", undefined, "empty")).body, "failed");
        assert.equal(server.messages.length, 1);
    }]
];

(async () => {
    let failed = 0;
    for (const [name, run] of tests) {
        try {
            await run();
            console.log(`PASS ${name}`);
        } catch (error) {
            failed++;
            console.error(`FAIL ${name}\n${error.stack}`);
        }
    }
    console.log(`${tests.length - failed}/${tests.length} tests passed`);
    if (failed) process.exitCode = 1;
})();
