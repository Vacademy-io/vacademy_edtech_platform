import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { toast } from 'sonner';
import { CaretDown, CaretUp, CheckCircle, Sparkle, Warning } from '@phosphor-icons/react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import {
    AGENT_ASSIST_CREDIT_COST,
    runAssistJob,
    type AssistAgentFields,
    type AssistAnalysis,
    type AssistJobRequest,
    type AssistOperation,
} from '../-services/ai-agent-assist';

/** The agent fields a rewrite updates together, so prompt and side fields never drift apart. */
export interface AgentAssistUpdate {
    systemPrompt?: string;
    openingLine?: string;
    extractionQuestions?: string[];
    dispositions?: string[];
}

interface AiAgentPromptAssistantProps {
    instituteId: string;
    /** Saved agent id — enables the call-grounded feedback loop. */
    agentId?: string;
    /** Current system prompt in the editor. */
    prompt: string;
    /** Current opening line, questions, outcomes, name, language (unsaved edits included). */
    fields: AssistAgentFields;
    /** Apply a rewrite: prompt + opening line + questions + outcomes in one go. */
    onApply: (update: AgentAssistUpdate) => void;
}

const scoreTone = (score: number) =>
    score >= 75 ? 'text-success-600' : score >= 50 ? 'text-warning-600' : 'text-danger-600';
const scoreBarTone = (score: number) =>
    score >= 75 ? 'bg-success-500' : score >= 50 ? 'bg-warning-500' : 'bg-danger-500';

/**
 * Called from mutation onError handlers, which are plain callbacks with no
 * hooks available, so it goes through the i18next singleton rather than a
 * passed-in `t`.
 */
const errMsg = (err: unknown): string => {
    const e = err as {
        assistMessage?: string;
        message?: string;
        response?: { status?: number; data?: { ex?: string; message?: string } };
    };
    if (e?.response?.status === 402)
        return i18next.t('settingsAiAgentPromptAssistant:errors.insufficientCredits');
    if (e?.message === 'assist-timeout')
        return i18next.t('settingsAiAgentPromptAssistant:errors.timeout');
    return (
        e?.assistMessage ??
        e?.response?.data?.ex ??
        e?.response?.data?.message ??
        i18next.t('settingsAiAgentPromptAssistant:errors.genericFailure')
    );
};

const sameList = (a?: string[], b?: string[]) =>
    (a ?? []).join('\n').trim() === (b ?? []).join('\n').trim();

/** The update a proposal applies; side fields only when the model returned them. */
const toUpdate = (res: AssistAnalysis): AgentAssistUpdate => {
    const opening = res.opening_line ?? res.derived?.opening_line;
    return {
        ...(res.prompt ? { systemPrompt: res.prompt } : {}),
        ...(opening ? { openingLine: opening } : {}),
        ...(res.derived?.extraction_questions?.length
            ? { extractionQuestions: res.derived.extraction_questions }
            : {}),
        ...(res.derived?.dispositions?.length ? { dispositions: res.derived.dispositions } : {}),
    };
};

function LintList({ items }: { items?: string[] }) {
    const { t } = useTranslation('settingsAiAgentPromptAssistant');
    if (!items?.length) return null;
    return (
        <div className="space-y-1 rounded-md border border-warning-200 bg-warning-50 p-2">
            <p className="flex items-center gap-1 text-caption font-medium text-warning-700">
                <Warning className="size-3.5" />
                {t('lint.title')}
            </p>
            {items.map((l, i) => (
                <p key={i} className="text-caption text-neutral-600">
                    • {l}
                </p>
            ))}
        </div>
    );
}

/**
 * AI-assisted authoring for an agent: draft from a plain brief, score against the
 * live-call rubric, apply selected suggestions, regenerate from the admin's notes, and
 * (for saved agents) revise from post-call feedback grounded in real calls. Every
 * rewrite returns the prompt, opening line, questions and outcomes as ONE proposal —
 * nothing changes until the admin clicks "Apply all".
 */
