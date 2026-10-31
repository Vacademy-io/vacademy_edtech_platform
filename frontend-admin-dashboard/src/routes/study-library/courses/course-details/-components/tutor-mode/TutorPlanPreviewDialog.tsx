import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { CircleNotch, Play } from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { getTutorSlidePlan, type TutorConceptView, type TutorPlanView } from '@/services/tutor';
import { animateBoard } from '@/components/common/tutor/animateBoard';
import '@/styles/tutor-board.css';

/**
 * One stored board with a Play button that animates it the way the learner
 * sees it (elements write in, diagrams draw on, stepped parts appear in
 * order). `ops` is the topic's cumulative ops up to this concept.
 */
const AnimatedBoard: React.FC<{
    html: string;
    ops: Array<Record<string, unknown>>;
    autoPlay?: boolean;
}> = ({ html, ops, autoPlay }) => {
    const { t } = useTranslation('studyLibraryTutorPlanPreviewDialog');
    const ref = useRef<HTMLDivElement>(null);
    const timers = useRef<number[]>([]);
    const play = () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        if (ref.current)
            timers.current = animateBoard(
                ref.current,
                ops as Array<{ op?: unknown; parts?: Array<{ id?: unknown; step?: unknown }> }>
            );
    };
    useEffect(() => {
        // The stored board HTML carries formulas as raw LaTeX in
        // `.tb-latex[data-latex]` (the server cannot typeset). The learner's
        // board typesets them with KaTeX; the preview must do the same, or an
        // admin reviewing a maths plan sees \vec{a} instead of the formula.
        ref.current?.querySelectorAll<HTMLElement>('.tb-latex:not([data-typeset])').forEach((el) => {
            const latex = el.dataset.latex || el.textContent || '';
            el.dataset.typeset = '1';
            try {
                katex.render(latex, el, { throwOnError: false, displayMode: true, output: 'html' });
            } catch {
                /* leave the raw source visible */
            }
        });
        if (autoPlay) play();
        return () => timers.current.forEach((t) => window.clearTimeout(t));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [html]);
    return (
        <div className="relative">
            <div
                ref={ref}
                className="tutor-board-preview max-w-none"
                dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true } }),
                }}
            />
            <button
                type="button"
                title={t('playTitle')}
                onClick={play}
                className="absolute end-2 top-2 inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 shadow-sm hover:bg-neutral-50"
            >
                <Play className="size-3" weight="fill" /> {t('play')}
            </button>
        </div>
    );
};

/** The topic's ops up to and including this concept (parts carry the steps). */
const cumulativeOps = (
    concepts: TutorConceptView[],
    upTo: number
): Array<Record<string, unknown>> => concepts.slice(0, upTo + 1).flatMap((c) => c.board_ops);

interface TutorPlanPreviewDialogProps {
    slideId: string | null;
    slideTitle?: string | null;
    onClose: () => void;
}

/**
 * Read-only preview of a slide's compiled teaching plan: each topic is one
 * whiteboard, each concept shows its board (server-materialized HTML), what
 * the teacher says, and the check it asks. The HTML was sanitized when the
 * plan was stored; DOMPurify here is belt and braces.
 */
