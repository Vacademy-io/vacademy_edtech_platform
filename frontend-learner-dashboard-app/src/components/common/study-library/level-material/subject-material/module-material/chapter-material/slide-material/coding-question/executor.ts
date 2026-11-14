import i18n from "@/i18n";
import { LANGUAGE_REGISTRY } from "./language-registry";
import { executeOnJudge0, judge0OutputToConsoleText } from "./judge0-client";
import { CodeErrorType, LangId } from "./types";
// Reuse the already-loaded Pyodide instance from the existing learner utils so
// we don't double-download Pyodide. The exported helper handles all Pyodide
// lifecycle + stdout capture.
import { executePythonWithPyodide } from "../code-slide-utils.";

export interface RunResult {
  stdout: string;
  stderr: string;
  output: string; // human-friendly combined string for the console pane
  hasError: boolean;
  timeMs?: number;
  memoryKb?: number;
  errorType?: CodeErrorType;
  errorLabel?: string;
}

export interface RunOptions {
  stdin?: string;
  cpuSeconds?: number;
  memoryKb?: number;
}

// Wraps a promise with a wall-clock timeout so Pyodide / browser-JS can
// surface TLE the same way Judge0 does. Pyodide has no built-in CPU limiter.
function withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T | "__TLE__"> {
  return Promise.race<T | "__TLE__">([
    p,
    new Promise<"__TLE__">((resolve) =>
      setTimeout(() => resolve("__TLE__"), timeoutMs),
    ),
  ]);
}

