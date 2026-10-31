import type { TFunction } from 'i18next';
import {
    SupportedLanguage,
    DEFAULT_CODE,
    LangId,
    LANGUAGE_REGISTRY,
    getLanguageDef,
} from '../constants/code-editor';
import { CodeEditorData, AllLanguagesData } from './code-editor-types';
import { executeOnJudge0, judge0OutputToConsoleText } from './judge0-client';

export interface CodeExecutionResult {
    output: string;
    needsInput: boolean;
    hasError?: boolean;
    timeMs?: number;
    memoryKb?: number;
}

export interface CodeExecutionOptions {
    stdin?: string;
    cpuSeconds?: number;
    memoryKb?: number;
}

// Pyodide instance - will be loaded lazily
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodide: any = null;
let isPyodideLoading = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodideLoadPromise: Promise<any> | null = null;

// Console output buffer
let consoleOutput: string[] = [];

// Custom stdout/stderr handler
const stdout = (msg: unknown) => {
    consoleOutput.push(String(msg));
    console.log(msg);
};

// Add timeout for Pyodide loading
const PYODIDE_LOAD_TIMEOUT = 30000; // 30 seconds

/**
 * Load Pyodide if not already loaded
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadPyodideInstance = async (): Promise<any> => {
    if (pyodide) {
        return pyodide;
    }

    if (isPyodideLoading && pyodideLoadPromise) {
        return pyodideLoadPromise;
    }

    isPyodideLoading = true;
    pyodideLoadPromise = new Promise((resolve, reject) => {
        // Add timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            reject(
                new Error(
                    'Pyodide loading timed out after 30 seconds. Please refresh the page and try again.'
                )
            );
        }, PYODIDE_LOAD_TIMEOUT);

        (async () => {
            try {
                // Use a fixed version for now - you can make this dynamic later
                const pyodideVersion = '0.28.0';

                // Dynamic import to avoid build issues
                const { loadPyodide } = await import('pyodide');

                pyodide = await loadPyodide({
                    indexURL: `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`,
                    stdout: stdout,
                    stderr: stdout,
                    checkAPIVersion: true,
                });

                clearTimeout(timeoutId);

                if (pyodide) {
                    resolve(pyodide);
                } else {
                    reject(new Error('Pyodide failed to initialize'));
                }
            } catch (error) {
                console.error('Pyodide loading error:', error);
                clearTimeout(timeoutId);
                reject(error);
            }
        })();
    });

    return pyodideLoadPromise;
};

/**
 * Execute Python code using Pyodide.
 *
 * Optional `stdin` feeds the Python program's input() calls — without it,
 * Pyodide raises OSError: [Errno 29] because the browser has no stdin pipe.
 * We install a line-pumping stdin callback via setStdin before each run.
 */