export const TutorPlanPreviewDialog: React.FC<TutorPlanPreviewDialogProps> = ({
    slideId,
    slideTitle,
    onClose,
}) => {
    const { t } = useTranslation('studyLibraryTutorPlanPreviewDialog');
    const [plan, setPlan] = useState<TutorPlanView | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!slideId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        setPlan(null);
        getTutorSlidePlan(slideId)
            .then((p) => {
                if (!cancelled) setPlan(p);
            })
            .catch((e: unknown) => {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : t('couldNotLoadPlan'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [slideId]);

    return (
        <Dialog open={!!slideId} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-screen w-full max-w-4xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                        <span>{t('teachingPlan')}</span>
                        {slideTitle && (
                            <span className="text-sm font-normal text-neutral-500">
                                {slideTitle}
                            </span>
                        )}
                        {plan && (
                            <Badge variant="outline" className="ml-auto">
                                v{plan.version} · {plan.status} · {plan.language}
                            </Badge>
                        )}
                    </DialogTitle>
                </DialogHeader>

                {loading && (
                    <div className="flex items-center gap-2 p-6 text-sm text-neutral-500">
                        <CircleNotch className="size-4 animate-spin" /> {t('loadingPlan')}
                    </div>
                )}
                {error && <p className="p-4 text-sm text-danger-600">{error}</p>}

                {plan && (
                    <div className="space-y-6">
                        {plan.error && (
                            <p className="rounded-md bg-danger-50 p-3 text-sm text-danger-700">
                                {plan.error}
                            </p>
                        )}
                        {plan.objectives.length > 0 && (
                            <section>
                                <h4 className="mb-1 text-sm font-semibold text-neutral-800">
                                    {t('objectives')}
                                </h4>
                                <ul className="list-disc space-y-0.5 ps-5 text-sm text-neutral-700">
                                    {plan.objectives.map((o, i) => (
                                        <li key={i}>{o}</li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        {plan.topics.map((topic) => (
                            <section
                                key={topic.id}
                                className="rounded-lg border border-neutral-200 p-4"
                            >
                                <h4 className="mb-3 text-base font-semibold text-neutral-900">
                                    {t('boardTitle', { order: topic.order, title: topic.title })}
                                    {topic.estimated_seconds ? (
                                        <span className="ms-2 text-xs font-normal text-neutral-500">
                                            {t('estimatedMinutes', {
                                                count: Math.round(topic.estimated_seconds / 60),
                                            })}
                                        </span>
                                    ) : null}
                                </h4>
                                <div className="space-y-4">
                                    {topic.concepts.map((c, ci) => (
                                        <div
                                            key={c.id}
                                            className="grid grid-cols-1 gap-3 md:grid-cols-2"
                                        >
                                            <div className="rounded-md border border-neutral-100 bg-neutral-50 p-3">
                                                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                                                    {t('boardAfterConcept', {
                                                        order: c.order,
                                                        title: c.title,
                                                    })}
                                                </p>
                                                <AnimatedBoard
                                                    html={c.board_html}
                                                    ops={cumulativeOps(topic.concepts, ci)}
                                                    autoPlay={ci === 0}
                                                />
                                            </div>
                                            <div className="space-y-2 text-sm">
                                                <p>
                                                    <span className="font-medium text-neutral-800">
                                                        {t('teacherSays')}{' '}
                                                    </span>
                                                    <span className="text-neutral-700">
                                                        {c.say}
                                                    </span>
                                                </p>
                                                {Object.entries(c.say_i18n || {}).map(
                                                    ([lang, text]) => (
                                                        <p key={lang} className="text-neutral-500">
                                                            <span className="font-medium uppercase">
                                                                {lang}:{' '}
                                                            </span>
                                                            {text}
                                                        </p>
                                                    )
                                                )}
                                                {c.check && c.check.type !== 'none' && (
                                                    <div className="rounded-md border border-primary-100 bg-primary-50 p-2">
                                                        <p className="text-xs font-medium uppercase text-primary-700">
                                                            {t('checkLabel', {
                                                                type: String(c.check.type),
                                                            })}
                                                        </p>
                                                        <p className="text-neutral-800">
                                                            {String(c.check.prompt ?? '')}
                                                        </p>
                                                        {Array.isArray(c.check.options) &&
                                                            c.check.options.length > 0 && (
                                                                <ul className="mt-1 list-disc ps-5 text-neutral-700">
                                                                    {(
                                                                        c.check.options as string[]
                                                                    ).map((o, i) => (
                                                                        <li key={i}>{o}</li>
                                                                    ))}
                                                                </ul>
                                                            )}
                                                        {c.check.expected ? (
                                                            <p className="mt-1 text-xs text-neutral-600">
                                                                {t('expectedLabel', {
                                                                    expected: String(
                                                                        c.check.expected
                                                                    ),
                                                                })}
                                                            </p>
                                                        ) : null}
                                                    </div>
                                                )}
                                                {c.teach_notes && (
                                                    <p className="text-xs text-neutral-500">
                                                        <span className="font-medium">
                                                            {t('notesLabel')}{' '}
                                                        </span>
                                                        {c.teach_notes}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
