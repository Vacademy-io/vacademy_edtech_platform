import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle, Spinner, WarningCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { COMPANION_KEYS } from '../../-hooks/companion';
import { companionErrorMessage, openLesson, pollLesson } from '../../-services/companion-service';
import type { LessonCard, LessonResponse } from '../../-types/companion';

const POLL_MS = 3000;
const DEFAULT_FRAME_H = 520;

/**
 * Appended to each card document so the (cross-origin, sandboxed) frame can
 * tell us its height. The shell's CSP allows inline scripts; the frame still
 * has no same-origin access, so this is the only channel.
 */
const HEIGHT_REPORTER =
    '<script>(function(){function s(){try{parent.postMessage({kbcHeight:document.documentElement.scrollHeight},"*")}catch(e){}}' +
    'window.addEventListener("load",s);if(window.ResizeObserver){new ResizeObserver(s).observe(document.documentElement)}setTimeout(s,60);setTimeout(s,800)})();</script>';

const withHeightReporter = (doc: string) =>
    doc.includes('</body>')
        ? doc.replace('</body>', `${HEIGHT_REPORTER}</body>`)
        : doc + HEIGHT_REPORTER;

function CardFrame({ doc, title }: { doc: string; title: string }) {
    const ref = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(DEFAULT_FRAME_H);

    useEffect(() => {
        const onMessage = (e: MessageEvent) => {
            if (!ref.current || e.source !== ref.current.contentWindow) return;
            const h = Number((e.data as { kbcHeight?: unknown })?.kbcHeight);
            if (Number.isFinite(h) && h > 0) setHeight(Math.min(1600, Math.max(120, Math.ceil(h))));
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    return (
        <iframe
            ref={ref}
            title={title}
            sandbox="allow-scripts"
            srcDoc={withHeightReporter(doc)}
            className="w-full rounded-md border border-neutral-200 bg-white"
            // Height comes from the frame's own content at runtime.
            style={{ height }}
        />
    );
}

function CheckCard({ card }: { card: LessonCard }) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const check = card.check;
    if (!check) return null;
    return (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-4">
            <p className="text-body font-medium text-neutral-700">{check.question}</p>
            <div className="flex flex-col gap-1.5">
                {check.options.map((opt, i) => (
                    <div
                        key={i}
                        className={cn(
                            'flex items-start gap-2 rounded-md border px-3 py-2 text-body',
                            i === check.answer_index
                                ? 'border-success-300 bg-success-50 text-success-700'
                                : 'border-neutral-200 text-neutral-600'
                        )}
                    >
                        <span className="font-semibold">{String.fromCharCode(65 + i)}.</span>
                        <span className="min-w-0 flex-1">{opt}</span>
                        {i === check.answer_index && (
                            <CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0" />
                        )}
                    </div>
                ))}
            </div>
            {check.explanation && (
                <p className="text-caption text-neutral-500">
                    <span className="font-semibold">{t('preview.explanation')}</span>{' '}
                    {check.explanation}
                </p>
            )}
        </div>
    );
}

function PreviewCard({ card, index }: { card: LessonCard; index: number }) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const ready = card.status === 'ready';
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <p className="text-body font-semibold text-neutral-700">
                    {t('preview.cardTitle', { n: index + 1, title: card.title || card.kind })}
                </p>
                <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-caption text-neutral-500">
                    {card.kind}
                </span>
            </div>
            {card.check ? (
                <CheckCard card={card} />
            ) : ready && card.html_doc ? (
                <CardFrame doc={card.html_doc} title={card.title || card.kind} />
            ) : (
                <div className="flex h-32 items-center justify-center gap-2 rounded-md border border-dashed border-neutral-300 text-caption text-neutral-500">
                    <Spinner className="size-4 animate-spin" />
                    {t('preview.cardPending')}
                </div>
            )}
            {card.say && ready && (
                <p className="text-caption italic text-neutral-500">
                    {t('preview.narration', { text: card.say })}
                </p>
            )}
            {card.citation && (
                <p className="flex items-center gap-1 text-caption text-neutral-500">
                    <BookOpen className="size-3.5" />
                    {card.citation}
                </p>
            )}
        </div>
    );
}

