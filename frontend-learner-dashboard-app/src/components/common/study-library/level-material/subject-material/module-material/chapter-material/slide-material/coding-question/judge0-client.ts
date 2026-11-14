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

import i18n from "@/i18n";
import { getLanguageDef } from "./language-registry";
import { LangId } from "./types";

const env =
  (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env ?? {};

export const JUDGE0_BASE: string = env.VITE_JUDGE0_BASE || "https://ce.judge0.com";
const JUDGE0_API_KEY: string | undefined = env.VITE_JUDGE0_API_KEY;
const JUDGE0_API_HOST: string | undefined = env.VITE_JUDGE0_API_HOST;

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (JUDGE0_API_KEY) h["X-RapidAPI-Key"] = JUDGE0_API_KEY;
  if (JUDGE0_API_HOST) h["X-RapidAPI-Host"] = JUDGE0_API_HOST;
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

function toB64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}
function fromB64(str: string | null | undefined): string {
  if (!str) return "";
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return "";
  }
}

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

export async function executeOnJudge0(
  input: Judge0RunInput,
): Promise<Judge0RunResult> {
  const {
    sourceCode,
    language,
    stdin = "",
    cpuSeconds = 2,
    memoryKb = 256_000,
  } = input;
  const def = getLanguageDef(language);

  // 429 (rate-limit) and transient 5xx get up to 3 retries with exponential
  // backoff (1s, 2s, 4s) plus a small jitter. Public ce.judge0.com throttles
  // aggressively; managed Judge0 still returns 429 under burst traffic.
  const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
  const BACKOFF_MS = [1000, 2000, 4000];

  return gate(async () => {
    const body = JSON.stringify({
      source_code: toB64(sourceCode),
      language_id: def.judge0Id,
      stdin: toB64(stdin),
      cpu_time_limit: cpuSeconds,
      memory_limit: memoryKb,
      redirect_stderr_to_stdout: false,
    });

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
      let res: Response;
      try {
        res = await fetch(
          `${JUDGE0_BASE}/submissions?base64_encoded=true&wait=true`,
          { method: "POST", headers: buildHeaders(), body },
        );
      } catch (netErr) {
        lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
        if (attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]! + Math.random() * 250);
          continue;
        }
        throw lastError;
      }

      if (res.ok) {
        const json = await res.json();
        return {
          stdout: fromB64(json.stdout),
          stderr: fromB64(json.stderr),
          compileOutput: fromB64(json.compile_output),
          timeMs: Math.round(parseFloat(json.time || "0") * 1000),
          memoryKb: Number(json.memory ?? 0),
          statusId: json.status?.id ?? 0,
          statusDescription: json.status?.description ?? i18n.t("libraryCommonA:codeExecution.unknownStatus"),
        };
      }

      // Honor Retry-After when Judge0 sends one; else fall back to backoff.
      const retryable = RETRY_STATUS.has(res.status) && attempt < BACKOFF_MS.length;
      lastError = new Error(`Judge0 HTTP ${res.status}: ${res.statusText}`);
      if (!retryable) throw lastError;
      const retryAfter = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : BACKOFF_MS[attempt]! + Math.random() * 250;
      await sleep(delay);
    }
    throw lastError ?? new Error("Judge0 exhausted retries");
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function judge0OutputToConsoleText(r: Judge0RunResult): string {
  if (r.compileOutput) return i18n.t("libraryCommonA:codeExecution.compileErrorPrefix", { output: r.compileOutput });
  if (r.stderr) return `${r.stdout}${r.stdout && r.stderr ? "\n" : ""}${r.stderr}`;
  return r.stdout || i18n.t("libraryCommonA:codeExecution.noOutputWithStatus", { status: r.statusDescription });
}
