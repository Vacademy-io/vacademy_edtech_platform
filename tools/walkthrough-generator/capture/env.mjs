// Tiny .env loader (no dependency). Reads tools/walkthrough-generator/.env
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const TOOL_ROOT = resolve(here, '..');

export function loadEnv() {
    const env = { ...process.env };
    const path = join(TOOL_ROOT, '.env');
    if (existsSync(path)) {
        for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) continue;
            const eq = line.indexOf('=');
            if (eq === -1) continue;
            const key = line.slice(0, eq).trim();
            let val = line.slice(eq + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            if (!(key in env) || env[key] === '') env[key] = val;
        }
    }
    return env;
}

export function requireEnv(env, keys) {
    const missing = keys.filter((k) => !env[k]);
    if (missing.length) {
        throw new Error(`Missing required env vars: ${missing.join(', ')} (set them in tools/walkthrough-generator/.env)`);
    }
}