export function LessonPreviewDialog({
    companionId,
    leaf,
    prepared,
    onOpenChange,
}: {
    companionId: string;
    /** The topic leaf to preview; null = closed. */
    leaf: { id: string; title: string } | null;
    /** READY or GENERATING already — previewing costs nothing. */
    prepared: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useTranslation('knowledgeBaseCompanions');
    const qc = useQueryClient();
    const open = Boolean(leaf);
    const [lesson, setLesson] = useState<LessonResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [loading, setLoading] = useState(false);

    const leafId = leaf?.id ?? null;
    const load = useCallback(
        async (start: boolean) => {
            if (!leafId) return;
            setLoading(true);
            setError(null);
            try {
                const res = start
                    ? await openLesson(companionId, leafId)
                    : await pollLesson(companionId, leafId);
                setLesson(res);
                if (start) qc.invalidateQueries({ queryKey: COMPANION_KEYS.one(companionId) });
            } catch (e) {
                setError(companionErrorMessage(e) ?? t('preview.loadFailed'));
            } finally {
                setLoading(false);
            }
        },
        [companionId, leafId, qc, t]
    );

    useEffect(() => {
        if (!leafId) return;
        setLesson(null);
        setError(null);
        setConfirming(!prepared);
        if (prepared) void load(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [leafId]);

    // Cards land one by one while the lesson compiles; keep polling until done.
    useEffect(() => {
        if (!open || lesson?.status !== 'GENERATING') return;
        const timer = window.setTimeout(() => void load(false), POLL_MS);
        return () => window.clearTimeout(timer);
    }, [open, lesson, load]);

    const close = (next: boolean) => {
        if (!next) qc.invalidateQueries({ queryKey: COMPANION_KEYS.one(companionId) });
        onOpenChange(next);
    };

    const readyCount = lesson?.cards.filter((c) => c.status === 'ready').length ?? 0;
    const planned = lesson?.cards_planned || lesson?.cards.length || 0;

    return (
        <MyDialog
            heading={t('preview.heading', { title: leaf?.title ?? '' })}
            open={open}
            onOpenChange={close}
            dialogWidth="max-w-3xl"
            footer={
                confirming ? (
                    <div className="flex w-full justify-end gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => close(false)}
                        >
                            {t('actions.cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => {
                                setConfirming(false);
                                void load(true);
                            }}
                        >
                            {t('preview.prepareAndPreview')}
                        </MyButton>
                    </div>
                ) : undefined
            }
        >
            <div className="flex flex-col gap-4">
                {confirming && (
                    <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3">
                        <WarningCircle className="mt-0.5 size-4 shrink-0 text-warning-600" />
                        <p className="text-body text-warning-700">{t('preview.willPrepare')}</p>
                    </div>
                )}

                {!confirming && (
                    <p className="text-caption text-neutral-500">{t('preview.intro')}</p>
                )}

                {!confirming && loading && !lesson && (
                    <Skeleton className="h-64 w-full rounded-md" />
                )}

                {error && (
                    <div className="flex flex-col items-start gap-2">
                        <p className="flex items-center gap-1.5 text-body text-danger-600">
                            <WarningCircle className="size-4" />
                            {error}
                        </p>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => void load(false)}
                        >
                            {t('actions.tryAgain')}
                        </MyButton>
                    </div>
                )}

                {lesson?.status === 'MISSING' && (
                    <div className="flex flex-col items-start gap-2">
                        <p className="text-body text-neutral-600">{t('preview.missing')}</p>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => void load(true)}
                        >
                            {t('preview.prepareAndPreview')}
                        </MyButton>
                    </div>
                )}

                {lesson?.status === 'FAILED' && (
                    <div className="flex flex-col items-start gap-2">
                        <p className="flex items-center gap-1.5 text-body text-danger-600">
                            <WarningCircle className="size-4" />
                            {lesson.error || t('preview.failed')}
                        </p>
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => void load(true)}
                        >
                            {t('preview.retry')}
                        </MyButton>
                    </div>
                )}

                {lesson?.status === 'GENERATING' && (
                    <p className="flex items-center gap-1.5 text-body text-primary-500">
                        <Spinner className="size-4 animate-spin" />
                        {planned
                            ? t('preview.generatingProgress', { ready: readyCount, total: planned })
                            : t('preview.generating')}
                    </p>
                )}

                {lesson && lesson.cards.length > 0 && (
                    <div className="flex flex-col gap-6">
                        {lesson.cards.map((card, i) => (
                            <PreviewCard key={card.id} card={card} index={i} />
                        ))}
                    </div>
                )}
            </div>
        </MyDialog>
    );
}
