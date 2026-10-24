import { useTranslation } from 'react-i18next';
import {
    CaretRight,
    Check,
    ClockCounterClockwise,
    Flag,
    FolderSimple,
    MagnifyingGlass,
    Play,
    Sparkle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Library, LibraryVideo, Section } from './search';
import { SectionTile, TopicChips, VideoThumb, formatDuration } from './parts';
import { trainingLocal, useTrainingLocalVersion } from './useTrainingLocal';

export interface TrainingActions {
    play: (videoId: string, sectionKey: string) => void;
    openSection: (sectionKey: string) => void;
    ask: (query: string) => void;
}

function VideoCard({
    library,
    video,
    sectionKey,
    step,
    showSection,
    actions,
}: {
    library: Library;
    video: LibraryVideo;
    sectionKey: string;
    step: number | null;
    showSection?: boolean;
    actions: TrainingActions;
}) {
    const section = library.sections.get(sectionKey)!;
    return (
        <button
            type="button"
            onClick={() => actions.play(video.id, sectionKey)}
            title={video.title}
            className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-start transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            <VideoThumb
                video={video}
                sectionName={section.name}
                step={step}
                className="border-b border-border"
            />
            <span className="flex flex-1 flex-col gap-2 p-3">
                {showSection ? (
                    <span className="flex items-center gap-1.5 text-caption font-semibold text-primary-600">
                        <SectionTile name={section.name} size="sm" />
                        {section.name}
                    </span>
                ) : null}
                <span className="line-clamp-3 text-body font-semibold leading-snug text-foreground">
                    {video.title}
                </span>
                <TopicChips topics={video.topics} max={2} />
            </span>
        </button>
    );
}