export function AiAgentPromptAssistant({
    instituteId,
    agentId,
    prompt,
    fields,
    onApply,
}: AiAgentPromptAssistantProps) {
    const { t } = useTranslation('settingsAiAgentPromptAssistant');
    const [analysis, setAnalysis] = useState<AssistAnalysis | null>(null);
    const [brief, setBrief] = useState('');
    const [notes, setNotes] = useState('');
    const [picked, setPicked] = useState<Set<number>>(new Set());
    const [showDims, setShowDims] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [proposal, setProposal] = useState<AssistAnalysis | null>(null);
    const [showFullPrompt, setShowFullPrompt] = useState(false);
    const [elapsed, setElapsed] = useState(0);

    const base: AssistJobRequest = { instituteId, agentId, prompt, ...fields };

    const job = useMutation({
        mutationFn: ({ op, extra }: { op: AssistOperation; extra: Partial<AssistJobRequest> }) => {
            setElapsed(0);
            return runAssistJob(op, { ...base, ...extra }, setElapsed);
        },
        onSuccess: (res, { op }) => {
            setPicked(new Set());
            if (op === 'analyze') {
                setAnalysis(res);
            } else {
                setProposal(res);
                setShowFullPrompt(false);
            }
        },
        onError: (e) => toast.error(errMsg(e)),
    });
    const running = job.isPending ? job.variables?.op : undefined;
    const busy = job.isPending;
    const cost = `(${t('creditCost', { count: AGENT_ASSIST_CREDIT_COST })})`;

    const suggestions = analysis?.suggestions ?? [];
    const hasPrompt = prompt.trim().length > 0;

    const applyProposal = () => {
        if (!proposal) return;
        onApply(toUpdate(proposal));
        setAnalysis(proposal);
        setProposal(null);
        setNotes('');
        setFeedback('');
        setFeedbackOpen(false);
        toast.success(t('toasts.applied'));
    };

    const proposalOpening = proposal
        ? proposal.opening_line ?? proposal.derived?.opening_line
        : undefined;

    return (
        <div className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-body font-semibold text-neutral-600">
                    <Sparkle className="size-4 text-primary-500" />
                    {t('header.title')}
                </p>
                {analysis && (
                    <span className="text-caption text-neutral-500">
                        {analysis.persona
                            ? t('header.detected', { persona: analysis.persona })
                            : ''}
                    </span>
                )}
            </div>

            {busy && (
                <p className="text-caption text-neutral-500">
                    {t('progress.working', { seconds: elapsed })}
                </p>
            )}

            {/* ── Proposal: one preview for every rewrite, applied as a set ── */}
            {proposal && (
                <div className="space-y-2 rounded-md border border-primary-200 bg-primary-50 p-2">
                    <p className="text-caption font-medium text-neutral-700">
                        {t('proposal.title', { score: proposal.score })}
                    </p>
                    {proposal.change_summary && (
                        <p className="whitespace-pre-line text-caption text-neutral-600">
                            {proposal.change_summary}
                        </p>
                    )}
                    {(proposal.call_insights ?? []).map((ci, i) => (
                        <p key={i} className="text-caption text-neutral-500">
                            • {ci}
                        </p>
                    ))}

                    <div className="space-y-1.5 rounded-md border border-neutral-200 bg-white p-2">
                        <p className="text-caption font-medium text-neutral-600">
                            {t('proposal.willUpdate')}
                        </p>
                        {proposalOpening && (
                            <div>
                                <p className="text-caption text-neutral-500">
                                    {t('proposal.openingLine')}
                                    {proposalOpening.trim() === (fields.openingLine ?? '').trim()
                                        ? ` · ${t('proposal.unchanged')}`
                                        : ''}
                                </p>
                                <p className="text-body text-neutral-700">{proposalOpening}</p>
                            </div>
                        )}
                        {!!proposal.derived?.extraction_questions?.length && (
                            <div>
                                <p className="text-caption text-neutral-500">
                                    {t('proposal.questions')}
                                    {sameList(
                                        proposal.derived.extraction_questions,
                                        fields.extractionQuestions
                                    )
                                        ? ` · ${t('proposal.unchanged')}`
                                        : ''}
                                </p>
                                <p className="text-caption text-neutral-700">
                                    {proposal.derived.extraction_questions.join(' · ')}
                                </p>
                            </div>
                        )}
                        {!!proposal.derived?.dispositions?.length && (
                            <div>
                                <p className="text-caption text-neutral-500">
                                    {t('proposal.outcomes')}
                                    {sameList(proposal.derived.dispositions, fields.dispositions)
                                        ? ` · ${t('proposal.unchanged')}`
                                        : ''}
                                </p>
                                <p className="text-caption text-neutral-700">
                                    {proposal.derived.dispositions.join(' · ')}
                                </p>
                            </div>
                        )}
                        {proposal.prompt && (
                            <div>
                                <button
                                    type="button"
                                    className="flex items-center gap-1 text-caption text-neutral-500 hover:text-primary-600"
                                    onClick={() => setShowFullPrompt((v) => !v)}
                                >
                                    {t('proposal.prompt', {
                                        before: prompt.length.toLocaleString(),
                                        after: proposal.prompt.length.toLocaleString(),
                                    })}
                                    {showFullPrompt ? (
                                        <CaretUp className="size-3" />
                                    ) : (
                                        <CaretDown className="size-3" />
                                    )}
                                </button>
                                {showFullPrompt && (
                                    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-50 p-2 text-caption text-neutral-700">
                                        {proposal.prompt}
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>

                    <LintList items={proposal.lint} />

                    <div className="flex gap-2">
                        <MyButton buttonType="primary" scale="small" onClick={applyProposal}>
                            {t('proposal.applyAll')}
                        </MyButton>
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setProposal(null)}
                        >
                            {t('proposal.discard')}
                        </MyButton>
                    </div>
                </div>
            )}

            {/* Draft-from-brief (empty prompt) or Review (existing prompt) */}
            {!proposal &&
                (!hasPrompt ? (
                    <div className="space-y-1.5">
                        <Label>{t('brief.label')}</Label>
                        <Textarea
                            rows={3}
                            value={brief}
                            onChange={(e) => setBrief(e.target.value)}
                            placeholder={t('brief.placeholder')}
                        />
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            disable={busy || brief.trim().length < 10}
                            onClick={() => job.mutate({ op: 'draft', extra: { brief } })}
                        >
                            {running === 'draft'
                                ? t('brief.drafting')
                                : `${t('brief.action')} ${cost}`}
                        </MyButton>
                    </div>
                ) : (
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={busy}
                        onClick={() => job.mutate({ op: 'analyze', extra: {} })}
                    >
                        {running === 'analyze'
                            ? t('review.reviewing')
                            : `${t('review.action')} ${cost}`}
                    </MyButton>
                ))}

            {/* Score + dimensions */}
            {analysis && !proposal && (
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <span className={cn('text-h3 font-bold', scoreTone(analysis.score))}>
                            {analysis.score}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-lg bg-neutral-200">
                            <div
                                className={cn('h-full rounded-lg', scoreBarTone(analysis.score))}
                                // inline style: genuinely dynamic value (score %), not a token
                                style={{ width: `${Math.min(100, Math.max(2, analysis.score))}%` }}
                            />
                        </div>
                        <button
                            type="button"
                            className="flex items-center gap-1 text-caption text-neutral-500 hover:text-primary-600"
                            onClick={() => setShowDims((v) => !v)}
                        >
                            {t('details.toggle')}{' '}
                            {showDims ? (
                                <CaretUp className="size-3" />
                            ) : (
                                <CaretDown className="size-3" />
                            )}
                        </button>
                    </div>
                    {showDims && (
                        <div className="space-y-1">
                            {(analysis.dimensions ?? []).map((d) => (
                                <div key={d.key} className="flex items-start gap-2 text-caption">
                                    <span
                                        className={cn(
                                            'w-8 shrink-0 font-semibold',
                                            d.score >= 8
                                                ? 'text-success-600'
                                                : d.score >= 5
                                                  ? 'text-warning-600'
                                                  : 'text-danger-600'
                                        )}
                                    >
                                        {t('details.dimensionScore', { score: d.score })}
                                    </span>
                                    <span className="font-medium text-neutral-600">{d.label}:</span>
                                    <span className="text-neutral-500">{d.comment}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    <LintList items={analysis.lint} />

                    {/* Suggestions — pick and apply */}
                    {suggestions.length > 0 && (
                        <div className="space-y-1.5">
                            <Label>{t('suggestions.label')}</Label>
                            {suggestions.map((sg, i) => (
                                <label
                                    key={i}
                                    className="flex cursor-pointer items-start gap-2 rounded-md border border-neutral-200 bg-white p-2"
                                >
                                    <Checkbox
                                        checked={picked.has(i)}
                                        onCheckedChange={(c) =>
                                            setPicked((prev) => {
                                                const next = new Set(prev);
                                                if (c === true) next.add(i);
                                                else next.delete(i);
                                                return next;
                                            })
                                        }
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-body font-medium text-neutral-700">
                                            {sg.title}
                                        </span>
                                        {sg.detail && (
                                            <span className="block text-caption text-neutral-500">
                                                {sg.detail}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            ))}
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                disable={busy || picked.size === 0}
                                onClick={() =>
                                    job.mutate({
                                        op: 'improve',
                                        extra: {
                                            additions: Array.from(picked).map(
                                                (i) => suggestions[i]!.addition
                                            ),
                                        },
                                    })
                                }
                            >
                                {running === 'improve'
                                    ? t('suggestions.applying')
                                    : `${t('suggestions.applySelected', { count: picked.size })} ${cost}`}
                            </MyButton>
                        </div>
                    )}

                    {/* Derived side-fields (review only — rewrites apply them with the prompt) */}
                    {analysis.derived && !analysis.prompt && (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-caption text-neutral-500">
                                {t('derived.label')}
                            </span>
                            <MyButton
                                buttonType="text"
                                scale="small"
                                onClick={() => {
                                    onApply(toUpdate({ ...analysis, prompt: undefined }));
                                    toast.success(t('toasts.derivedApplied'));
                                }}
                            >
                                <CheckCircle className="mr-1 size-3.5" />
                                {t('derived.useButton')}
                            </MyButton>
                        </div>
                    )}
                </div>
            )}

            {/* Regenerate from the admin's own notes */}
            {hasPrompt && !proposal && (
                <div className="space-y-1.5 border-t border-neutral-200 pt-2">
                    <Label>{t('regenerate.label')}</Label>
                    <Textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={t('regenerate.placeholder')}
                    />
                    <p className="text-caption text-neutral-500">{t('regenerate.hint')}</p>
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        disable={busy || notes.trim().length < 5}
                        onClick={() => job.mutate({ op: 'regenerate', extra: { notes } })}
                    >
                        {running === 'regenerate'
                            ? t('regenerate.running')
                            : `${t('regenerate.action')} ${cost}`}
                    </MyButton>
                </div>
            )}

            {/* Post-call feedback loop (saved agents only) */}
            {agentId && hasPrompt && !proposal && (
                <div className="space-y-1.5 border-t border-neutral-200 pt-2">
                    <button
                        type="button"
                        className="flex items-center gap-1 text-caption font-medium text-neutral-600 hover:text-primary-600"
                        onClick={() => setFeedbackOpen((v) => !v)}
                    >
                        {t('feedback.toggle')}{' '}
                        {feedbackOpen ? (
                            <CaretUp className="size-3" />
                        ) : (
                            <CaretDown className="size-3" />
                        )}
                    </button>
                    {feedbackOpen && (
                        <div className="space-y-1.5">
                            <Textarea
                                rows={3}
                                value={feedback}
                                onChange={(e) => setFeedback(e.target.value)}
                                placeholder={t('feedback.placeholder')}
                            />
                            <p className="text-caption text-neutral-500">{t('feedback.hint')}</p>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                disable={busy || feedback.trim().length < 5}
                                onClick={() => job.mutate({ op: 'feedback', extra: { feedback } })}
                            >
                                {running === 'feedback'
                                    ? t('feedback.revising')
                                    : `${t('feedback.action')} ${cost}`}
                            </MyButton>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
