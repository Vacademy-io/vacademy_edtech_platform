#!/usr/bin/env node
/**
 * Local reverse proxy for Classroom testing: routes by path prefix to services
 * on THIS machine and injects faults. It has no way to reach anything else:
 * upstreams must be http:// on a loopback address, checked at startup and on
 * every route added later.
 *
 *   node scripts/classroom/local-gateway.mjs --port 8760 \
 *        --default http://127.0.0.1:8761 \
 *        --route /auth-service=http://127.0.0.1:8071
 *
 * A lab build points VITE_BACKEND_URL at this port. A path with no matching
 * route goes to --default (the mock).
 *
 * Controls, on the same port:
 *   POST   /__gateway/faults  add a fault, see below
 *   GET    /__gateway/faults  list faults
 *   DELETE /__gateway/faults  clear faults
 *   GET    /__gateway/log     last 500 requests [{at, method, path, status, upstream, fault}]
 *   DELETE /__gateway/log     clear the log
 *   POST   /__gateway/routes  {prefix, upstream}
 *   GET    /__gateway/routes  list routes
 *
 * A fault is {path, type, method?, times?, delay_ms?, status?, body?}. `path` is
 * a prefix, or a regex written /like-this/. `times` defaults to unlimited.
 *   drop_response  the upstream handles the request, then the client's socket is
 *                  cut, so state changes but the answer is lost
 *   offline        the socket is cut before anything reaches the upstream
 *   delay          wait delay_ms, then proxy normally
 *   status         answer `status` (default 500) with `body`, upstream not called
 * CORS preflights only ever see `offline`.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const FAULT_TYPES = new Set(['drop_response', 'offline', 'delay', 'status']);
const LOG_LIMIT = 500;

/** Throws unless `value` is an http URL on this machine. */
export function assertLocalUpstream(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`Upstream is not a URL: ${value}`);
    }
    if (url.protocol !== 'http:') {
        throw new Error(`Upstream must be http:// on this machine, got: ${value}`);
    }
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
        throw new Error(`Upstream must be a loopback host, got: ${value}`);
    }
    return url;
}

function compilePath(path) {
    const text = String(path ?? '/');
    if (text.length > 2 && text.startsWith('/') && text.endsWith('/')) {
        const regex = new RegExp(text.slice(1, -1));
        return (candidate) => regex.test(candidate);
    }
    return (candidate) => candidate.startsWith(text);
}

function corsHeaders(req) {
    return {
        'Access-Control-Allow-Origin': req.headers.origin ?? '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
    };
}

function readJson(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
            } catch {
                resolve({});
            }
        });
    });
}

