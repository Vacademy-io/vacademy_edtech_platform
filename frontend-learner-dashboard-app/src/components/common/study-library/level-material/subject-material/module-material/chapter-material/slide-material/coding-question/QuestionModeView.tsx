import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Editor from "@monaco-editor/react";
import { Play, PaperPlaneTilt, Check, X, SpinnerGap, Clock } from "@phosphor-icons/react";
import { v4 as uuidv4 } from "uuid";
import confetti from "canvas-confetti";
import { Preferences } from "@capacitor/preferences";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { refreshProgressAfterSubmit } from "@/utils/study-library/tracking/refreshProgressAfterSubmit";
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
import {
  LANGUAGE_REGISTRY,
  getLanguageDef,
} from "./language-registry";
import type {
  CodingQuestionConfig,
  CodingSubmission,
  LangId,
  TestCaseResult,
  Verdict,
} from "./types";
import { runCode, runTestCase, effectiveAccepted } from "./executor";
import { preloadPyodide, isPyodideReady } from "../code-slide-utils.";
import { SessionTimer } from "./SessionTimer";
import { SubmissionHistory } from "./SubmissionHistory";
import { saveSubmission } from "./submission-store";
import { OutputDiff } from "./OutputDiff";

// Persisted flag: set when the session timer auto-submits, hydrated on mount.
// Keeps Run/Submit disabled and the editor read-only across reloads so
// learners can't keep editing past the deadline.
const expiredKey = (slideId: string) => `coding_session_expired_${slideId}`;

interface Props {
  question: CodingQuestionConfig;
  slideId: string;
}

function pickInitialLang(allowed: LangId[]): LangId {
  return allowed.length ? allowed[0]! : "python";
}

function classify(passed: number, total: number, hadError: boolean): Verdict {
  if (total === 0) return "ERROR";
  if (hadError && passed === 0) return "ERROR";
  if (passed === total) return "ACCEPTED";
  if (passed === 0) return "REJECTED";
  return "PARTIAL";
}

