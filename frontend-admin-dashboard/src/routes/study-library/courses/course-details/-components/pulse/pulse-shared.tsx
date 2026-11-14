import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ClipboardText,
    Code,
    FileText,
    ListChecks,
    PencilLine,
    Question,
    SpeakerHigh,
    VideoCamera,
    type Icon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export const SLIDE_ICON: Record<string, Icon> = {
    DOCUMENT: FileText,
    PDF: FileText,
    DOC: FileText,
    VIDEO: VideoCamera,
    HTML_VIDEO: VideoCamera,
    AUDIO: SpeakerHigh,
    QUESTION: Question,
    QUIZ: ListChecks,
    ASSESSMENT: ClipboardText,
    ASSIGNMENT: PencilLine,
    CODE: Code,
};

export function slideIconFor(slideType: string): Icon {
    return SLIDE_ICON[slideType] ?? FileText;
}

/** "1h 4m" / "6m 05s" / "42s" */
export function formatDuration(totalSeconds: number): string {
    const s = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`;
    return `${sec}s`;
}

/** Initials for an avatar bubble. */
export function initialsOf(name: string | null): string {
    return (name ?? '?')
        .split(' ')
        .map((w) => w[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase();
}

/** Single shared 1s ticker so live durations count up between polls (delta only, no client clock). */
export function useSecondsTicker(): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, []);
    return now;
}

export function LiveStatusLine({
    secondsSinceFetch,
    isFetching,
}: {
    secondsSinceFetch: number;
    isFetching: boolean;
}) {
    const { t } = useTranslation('studyLibraryPulseShared');
    return (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary-500" />
            </span>
            {isFetching ? t('liveRefreshing') : t('liveUpdatedAgo', { count: secondsSinceFetch })}
        </div>
    );
}

export function KpiCard({
    label,
    value,
    hint,
    tone,
}: {
    label: string;
    value: number;
    hint: string;
    tone: string;
}) {
    return (
        <div className="relative overflow-hidden rounded-md border border-neutral-200 bg-white py-2 pl-3 pr-2.5 shadow-sm">
            <span className={cn('absolute inset-y-0 left-0 w-1', tone)} />
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    {label}
                </p>
                <p className="text-xl font-semibold leading-none tabular-nums text-neutral-700">
                    {value}
                </p>
            </div>
            <p className="mt-0.5 truncate text-xs text-neutral-400">{hint}</p>
        </div>
    );
}

/** Shared empty/error/loading blocks so every view is consistent. */
export function PulseMessage({
    tone = 'neutral',
    title,
    subtitle,
    action,
}: {
    tone?: 'neutral' | 'danger';
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <p
                className={cn(
                    'text-sm font-medium',
                    tone === 'danger' ? 'text-danger-600' : 'text-neutral-500'
                )}
            >
                {title}
            </p>
            {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
            {action}
        </div>
    );
}