/** "Start here": the first ordered section of the module, as a numbered path with progress. */
function StartHere({ section, actions }: { section: Section; actions: TrainingActions }) {
    const { t } = useTranslation('trainingViewer');
    const items = section.items.filter((i) => i.step != null);
    const n = items.length;
    const done = items.filter((i) => trainingLocal.isDone(i.video.id)).length;
    const nextIdx = Math.max(
        0,
        items.findIndex((i) => !trainingLocal.isDone(i.video.id))
    );
    const next = done === n ? items[0]! : items[nextIdx]!;
    const start = Math.min(Math.max(0, nextIdx - 1), Math.max(0, n - 5));
    const visible = items.slice(start, start + 5);
    return (
        <section className="grid grid-cols-1 gap-6 rounded-lg border border-primary-100 bg-gradient-to-br from-primary-50 to-card p-5 sm:p-6 lg:grid-cols-2">
            <div className="flex flex-col items-start gap-3">
                <span className="inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-primary-600">
                    <Flag size={14} weight="fill" /> {t('startHere')}
                </span>
                <h3 className="text-h3 font-semibold text-foreground">
                    {done === 0
                        ? t('heroNewTitle', { section: section.name })
                        : done === n
                          ? t('heroDoneTitle', { section: section.name })
                          : t('heroNextTitle', { step: next.step })}
                </h3>
                <p className="text-body text-neutral-600">
                    {done === 0
                        ? t('heroNewBody', { count: n })
                        : t('heroNextBody', { done, total: n, section: section.name })}
                </p>
                {done ? (
                    <Progress value={(done / n) * 100} className="h-2 max-w-sm !bg-neutral-200" />
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        onClick={() => actions.play(next.video.id, section.key)}
                    >
                        <Play size={16} weight="fill" />
                        {done === 0
                            ? t('startWithStep1')
                            : done === n
                              ? t('watchAgain')
                              : t('continueWithStep', { step: next.step })}
                    </MyButton>
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        onClick={() => actions.openSection(section.key)}
                    >
                        {t('seeAllSteps', { count: n })}
                    </MyButton>
                </div>
            </div>
            <ol className="flex flex-col gap-0.5 self-start rounded-lg border border-border bg-card p-2">
                {visible.map((i) => {
                    const isDone = trainingLocal.isDone(i.video.id);
                    const isNext = i === next && done < n;
                    const d = formatDuration(trainingLocal.duration(i.video.id));
                    return (
                        <li key={i.video.id}>
                            <button
                                type="button"
                                onClick={() => actions.play(i.video.id, section.key)}
                                title={i.video.title}
                                className={cn(
                                    'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-start text-body transition-colors hover:bg-muted',
                                    isNext && 'bg-primary-50 hover:bg-primary-50'
                                )}
                            >
                                <span
                                    className={cn(
                                        'flex size-6 shrink-0 items-center justify-center rounded-full font-semibold',
                                        isDone
                                            ? 'bg-success-100 text-success-600'
                                            : isNext
                                              ? 'bg-primary-500 text-white'
                                              : 'bg-muted text-neutral-600'
                                    )}
                                >
                                    {isDone ? (
                                        <Check size={12} weight="bold" />
                                    ) : (
                                        <span className="text-caption">{i.step}</span>
                                    )}
                                </span>
                                <span
                                    className={cn(
                                        'min-w-0 flex-1 truncate',
                                        isNext
                                            ? 'font-semibold text-foreground'
                                            : 'text-neutral-700'
                                    )}
                                >
                                    {i.video.title}
                                </span>
                                {isNext ? (
                                    <span className="rounded-full border border-primary-200 bg-card px-2 text-caption font-semibold text-primary-600">
                                        {t('upNext')}
                                    </span>
                                ) : d ? (
                                    <span className="text-caption tabular-nums text-neutral-400">
                                        {d}
                                    </span>
                                ) : null}
                            </button>
                        </li>
                    );
                })}
                {n > 5 ? (
                    <li>
                        <button
                            type="button"
                            onClick={() => actions.openSection(section.key)}
                            className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-start text-body text-neutral-500 hover:bg-muted"
                        >
                            <span className="w-6 text-center text-caption font-semibold text-neutral-400">
                                +{n - 5}
                            </span>
                            {t('moreSteps')}
                        </button>
                    </li>
                ) : null}
            </ol>
        </section>
    );
}

export function PopularQuestions({
    questions,
    onAsk,
    className,
}: {
    questions: string[];
    onAsk: (q: string) => void;
    className?: string;
}) {
    if (!questions.length) return null;
    return (
        <div className={cn('flex flex-wrap gap-2', className)}>
            {questions.map((q) => (
                <button
                    key={q}
                    type="button"
                    onClick={() => onAsk(q)}
                    className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3.5 text-body text-neutral-700 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <MagnifyingGlass size={14} className="text-neutral-400" />
                    {q}
                </button>
            ))}
        </div>
    );
}

export function TrainingHome({
    library,
    sections,
    popular,
    actions,
}: {
    library: Library;
    /** Sections of the module being browsed. */
    sections: Section[];
    popular: string[];
    actions: TrainingActions;
}) {
    const { t } = useTranslation('trainingViewer');
    useTrainingLocalVersion();
    const path = sections.find((s) => s.items.filter((i) => i.step != null).length >= 5);
    const inModule = new Set(sections.flatMap((s) => s.items.map((i) => i.video)));
    const continueWatching = library.videos
        .filter(
            (v) =>
                inModule.has(v) &&
                !trainingLocal.isDone(v.id) &&
                trainingLocal.fraction(v.id) > 0.02
        )
        .sort((a, b) => trainingLocal.lastWatchedAt(b.id) - trainingLocal.lastWatchedAt(a.id))
        .slice(0, 4);

    // Sections with 3+ videos get their own row; tiny ones share "More topics". A video shows once here.
    const shown = new Set<LibraryVideo>();
    const rows: Array<{ section: Section; items: Section['items'] }> = [];
    const small: Array<{ section: Section; item: Section['items'][number] }> = [];
    for (const s of sections) {
        const items = s.items.filter((i) => !shown.has(i.video));
        if (!items.length) continue;
        if (s.items.length < 3) {
            items.forEach((item) => {
                small.push({ section: s, item });
                shown.add(item.video);
            });
            continue;
        }
        const first = items.slice(0, 4);
        first.forEach((i) => shown.add(i.video));
        rows.push({ section: s, items: first });
    }

    return (
        <div className="flex flex-col gap-8">
            {path ? <StartHere section={path} actions={actions} /> : null}

            {continueWatching.length ? (
                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-md border border-primary-100 bg-primary-50 text-primary-600">
                            <ClockCounterClockwise size={18} />
                        </span>
                        <h3 className="text-subtitle font-semibold text-foreground">
                            {t('continueWatching')}
                        </h3>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {continueWatching.map((v) => {
                            const p = v.placements[0]!;
                            return (
                                <VideoCard
                                    key={v.id}
                                    library={library}
                                    video={v}
                                    sectionKey={p.root + '|' + p.section}
                                    step={p.step}
                                    showSection
                                    actions={actions}
                                />
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {popular.length ? (
                <section className="flex flex-col gap-3 rounded-lg border border-dashed border-neutral-300 bg-muted/40 p-4">
                    <span className="flex items-center gap-1.5 text-body font-semibold text-neutral-700">
                        <Sparkle size={16} weight="fill" className="text-primary-400" />{' '}
                        {t('peopleAsk')}
                    </span>
                    <PopularQuestions questions={popular} onAsk={actions.ask} />
                </section>
            ) : null}

            {rows.map(({ section, items }) => {
                const done = section.items.filter((i) => trainingLocal.isDone(i.video.id)).length;
                return (
                    <section key={section.key} className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                            <SectionTile name={section.name} />
                            <div className="min-w-0 flex-1">
                                <h3 className="truncate text-subtitle font-semibold text-foreground">
                                    {section.name}
                                </h3>
                                <p className="text-caption text-neutral-500">
                                    {t('videosCount', { count: section.items.length })}
                                    {section.numbered ? ` · ${t('watchInOrder')}` : ''}
                                    {done ? ` · ${t('watchedCount', { count: done })}` : ''}
                                </p>
                            </div>
                            {section.items.length > items.length ? (
                                <MyButton
                                    buttonType="text"
                                    scale="medium"
                                    onClick={() => actions.openSection(section.key)}
                                >
                                    {t('seeAll', { count: section.items.length })}
                                    <CaretRight size={14} />
                                </MyButton>
                            ) : null}
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            {items.map((i) => (
                                <VideoCard
                                    key={i.video.id}
                                    library={library}
                                    video={i.video}
                                    sectionKey={section.key}
                                    step={i.step}
                                    actions={actions}
                                />
                            ))}
                        </div>
                    </section>
                );
            })}

            {small.length ? (
                <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-md border border-primary-100 bg-primary-50 text-primary-600">
                            <FolderSimple size={18} />
                        </span>
                        <div>
                            <h3 className="text-subtitle font-semibold text-foreground">
                                {t('moreTopics')}
                            </h3>
                            <p className="text-caption text-neutral-500">
                                {t('videosCount', { count: small.length })}
                            </p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {small.map(({ section, item }) => (
                            <VideoCard
                                key={item.video.id}
                                library={library}
                                video={item.video}
                                sectionKey={section.key}
                                step={null}
                                showSection
                                actions={actions}
                            />
                        ))}
                    </div>
                </section>
            ) : null}
        </div>
    );
}
