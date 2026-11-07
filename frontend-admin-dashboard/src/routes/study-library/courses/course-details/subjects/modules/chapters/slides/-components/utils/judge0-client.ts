// Judge0 client.
//
// Endpoint + auth are env-driven so production can switch from the dev
// placeholder (public ce.judge0.com, rate-limited ~50 req/day per IP) to a
// managed Judge0 (RapidAPI-style) without any code change. Set in .env:
//
//   VITE_JUDGE0_BASE=https://judge0-ce.p.rapidapi.com
//   VITE_JUDGE0_API_KEY=<rapidapi key>
//   VITE_JUDGE0_API_HOST=judge0-ce.p.rapidapi.com   (RapidAPI requires this header)
//
// Decision: production will use a managed Judge0 with API key, NOT self-hosted.

import { LangId, getLanguageDef } from '../constants/code-editor';
import i18n from '@/i18n';

const NS = 'studyLibraryJudge0Client';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const JUDGE0_BASE: string = env.VITE_JUDGE0_BASE || 'https://ce.judge0.com';
const JUDGE0_API_KEY: string | undefined = env.VITE_JUDGE0_API_KEY;
const JUDGE0_API_HOST: string | undefined = env.VITE_JUDGE0_API_HOST;

function buildHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (JUDGE0_API_KEY) h['X-RapidAPI-Key'] = JUDGE0_API_KEY;
    if (JUDGE0_API_HOST) h['X-RapidAPI-Host'] = JUDGE0_API_HOST;
    return h;
}

export interface Judge0RunInput {
    sourceCode: string;
    language: LangId;
    stdin?: string;
    cpuSeconds?: number;
    memoryKb?: number;
}

export interface Judge0RunResult {
    stdout: string;
    stderr: string;
    compileOutput: string;
    timeMs: number;
    memoryKb: number;
    statusId: number;
    statusDescription: string;
}

// Browser-safe base64 helpers that survive multibyte chars.
function toB64(str: string): string {
    // Encode as UTF-8 then base64 (btoa only handles latin1).
    return btoa(unescape(encodeURIComponent(str)));
}
function fromB64(str: string | null | undefined): string {
    if (!str) return '';
    try {
        return decodeURIComponent(escape(atob(str)));
    } catch {
        return '';
    }
}

// Light concurrency gate so we don't fire 20 parallel requests at the public
// endpoint when grading a 20-case problem.
const MAX_CONCURRENT = 3;
let inFlight = 0;
const queue: Array<() => void> = [];
function gate<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const run = () => {
            inFlight++;
            fn()
                .then(resolve, reject)
                .finally(() => {
                    inFlight--;
                    const next = queue.shift();
                    if (next) next();
                });
        };
        if (inFlight < MAX_CONCURRENT) run();
        else queue.push(run);
    });
}

export async function executeOnJudge0(input: Judge0RunInput): Promise<Judge0RunResult> {
    const { sourceCode, language, stdin = '', cpuSeconds = 2, memoryKb = 256_000 } = input;
    const def = getLanguageDef(language);

    return gate(async () => {
        const res = await fetch(`${JUDGE0_BASE}/submissions?base64_encoded=true&wait=true`, {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
                source_code: toB64(sourceCode),
                language_id: def.judge0Id,
                stdin: toB64(stdin),
                cpu_time_limit: cpuSeconds,
                memory_limit: memoryKb,
                redirect_stderr_to_stdout: false,
            }),
        });

        if (!res.ok) {
            throw new Error(
                i18n.t(`${NS}:httpError`, { status: res.status, statusText: res.statusText })
            );
        }

        const json = await res.json();
        return {
            stdout: fromB64(json.stdout),
            stderr: fromB64(json.stderr),
            compileOutput: fromB64(json.compile_output),
            timeMs: Math.round(parseFloat(json.time || '0') * 1000),
            memoryKb: Number(json.memory ?? 0),
            statusId: json.status?.id ?? 0,
            statusDescription: json.status?.description ?? 'Unknown',
        };
    });
}

// Combined output as a single text blob (useful for the editor's console pane).
export function judge0OutputToConsoleText(r: Judge0RunResult): string {
    if (r.compileOutput) return `${i18n.t(`${NS}:compileError`)}:\n${r.compileOutput}`;
    if (r.stderr) return `${r.stdout}${r.stdout && r.stderr ? '\n' : ''}${r.stderr}`;
    return r.stdout || `${i18n.t(`${NS}:noOutput`)} — ${r.statusDescription}`;
}
