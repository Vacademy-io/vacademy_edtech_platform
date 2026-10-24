import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Play, Sparkle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import { stem, type Library, type LibraryVideo, type SearchResult } from './search';
import { sectionIcon } from './meta';
import { trainingLocal, useThumbOnVisible, useTrainingLocalVersion } from './useTrainingLocal';

export const formatDuration = (s?: number) =>
    s && isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '';

/** "1 h 12 min" / "48 min" — only when every video's length is known. */
export function totalDuration(videos: LibraryVideo[]): string {
    const ds = videos.map((v) => trainingLocal.duration(v.id));
    if (!ds.length || ds.some((d) => !d)) return '';
    const m = Math.round(ds.reduce<number>((a, d) => a + (d || 0), 0) / 60);
    return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Wraps words whose stem matched the search in <mark>. */
export function Highlight({ text, marks }: { text: string; marks?: Set<string> }) {
    if (!marks?.size) return <>{text}</>;
    return (
        <>
            {text.split(/([A-Za-z0-9]+)/).map((part, i) =>
                i % 2 && marks.has(stem(part)) ? (
                    <mark key={i} className="rounded-sm bg-warning-100 px-px text-inherit">
                        {part}
                    </mark>
                ) : (
                    part
                )
            )}
        </>
    );
}

const hasHit = (text: string, marks: Set<string>) =>
    (text.match(/[A-Za-z0-9]+/g) || []).some((w) => marks.has(stem(w)));

export function TopicChips({
    topics,
    marks,
    max,
}: {
    topics: string[];
    marks?: Set<string>;
    max: number;
}) {
    const { t } = useTranslation('trainingViewer');
    if (!topics.length) return null;
    const list = topics.map((topic) => ({ topic, hit: marks ? hasHit(topic, marks) : false }));
    const ordered = marks ? [...list.filter((c) => c.hit), ...list.filter((c) => !c.hit)] : list;
    const shown = ordered.slice(0, max);
    const more = ordered.length - shown.length;
    return (
        <span className="flex flex-wrap gap-1.5 text-caption">
            {shown.map((c) => (
                <span
                    key={c.topic}
                    title={c.topic}
                    className={cn(
                        'max-w-full truncate rounded-full px-2.5 py-0.5',
                        c.hit
                            ? 'bg-primary-50 text-primary-600 ring-1 ring-inset ring-primary-200'
                            : 'bg-muted text-neutral-600'
                    )}
                >
                    <Highlight text={c.topic} marks={marks} />
                </span>
            ))}
            {more > 0 ? (
                <span className="py-0.5 text-caption text-neutral-400">
                    {t('moreCount', { count: more })}
                </span>
            ) : null}
        </span>
    );
}

/** Small tinted icon square used for sections in the sidebar, headers and playlist. */
export function SectionTile({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
    const Icon = sectionIcon(name);
    return (
        <span
            className={cn(
                'flex shrink-0 items-center justify-center border border-primary-100 bg-primary-50 text-primary-600',
                size === 'sm' && 'size-6 rounded-sm',
                size === 'md' && 'size-9 rounded-md',
                size === 'lg' && 'size-14 rounded-lg'
            )}
        >
            <Icon size={size === 'lg' ? 26 : size === 'sm' ? 13 : 18} />
        </span>
    );
}

/** 16:9 thumbnail: cached frame (or section icon), step badge, duration, watched state, progress. */
export function VideoThumb({
    video,
    sectionName,
    step,
    className,
}: {
    video: LibraryVideo;
    sectionName: string;
    step?: number | null;
    className?: string;
}) {
    const { t } = useTranslation('trainingViewer');
    const ref = useRef<HTMLSpanElement>(null);
    useTrainingLocalVersion();
    useThumbOnVisible(ref, video.id, video.fileUrl);
    const src = trainingLocal.thumb(video.id);
    const done = trainingLocal.isDone(video.id);
    const fraction = trainingLocal.fraction(video.id);
    const duration = formatDuration(trainingLocal.duration(video.id));
    const Icon = sectionIcon(sectionName);
    return (
        <span
            ref={ref}
            className={cn(
                'relative block aspect-video w-full shrink-0 overflow-hidden bg-primary-50',
                className
            )}
        >
            {src ? (
                <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
            ) : (
                <span className="absolute inset-0 flex items-center justify-center text-primary-300">
                    <Icon size={36} />
                </span>
            )}
            {step != null ? (
                <span className="absolute left-2 top-2 rounded-full bg-neutral-900/80 px-2 py-0.5 text-caption font-semibold text-white">
                    {t('stepBadge', { step })}
                </span>
            ) : null}
            {done ? (
                <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-success-600 px-2 py-0.5 text-caption font-semibold text-white">
                    <Check size={12} weight="bold" /> {t('watched')}
                </span>
            ) : null}
            {duration ? (
                <span className="absolute bottom-2 right-2 rounded-sm bg-neutral-900/80 px-1.5 text-caption font-semibold tabular-nums text-white">
                    {duration}
                </span>
            ) : null}
            <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <span className="flex size-11 items-center justify-center rounded-full bg-white/95 text-primary-500 shadow-md">
                    <Play size={18} weight="fill" />
                </span>
            </span>
            {fraction > 0.02 && !done ? (
                <Progress
                    value={fraction * 100}
                    className="absolute inset-x-0 bottom-0 h-1 rounded-none !bg-white/60"
                />
            ) : null}
        </span>
    );
}

/** "Live Sessions · Step 3 of 10 · Watched · Also in Reports" */
export function VideoMeta({
    library,
    video,
    sectionKey,
    step,
    hideSection,
}: {
    library: Library;
    video: LibraryVideo;
    sectionKey: string;
    step: number | null;
    hideSection?: boolean;
}) {
    const { t } = useTranslation('trainingViewer');
    useTrainingLocalVersion();
    const section = library.sections.get(sectionKey);
    const total = section ? section.items.filter((i) => i.step != null).length : 0;
    const also = video.placements
        .map((p) => library.sections.get(p.root + '|' + p.section))
        .filter((s): s is NonNullable<typeof s> => !!s && s.key !== sectionKey)
        .map((s) => s.name);
    const done = trainingLocal.isDone(video.id);
    const fraction = trainingLocal.fraction(video.id);
    const parts = [
        !hideSection && section ? (
            <span
                key="s"
                className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-0.5 pl-1.5 pr-2 font-semibold text-primary-600"
            >
                <SectionTile name={section.name} size="sm" />
                {section.name}
            </span>
        ) : null,
        !hideSection && step != null ? <span key="st">{t('stepOf', { step, total })}</span> : null,
        done ? (
            <span key="d" className="inline-flex items-center gap-1 font-semibold text-success-600">
                <Check size={12} weight="bold" /> {t('watched')}
            </span>
        ) : fraction > 0.02 ? (
            <span key="p" className="font-semibold text-primary-600">
                {t('percentWatched', { percent: Math.round(fraction * 100) })}
            </span>
        ) : null,
        also.length ? <span key="a">{t('alsoIn', { sections: also.join(', ') })}</span> : null,
    ].filter(Boolean);
    if (!parts.length) return null;
    return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-neutral-500">
            {parts.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                    {i ? <span className="text-neutral-300">·</span> : null}
                    {p}
                </span>
            ))}
        </span>
    );
}

