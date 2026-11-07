import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretRight, Check, Play } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { Library, Section } from './search';
import { SectionTile, TopicChips, VideoMeta, VideoThumb, totalDuration } from './parts';
import type { TrainingActions } from './TrainingHome';
import { trainingLocal, useTrainingLocalVersion } from './useTrainingLocal';

/** One section ("Live Sessions") as an ordered list of steps, with progress. */
export function TrainingSectionView({
    library,
    section,
    actions,
    onHome,
}: {
    library: Library;
    section: Section;
    actions: TrainingActions;
    onHome: () => void;
}) {
    const { t } = useTranslation('trainingViewer');
    useTrainingLocalVersion();
    const n = section.items.length;
    const done = section.items.filter((i) => trainingLocal.isDone(i.video.id)).length;
    const next = section.items.find((i) => !trainingLocal.isDone(i.video.id)) ?? section.items[0]!;
    const total = totalDuration(section.items.map((i) => i.video));
    const cta =
        done === 0
            ? section.numbered
                ? t('startFromStep1')
                : t('playAll')
            : done === n
              ? t('watchAgain')
              : next.step != null
                ? t('continueStep', { step: next.step })
                : t('continue');

    return (
        <div className="flex flex-col gap-5">
            <nav className="flex items-center gap-1.5 text-body text-neutral-500">
                <button type="button" onClick={onHome} className="hover:text-primary-600">
                    {t('allVideos')}
                </button>
                <CaretRight size={12} className="text-neutral-300" />
                <span>{section.root}</span>
                <CaretRight size={12} className="text-neutral-300" />
                <span className="font-semibold text-foreground">{section.name}</span>
            </nav>

            <section className="flex flex-col gap-4 rounded-lg border border-primary-100 bg-gradient-to-br from-primary-50 to-card p-5 sm:flex-row sm:items-center">
                <SectionTile name={section.name} size="lg" />
                <div className="min-w-0 flex-1">
                    <h3 className="text-h3 font-semibold text-foreground">{section.name}</h3>
                    <p className="text-body text-neutral-600">
                        {t('videosCount', { count: n })}
                        {total ? ` · ${total}` : ''}
                        {section.numbered ? ` · ${t('bestInOrder')}` : ''}
                    </p>
                    <Progress
                        value={(done / n) * 100}
                        className="mt-3 h-1.5 max-w-xs !bg-neutral-200"
                    />
                    <p className="mt-1 text-caption text-neutral-500">
                        {t('doneOfTotal', { done, total: n })}
                    </p>
                </div>
                <MyButton
                    buttonType="primary"
                    scale="large"
                    onClick={() => actions.play(next.video.id, section.key)}
                >
                    <Play size={16} weight="fill" /> {cta}
                </MyButton>
            </section>

            <ol className="flex flex-col">
                {section.items.map((item, i) => {
                    const isDone = trainingLocal.isDone(item.video.id);
                    const isNext = item === next && done > 0 && done < n;
                    const last = i === n - 1;
                    const groupStart = item.group && item.group !== section.items[i - 1]?.group;
                    return (
                        <Fragment key={item.video.id}>
                            {groupStart ? (
                                <li className="px-3 pb-1 pt-4 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                    {item.group}
                                </li>
                            ) : null}
                            <li className="relative flex gap-2">
                                {section.numbered ? (
                                    <div className="hidden w-9 shrink-0 justify-center pt-5 sm:flex">
                                        {!last ? (
                                            <span
                                                className={cn(
                                                    'absolute -bottom-5 left-4 top-14 w-0.5 translate-x-px',
                                                    isDone ? 'bg-success-200' : 'bg-border'
                                                )}
                                            />
                                        ) : null}
                                        <span
                                            className={cn(
                                                'relative flex size-8 items-center justify-center rounded-full border-2 font-semibold',
                                                isDone
                                                    ? 'border-success-500 bg-success-500 text-white'
                                                    : isNext
                                                      ? 'border-primary-500 bg-card text-primary-600 ring-4 ring-primary-50'
                                                      : 'border-border bg-card text-neutral-600'
                                            )}
                                        >
                                            {isDone ? (
                                                <Check size={14} weight="bold" />
                                            ) : (
                                                <span className="text-caption">
                                                    {item.step ?? i + 1}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => actions.play(item.video.id, section.key)}
                                    className="group flex min-w-0 flex-1 flex-col gap-3 rounded-lg border border-transparent p-3 text-start transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:gap-4"
                                >
                                    <VideoThumb
                                        video={item.video}
                                        sectionName={section.name}
                                        className="rounded-md sm:w-52"
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                                        <span className="text-subtitle font-semibold leading-snug text-foreground">
                                            {item.video.title}
                                        </span>
                                        <VideoMeta
                                            library={library}
                                            video={item.video}
                                            sectionKey={section.key}
                                            step={item.step}
                                            hideSection
                                        />
                                        <TopicChips topics={item.video.topics} max={5} />
                                    </span>
                                </button>
                            </li>
                        </Fragment>
                    );
                })}
            </ol>
        </div>
    );
}
