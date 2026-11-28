import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowRight,
    CaretLeft,
    CaretRight,
    Check,
    Play,
    SkipBack,
    SkipForward,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { CopyShareLink } from './CopyShareLink';
import type { Library, LibraryVideo, Section } from './search';
import { SectionTile, VideoMeta, formatDuration, totalDuration } from './parts';
import { trainingLocal, useTrainingLocalVersion } from './useTrainingLocal';

const UP_NEXT_SECONDS = 6;

export function TrainingPlayer({
    library,
    video,
    section,
    backLabel,
    onBack,
    onPlay,
}: {
    library: Library;
    video: LibraryVideo;
    section: Section;
    backLabel: string;
    onBack: () => void;
    /** Switch to another video of the same section (keeps the back target). */
    onPlay: (videoId: string) => void;
}) {
    const { t } = useTranslation('trainingViewer');
    useTrainingLocalVersion();
    const ref = useRef<HTMLVideoElement>(null);
    const lastSave = useRef(0);
    const listRef = useRef<HTMLOListElement>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [finished, setFinished] = useState(false);

    const idx = section.items.findIndex((i) => i.video === video);
    const current = section.items[idx];
    const prev = section.items[idx - 1];
    const next = section.items[idx + 1];
    const numbered = section.items.filter((i) => i.step != null).length;
    const done = section.items.filter((i) => trainingLocal.isDone(i.video.id)).length;

    useEffect(() => {
        setCountdown(null);
        setFinished(false);
        // Keep the playing item in view inside the playlist only — never scroll the popup itself.
        const list = listRef.current;
        const item = list?.querySelector<HTMLElement>('[data-now="true"]');
        if (list && item)
            list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2;
    }, [video.id]);

    useEffect(() => {
        if (countdown === null || !next) return;
        if (countdown <= 0) {
            onPlay(next.video.id);
            return;
        }
        const timer = window.setTimeout(() => setCountdown((c) => (c === null ? c : c - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [countdown, next, onPlay]);

    const save = (ended = false) => {
        const el = ref.current;
        if (el)
            trainingLocal.saveProgress(
                video.id,
                ended ? el.duration : el.currentTime,
                el.duration,
                ended
            );
    };

    return (
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
            <div className="flex min-w-0 flex-col xl:col-span-2">
                <MyButton
                    buttonType="text"
                    scale="medium"
                    onClick={onBack}
                    className="mb-3 self-start"
                >
                    <CaretLeft size={14} /> {backLabel}
                </MyButton>
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black shadow-md">
                    <video
                        key={video.id}
                        ref={ref}
                        src={video.fileUrl}
                        controls
                        autoPlay
                        playsInline
                        className="size-full"
                        onLoadedMetadata={(e) => {
                            const el = e.currentTarget;
                            trainingLocal.setDuration(video.id, el.duration);
                            const at = trainingLocal.resumeAt(video.id);
                            if (at) {
                                el.currentTime = at;
                                toast(t('resumedFrom', { time: formatDuration(at) }));
                            }
                        }}
                        onTimeUpdate={() => {
                            if (Date.now() - lastSave.current > 1500) {
                                lastSave.current = Date.now();
                                save();
                            }
                        }}
                        onPause={() => save()}
                        onEnded={() => {
                            save(true);
                            if (next) setCountdown(UP_NEXT_SECONDS);
                            else setFinished(true);
                        }}
                    />
                    {countdown !== null && next ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900/80 p-6 text-center text-white">
                            <span className="text-caption font-semibold uppercase tracking-wide text-neutral-300">
                                {t('upNext')}
                                {next.step != null
                                    ? ` · ${t('stepBadge', { step: next.step })}`
                                    : ''}
                            </span>
                            <span className="max-w-lg text-title font-semibold">
                                {next.video.title}
                            </span>
                            <span className="flex size-11 items-center justify-center rounded-full border-2 border-primary-300 text-title font-semibold">
                                {countdown}
                            </span>
                            <div className="flex gap-2">
                                <MyButton
                                    buttonType="primary"
                                    scale="medium"
                                    onClick={() => onPlay(next.video.id)}
                                >
                                    <Play size={14} weight="fill" /> {t('playNow')}
                                </MyButton>
                                <MyButton
                                    buttonType="secondary"
                                    scale="medium"
                                    onClick={() => setCountdown(null)}
                                >
                                    {t('cancel')}
                                </MyButton>
                            </div>
                        </div>
                    ) : null}
                    {finished ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900/80 p-6 text-center text-white">
                            <span className="text-caption font-semibold uppercase tracking-wide text-neutral-300">
                                {t('sectionComplete')}
                            </span>
                            <span className="max-w-lg text-title font-semibold">
                                {t('watchedEverything', { section: section.name })}
                            </span>
                            <MyButton buttonType="primary" scale="medium" onClick={onBack}>
                                {t('backToVideos')}
                            </MyButton>
                        </div>
                    ) : null}
                </div>

                <nav className="mt-4 flex flex-wrap items-center gap-1.5 text-body text-neutral-500">
                    <SectionTile name={section.name} size="sm" />
                    {section.root}
                    <CaretRight size={12} className="text-neutral-300" />
                    {section.name}
                    {current?.step != null ? (
                        <>
                            <CaretRight size={12} className="text-neutral-300" />
                            {t('stepOf', { step: current.step, total: numbered })}
                        </>
                    ) : null}
                </nav>
                <h3 className="mt-1.5 text-h3 font-semibold text-foreground">{video.title}</h3>
                <div className="mt-1.5">
                    <VideoMeta
                        library={library}
                        video={video}
                        sectionKey={section.key}
                        step={current?.step ?? null}
                        hideSection
                    />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    {prev ? (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => onPlay(prev.video.id)}
                        >
                            <SkipBack size={14} /> {t('previous')}
                        </MyButton>
                    ) : null}
                    {next ? (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={() => onPlay(next.video.id)}
                            className="max-w-full"
                            title={next.video.title}
                        >
                            <span className="truncate">
                                {t('nextTitle', { title: next.video.title })}
                            </span>
                            <SkipForward size={14} />
                        </MyButton>
                    ) : null}
                    <CopyShareLink video={video} />
                </div>

                {video.topics.length ? (
                    <div className="mt-6 border-t border-border pt-5">
                        <h4 className="mb-3 text-subtitle font-semibold text-foreground">
                            {t('whatYoullLearn')}
                        </h4>
                        {video.flow ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {video.topics.map((topic, i) => (
                                    <span key={topic} className="inline-flex items-center gap-1.5">
                                        {i ? (
                                            <ArrowRight size={12} className="text-neutral-300" />
                                        ) : null}
                                        <span className="rounded-full border border-border bg-card px-2.5 py-0.5 text-caption text-neutral-700">
                                            {topic}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                                {video.topics.map((topic) => (
                                    <li
                                        key={topic}
                                        className="flex gap-2 text-body text-neutral-700"
                                    >
                                        <Check
                                            size={14}
                                            weight="bold"
                                            className="mt-1 shrink-0 text-success-600"
                                        />
                                        {topic}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ) : null}
            </div>

            <aside className="flex max-h-screen flex-col overflow-hidden rounded-lg border border-border bg-card xl:sticky xl:top-0">
                <div className="flex items-center gap-3 px-4 pb-2 pt-4">
                    <SectionTile name={section.name} />
                    <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-foreground">
                            {section.name}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('doneOfTotal', { done, total: section.items.length })}
                            {totalDuration(section.items.map((i) => i.video))
                                ? ` · ${totalDuration(section.items.map((i) => i.video))}`
                                : ''}
                        </p>
                    </div>
                </div>
                <Progress
                    value={(done / section.items.length) * 100}
                    className="mx-4 mb-3 h-1.5 w-auto !bg-neutral-200"
                />
                <ol
                    ref={listRef}
                    className="relative flex flex-col gap-0.5 overflow-y-auto border-t border-border p-1.5"
                >
                    {section.items.map((item, i) => {
                        const now = item.video === video;
                        const isDone = trainingLocal.isDone(item.video.id);
                        return (
                            <li key={item.video.id}>
                                <button
                                    type="button"
                                    onClick={() => onPlay(item.video.id)}
                                    data-now={now}
                                    className={cn(
                                        'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-start text-body transition-colors',
                                        now ? 'bg-primary-50' : 'hover:bg-muted'
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full font-semibold',
                                            now
                                                ? 'bg-primary-500 text-white'
                                                : isDone
                                                  ? 'bg-success-100 text-success-600'
                                                  : 'bg-muted text-neutral-600'
                                        )}
                                    >
                                        {isDone && !now ? (
                                            <Check size={12} weight="bold" />
                                        ) : (
                                            <span className="text-caption">
                                                {item.step ?? i + 1}
                                            </span>
                                        )}
                                    </span>
                                    <span className="flex min-w-0 flex-col gap-0.5">
                                        <span
                                            className={cn(
                                                'leading-snug',
                                                now
                                                    ? 'font-semibold text-primary-600'
                                                    : 'text-neutral-700'
                                            )}
                                        >
                                            {item.video.title}
                                        </span>
                                        <span
                                            className={
                                                now
                                                    ? 'text-caption text-primary-500'
                                                    : 'text-caption text-neutral-400'
                                            }
                                        >
                                            {now
                                                ? t('nowPlaying')
                                                : isDone
                                                  ? t('watched')
                                                  : formatDuration(
                                                        trainingLocal.duration(item.video.id)
                                                    )}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            </aside>
        </div>
    );
}