function surfaceWord(video: LibraryVideo, st: string): string {
    for (const text of [
        video.title,
        ...video.keywords,
        ...video.topics,
        video.originalTitle,
        ...video.originalTopics,
    ])
        for (const w of text.match(/[A-Za-z0-9]+/g) || []) if (stem(w) === st) return w;
    return st;
}

/** "Matched payment for “fees kaise le” in topics, Course in title" — why this result showed up. */
export function WhyLine({ result }: { result: SearchResult }) {
    const { t } = useTranslation('trainingViewer');
    if (!result.why.length) return null;
    return (
        <span className="flex items-start gap-1.5 text-caption text-neutral-500">
            <Sparkle size={13} weight="fill" className="mt-0.5 shrink-0 text-primary-400" />
            <span>
                {t('matched')}{' '}
                {result.why.slice(0, 3).map((w, i) => {
                    const own = new Set(
                        [...w.concept.display.split(/\s+/), ...w.concept.user].map((x) =>
                            stem(x.toLowerCase())
                        )
                    );
                    return (
                        <span key={i}>
                            {i ? ', ' : ''}
                            <span className="font-semibold text-neutral-700">
                                {surfaceWord(result.video, w.stem)}
                            </span>
                            {own.has(w.stem) ? null : (
                                <span className="text-primary-600">
                                    {' '}
                                    {t('matchedFor', { typed: w.concept.display })}
                                </span>
                            )}{' '}
                            {t('matchedIn', { field: t(`fields.${w.field}`) })}
                        </span>
                    );
                })}
            </span>
        </span>
    );
}