export const executePythonWithPyodide = async (
    code: string,
    stdin: string = '',
    t: TFunction,
    locale?: string
): Promise<CodeExecutionResult> => {
    try {
        // Load Pyodide if not already loaded
        const pyodideInstance = await loadPyodideInstance();

        // Clear previous output
        consoleOutput = [];

        // Install stdin for this run. Each call returns one line; null = EOF
        // (Python's input() then raises EOFError).
        const stdinLines = stdin.length ? stdin.split('\n') : [];
        let stdinIdx = 0;
        try {
            pyodideInstance.setStdin({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                stdin: () =>
                    stdinIdx < stdinLines.length ? (stdinLines[stdinIdx++] as string) : null,
                isatty: false,
            });
        } catch {
            // Older Pyodide builds without setStdin — fall through.
        }

        try {
            // Execute code using the working approach from the GitHub repo
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dict = pyodideInstance.globals.get('dict') as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const globals = dict() as any;

            // Run as the main module so the very common
            // `if __name__ == "__main__":` guard executes. Without this the
            // fresh globals dict has no __name__, so any program (or AI-generated
            // solution/starter) that puts its I/O under that guard silently
            // produces no output.
            try {
                globals.set('__name__', '__main__');
            } catch {
                // Older Pyodide dict proxy without .set — ignore.
            }

            await pyodideInstance.loadPackagesFromImports(code);
            await pyodideInstance.runPythonAsync(code, { globals, locals: globals });

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globals as any).destroy();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (dict as any).destroy();
        } catch (executionError) {
            // Handle execution errors specifically
            console.error('[CodeEditor] Python execution error:', executionError);
            stdout(executionError instanceof Error ? executionError.stack : executionError);
        } finally {
            // Only append the diagnostic footer for sandbox runs (no stdin). For
            // graded test-case runs the footer would pollute the stdout compared
            // against the expected output and cause false failures.
            if (!stdin.length) {
                stdout(`\n[Editor (Pyodide: v${pyodideInstance.version}): ${new Date().toLocaleString(locale)}]`);
            }
        }

        // Combine output
        const output = consoleOutput.join('\n');
        const hasError = output.includes('Error:') || output.includes('Traceback');

        // Check if code contains input() function
        const needsInput = code.includes('input(');
        if (needsInput) {
            consoleOutput.push(t('output.interactiveInputNotSupported'));
        }

        return {
            output: output.trim() || t('output.codeExecutedNoOutput'),
            needsInput: false,
            hasError,
        };
    } catch (error) {
        console.error('[CodeEditor] Error loading or initializing Pyodide:', error);

        // Provide more specific error messages. NOTE: the `.includes(...)`
        // checks below match against the raw (untranslated) Error thrown
        // above — those thrown strings are internal matching signals, not
        // shown to the user, so they intentionally stay in English.
        let errorMessage = t('errors.unknownPyodideError');

        if (error instanceof Error) {
            if (error.message.includes('timed out')) {
                errorMessage = t('errors.pyodideTimedOut');
            } else if (error.message.includes('Failed to fetch')) {
                errorMessage = t('errors.pyodideDownloadFailed');
            } else if (error.message.includes('pyodide')) {
                errorMessage = t('errors.pyodideError', { message: error.message });
            } else {
                errorMessage = t('errors.loadingError', { message: error.message });
            }
        }

        return {
            output: t('errors.pyodideLoadingErrorBlock', { errorMessage }),
            needsInput: false,
            hasError: true,
        };
    }
};

/**
 * Get the current code from the Monaco editor
 */
export const getCurrentCodeFromEditor = (editorRef: React.RefObject<unknown>): string => {
    if (
        editorRef.current &&
        typeof editorRef.current === 'object' &&
        'getValue' in editorRef.current
    ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (editorRef.current as any).getValue() || '';
    }
    return '';
};

/**
 * Copy code to clipboard
 */
export const copyCodeToClipboard = (code: string): void => {
    navigator.clipboard.writeText(code);
};

/**
 * Download code as a file
 */
