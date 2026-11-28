import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Editor from "@monaco-editor/react";
import { Play, Check, X, SpinnerGap } from "@phosphor-icons/react";
import { Preferences } from "@capacitor/preferences";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { runTestCase, effectiveAccepted } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/coding-question/executor";
import { LANGUAGE_REGISTRY } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/coding-question/language-registry";
import {
    preloadPyodide,
    isPyodideReady,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/code-slide-utils.";
import type {
    CodingQuestionConfig,
    CodingTestCase,
    LangId,
    Verdict,
} from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/coding-question/types";
import { OutputDiff } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/coding-question/OutputDiff";
import { useAssessmentStore, type CodingAnswerData, type CodingTestCaseResult } from "@/stores/assessment-store";

interface Props {
    questionId: string;
    attemptId: string | undefined;
    config: CodingQuestionConfig;
}

const LOCAL_DEBOUNCE_MS = 400;

function localStorageKey(attemptId: string | undefined, questionId: string) {
    return `assessment_coding_${attemptId ?? "noattempt"}_${questionId}`;
}

export function CodingQuestionDisplay({ questionId, attemptId, config }: Props) {
    const { t } = useTranslation("questionTest");
    const setCodingAnswer = useAssessmentStore((s) => s.setCodingAnswer);
    const incrementPaste = useAssessmentStore((s) => s.incrementCodingPasteAttempt);
    const existingAnswer = useAssessmentStore(
        (s) => s.codingAnswers[questionId] as CodingAnswerData | undefined
    );

    const allowed: LangId[] = useMemo(
        () =>
            (config.allowedLanguages && config.allowedLanguages.length > 0
                ? config.allowedLanguages
                : ["python"]) as LangId[],
        [config.allowedLanguages]
    );

    const [language, setLanguage] = useState<LangId>(
        (existingAnswer?.language as LangId) || allowed[0]
    );

    const [codeByLang, setCodeByLang] = useState<Partial<Record<LangId, string>>>(() => {
        const map: Partial<Record<LangId, string>> = {};
        for (const id of allowed) {
            map[id] = config.starterCode?.[id] ?? LANGUAGE_REGISTRY[id]?.starter ?? "";
        }
        if (existingAnswer?.sourceCode && existingAnswer.language) {
            map[existingAnswer.language as LangId] = existingAnswer.sourceCode;
        }
        return map;
    });

    const [running, setRunning] = useState(false);
    const [results, setResults] = useState<CodingTestCaseResult[]>(
        existingAnswer?.testCaseResults ?? []
    );
    const [verdict, setVerdict] = useState<Verdict | "">(
        (existingAnswer?.verdict as Verdict) || ""
    );

    // Pyodide is ~10 MB; preload in the background so the first Run/Submit
    // doesn't freeze the main thread. If python isn't allowed, skip entirely.
    const pythonAllowed = useMemo(
        () =>
            allowed.some((l) => LANGUAGE_REGISTRY[l]?.executor === "pyodide"),
        [allowed]
    );
    const [pyodideReady, setPyodideReady] = useState<boolean>(() =>
        isPyodideReady()
    );
    useEffect(() => {
        if (!pythonAllowed || pyodideReady) return;
        let cancelled = false;
        preloadPyodide().then(() => {
            if (!cancelled) setPyodideReady(isPyodideReady());
        });
        return () => {
            cancelled = true;
        };
    }, [pythonAllowed, pyodideReady]);
    const currentExecutor = LANGUAGE_REGISTRY[language]?.executor;
    const pythonBlocked = currentExecutor === "pyodide" && !pyodideReady;

    // Hydrate persisted code on first mount
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (hydratedRef.current) return;
        hydratedRef.current = true;
        (async () => {
            try {
                const { value } = await Preferences.get({
                    key: localStorageKey(attemptId, questionId),
                });
                if (!value) return;
                const parsed = JSON.parse(value) as {
                    language?: LangId;
                    codeByLang?: Partial<Record<LangId, string>>;
                };
                if (parsed.language && allowed.includes(parsed.language)) {
                    setLanguage(parsed.language);
                }
                if (parsed.codeByLang) {
                    setCodeByLang((prev) => ({ ...prev, ...parsed.codeByLang }));
                }
            } catch {
                /* ignore */
            }
        })();
    }, [attemptId, questionId, allowed]);

    // Persist locally with debounce
    useEffect(() => {
        const handle = setTimeout(() => {
            void Preferences.set({
                key: localStorageKey(attemptId, questionId),
                value: JSON.stringify({ language, codeByLang }),
            });
        }, LOCAL_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [attemptId, questionId, language, codeByLang]);

    const code = codeByLang[language] ?? "";
    const visibleTests: CodingTestCase[] = useMemo(
        () => (config.testCases || []).filter((t) => t.visible),
        [config.testCases]
    );

    const cpuSeconds = config.perRunLimits?.cpuSeconds ?? 2;
    const memoryKb = config.perRunLimits?.memoryKb ?? 262144;

    const computeVerdict = useCallback(
        (passed: number, total: number, errored: boolean, timedOut: boolean): Verdict => {
            if (timedOut) return "TIMED_OUT";
            if (errored && passed === 0) return "ERROR";
            if (total > 0 && passed === total) return "ACCEPTED";
            if (passed > 0) return "PARTIAL";
            return "REJECTED";
        },
        []
    );

    const runTests = useCallback(
        async (tests: CodingTestCase[], persist: boolean) => {
            const fresh: CodingTestCaseResult[] = [];
            let totalTime = 0;
            let peakMemory = 0;
            let errored = false;
            let timedOut = false;
            for (const tc of tests) {
                const r = await runTestCase(
                    code,
                    language,
                    tc.stdin,
                    effectiveAccepted(tc),
                    { cpuSeconds, memoryKb },
                    // Hidden tests are served with hashed expected outputs; grade
                    // by hashing the learner's output and comparing digests.
                    tc.outputsHashed ?? false,
                );
                fresh.push({
                    id: tc.id,
                    label: tc.label,
                    visible: tc.visible,
                    passed: r.passed,
                    stdout: tc.visible ? r.stdout : undefined,
                    expected: tc.visible ? tc.expectedStdout : undefined,
                    stderr: tc.visible ? r.stderr : undefined,
                    timeMs: r.timeMs,
                    memoryKb: r.memoryKb,
                    error: r.error,
                });
                totalTime += r.timeMs ?? 0;
                if ((r.memoryKb ?? 0) > peakMemory) peakMemory = r.memoryKb ?? 0;
                if (r.error) errored = true;
                if (r.error && r.error.toUpperCase().includes("TIMEOUT")) timedOut = true;
            }
            const passedAll = fresh.filter((r) => r.passed).length;
            const v = computeVerdict(passedAll, tests.length, errored, timedOut);
            setResults(fresh);
            setVerdict(v);
            if (persist) {
                const maxPoints = config.maxPoints ?? 10;
                // Score is based on the HIDDEN test cases (falling back to samples
                // when no hidden tests exist), mirroring the server-side coding
                // marking strategy so the learner sees the score they'll be awarded.
                const hidden = fresh.filter((r) => r.visible === false);
                const scoringSet =
                    hidden.length > 0 ? hidden : fresh.filter((r) => r.visible === true);
                const scoredPassed = scoringSet.filter((r) => r.passed).length;
                const scoredTotal = scoringSet.length;
                const score = scoredTotal > 0 ? (scoredPassed / scoredTotal) * maxPoints : 0;
                setCodingAnswer(questionId, {
                    language,
                    sourceCode: code,
                    verdict: v,
                    passedCount: scoredPassed,
                    totalCount: scoredTotal,
                    score,
                    totalTimeMs: totalTime,
                    peakMemoryKb: peakMemory,
                    testCaseResults: fresh,
                    pasteAttemptCount: existingAnswer?.pasteAttemptCount ?? 0,
                });
            }
            return { fresh, passed: passedAll, total: tests.length, verdict: v };
        },
        [
            code,
            language,
            cpuSeconds,
            memoryKb,
            computeVerdict,
            config.maxPoints,
            setCodingAnswer,
            questionId,
            existingAnswer?.pasteAttemptCount,
        ]
    );

    // Single Run button: executes against ALL tests (visible + hidden) and
    // persists the verdict + score into the assessment answer store. The
    // top-level assessment Submit picks up these answers when it's clicked;
    // there's no separate per-question Submit.
    const handleRun = useCallback(async () => {
        setRunning(true);
        try {
            await runTests(config.testCases || [], true);
        } finally {
            setRunning(false);
        }
    }, [runTests, config.testCases]);

    const handleEditorMount = useCallback(
        (editor: unknown) => {
            const ed = editor as {
                onDidPaste?: (cb: () => void) => void;
                getDomNode?: () => HTMLElement | null;
                addCommand?: (keybinding: number, handler: () => void) => void;
            };

            // Count paste attempts via Monaco's own paste event.
            ed.onDidPaste?.(() => {
                incrementPaste(questionId);
            });

            const dom = ed.getDomNode?.();
            if (dom) {
                // Block paste + drop (count attempt then cancel).
                const pasteBlocker = (e: ClipboardEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    incrementPaste(questionId);
                };
                dom.addEventListener("paste", pasteBlocker, { capture: true });
                dom.addEventListener("drop", pasteBlocker, { capture: true });

                // Block copy/cut at the DOM level so text cannot be exfiltrated.
                const copyBlocker = (e: ClipboardEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                };
                dom.addEventListener("copy", copyBlocker, { capture: true });
                dom.addEventListener("cut", copyBlocker, { capture: true });
            }

            // Override Monaco's built-in Ctrl/Cmd+C and Ctrl/Cmd+X keyboard commands.
            // KeyMod and KeyCode constants: Ctrl=2048, Meta=256, C=33, X=52.
            const CtrlC = 2048 | 33;
            const MetaC = 256 | 33;
            const CtrlX = 2048 | 52;
            const MetaX = 256 | 52;
            const noop = () => { /* copy/cut disabled */ };
            ed.addCommand?.(CtrlC, noop);
            ed.addCommand?.(MetaC, noop);
            ed.addCommand?.(CtrlX, noop);
            ed.addCommand?.(MetaX, noop);
        },
        [incrementPaste, questionId]
    );

    return (
        <div className="grid grid-cols-1 gap-stack md:grid-cols-2">
            {/* Problem panel */}
            <div className="rounded border bg-background p-3">
                <div
                    className="prose max-w-none"
                    dangerouslySetInnerHTML={{
                        __html:
                            config.problemHtml ||
                            `<i>${t("coding.problem.missing")}</i>`,
                    }}
                />
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <Badge variant="outline">
                        {t("coding.badges.maxPoints", { max: config.maxPoints ?? 10 })}
                    </Badge>
                    <Badge variant="outline">
                        {t("coding.badges.cpu", { seconds: cpuSeconds })}
                    </Badge>
                    <Badge variant="outline">
                        {t("coding.badges.tests", { count: config.testCases?.length || 0 })}
                    </Badge>
                </div>
            </div>

            {/* Editor + results */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <Select value={language} onValueChange={(v) => setLanguage(v as LangId)}>
                        <SelectTrigger className="w-reg-180">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {allowed.map((id) => (
                                <SelectItem key={id} value={id}>
                                    {LANGUAGE_REGISTRY[id]?.label ?? id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={handleRun}
                        disabled={running || pythonBlocked}
                        size="sm"
                    >
                        {running ? (
                            <SpinnerGap className="me-1 h-4 w-4 animate-spin" />
                        ) : (
                            <Play className="me-1 h-4 w-4" />
                        )}
                        {t("coding.actions.run")}
                    </Button>
                    {pythonBlocked && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <SpinnerGap className="h-3 w-3 animate-spin" />
                            {t("coding.loadingRuntime")}
                        </span>
                    )}
                    {verdict && (
                        <Badge
                            variant={verdict === "ACCEPTED" ? "default" : "destructive"}
                            className="ms-auto"
                        >
                            {verdict}
                        </Badge>
                    )}
                </div>
                <div className="h-reg-320 overflow-hidden rounded border">
                    <Editor
                        height="100%"
                        language={LANGUAGE_REGISTRY[language]?.monacoLang ?? "plaintext"}
                        value={code}
                        onChange={(v) =>
                            setCodeByLang((prev) => ({ ...prev, [language]: v ?? "" }))
                        }
                        onMount={handleEditorMount}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            contextmenu: false,
                            // Disabled: Monaco's sticky-scroll controller races its
                            // async folding-model update against rapid edits and throws
                            // "Illegal value for lineNumber" (unhandled rejection) when
                            // lines are deleted mid-update. No value in a small embedded
                            // exam editor anyway.
                            stickyScroll: { enabled: false },
                        }}
                    />
                </div>

                <Tabs defaultValue="tests" className="w-full">
                    <TabsList>
                        <TabsTrigger value="tests">{t("coding.tabs.tests")}</TabsTrigger>
                        <TabsTrigger value="output">{t("coding.tabs.output")}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="tests">
                        <div className="space-y-2">
                            {visibleTests.length === 0 && results.length === 0 && (
                                <p className="text-xs text-muted-foreground">
                                    {t("coding.tests.noneProvided")}
                                </p>
                            )}
                            {visibleTests.map((tc, i) => {
                                const r = results.find((x) => x.id === tc.id);
                                return (
                                    <div
                                        key={tc.id}
                                        className="rounded border p-2 text-xs"
                                    >
                                        <div className="flex items-center gap-2">
                                            {r ? (
                                                r.passed ? (
                                                    <Check className="h-4 w-4 text-green-600" />
                                                ) : (
                                                    <X className="h-4 w-4 text-red-600" />
                                                )
                                            ) : (
                                                <span className="h-4 w-4" />
                                            )}
                                            <span className="font-medium">
                                                {tc.label ||
                                                    t("coding.tests.sampleFallback", { number: i + 1 })}
                                            </span>
                                            {r && typeof r.timeMs === "number" && (
                                                <span className="text-muted-foreground">
                                                    {r.timeMs}ms
                                                </span>
                                            )}
                                            {r?.error && (
                                                <span className="text-2xs text-red-600">
                                                    {r.error}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <div>
                                                <div className="text-muted-foreground">
                                                    {t("coding.tests.input")}
                                                </div>
                                                <pre className="whitespace-pre-wrap rounded bg-muted/50 p-1">
                                                    {tc.stdin || t("coding.tests.empty")}
                                                </pre>
                                            </div>
                                            <div>
                                                <div className="text-muted-foreground">
                                                    {t("coding.tests.expected")}
                                                </div>
                                                <pre className="whitespace-pre-wrap rounded bg-muted/50 p-1">
                                                    {tc.expectedStdout || t("coding.tests.empty")}
                                                </pre>
                                            </div>
                                        </div>
                                        {r && !r.passed && (
                                            <div className="mt-2 space-y-2">
                                                {r.stderr && (
                                                    <div>
                                                        <div className="text-red-600">
                                                            {t("coding.tests.compilerError")}
                                                        </div>
                                                        <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-2xs text-red-900">
                                                            {r.stderr}
                                                        </pre>
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="text-muted-foreground">
                                                        {t("coding.tests.yourOutput")}
                                                    </div>
                                                    <OutputDiff
                                                        actual={r.stdout ?? ""}
                                                        expected={tc.expectedStdout ?? ""}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {/* Hidden test counts only */}
                            {results
                                .filter((r) => !r.visible)
                                .map((r, i) => (
                                    <div
                                        key={r.id}
                                        className="flex items-center gap-2 rounded border p-2 text-xs"
                                    >
                                        {r.passed ? (
                                            <Check className="h-4 w-4 text-green-600" />
                                        ) : (
                                            <X className="h-4 w-4 text-red-600" />
                                        )}
                                        <span className="font-medium">
                                            {r.label ||
                                                t("coding.tests.hiddenFallback", { number: i + 1 })}
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className="text-3xs"
                                        >
                                            {t("coding.tests.hiddenBadge")}
                                        </Badge>
                                    </div>
                                ))}
                        </div>
                    </TabsContent>
                    <TabsContent value="output">
                        {results.length === 0 ? (
                            <p className="text-xs text-muted-foreground">{t("coding.output.none")}</p>
                        ) : (
                            <div className="space-y-2">
                                {results
                                    .filter((r) => r.visible)
                                    .map((r, i) => (
                                        <div key={r.id} className="rounded border p-2">
                                            <div className="text-xs font-medium">
                                                {r.label ||
                                                    t("coding.output.testFallback", { number: i + 1 })}
                                            </div>
                                            <div className="mt-1 text-2xs text-muted-foreground">
                                                {t("coding.output.stdoutLabel")}
                                            </div>
                                            <pre className="whitespace-pre-wrap text-xs">
                                                {r.stdout || t("coding.tests.empty")}
                                            </pre>
                                            {r.stderr && (
                                                <>
                                                    <div className="mt-1 text-2xs text-red-600">
                                                        {t("coding.output.stderrLabel")}
                                                    </div>
                                                    <pre className="whitespace-pre-wrap rounded bg-red-50 p-2 text-2xs text-red-900">
                                                        {r.stderr}
                                                    </pre>
                                                </>
                                            )}
                                        </div>
                                    ))}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