function runJsInBrowser(code: string, stdin: string): RunResult {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  let hasError = false;
  try {
    console.log = (...args: unknown[]) => {
      logs.push(
        args
          .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
          .join(" "),
      );
    };
    console.error = (...args: unknown[]) => {
      hasError = true;
      const msg = args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ");
      errors.push(msg);
      logs.push("ERROR: " + msg);
    };
    const stdinLines = stdin.split("\n");
    let stdinIdx = 0;
    const readline = () => stdinLines[stdinIdx++] ?? "";
    const fn = new Function("readline", '"use strict";\n' + code);
    const result = fn(readline);
    if (result !== undefined) logs.push(String(result));
  } catch (err) {
    hasError = true;
    const msg = "Error: " + (err instanceof Error ? err.message : String(err));
    errors.push(msg);
    logs.push(msg);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  const stdout = logs.join("\n");
  return {
    stdout,
    stderr: errors.join("\n"),
    output: stdout || "(no output)",
    hasError,
    errorType: hasError ? "RUNTIME_JS" : undefined,
    errorLabel: hasError ? i18n.t("libraryCommonA:codeExecution.runtimeError") : undefined,
  };
}

/**
 * Dispatches code execution by language: pyodide / browser eval / Judge0.
 * Pure stdout/stderr/error model so the question-mode grader can compare
 * against expected stdout.
 */
export async function runCode(
  code: string,
  language: LangId,
  options: RunOptions = {},
): Promise<RunResult> {
  if (!code.trim()) {
    return {
      stdout: "",
      stderr: "",
      output: i18n.t("libraryCommonA:codeExecution.noCodeToExecute"),
      hasError: true,
    };
  }

  const def = LANGUAGE_REGISTRY[language] ?? LANGUAGE_REGISTRY.python;

  // Wall-clock budget for in-browser executors (Pyodide / JS) which lack a
  // built-in CPU limiter. Slightly larger than cpuSeconds to allow for VM
  // warmup; Judge0 enforces its own limit.
  const cpuSec = options.cpuSeconds ?? 2;
  const browserTimeoutMs = Math.max(1000, cpuSec * 1000 + 500);

  if (def.executor === "pyodide") {
    // Existing helper returns { output, needsInput, hasError }. Treat output as
    // combined stdout — Pyodide already merges stdout and exception traces.
    // Pass stdin so input()-using solutions work for graded test cases.
    const raced = await withTimeout(
      executePythonWithPyodide(code, options.stdin),
      browserTimeoutMs,
    );
    if (raced === "__TLE__") {
      return {
        stdout: "",
        stderr: i18n.t("libraryCommonA:codeExecution.timeLimitExceeded"),
        output: i18n.t("libraryCommonA:codeExecution.timeLimitExceeded"),
        hasError: true,
        errorType: "TLE",
        errorLabel: i18n.t("libraryCommonA:codeExecution.timeLimitExceeded"),
      };
    }
    return {
      stdout: raced.output,
      stderr: raced.hasError ? raced.output : "",
      output: raced.output,
      hasError: !!raced.hasError,
      errorType: raced.hasError ? "RUNTIME_JS" : undefined,
      errorLabel: raced.hasError ? i18n.t("libraryCommonA:codeExecution.runtimeError") : undefined,
    };
  }

  if (def.executor === "browser") {
    const raced = await withTimeout(
      Promise.resolve(runJsInBrowser(code, options.stdin ?? "")),
      browserTimeoutMs,
    );
    if (raced === "__TLE__") {
      return {
        stdout: "",
        stderr: i18n.t("libraryCommonA:codeExecution.timeLimitExceeded"),
        output: i18n.t("libraryCommonA:codeExecution.timeLimitExceeded"),
        hasError: true,
        errorType: "TLE",
        errorLabel: i18n.t("libraryCommonA:codeExecution.timeLimitExceeded"),
      };
    }
    return raced;
  }

  try {
    const j = await executeOnJudge0({
      sourceCode: code,
      language,
      stdin: options.stdin,
      cpuSeconds: options.cpuSeconds,
      memoryKb: options.memoryKb,
    });
    const hasError = !!j.compileOutput || !!j.stderr || j.statusId >= 5;

    // Map Judge0 status IDs to specific error categories so the UI can show
    // TLE / MLE / Compile / Runtime instead of a generic failure.
    let errorType: CodeErrorType | undefined;
    let errorLabel: string | undefined;
    if (j.statusId === 5) {
      errorType = "TLE";
      errorLabel = i18n.t("libraryCommonA:codeExecution.timeLimitExceeded");
    } else if (j.statusId === 6) {
      errorType = "COMPILE";
      errorLabel = i18n.t("libraryCommonA:codeExecution.compilationError");
    } else if (j.statusId >= 7 && j.statusId <= 12) {
      errorType = "RUNTIME";
      errorLabel = j.statusDescription || i18n.t("libraryCommonA:codeExecution.runtimeError");
    } else if (hasError) {
      errorType = "RUNTIME";
      errorLabel = j.statusDescription || i18n.t("libraryCommonA:codeExecution.runtimeError");
    }
    // Judge0 has no dedicated MLE status; infer when memory readout is at or
    // above the configured cap and we're not already in a TLE/Compile bucket.
    if (
      options.memoryKb &&
      j.memoryKb &&
      j.memoryKb >= options.memoryKb * 0.95 &&
      errorType !== "TLE" &&
      errorType !== "COMPILE"
    ) {
      errorType = "MLE";
      errorLabel = i18n.t("libraryCommonA:codeExecution.memoryLimitExceeded");
    }

    return {
      stdout: j.stdout,
      stderr: j.stderr || j.compileOutput,
      output: judge0OutputToConsoleText(j),
      hasError,
      timeMs: j.timeMs,
      memoryKb: j.memoryKb,
      errorType,
      errorLabel,
    };
  } catch (err) {
    const msg = i18n.t("libraryCommonA:codeExecution.judge0ErrorHint", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      stdout: "",
      stderr: msg,
      output: msg,
      hasError: true,
      errorType: "JUDGE0",
      errorLabel: i18n.t("libraryCommonA:codeExecution.executionServiceError"),
    };
  }
}

/**
 * Normalize program output before comparison. This is the SINGLE source of
 * truth for matching semantics: trim leading/trailing whitespace (incl. the
 * trailing newline), then compare verbatim. Internal whitespace and case are
 * significant. Do not change this without auditing every test case.
 */
function normalizeOutput(s: string): string {
  return (s ?? "").trim();
}

/**
 * Resolve the effective set of acceptable outputs. Old test cases that only
 * carry a single `expectedStdout` (no `acceptedOutputs`) behave exactly as
 * before — they collapse to a one-element set.
 */
export function effectiveAccepted(tc: {
  expectedStdout: string;
  acceptedOutputs?: string[];
}): string[] {
  return tc.acceptedOutputs && tc.acceptedOutputs.length > 0
    ? tc.acceptedOutputs
    : [tc.expectedStdout ?? ""];
}

/**
 * SHA-256 hex of a string. Used to compare against hidden test cases whose
 * expected outputs the backend redacts to hashes (see `hashed` below) so the
 * answer key never reaches the learner in plaintext.
 */
async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Returns the index of the first accepted output that matches `actual`
 * (after normalization), or -1 if none match.
 *
 * When `hashed` is true, `accepted` holds SHA-256 hex digests of the
 * normalized expected outputs (the backend redacts hidden tests this way).
 * We then hash the normalized actual output and compare digests. Normalization
 * MUST be identical on both sides — the backend hashes the trimmed value.
 */
export async function matchAccepted(
  actual: string,
  accepted: string[],
  hashed = false,
): Promise<number> {
  const a = normalizeOutput(actual);
  if (hashed) {
    const actualHash = await sha256Hex(a);
    for (let i = 0; i < accepted.length; i++) {
      if ((accepted[i] ?? "") === actualHash) return i;
    }
    return -1;
  }
  for (let i = 0; i < accepted.length; i++) {
    if (normalizeOutput(accepted[i]) === a) return i;
  }
  return -1;
}

/**
 * Run a single test case and produce a pass/fail verdict by comparing the
 * program's stdout against the set of accepted outputs (pass if it matches
 * ANY). Stderr is informational only; a runtime error always fails.
 */
export async function runTestCase(
  code: string,
  language: LangId,
  testStdin: string,
  accepted: string[],
  options: RunOptions = {},
  hashed = false,
): Promise<{
  passed: boolean;
  matchedIndex: number;
  acceptedCount: number;
  stdout: string;
  stderr: string;
  timeMs?: number;
  memoryKb?: number;
  error?: string;
  errorType?: CodeErrorType;
  errorLabel?: string;
}> {
  try {
    const r = await runCode(code, language, { ...options, stdin: testStdin });
    const matchedIndex = r.hasError
      ? -1
      : await matchAccepted(r.stdout ?? "", accepted, hashed);
    return {
      passed: !r.hasError && matchedIndex >= 0,
      matchedIndex,
      acceptedCount: accepted.length,
      stdout: r.stdout,
      stderr: r.stderr,
      timeMs: r.timeMs,
      memoryKb: r.memoryKb,
      errorType: r.errorType,
      errorLabel: r.errorLabel,
    };
  } catch (err) {
    return {
      passed: false,
      matchedIndex: -1,
      acceptedCount: accepted.length,
      stdout: "",
      stderr: "",
      error: err instanceof Error ? err.message : String(err),
      errorType: "OTHER",
      errorLabel: i18n.t("libraryCommonA:codeExecution.unexpectedError"),
    };
  }
}