export function createGateway({ defaultUpstream, routes = [] }) {
    const fallback = assertLocalUpstream(defaultUpstream);
    let routeTable = routes.map(({ prefix, upstream }) => ({
        prefix,
        upstream: assertLocalUpstream(upstream),
    }));
    let faults = [];
    let nextFaultId = 1;
    let log = [];

    const pickUpstream = (path) => {
        const match = routeTable
            .filter((route) => path.startsWith(route.prefix))
            .sort((a, b) => b.prefix.length - a.prefix.length)[0];
        return match ? match.upstream : fallback;
    };

    function record(entry) {
        log.push({ at: Date.now(), ...entry });
        if (log.length > LOG_LIMIT) log = log.slice(-LOG_LIMIT);
    }

    function takeFault(method, path) {
        for (const fault of faults) {
            if (fault.method && fault.method !== method) continue;
            if (method === 'OPTIONS' && fault.type !== 'offline') continue;
            if (!fault.matches(path)) continue;
            if (fault.times !== null) {
                fault.times -= 1;
                if (fault.times <= 0) faults = faults.filter((item) => item !== fault);
            }
            return fault;
        }
        return null;
    }

    function publicFault(fault) {
        const { matches, ...rest } = fault;
        return rest;
    }

    function sendJson(req, res, status, body) {
        res.writeHead(status, { ...corsHeaders(req), 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    }

    async function control(req, res, path) {
        if (req.method === 'OPTIONS') {
            res.writeHead(204, corsHeaders(req));
            res.end();
        } else if (path === '/__gateway/faults' && req.method === 'POST') {
            const body = await readJson(req);
            if (!FAULT_TYPES.has(body.type)) {
                return sendJson(req, res, 400, { message: `Unknown fault type: ${body.type}` });
            }
            const fault = {
                id: nextFaultId,
                path: body.path ?? '/',
                type: body.type,
                method: body.method ?? null,
                times: typeof body.times === 'number' ? body.times : null,
                delay_ms: body.delay_ms ?? 0,
                status: body.status ?? 500,
                body: body.body ?? { code: 'ERROR', message: 'Injected fault' },
                matches: compilePath(body.path),
            };
            nextFaultId += 1;
            faults.push(fault);
            sendJson(req, res, 200, publicFault(fault));
        } else if (path === '/__gateway/faults' && req.method === 'DELETE') {
            faults = [];
            sendJson(req, res, 200, { cleared: true });
        } else if (path === '/__gateway/faults') {
            sendJson(req, res, 200, faults.map(publicFault));
        } else if (path === '/__gateway/log' && req.method === 'DELETE') {
            log = [];
            sendJson(req, res, 200, { cleared: true });
        } else if (path === '/__gateway/log') {
            sendJson(req, res, 200, log);
        } else if (path === '/__gateway/routes' && req.method === 'POST') {
            const body = await readJson(req);
            try {
                const upstream = assertLocalUpstream(body.upstream);
                routeTable = routeTable.filter((route) => route.prefix !== body.prefix);
                routeTable.push({ prefix: String(body.prefix), upstream });
                sendJson(req, res, 200, { ok: true });
            } catch (error) {
                sendJson(req, res, 400, { message: error.message });
            }
        } else if (path === '/__gateway/routes') {
            sendJson(req, res, 200, {
                default: fallback.origin,
                routes: routeTable.map((route) => ({
                    prefix: route.prefix,
                    upstream: route.upstream.origin,
                })),
            });
        } else {
            sendJson(req, res, 404, { message: 'Unknown control path' });
        }
        return undefined;
    }

    function proxy(req, res, path, upstream, fault) {
        const headers = {
            ...req.headers,
            host: upstream.host,
            'x-forwarded-host': req.headers.host ?? upstream.host,
        };
        const forwarded = req.headers['x-forwarded-for'];
        const peer = req.socket.remoteAddress ?? '';
        headers['x-forwarded-for'] = forwarded ? `${forwarded}, ${peer}` : peer;

        const outgoing = http.request(
            {
                protocol: 'http:',
                hostname: upstream.hostname,
                port: upstream.port,
                method: req.method,
                path: req.url,
                headers,
            },
            (incoming) => {
                record({
                    method: req.method,
                    path,
                    status: incoming.statusCode,
                    upstream: upstream.origin,
                    fault: fault?.type ?? null,
                });
                if (fault?.type === 'drop_response') {
                    incoming.resume();
                    incoming.on('end', () => req.socket.destroy());
                    return;
                }
                res.writeHead(incoming.statusCode ?? 502, incoming.headers);
                incoming.pipe(res);
            }
        );
        outgoing.on('error', (error) => {
            record({
                method: req.method,
                path,
                status: 502,
                upstream: upstream.origin,
                fault: null,
            });
            if (res.headersSent) {
                res.destroy();
            } else {
                sendJson(req, res, 502, {
                    code: 'ERROR',
                    message: `No local service at ${upstream.origin}: ${error.code ?? error.message}`,
                });
            }
        });
        res.on('close', () => {
            if (!res.writableEnded && fault?.type !== 'drop_response') outgoing.destroy();
        });
        req.pipe(outgoing);
    }

    const server = http.createServer((req, res) => {
        const path = new URL(req.url, 'http://gateway').pathname;
        if (path.startsWith('/__gateway/')) {
            void control(req, res, path);
            return;
        }
        const upstream = pickUpstream(path);
        const fault = takeFault(req.method, path);
        if (fault?.type === 'offline') {
            record({ method: req.method, path, status: 0, upstream: null, fault: fault.type });
            req.socket.destroy();
        } else if (fault?.type === 'status') {
            record({
                method: req.method,
                path,
                status: fault.status,
                upstream: null,
                fault: fault.type,
            });
            req.resume();
            sendJson(req, res, fault.status, fault.body);
        } else if (fault?.type === 'delay') {
            setTimeout(() => proxy(req, res, path, upstream, fault), fault.delay_ms);
        } else {
            proxy(req, res, path, upstream, fault);
        }
    });

    return {
        server,
        listen: (port = 0, host = '127.0.0.1') =>
            new Promise((resolve) => {
                server.listen(port, host, () => resolve(server.address().port));
            }),
        close: () =>
            new Promise((resolve) => {
                server.closeAllConnections?.();
                server.close(() => resolve());
            }),
    };
}

function parseArgs(argv) {
    const out = {
        port: 8760,
        host: '127.0.0.1',
        defaultUpstream: 'http://127.0.0.1:8761',
        routes: [],
    };
    for (let i = 0; i < argv.length; i += 1) {
        const value = argv[i + 1];
        if (argv[i] === '--port') out.port = Number(value);
        if (argv[i] === '--host') out.host = value;
        if (argv[i] === '--default') out.defaultUpstream = value;
        if (argv[i] === '--route') {
            const at = String(value).indexOf('=');
            out.routes.push({ prefix: value.slice(0, at), upstream: value.slice(at + 1) });
        }
    }
    return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const args = parseArgs(process.argv.slice(2));
    try {
        const gateway = createGateway(args);
        const bound = await gateway.listen(args.port, args.host);
        console.log(`[local-gateway] http://${args.host}:${bound} default ${args.defaultUpstream}`);
        args.routes.forEach((route) => {
            console.log(`[local-gateway] ${route.prefix} -> ${route.upstream}`);
        });
    } catch (error) {
        console.error(`[local-gateway] refusing to start: ${error.message}`);
        process.exit(1);
    }
}
