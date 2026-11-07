import { useTranslation } from 'react-i18next';
import { Check, MagnifyingGlass, Play, Sparkle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { ChipToggleGroup } from '@/components/design-system/chips';
import type { Library, LibraryVideo, SearchOutcome, SearchResult } from './search';
import { Highlight, TopicChips, VideoMeta, VideoThumb, WhyLine } from './parts';
import { PopularQuestions, type TrainingActions } from './TrainingHome';
import { sectionIcon } from './meta';

const ALL = '__all__';

function placementFor(library: Library, video: LibraryVideo, filter: string | null) {
    const p =
        video.placements.find((pl) => pl.root + '|' + pl.section === filter) ??
        video.placements[0]!;
    return {
        key: p.root + '|' + p.section,
        step: p.step,
        section: library.sections.get(p.root + '|' + p.section)!,
    };
}

function BestMatch({
    library,
    result,
    filter,
    actions,
}: {
    library: Library;
    result: SearchResult;
    filter: string | null;
    actions: TrainingActions;
}) {
    const { t } = useTranslation('trainingViewer');
    const v = result.video;
    const p = placementFor(library, v, filter);
    const play = () => actions.play(v.id, p.key);
    return (
        <section className="grid grid-cols-1 gap-5 rounded-lg border border-primary-200 bg-gradient-to-bl from-primary-50 to-card p-4 shadow-sm md:grid-cols-5">
            <button
                type="button"
                onClick={play}
                aria-label={v.title}
                className="group self-start overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:col-span-2"
            >
                <VideoThumb video={v} sectionName={p.section.name} step={p.step} />
            </button>
            <div className="flex min-w-0 flex-col items-start gap-2.5 md:col-span-3">
                <span className="inline-flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-primary-600">
                    <Sparkle size={13} weight="fill" /> {t('bestMatch')}
                </span>
                <button
                    type="button"
                    onClick={play}
                    className="text-start text-title font-semibold leading-snug text-foreground hover:text-primary-600"
                >
                    <Highlight text={v.title} marks={result.marks} />
                </button>
                <VideoMeta library={library} video={v} sectionKey={p.key} step={p.step} />
                <WhyLine result={result} />
                {v.topics.length ? (
                    <>
                        <span className="pt-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('inThisVideo')}
                        </span>
                        <ul className="grid w-full gap-x-5 gap-y-1.5 sm:grid-cols-2">
                            {v.topics.slice(0, 6).map((topic) => (
                                <li key={topic} className="flex gap-2 text-body text-neutral-700">
                                    <Check
                                        size={14}
                                        weight="bold"
                                        className="mt-1 shrink-0 text-success-600"
                                    />
                                    <span>
                                        <Highlight text={topic} marks={result.marks} />
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {v.topics.length > 6 ? (
                            <span className="text-caption text-neutral-400">
                                {t('moreCount', { count: v.topics.length - 6 })}
                            </span>
                        ) : null}
                    </>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                    <MyButton buttonType="primary" scale="large" onClick={play}>
                        <Play size={16} weight="fill" /> {t('playVideo')}
                    </MyButton>
                    {p.section.items.length > 1 ? (
                        <MyButton
                            buttonType="secondary"
                            scale="large"
                            onClick={() => actions.openSection(p.key)}
                        >
                            {t('moreIn', { section: p.section.name })}
                        </MyButton>
                    ) : null}
                </div>
            </div>
        </section>
    );
}

function ResultRow({
    library,
    result,
    filter,
    actions,
}: {
    library: Library;
    result: SearchResult;
    filter: string | null;
    actions: TrainingActions;
}) {
    const v = result.video;
    const p = placementFor(library, v, filter);
    return (
        <button
            type="button"
            onClick={() => actions.play(v.id, p.key)}
            className="group flex min-w-0 flex-col gap-3 rounded-lg border border-transparent p-3 text-start transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:gap-4"
        >
            <VideoThumb video={v} sectionName={p.section.name} className="rounded-md sm:w-52" />
            <span className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                <span className="text-subtitle font-semibold leading-snug text-foreground">
                    <Highlight text={v.title} marks={result.marks} />
                </span>
                <VideoMeta library={library} video={v} sectionKey={p.key} step={p.step} />
                <WhyLine result={result} />
                <TopicChips topics={v.topics} marks={result.marks} max={4} />
            </span>
        </button>
    );
}

export function TrainingResults({
    library,
    query,
    outcome,
    filter,
    onFilter,
    groupLabel,
    popular,
    onSearchInstead,
    actions,
}: {
    library: Library;
    query: string;
    outcome: SearchOutcome;
    filter: string | null;
    onFilter: (sectionKey: string | null) => void;
    groupLabel: (groupId: string) => string;
    popular: string[];
    onSearchInstead: () => void;
    actions: TrainingActions;
}) {
    const { t } = useTranslation('trainingViewer');
    const { results } = outcome;
    const list = filter
        ? results.filter((r) => r.video.placements.some((p) => p.root + '|' + p.section === filter))
        : results;

    const labels: string[] = [];
    for (const c of outcome.concepts) {
        if (c.weak) continue;
        const g = c.groups.find((x) => !x.weak);
        const label = g ? groupLabel(g.id) : c.display;
        if (!labels.includes(label)) labels.push(label);
    }
    let corrected = query.trim();
    for (const [bad, good] of outcome.corrections)
        corrected = corrected.replace(new RegExp(`\\b${bad}\\b`, 'i'), good);

    const sectionCounts = library.sectionList
        .map((s) => ({
            s,
            n: results.filter((r) =>
                r.video.placements.some((p) => p.root + '|' + p.section === s.key)
            ).length,
        }))
        .filter((x) => x.n);
    const multiRoot = library.roots.length > 1;

    const [first, second] = list;
    const showBest = !!first && (!second || first.score >= second.score * 1.35);
    const rest = showBest ? list.slice(1) : list;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2.5">
                {outcome.corrections.length ? (
                    <p className="text-subtitle text-neutral-600">
                        {t('showingResultsFor')}{' '}
                        <em className="font-semibold text-primary-600">{corrected}</em>
                        <span className="mx-2 text-neutral-300">·</span>
                        <button
                            type="button"
                            onClick={onSearchInstead}
                            className="text-body text-neutral-500 underline underline-offset-2 hover:text-foreground"
                        >
                            {t('searchInsteadFor', { query: query.trim() })}
                        </button>
                    </p>
                ) : null}
                {results.length && labels.length ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-body text-neutral-500">
                        <Sparkle size={14} weight="fill" className="text-primary-400" />
                        <span>{t('lookingFor')}</span>
                        {labels.map((l) => (
                            <span
                                key={l}
                                className="rounded-full border border-border bg-card px-2.5 py-0.5 text-caption font-semibold text-foreground"
                            >
                                {l}
                            </span>
                        ))}
                        <span className="text-neutral-400">
                            · {t('videosCount', { count: results.length })}
                        </span>
                    </div>
                ) : null}
                {outcome.unknown.length && results.length ? (
                    <p className="text-body text-neutral-500">
                        {t('noVideoMentions', { words: outcome.unknown.join(', ') })}
                    </p>
                ) : null}
                {results.length > 1 && sectionCounts.length > 1 ? (
                    <ChipToggleGroup
                        size="md"
                        variant="outline"
                        ariaLabel={t('filterBySection')}
                        value={filter ?? ALL}
                        onChange={(v) => onFilter(v === ALL ? null : v)}
                        className="border-b border-border pb-3"
                        options={[
                            { value: ALL, label: `${t('all')} · ${results.length}` },
                            ...sectionCounts.map(({ s, n }) => ({
                                value: s.key,
                                label: `${multiRoot ? `${s.root} › ` : ''}${s.name} · ${n}`,
                                icon: sectionIcon(s.name),
                            })),
                        ]}
                    />
                ) : null}
            </div>

            {!results.length ? (
                <div className="mx-auto flex max-w-xl flex-col items-center gap-3 py-10 text-center">
                    <span className="flex size-16 items-center justify-center rounded-lg bg-muted text-neutral-400">
                        <MagnifyingGlass size={28} />
                    </span>
                    <h3 className="text-title font-semibold text-foreground">
                        {t('noResultsTitle', { query: query.trim() })}
                    </h3>
                    <p className="text-body text-neutral-500">{t('noResultsBody')}</p>
                    <PopularQuestions
                        questions={popular.slice(0, 6)}
                        onAsk={actions.ask}
                        className="justify-center"
                    />
                </div>
            ) : (
                <>
                    {showBest ? (
                        <BestMatch
                            library={library}
                            result={first!}
                            filter={filter}
                            actions={actions}
                        />
                    ) : null}
                    {showBest && rest.length ? (
                        <span className="px-3 pt-1 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                            {t('otherMatches')}
                        </span>
                    ) : null}
                    <div className="flex flex-col gap-0.5">
                        {rest.map((r) => (
                            <ResultRow
                                key={r.video.id}
                                library={library}
                                result={r}
                                filter={filter}
                                actions={actions}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