export function QuestionModeView({ question, slideId }: Props) {
  // Router search params carry the cascade-context IDs we ship to the backend
  // alongside each submission so the learner_operation cascade can run. The
  // slide route URL uses `sessionId` for what the backend calls
  // `packageSessionId` — see routes/.../slides/index.tsx validateSearch.
  const { t } = useTranslation("libraryCommonA");
  const router = useRouter();
  const queryClient = useQueryClient();

  const codeStorageKey = `coding_code_${slideId}`;
  // Per-language code, persisted per-slide in Capacitor Preferences so a
  // refresh / app re-open doesn't wipe in-progress work. Hydrated below.
  const [codeByLang, setCodeByLang] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of question.allowedLanguages) {
      init[l] =
        question.starterCode[l] ?? LANGUAGE_REGISTRY[l]?.starter ?? "";
    }
    return init;
  });
  const [language, setLanguage] = useState<LangId>(() =>
    pickInitialLang(question.allowedLanguages),
  );
  const codeHydratedRef = useRef(false);

  // Hydrate saved code from Preferences. Merge over the starter defaults so
  // languages the learner hasn't touched still show their starter, and any
  // newly-allowed language added by the admin since last session shows up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { value } = await Preferences.get({ key: codeStorageKey });
        if (cancelled) return;
        if (value) {
          try {
            const obj = JSON.parse(value) as {
              codeByLang?: Record<string, string>;
              language?: LangId;
            };
            if (obj && typeof obj === "object") {
              if (obj.codeByLang && typeof obj.codeByLang === "object") {
                setCodeByLang((prev) => ({ ...prev, ...obj.codeByLang }));
              }
              if (
                obj.language &&
                question.allowedLanguages.includes(obj.language)
              ) {
                setLanguage(obj.language);
              }
            }
          } catch {
            // corrupt entry — ignore, starter defaults remain
          }
        }
      } catch {
        // Preferences unavailable; keep starter defaults
      } finally {
        if (!cancelled) codeHydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [codeStorageKey, question.allowedLanguages]);

  // Debounce-save code + last-used language whenever they change. Skipped
  // until hydration finishes so we don't overwrite saved code with starters.
  useEffect(() => {
    if (!codeHydratedRef.current) return;
    const t = setTimeout(() => {
      Preferences.set({
        key: codeStorageKey,
        value: JSON.stringify({ codeByLang, language }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [codeByLang, language, codeStorageKey]);

  const [output, setOutput] = useState<string>("");
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bottomTab, setBottomTab] = useState<
    "tests" | "output" | "history"
  >("tests");
  const [testResults, setTestResults] = useState<TestCaseResult[] | null>(
    null,
  );
  const [latestVerdict, setLatestVerdict] = useState<Verdict | null>(null);
  const [latestScore, setLatestScore] = useState<number | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const submitInFlightRef = useRef(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Hydrate the expired flag on mount so a reload after timer-auto-submit
  // keeps the editor locked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { value } = await Preferences.get({ key: expiredKey(slideId) });
        if (!cancelled && value === "1") setSessionExpired(true);
      } catch {
        // Preferences unavailable — best-effort, default to not-expired.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slideId]);

  const def = getLanguageDef(language);

  // Pyodide is ~10 MB; preload in the background on mount so Run/Submit
  // aren't silently blocked for 30s on first click. If python isn't in the
  // allowed set, skip the preload entirely.
  const pythonAllowed = useMemo(
    () =>
      question.allowedLanguages.some(
        (l) => LANGUAGE_REGISTRY[l]?.executor === "pyodide",
      ),
    [question.allowedLanguages],
  );
  const [pyodideReady, setPyodideReady] = useState<boolean>(() =>
    isPyodideReady(),
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
  // Only gate when the current language is the python one — switching to JS
  // or a Judge0 language should run immediately.
  const needsPyodide = def.executor === "pyodide";
  const pythonBlocked = needsPyodide && !pyodideReady;

  const handleLangChange = useCallback((l: LangId) => {
    setLanguage(l);
    setCodeByLang((prev) =>
      prev[l] != null
        ? prev
        : {
            ...prev,
            [l]:
              question.starterCode[l] ?? LANGUAGE_REGISTRY[l]?.starter ?? "",
          },
    );
  }, [question.starterCode]);

  const sampleCases = useMemo(
    () => question.testCases.filter((t) => t.visible),
    [question.testCases],
  );
  const hiddenCount = question.testCases.length - sampleCases.length;

  // ---- RUN: execute against sample test cases (if any) or just stdin=""
  const onRun = useCallback(async () => {
    if (isRunning || isSubmitting || sessionExpired) return;
    setIsRunning(true);
    setBottomTab(sampleCases.length ? "tests" : "output");
    setTestResults(null);
    setOutput(t("codeEditor.running"));
    try {
      const code = codeByLang[language] ?? "";
      if (sampleCases.length === 0) {
        const r = await runCode(code, language, {
          cpuSeconds: question.perRunLimits.cpuSeconds,
          memoryKb: question.perRunLimits.memoryKb,
        });
        setOutput(r.output);
      } else {
        const results: TestCaseResult[] = [];
        for (const tc of sampleCases) {
          const r = await runTestCase(
            code,
            language,
            tc.stdin,
            effectiveAccepted(tc),
            {
              cpuSeconds: question.perRunLimits.cpuSeconds,
              memoryKb: question.perRunLimits.memoryKb,
            },
          );
          results.push({
            id: tc.id,
            label: tc.label,
            visible: true,
            passed: r.passed,
            stdout: r.stdout,
            expected: tc.expectedStdout,
            matchedIndex: r.matchedIndex,
            acceptedCount: r.acceptedCount,
            stderr: r.stderr,
            timeMs: r.timeMs,
            memoryKb: r.memoryKb,
            error: r.error,
            errorType: r.errorType,
            errorLabel: r.errorLabel,
          });
        }
        setTestResults(results);
        setOutput(
          results
            .map(
              (r, i) =>
                `--- ${r.label || t("codingQuestion.questionMode.sampleLabel", { number: i + 1 })}: ${r.passed ? t("codingQuestion.questionMode.passLabel") : t("codingQuestion.questionMode.failLabel")} ---\n${r.stdout || t("codingQuestion.questionMode.noStdout")}`,
            )
            .join("\n\n"),
        );
      }
    } catch (e) {
      setOutput(
        t("codingQuestion.questionMode.runErrorPrefix", { message: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setIsRunning(false);
    }
  }, [
    codeByLang,
    language,
    sampleCases,
    isRunning,
    isSubmitting,
    sessionExpired,
    question.perRunLimits.cpuSeconds,
    question.perRunLimits.memoryKb,
  ]);

  // ---- SUBMIT: run ALL test cases, store the submission
  const submit = useCallback(
    async (auto = false) => {
      if (submitInFlightRef.current) return;
      // Once the timer has expired, only the timer-driven auto-submit is
      // allowed through. Manual clicks and Ctrl+Shift+Enter are no-ops.
      if (sessionExpired && !auto) return;
      submitInFlightRef.current = true;
      setIsSubmitting(true);
      setBottomTab("tests");
      const code = codeByLang[language] ?? "";
      const results: TestCaseResult[] = [];
      let totalTime = 0;
      let peakMemory = 0;
      let hadError = false;
      try {
        for (const tc of question.testCases) {
          const r = await runTestCase(code, language, tc.stdin, effectiveAccepted(tc), {
            cpuSeconds: question.perRunLimits.cpuSeconds,
            memoryKb: question.perRunLimits.memoryKb,
          });
          if (r.error) hadError = true;
          totalTime += r.timeMs ?? 0;
          peakMemory = Math.max(peakMemory, r.memoryKb ?? 0);
          results.push({
            id: tc.id,
            label: tc.label,
            visible: tc.visible,
            passed: r.passed,
            stdout: r.stdout,
            expected: tc.expectedStdout,
            matchedIndex: r.matchedIndex,
            acceptedCount: r.acceptedCount,
            stderr: r.stderr,
            timeMs: r.timeMs,
            memoryKb: r.memoryKb,
            error: r.error,
            errorType: r.errorType,
            errorLabel: r.errorLabel,
          });
        }

        const passed = results.filter((r) => r.passed).length;
        const total = results.length;
        const verdict = classify(passed, total, hadError);
        const score =
          total === 0 ? 0 : (passed / total) * question.maxPoints;

        // Pull the timer's start time (set on first mount by SessionTimer) so
        // the backend can record how long the learner actually took. Only
        // present when the question has a session timer; otherwise undefined.
        let sessionStartedAt: number | undefined;
        if (question.sessionTimeMinutes) {
          try {
            const { value } = await Preferences.get({
              key: `coding_session_started_${slideId}`,
            });
            if (value) {
              // Newer sessions store JSON { startedAt, totalMinutes };
              // older ones store a bare millisecond number.
              try {
                const obj = JSON.parse(value);
                if (obj && Number.isFinite(obj.startedAt)) {
                  sessionStartedAt = Number(obj.startedAt);
                }
              } catch {
                const n = Number(value);
                if (Number.isFinite(n)) sessionStartedAt = n;
              }
            }
          } catch {
            // Preferences unavailable (e.g. SSR / web build without plugin)
            // — leave undefined.
          }
        }

        const submission: CodingSubmission = {
          id: uuidv4(),
          slideId,
          language,
          sourceCode: code,
          verdict,
          passedCount: passed,
          totalCount: total,
          score,
          maxPoints: question.maxPoints,
          results,
          totalTimeMs: totalTime,
          peakMemoryKb: peakMemory,
          submittedAt: Date.now(),
          sessionStartedAt,
        };

        // Pull cascade-context IDs from the current route. `sessionId` in the
        // URL is the packageSessionId on the backend (per the slide route's
        // validateSearch). Sending all four lets the backend fire the
        // learner_operation cascade so this slide counts toward chapter /
        // module / subject / course progress.
        const search = router.state.location.search as Record<string, unknown>;
        const chapterIdForCascade = (search.chapterId as string | undefined) ?? "";
        const moduleIdForCascade = (search.moduleId as string | undefined) ?? "";
        const subjectIdForCascade = (search.subjectId as string | undefined) ?? "";
        const packageSessionIdForCascade =
          (search.sessionId as string | undefined) ?? "";

        await saveSubmission(submission, {
          chapterId: chapterIdForCascade,
          moduleId: moduleIdForCascade,
          subjectId: subjectIdForCascade,
          packageSessionId: packageSessionIdForCascade,
        });

        // Invalidate every progress cache so the chapter sidebar, module
        // rollups, and course % refetch with the new value. Mirror of the
        // quiz submit path (see quiz-viewer.tsx).
        if (chapterIdForCascade) {
          void refreshProgressAfterSubmit(queryClient, chapterIdForCascade);
        }
        // Redact hidden-test answer keys before they land in React state —
        // otherwise a learner can open DevTools and read `expected`/`stdout`
        // for hidden cases they just failed. The full payload already went
        // to the backend above; backend redacts on GET for non-privileged
        // users. Keep `passed`/`timeMs` so the UI still shows pass/fail.
        const safeResults: TestCaseResult[] = results.map((r) =>
          r.visible
            ? r
            : {
                ...r,
                stdout: "",
                expected: "",
                stderr: "",
                error: r.error ? "(hidden)" : undefined,
              },
        );
        setTestResults(safeResults);
        setLatestVerdict(verdict);
        setLatestScore(score);
        setHistoryTick((t) => t + 1);

        if (verdict === "ACCEPTED" && !auto) {
          try {
            confetti({
              particleCount: 120,
              spread: 70,
              origin: { y: 0.6 },
            });
          } catch {
            // ignore — confetti is best-effort
          }
        }
        if (auto) {
          // Session expired — persist the flag so subsequent reloads keep
          // the editor read-only and Run/Submit disabled. Intentionally do
          // NOT clear `coding_session_started_${slideId}`: leaving it in
          // place keeps remaining at 00:00 instead of starting a fresh
          // countdown if the learner reloads after expiry.
          try {
            await Preferences.set({
              key: expiredKey(slideId),
              value: "1",
            });
          } catch {
            // Preferences unavailable — UI flag is still set in memory.
          }
        }
      } catch (e) {
        setOutput(
          t("codingQuestion.questionMode.submitFailedPrefix", { message: e instanceof Error ? e.message : String(e) }),
        );
      } finally {
        submitInFlightRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      codeByLang,
      language,
      question.testCases,
      question.perRunLimits.cpuSeconds,
      question.perRunLimits.memoryKb,
      question.maxPoints,
      question.sessionTimeMinutes,
      slideId,
      sessionExpired,
    ],
  );

  // Auto-submit when the session timer expires. Flip the expired flag
  // synchronously so the disabled state takes effect even before the
  // submit promise resolves.
  const onTimerExpire = useCallback(() => {
    setSessionExpired(true);
    submit(true);
  }, [submit]);

  // Keep latest handlers in refs so the Monaco commands registered once at
  // mount always see the freshest closure (onRun/submit change every render
  // due to their dep arrays, but Monaco's addCommand is one-shot).
  const onRunRef = useRef(onRun);
  const onSubmitRef = useRef<() => void>(() => submit(false));
  onRunRef.current = onRun;
  onSubmitRef.current = () => submit(false);

  // Register Ctrl/Cmd+Enter = Run, Ctrl/Cmd+Shift+Enter = Submit.
  // Hotkeys fire only when the editor is focused — standard LeetCode UX.
  const handleEditorMount = useCallback<
    (editor: unknown, monaco: unknown) => void
  >((editor, monaco) => {
    const ed = editor as {
      addCommand: (keybinding: number, handler: () => void) => void;
    };
    const m = monaco as {
      KeyMod: { CtrlCmd: number; Shift: number };
      KeyCode: { Enter: number };
    };
    ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => {
      onRunRef.current();
    });
    ed.addCommand(
      m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.Enter,
      () => {
        onSubmitRef.current();
      },
    );
  }, []);

  // ---- Resize: vertical split (top = code+problem, bottom = output/tests)
  const [bottomHeight, setBottomHeight] = useState(220);
  const resizingRef = useRef(false);
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
  };
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const vh = window.innerHeight;
      const next = Math.min(Math.max(vh - e.clientY, 120), vh * 0.7);
      setBottomHeight(next);
    };
    const up = () => {
      resizingRef.current = false;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border bg-white">
      {sessionExpired && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          <Clock className="size-4 shrink-0" />
          <span>
            {t("codingQuestion.questionMode.sessionEndedBanner")}
          </span>
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b bg-gray-50 px-3 py-2">
        <Select
          value={language}
          onValueChange={(v) => handleLangChange(v as LangId)}
        >
          <SelectTrigger className="h-8 w-reg-180">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {question.allowedLanguages.map((l) => (
              <SelectItem key={l} value={l}>
                {LANGUAGE_REGISTRY[l]?.label ?? l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Badge variant="outline" className="text-3xs">
          {def.executor}
        </Badge>

        <div className="ms-auto flex items-center gap-2">
          {question.sessionTimeMinutes ? (
            <SessionTimer
              slideId={slideId}
              totalMinutes={question.sessionTimeMinutes}
              onExpire={onTimerExpire}
            />
          ) : null}

          {pythonBlocked && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <SpinnerGap className="size-3 animate-spin" />
              {t("codingQuestion.questionMode.loadingPythonRuntime")}
            </span>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={onRun}
            disabled={isRunning || isSubmitting || pythonBlocked || sessionExpired}
            title={
              sessionExpired
                ? t("codingQuestion.questionMode.sessionEndedTooltip")
                : t("codingQuestion.questionMode.runTooltip")
            }
          >
            {isRunning ? (
              <SpinnerGap className="me-1 size-4 animate-spin" />
            ) : (
              <Play className="me-1 size-4" />
            )}
            {t("codeEditor.run")}
          </Button>

          <Button
            size="sm"
            onClick={() => submit(false)}
            disabled={isSubmitting || isRunning || pythonBlocked || sessionExpired}
            className="bg-primary-500 text-white hover:bg-primary-600"
            title={
              sessionExpired
                ? t("codingQuestion.questionMode.sessionEndedTooltip")
                : t("codingQuestion.questionMode.submitTooltip")
            }
          >
            {isSubmitting ? (
              <SpinnerGap className="me-1 size-4 animate-spin" />
            ) : (
              <PaperPlaneTilt className="me-1 size-4" />
            )}
            {t("codingQuestion.questionMode.submit")}
          </Button>
        </div>
      </div>

      {/* Two-column top on tablet/desktop; stacks vertically on mobile so the
          editor isn't squeezed off-screen behind the problem panel. */}
      <div
        className="flex min-h-0 flex-1 flex-col md:flex-row"
        style={{ height: `calc(100% - ${bottomHeight + 36}px)` }}
      >
        {/* Problem */}
        {/* select-none + copy/contextmenu handlers are a malpractice
            *deterrent* (paste-into-LLM). Not a security control — anyone
            can read the DOM. Code editor stays selectable. */}
        <div
          className="w-full select-none overflow-auto border-b bg-white p-4 md:w-2/5 md:min-w-reg-280 md:border-b-0 md:border-e"
          style={{
            WebkitUserSelect: "none",
            MozUserSelect: "none",
            msUserSelect: "none",
            userSelect: "none",
          }}
          onCopy={(e) => e.preventDefault()}
          onCut={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {question.problemHtml ? (
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: question.problemHtml }}
            />
          ) : (
            <p className="text-sm text-gray-500">
              {t("codingQuestion.questionMode.noProblemStatement")}
            </p>
          )}
          <div className="mt-3 text-xs text-gray-500">
            {t("codingQuestion.questionMode.statsPrefix")}{" "}
            <span className="font-medium">{question.maxPoints}</span>{" "}
            {t("codingQuestion.questionMode.statsLine", {
              count: question.testCases.length,
              visible: sampleCases.length,
              hidden: hiddenCount,
              cpu: question.perRunLimits.cpuSeconds,
              mem: Math.round(question.perRunLimits.memoryKb / 1000),
            })}
          </div>
        </div>

        {/* Editor — fixed height on mobile (the container collapses to auto
            height there, so flex-grow can't size the editor); fills the pane
            on tablet/desktop. */}
        <div className="h-80 w-full md:h-auto md:min-h-0 md:flex-1">
          <Editor
            height="100%"
            language={def.monacoLang}
            value={codeByLang[language] ?? ""}
            theme="vs-dark"
            onMount={handleEditorMount}
            onChange={(v) =>
              setCodeByLang((prev) => ({ ...prev, [language]: v ?? "" }))
            }
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              padding: { top: 12 },
              readOnly: sessionExpired,
              // Disabled: sticky-scroll's async folding update races rapid edits
              // and throws "Illegal value for lineNumber" (unhandled rejection).
              stickyScroll: { enabled: false },
            }}
          />
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize bg-gray-200 hover:bg-gray-300"
        onMouseDown={onResizeStart}
      />

      {/* Bottom panel: tabs */}
      <div
        className="flex flex-col overflow-hidden border-t bg-white"
        style={{ height: bottomHeight }}
      >
        <Tabs
          value={bottomTab}
          onValueChange={(v) => setBottomTab(v as typeof bottomTab)}
          className="flex h-full flex-col"
        >
          <div className="flex items-center justify-between border-b px-3 py-1">
            <TabsList>
              <TabsTrigger value="tests">
                {t("codingQuestion.questionMode.testCasesTab")}
                {testResults
                  ? ` (${testResults.filter((r) => r.passed).length}/${testResults.length})`
                  : ""}
              </TabsTrigger>
              <TabsTrigger value="output">{t("codingQuestion.questionMode.outputTab")}</TabsTrigger>
              <TabsTrigger value="history">{t("codingQuestion.questionMode.submissionsTab")}</TabsTrigger>
            </TabsList>
            {latestVerdict && (
              <div className="text-xs">
                <span className="font-semibold">
                  {latestVerdict === "ACCEPTED" && t("codingQuestion.submissionHistory.verdict.accepted")}
                  {latestVerdict === "PARTIAL" && t("codingQuestion.submissionHistory.verdict.partial")}
                  {latestVerdict === "REJECTED" && t("codingQuestion.submissionHistory.verdict.rejected")}
                  {latestVerdict === "ERROR" && t("codingQuestion.submissionHistory.verdict.error")}
                  {latestVerdict === "TIMED_OUT" && t("codingQuestion.submissionHistory.verdict.timedOut")}
                </span>
                {latestScore != null && (
                  <span className="ms-1 text-gray-500">
                    {latestScore.toFixed(1)} / {question.maxPoints}
                  </span>
                )}
              </div>
            )}
          </div>

          <TabsContent
            value="tests"
            className="m-0 flex-1 overflow-auto p-3"
          >
            {testResults ? (
              <div className="space-y-2">
                {testResults.map((r, i) => (
                  <div
                    key={r.id}
                    className={`rounded border p-2 text-xs ${
                      r.passed
                        ? "border-green-200 bg-green-50"
                        : "border-red-200 bg-red-50"
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      {r.passed ? (
                        <Check className="size-3 text-green-600" />
                      ) : (
                        <X className="size-3 text-red-600" />
                      )}
                      <span className="font-medium">
                        {r.label || (r.visible ? t("codingQuestion.questionMode.sampleLabel", { number: i + 1 }) : t("codingQuestion.questionMode.hiddenLabel", { number: i + 1 }))}
                      </span>
                      <span className="text-gray-500">
                        {r.visible ? t("codingQuestion.questionMode.sampleTag") : t("codingQuestion.questionMode.hiddenTag")}
                      </span>
                      {r.errorType && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-red-800">
                          {r.errorType === "TLE" && "TLE"}
                          {r.errorType === "MLE" && "MLE"}
                          {r.errorType === "COMPILE" && t("codeExecution.compilationError")}
                          {(r.errorType === "RUNTIME" ||
                            r.errorType === "RUNTIME_JS") &&
                            (r.errorLabel || t("codeExecution.runtimeError"))}
                          {r.errorType === "JUDGE0" && t("codingQuestion.questionMode.serviceError")}
                          {r.errorType === "OTHER" && t("codingQuestion.questionMode.genericError")}
                        </span>
                      )}
                      {r.timeMs != null && (
                        <span className="ms-auto text-gray-500">
                          {r.timeMs} ms
                        </span>
                      )}
                    </div>
                    {r.visible &&
                      (r.passed ? (
                        <>
                          <pre className="overflow-auto rounded bg-white p-1 font-mono text-2xs">
                            {r.stdout || t("codingQuestion.outputDiff.empty")}
                          </pre>
                          {(r.acceptedCount ?? 1) > 1 &&
                            r.matchedIndex != null &&
                            r.matchedIndex >= 0 && (
                              <div className="mt-0.5 text-3xs text-green-700">
                                {t("codingQuestion.questionMode.matchedAcceptedOutput", { index: r.matchedIndex + 1, count: r.acceptedCount })}
                              </div>
                            )}
                        </>
                      ) : (
                        <OutputDiff
                          actual={r.stdout ?? ""}
                          expected={r.expected ?? ""}
                          acceptedCount={r.acceptedCount}
                        />
                      ))}
                    {r.stderr && (
                      <pre className="mt-1 overflow-auto rounded bg-white p-1 font-mono text-2xs text-red-700">
                        {r.stderr}
                      </pre>
                    )}
                    {r.error && (
                      <div className="mt-1 text-2xs text-red-700">
                        {r.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {sampleCases.length === 0 ? (
                  <p className="text-xs text-gray-500">
                    {t("codingQuestion.questionMode.noSampleTests", { count: hiddenCount })}
                  </p>
                ) : (
                  <>
                    <p className="text-xs text-gray-500">
                      {t("codingQuestion.questionMode.hitRunHint", { count: sampleCases.length })}
                    </p>
                    {sampleCases.map((tc, i) => (
                      <div
                        key={tc.id}
                        className="rounded border p-2 text-xs space-y-1"
                      >
                        <div className="font-medium">
                          {tc.label || t("codingQuestion.questionMode.sampleLabel", { number: i + 1 })}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="text-3xs font-semibold uppercase text-gray-500">
                              {t("codingQuestion.questionMode.inputLabel")}
                            </div>
                            <pre className="overflow-auto rounded bg-gray-50 p-1 font-mono text-2xs">
                              {tc.stdin || t("codingQuestion.outputDiff.empty")}
                            </pre>
                          </div>
                          <div>
                            <div className="text-3xs font-semibold uppercase text-gray-500">
                              {t("codingQuestion.questionMode.expectedOutputLabel")}
                            </div>
                            <pre className="overflow-auto rounded bg-gray-50 p-1 font-mono text-2xs">
                              {tc.expectedStdout || t("codingQuestion.outputDiff.empty")}
                            </pre>
                            {(tc.acceptedOutputs?.length ?? 0) > 1 && (
                              <div className="mt-0.5 text-3xs text-gray-500">
                                {t("codingQuestion.questionMode.moreAcceptedOutputs", { count: (tc.acceptedOutputs?.length ?? 1) - 1 })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="output" className="m-0 flex-1 overflow-auto">
            <pre className="h-full overflow-auto bg-gray-900 p-3 font-mono text-xs text-green-300">
              {output || t("codingQuestion.questionMode.hitRunToSeeOutput")}
            </pre>
          </TabsContent>

          <TabsContent
            value="history"
            className="m-0 flex-1 overflow-auto p-3"
          >
            <SubmissionHistory slideId={slideId} refreshKey={historyTick} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
