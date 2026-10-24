import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Sparkle, CheckCircle, WarningCircle, CircleNotch, ArrowLeft } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ToolCostBadge } from '@/components/common/ai-credits/ToolCostBadge';
import { useToolCostPreview } from '@/components/common/ai-credits/useToolCostPreview';
import { ALL_LANG_IDS, LANGUAGE_REGISTRY, type LangId } from '../constants/code-editor';
import type { CodingQuestionConfig, CodingTestCase } from '../utils/code-editor-types';
import { executeCode } from '../utils/code-editor-utils';
import { generateCodingQuestion, type GeneratedCodingQuestion } from './ai-generate-api';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultLanguages: LangId[];
    /** Receives the reviewed config; wired to the editor's handleQuestionChange. */
    onApply: (question: CodingQuestionConfig) => void;
}

type Difficulty = 'easy' | 'medium' | 'hard';
type Phase = 'input' | 'working' | 'review';

interface VerifyRow {
    label: string;
    input: string;
    expected: string[];
    actual: string;
    passed: boolean;
    errored: boolean;
    /** When true, apply the reference solution's actual output as the accepted answer. */
    useReference: boolean;
}

function newId(i: number): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tc-${Date.now()}-${i}`;
}

// Pyodide sandbox runs append a "[Editor (Pyodide: v…): …]" diagnostic footer
// when no stdin is supplied. Strip it so verify compares clean stdout.
function cleanOutput(s: string): string {
    return (s ?? '').replace(/\n?\[Editor \(Pyodide:[^\]]*\]\s*$/, '').trim();
}

function errText(e: unknown, t: TFunction): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const any = e as any;
    return (
        any?.response?.data?.detail ||
        any?.response?.data?.message ||
        any?.message ||
        t('errors.generationFailed')
    );
}

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export function GenerateCodingQuestionDialog({
    open,
    onOpenChange,
    defaultLanguages,
    onApply,
}: Props) {
    const { t, i18n } = useTranslation('studyLibraryGenerateCodingQuestionDialog');
    const { t: tCodeEditorUtils } = useTranslation('studyLibraryCodeEditorUtils');
    const [idea, setIdea] = useState('');
    const [languages, setLanguages] = useState<LangId[]>(
        defaultLanguages?.length ? defaultLanguages : ['python']
    );
    const [difficulty, setDifficulty] = useState<Difficulty>('medium');
    const [numTests, setNumTests] = useState(5);
    const [phase, setPhase] = useState<Phase>('input');
    const [workingMsg, setWorkingMsg] = useState('');
    const [generated, setGenerated] = useState<GeneratedCodingQuestion | null>(null);
    const [verify, setVerify] = useState<VerifyRow[]>([]);
    const [error, setError] = useState<string | null>(null);

    const cost = useToolCostPreview('coding_question', {}, open);

    const toggleLang = useCallback((lang: LangId) => {
        setLanguages((prev) =>
            prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
        );
    }, []);

    const reset = useCallback(() => {
        setPhase('input');
        setGenerated(null);
        setVerify([]);
        setError(null);
        setWorkingMsg('');
    }, []);

    const passCount = useMemo(() => verify.filter((v) => v.passed).length, [verify]);
    const mismatchCount = useMemo(
        () => verify.filter((v) => !v.passed && !v.errored).length,
        [verify]
    );

    const handleGenerate = useCallback(async () => {
        if (!idea.trim() || languages.length === 0) return;
        setError(null);
        setPhase('working');
        setWorkingMsg(t('working.generating'));
        try {
            const resp = await generateCodingQuestion({
                idea: idea.trim(),
                allowed_languages: languages,
                difficulty,
                num_test_cases: numTests,
            });
            setGenerated(resp);

            // Self-verify: run the reference solution against every generated
            // test case in-browser and compare (trim + exact, any accepted).
            setWorkingMsg(t('working.verifying'));
            const rows: VerifyRow[] = [];
            for (const tc of resp.test_cases) {
                let actual = '';
                let errored = false;
                try {
                    const r = await executeCode(
                        resp.solution.source_code,
                        resp.solution.language,
                        {
                            stdin: tc.input,
                            cpuSeconds: resp.settings.cpu_seconds,
                            memoryKb: resp.settings.memory_kb,
                        },
                        tCodeEditorUtils,
                        i18n.language
                    );
                    errored = !!r.hasError;
                    actual = cleanOutput(r.output);
                } catch {
                    errored = true;
                }
                const passed =
                    !errored && tc.accepted_outputs.some((a) => (a ?? '').trim() === actual);
                rows.push({
                    label: tc.label || t('review.testFallbackLabel'),
                    input: tc.input,
                    expected: tc.accepted_outputs,
                    actual,
                    passed,
                    errored,
                    // Auto-correct a mismatch to the reference solution's real
                    // output — but only when the solution actually ran (not on a
                    // solution error, which would overwrite with an error string).
                    useReference: !passed && !errored,
                });
            }
            setVerify(rows);
            setPhase('review');
        } catch (e) {
            setError(errText(e, t));
            setPhase('input');
        }
    }, [idea, languages, difficulty, numTests, t, tCodeEditorUtils, i18n.language]);

    const handleApply = useCallback(() => {
        if (!generated) return;
        const testCases: CodingTestCase[] = generated.test_cases.map((tc, i) => {
            const row = verify[i];
            const accepted =
                row && row.useReference && !row.errored ? [row.actual] : tc.accepted_outputs;
            const safeAccepted = accepted.length ? accepted : [''];
            return {
                id: newId(i),
                label: tc.label,
                stdin: tc.input,
                expectedStdout: safeAccepted[0] ?? '',
                acceptedOutputs: safeAccepted,
                visible: tc.visible,
            };
        });

        const config: CodingQuestionConfig = {
            problemHtml: generated.problem_html,
            allowedLanguages: generated.allowed_languages,
            starterCode: generated.starter_code,
            sessionTimeMinutes: generated.settings.session_time_minutes ?? null,
            perRunLimits: {
                cpuSeconds: generated.settings.cpu_seconds,
                memoryKb: generated.settings.memory_kb,
            },
            maxPoints: generated.settings.max_points,
            testCases,
        };
        onApply(config);
        onOpenChange(false);
        reset();
    }, [generated, verify, onApply, onOpenChange, reset]);

    const canGenerate =
        !!idea.trim() && languages.length > 0 && phase !== 'working' && cost.sufficient !== false;

    // ---- Footer ----
    let footer: JSX.Element;
    if (phase === 'review') {
        footer = (
            <div className="flex w-full items-center justify-between gap-2">
                <MyButton buttonType="secondary" scale="medium" onClick={reset}>
                    <ArrowLeft className="mr-1 size-4" />
                    {t('footer.startOver')}
                </MyButton>
                <MyButton buttonType="primary" scale="medium" onClick={handleApply}>
                    {t('footer.applyToQuestion')}
                </MyButton>
            </div>
        );
    } else {
        footer = (
            <div className="flex w-full items-center justify-end gap-2">
                <ToolCostBadge
                    credits={cost.credits}
                    sufficient={cost.sufficient}
                    coverage={cost.coverage}
                    loading={cost.isLoading}
                    className="mr-auto"
                />
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => onOpenChange(false)}
                    disable={phase === 'working'}
                >
                    {t('footer.cancel')}
                </MyButton>
                <MyButton
                    buttonType="primary"
                    scale="medium"
                    onClick={handleGenerate}
                    disable={!canGenerate}
                >
                    <Sparkle className="mr-1 size-4" weight="fill" />
                    {t('footer.generate')}
                </MyButton>
            </div>
        );
    }

    return (
        <MyDialog
            open={open}
            onOpenChange={(o) => {
                if (!o) reset();
                onOpenChange(o);
            }}
            heading={t('heading')}
            dialogWidth="max-w-2xl"
            footer={footer}
        >
            {phase === 'working' ? (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                    <CircleNotch className="size-8 animate-spin text-primary-500" />
                    <p className="text-sm font-medium">{workingMsg}</p>
                    <p className="text-xs text-muted-foreground">{t('working.etaHint')}</p>
                </div>
            ) : phase === 'review' && generated ? (
                <div className="space-y-4">
                    <div>
                        <div className="text-sm font-semibold">{generated.title}</div>
                        <div className="text-xs text-muted-foreground">
                            {t('review.summaryLine', {
                                languages: generated.allowed_languages.join(', '),
                                count: generated.test_cases.length,
                                model: generated.model_used,
                            })}
                        </div>
                    </div>

                    {/* Self-verify summary */}
                    <div
                        className={cn(
                            'flex items-center gap-2 rounded-md border p-2 text-sm',
                            mismatchCount === 0
                                ? 'border-green-200 bg-green-50 text-green-800'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                        )}
                    >
                        {mismatchCount === 0 ? (
                            <CheckCircle className="size-4 shrink-0" weight="fill" />
                        ) : (
                            <WarningCircle className="size-4 shrink-0" weight="fill" />
                        )}
                        <span>
                            {t('review.verifySummary', {
                                count: verify.length,
                                passed: passCount,
                            })}
                            {mismatchCount > 0 &&
                                t('review.autoCorrectSuffix', { count: mismatchCount })}
                            .
                        </span>
                    </div>

                    {/* Per-test list */}
                    <div className="max-h-64 space-y-1 overflow-auto">
                        {verify.map((v, i) => (
                            <div
                                key={i}
                                className={cn(
                                    'rounded border p-2 text-xs',
                                    v.passed
                                        ? 'border-green-200 bg-green-50'
                                        : v.errored
                                          ? 'border-red-200 bg-red-50'
                                          : 'border-amber-200 bg-amber-50'
                                )}
                            >
                                <div className="flex items-center gap-2 font-medium">
                                    {v.passed ? (
                                        <CheckCircle className="size-3 text-green-600" weight="fill" />
                                    ) : (
                                        <WarningCircle
                                            className="size-3 text-amber-600"
                                            weight="fill"
                                        />
                                    )}
                                    {v.label}
                                    <span className="text-muted-foreground">
                                        {v.passed
                                            ? t('review.status.verified')
                                            : v.errored
                                              ? t('review.status.errored')
                                              : t('review.status.mismatch')}
                                    </span>
                                </div>
                                {!v.passed && !v.errored && (
                                    <div className="mt-1 grid grid-cols-2 gap-2 font-mono">
                                        <div>
                                            <div className="text-muted-foreground">
                                                {t('review.aiExpected')}
                                            </div>
                                            <pre className="overflow-auto rounded bg-white p-1">
                                                {v.expected[0] || t('review.empty')}
                                            </pre>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">
                                                {t('review.referenceOutput')}
                                            </div>
                                            <pre className="overflow-auto rounded bg-white p-1">
                                                {v.actual || t('review.empty')}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{t('review.applyHint')}</p>
                </div>
            ) : (
                <div className="space-y-4">
                    <div>
                        <Label className="text-sm">{t('input.describeLabel')}</Label>
                        <Textarea
                            value={idea}
                            onChange={(e) => setIdea(e.target.value)}
                            placeholder={t('input.describePlaceholder')}
                            rows={5}
                            className="text-sm"
                        />
                    </div>

                    <div>
                        <Label className="text-sm">{t('input.languagesLabel')}</Label>
                        <div className="mt-1 flex flex-wrap gap-2">
                            {ALL_LANG_IDS.map((l) => {
                                const active = languages.includes(l);
                                return (
                                    <button
                                        key={l}
                                        type="button"
                                        onClick={() => toggleLang(l)}
                                        className={cn(
                                            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                                            active
                                                ? 'border-primary-500 bg-primary-50 text-primary-600'
                                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                        )}
                                    >
                                        {LANGUAGE_REGISTRY[l].label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-6">
                        <div>
                            <Label className="text-sm">{t('input.difficultyLabel')}</Label>
                            <div className="mt-1 flex gap-2">
                                {DIFFICULTIES.map((d) => (
                                    <button
                                        key={d}
                                        type="button"
                                        onClick={() => setDifficulty(d)}
                                        className={cn(
                                            'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
                                            difficulty === d
                                                ? 'border-primary-500 bg-primary-50 text-primary-600'
                                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                        )}
                                    >
                                        {t(`input.difficulties.${d}`)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div>
                            <Label className="text-sm">{t('input.testCasesLabel')}</Label>
                            <Input
                                type="number"
                                min={2}
                                max={12}
                                value={numTests}
                                onChange={(e) =>
                                    setNumTests(
                                        Math.max(2, Math.min(12, Number(e.target.value) || 5))
                                    )
                                }
                                className="mt-1 h-9 w-24"
                            />
                        </div>
                    </div>

                    {cost.sufficient === false && (
                        <p className="text-xs text-amber-700">
                            {t('input.insufficientCredits')}
                        </p>
                    )}
                    {error && <p className="text-xs text-red-600">{error}</p>}
                </div>
            )}
        </MyDialog>
    );
}