export const downloadCodeAsFile = (code: string, language: SupportedLanguage): void => {
    const extension = getLanguageDef(language).fileExt;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

/**
 * Execute JavaScript in the browser. Captures console.log and the final
 * expression value. No isolation — fine for sandbox/practice, NOT for grading
 * untrusted code (use Judge0 path for that).
 */
export const executeJavaScriptInBrowser = (
    code: string,
    stdin: string = '',
    t: TFunction
): CodeExecutionResult => {
    const logs: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    let hasError = false;
    try {
        console.log = (...args: unknown[]) => {
            logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        };
        console.error = (...args: unknown[]) => {
            hasError = true;
            logs.push(
                t('output.errorLabel', {
                    message: args
                        .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
                        .join(' '),
                })
            );
        };
        // Provide a minimal stdin shim so problems that read input have something
        // to consume. Splits on newlines.
        const stdinLines = stdin.split('\n');
        let stdinIdx = 0;
        const readline = () => stdinLines[stdinIdx++] ?? '';
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const fn = new Function('readline', '"use strict";\n' + code);
        const result = fn(readline);
        if (result !== undefined) logs.push(String(result));
    } catch (err) {
        hasError = true;
        logs.push(
            t('errors.genericError', {
                message: err instanceof Error ? err.message : String(err),
            })
        );
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return {
        output: logs.join('\n') || t('output.noOutputParen'),
        needsInput: false,
        hasError,
    };
};

/**
 * Execute code using the executor declared in LANGUAGE_REGISTRY.
 *  - python   → Pyodide (in-browser)
 *  - js       → new Function() (in-browser)
 *  - others   → Judge0 (https://ce.judge0.com)
 */
export const executeCode = async (
    code: string,
    language: SupportedLanguage,
    options: CodeExecutionOptions = {},
    t: TFunction,
    locale?: string
): Promise<CodeExecutionResult> => {
    if (!code.trim()) {
        return {
            output: t('errors.noCodeToExecute'),
            needsInput: false,
        };
    }

    const def = LANGUAGE_REGISTRY[language as LangId] ?? LANGUAGE_REGISTRY.python;

    if (def.executor === 'pyodide') {
        // Pass stdin through so graded/test-case runs (e.g. AI self-verify,
        // starter-code preview against inputs) feed the program's input().
        return await executePythonWithPyodide(code, options.stdin, t, locale);
    }

    if (def.executor === 'browser') {
        return executeJavaScriptInBrowser(code, options.stdin, t);
    }

    // Judge0 path (C / C++ / Java / Go / future)
    try {
        const result = await executeOnJudge0({
            sourceCode: code,
            language: language as LangId,
            stdin: options.stdin,
            cpuSeconds: options.cpuSeconds,
            memoryKb: options.memoryKb,
        });
        const output = judge0OutputToConsoleText(result);
        const hasError = !!result.compileOutput || !!result.stderr || result.statusId >= 6;
        return {
            output,
            needsInput: false,
            hasError,
            timeMs: result.timeMs,
            memoryKb: result.memoryKb,
        };
    } catch (err) {
        return {
            output: t('errors.judge0Error', {
                message: err instanceof Error ? err.message : String(err),
            }),
            needsInput: false,
            hasError: true,
        };
    }
};

/**
 * Handle user input submission during code execution
 */
export const handleUserInputSubmission = (
    userInput: string,
    language: SupportedLanguage,
    currentOutput: string,
    t: TFunction
): string => {
    if (!userInput.trim()) {
        return currentOutput;
    }

    const trimmedInput = userInput.trim();
    let newOutput = currentOutput + trimmedInput + '\n';

    // Continue Python simulation after input
    if (language === 'python') {
        newOutput += t('simulation.pythonWelcome', { name: trimmedInput });
    }

    return newOutput;
};

/**
 * Setup keyboard shortcuts for the code editor
 */
export const setupKeyboardShortcuts = (
    onRunCode: () => void,
    isRunning: boolean,
    isEditable: boolean
): (() => void) => {
    const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!isRunning && isEditable) {
                onRunCode();
            }
        }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Return cleanup function
    return () => {
        document.removeEventListener('keydown', handleKeyDown);
    };
};

/**
 * Initialize language states based on code data
 */
export const initializeLanguageStates = (codeData?: CodeEditorData): AllLanguagesData => {
    // If we have allLanguagesData from the server, use that
    if (codeData?.allLanguagesData) {
        return {
            python: {
                code: codeData.allLanguagesData.python.code ?? DEFAULT_CODE.python,
                lastEdited: codeData.allLanguagesData.python.lastEdited,
            },
            javascript: {
                code: codeData.allLanguagesData.javascript.code ?? DEFAULT_CODE.javascript,
                lastEdited: codeData.allLanguagesData.javascript.lastEdited,
            },
        };
    }

    // Fallback to legacy single-language data structure
    const currentLanguage = codeData?.language as SupportedLanguage;
    const currentCode = codeData?.code;

    return {
        python: {
            code:
                currentLanguage === 'python'
                    ? currentCode ?? DEFAULT_CODE.python
                    : DEFAULT_CODE.python,
            lastEdited: currentLanguage === 'python' ? Date.now() : undefined,
        },
        javascript: {
            code: DEFAULT_CODE.javascript,
            lastEdited: undefined,
        },
    };
};

/**
 * Initialize current data state based on language states and code data.
 *
 * IMPORTANT: preserves the full saved payload (including `mode`, `question`,
 * and whichever `language` was last active). A previous version returned only
 * {language, code, theme, viewMode} which silently dropped Question Mode state
 * on every reload — a saved coding-question slide would come back as a blank
 * Practice-Mode slide.
 */
export const initializeCurrentData = (
    codeData: CodeEditorData | undefined,
    languageStates: AllLanguagesData
): CodeEditorData => {
    const savedLanguage = (codeData?.language as SupportedLanguage | undefined) ?? 'python';
    const activeLanguage: SupportedLanguage =
        languageStates[savedLanguage] != null ? savedLanguage : 'python';
    return {
        language: activeLanguage,
        code: languageStates[activeLanguage]?.code ?? '',
        theme: codeData?.theme || 'light',
        viewMode: codeData?.viewMode || 'edit',
        mode: codeData?.mode,
        question: codeData?.question,
        allLanguagesData: languageStates,
    };
};
