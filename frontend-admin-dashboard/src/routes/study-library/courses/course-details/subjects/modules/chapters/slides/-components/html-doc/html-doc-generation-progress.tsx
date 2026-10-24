import { useEffect, useState } from 'react';
import { CheckCircle, Circle, Spinner, X } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import type { HtmlDocJobPhase } from './html-doc-ai-service';

export type GenerationProgress = {
    phase: HtmlDocJobPhase;
    hasPdf?: boolean;
    /** Heading of the section being written now (parallel: those still in flight). */
    section?: string;
    /** Parallel mode — all sections are written at the same time. */
    sectionsTotal?: number;
    sectionsDone?: number;
    contentChars?: number;
    /** Rough final size — the current page's length on an edit. */
    expectedChars?: number;
    imagesDone?: number;
    imagesTotal?: number;
    /** Server-measured time since the generation started. */
    elapsedSeconds: number;
};

// A full created page is ~30k characters of HTML; used only to move the bar.
const TYPICAL_PAGE_CHARS = 30000;
const ORDER: HtmlDocJobPhase[] = ['reading_pdf', 'planning', 'writing', 'images'];

function formatElapsed(total: number) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Rough completion so the bar keeps moving; never claims 100% before done. */
function percentOf(p: GenerationProgress) {
    if (p.phase === 'reading_pdf') return 4;
    if (p.phase === 'planning') return 8;
    if (p.phase === 'writing' && p.sectionsTotal) {
        return 10 + ((p.sectionsDone || 0) / p.sectionsTotal) * 75;
    }
    if (p.phase === 'writing') {
        const expected = p.expectedChars || TYPICAL_PAGE_CHARS;
        return 10 + Math.min(1, (p.contentChars || 0) / expected) * 75;
    }
    const total = p.imagesTotal || 0;
    return 85 + (total ? ((p.imagesDone || 0) / total) * 13 : 0);
}

type Props = {
    progress: GenerationProgress | null;
    /** True when the server runs the job — the author may leave the page. */
    canLeave: boolean;
    onCancel: () => void;
};

/**
 * Step-by-step status for an HTML page generation (which takes minutes, so a
 * lone spinner reads as "stuck"): which phase is running, the section being
 * written, pictures drawn so far, elapsed time and a rough progress bar.
 */
export function HtmlDocGenerationProgress({ progress, canLeave, onCancel }: Props) {
    const { t } = useTranslation('studyLibraryHtmlDocAiAuthor');
    const p = progress ?? { phase: 'planning' as const, elapsedSeconds: 0 };

    // Tick locally between polls so the clock runs smoothly.
    const [base, setBase] = useState({ server: p.elapsedSeconds, at: Date.now() });
    const [, setTick] = useState(0);
    useEffect(() => {
        setBase({ server: p.elapsedSeconds, at: Date.now() });
    }, [p.elapsedSeconds]);
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, []);
    const elapsed = base.server + Math.floor((Date.now() - base.at) / 1000);

    const steps: { key: HtmlDocJobPhase; label: string }[] = [
        ...(p.hasPdf || p.phase === 'reading_pdf'
            ? [{ key: 'reading_pdf' as const, label: t('progress.readingPdf') }]
            : []),
        { key: 'planning', label: t('progress.planning') },
        {
            key: 'writing',
            label:
                p.phase === 'writing' && p.sectionsTotal
                    ? t('progress.writingParallel', {
                          done: p.sectionsDone ?? 0,
                          total: p.sectionsTotal,
                      })
                    : p.phase === 'writing' && p.section
                      ? t('progress.writingSection', { section: p.section })
                      : t('progress.writing'),
        },
        {
            key: 'images',
            label:
                p.phase === 'images' && p.imagesTotal
                    ? t('progress.illustrationsCount', {
                          completed: p.imagesDone ?? 0,
                          total: p.imagesTotal,
                      })
                    : t('progress.illustrations'),
        },
    ];
    const current = ORDER.indexOf(p.phase);
    const percent = Math.round(percentOf(p));

    return (
        <div className="border-b border-primary-100 bg-primary-50 p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-caption font-medium text-primary-500">
                    <Spinner className="size-4 animate-spin" />
                    {t('buildingYourPage')}
                    <span className="font-normal tabular-nums text-neutral-500">
                        {formatElapsed(elapsed)}
                    </span>
                </span>
                <MyButton buttonType="secondary" scale="small" onClick={onCancel}>
                    <X className="size-4" /> {t('cancel')}
                </MyButton>
            </div>

            <div
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-primary-100"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                {/* Width is a live, computed percentage — the one dynamic value here. */}
                <div
                    className="h-full rounded-full bg-primary-400 transition-all duration-700"
                    style={{ width: `${percent}%` }}
                />
            </div>

            <ol className="mt-3 flex flex-col gap-1.5">
                {steps.map((step) => {
                    const idx = ORDER.indexOf(step.key);
                    const state = idx < current ? 'done' : idx === current ? 'active' : 'todo';
                    return (
                        <li
                            key={step.key}
                            className={cn(
                                'flex items-center gap-2 text-caption',
                                state === 'active' && 'font-medium text-primary-500',
                                state === 'done' && 'text-neutral-600',
                                state === 'todo' && 'text-neutral-400'
                            )}
                        >
                            {state === 'done' ? (
                                <CheckCircle weight="fill" className="size-4 text-success-500" />
                            ) : state === 'active' ? (
                                <Spinner className="size-4 animate-spin" />
                            ) : (
                                <Circle className="size-4" />
                            )}
                            <span className="truncate">{step.label}</span>
                            {state === 'active' &&
                                step.key === 'writing' &&
                                !!p.sectionsTotal &&
                                !!p.section && (
                                    <span className="truncate font-normal text-neutral-500">
                                        · {p.section}
                                    </span>
                                )}
                        </li>
                    );
                })}
            </ol>

            <p className="mt-3 text-caption text-neutral-500">
                {canLeave ? t('progress.canLeaveHint') : t('progress.stayHint')}
            </p>
        </div>
    );
}
