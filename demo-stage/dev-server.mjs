// Local server for the demo stage: serves this folder and stands in for the
// backend "demo session" endpoint. In production the stage is a static site and
// /session is answered by ai_service, which hands out the read-only demo
// user's sign-in. Here it signs in once with DEMO_USER / DEMO_PASS and reuses
// the tokens (each sign-in revokes that user's earlier refresh tokens).
//
//   DEMO_USER=... DEMO_PASS=... node dev-server.mjs [port]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 5280);
const BACKEND = process.env.DEMO_BACKEND || 'https://backend-stage.vacademy.io';
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};

let session = null;

async function getSession() {
    if (session && session.expiresAt > Date.now()) return session.body;
    const res = await fetch(`${BACKEND}/auth-service/v1/login-root`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_name: process.env.DEMO_USER,
            password: process.env.DEMO_PASS,
            client_name: 'ADMIN_PORTAL',
        }),
    });
    if (!res.ok) throw new Error(`sign-in failed: ${res.status}`);
    const data = await res.json();
    const claims = JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64url').toString());
    const instituteId =
        process.env.DEMO_INSTITUTE ||
        Object.entries(claims.authorities || {}).find(([, a]) => (a.roles || []).includes('ADMIN'))?.[0];
    const body = { accessToken: data.accessToken, refreshToken: data.refreshToken, instituteId };
    session = { body, expiresAt: Date.now() + 6 * 3600 * 1000 };
    return body;
}

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/session') {
        try {
            const body = await getSession();
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(body));
        } catch (e) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(e.message || e) }));
        }
        return;
    }
    let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end();
    }
    fs.readFile(file, (err, buf) => {
        if (err) {
            res.writeHead(404);
            return res.end('not found');
        }
        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(buf);
    });
}).listen(PORT, () => console.log(`demo stage on http://localhost:${PORT}`));
