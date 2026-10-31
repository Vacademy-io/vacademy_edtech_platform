import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouterState } from '@tanstack/react-router';
import {
    ClockCounterClockwise,
    House,
    MagnifyingGlass,
    PlayCircle,
    TrendUp,
    X,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { ChipToggleGroup } from '@/components/design-system/chips';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTrainingVideos } from '@/services/training-videos';
import { useNamingSettingsVersion } from '@/hooks/useNamingSettingsVersion';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import {
    ContentTerms,
    OtherTerms,
    RoleTerms,
    SystemTerms,
} from '@/routes/settings/-components/NamingSettings';
import { buildLibrary, createSearchIndex, type Section } from './training/search';
import { getTrainingTerminology } from './training/terminology';
import { POPULAR_QUESTIONS, moduleForPath, moduleIcon } from './training/meta';
import { SectionTile } from './training/parts';
import { TrainingHome, type TrainingActions } from './training/TrainingHome';
import { TrainingSectionView } from './training/TrainingSectionView';
import { TrainingResults } from './training/TrainingResults';
import { TrainingPlayer } from './training/TrainingPlayer';
import { trainingLocal, useTrainingLocalVersion } from './training/useTrainingLocal';

type Browse = { kind: 'home' } | { kind: 'section'; key: string };
interface Playing {
    id: string;
    section: string;
    back: 'browse' | 'results';
}

const ALL_MODULES = '__all__';

/**
 * Assist Dock "Training" popup — the training library super admins publish from the health-check
 * dashboard. Built for finding the right video fast:
 *  - browse by module (LMS / CRM …) and section, sections shown as ordered steps with progress
 *  - Google-style search (synonyms, Hinglish, typos, per-video keywords) — see training/search.ts
 *  - everything reads in the institute's own words (Naming Settings) — see training/terminology.ts
 */
export function TrainingViewer({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation('trainingViewer');
    // Deferred like the roadmap body - only downloaded while the popup is open.
    const videos = useTrainingVideos(open);
    const namingVersion = useNamingSettingsVersion();
    useTrainingLocalVersion();
    const pathname = useRouterState({ select: (s) => s.location.pathname });

    const library = useMemo(
        () => buildLibrary(videos.data ?? [], getTrainingTerminology().rename),
        // namingVersion is the trigger: naming settings live in localStorage, not in React state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [videos.data, namingVersion]
    );
    const index = useMemo(() => createSearchIndex(library), [library]);

    const [browse, setBrowse] = useState<Browse>({ kind: 'home' });
    const [playing, setPlaying] = useState<Playing | null>(null);
    const [query, setQuery] = useState('');
    const [typing, setTyping] = useState(true);
    const [noCorrect, setNoCorrect] = useState(false);
    const [filter, setFilter] = useState<string | null>(null);
    const [activeModule, setActiveModule] = useState(ALL_MODULES);
    const [suggestOpen, setSuggestOpen] = useState(false);
    const [suggestIdx, setSuggestIdx] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const mainRef = useRef<HTMLElement>(null);
    const deferredQuery = useDeferredValue(query);

    // Open on the module of the page Training was launched from (a CRM page shows CRM videos).
    const rootsKey = library.roots.join('|');
    useEffect(() => {
        if (!open) return;
        const current = moduleForPath(pathname)?.toLowerCase();
        const match = library.roots.find((r) => r.toLowerCase() === current);
        setActiveModule(library.roots.length > 1 && match ? match : ALL_MODULES);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- rootsKey stands in for library.roots
    }, [open, rootsKey, pathname]);

    const outcome = useMemo(
        () => (deferredQuery.trim() ? index.search(deferredQuery, { typing, noCorrect }) : null),
        [index, deferredQuery, typing, noCorrect]
    );
    const searching = !!outcome && (outcome.concepts.length > 0 || outcome.unknown.length > 0);

    const browseRoots = activeModule === ALL_MODULES ? library.roots : [activeModule];
    const browseSections = library.sectionList.filter((s) => browseRoots.includes(s.root));
    const browseCount = library.videos.filter((v) =>
        v.placements.some((p) => browseRoots.includes(p.root))
    ).length;

    const popular = useMemo(() => {
        const { rename } = getTrainingTerminology();
        const roots = activeModule === ALL_MODULES ? library.roots : [activeModule];
        return (
            roots
                .flatMap((r) => POPULAR_QUESTIONS[r.toLowerCase()] ?? [])
                .map(rename)
                // Only questions a video fully answers — not ones that merely share a word like "leads".
                .filter((q) => index.search(q, { typing: false }).results[0]?.coverage === 1)
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps -- namingVersion: see library above
    }, [library.roots, activeModule, index, namingVersion]);

    const groupLabel = (id: string): string => {
        const learners = getTerminologyPlural(RoleTerms.Learner, SystemTerms.Learner);
        switch (id) {
            case 'students':
                return learners;
            case 'teachers':
                return getTerminologyPlural(RoleTerms.Teacher, SystemTerms.Teacher);
            case 'liveClasses':
                return getTerminologyPlural(ContentTerms.LiveSession, SystemTerms.LiveSession);
            case 'audience':
                return getTerminologyPlural(OtherTerms.AudienceList, SystemTerms.AudienceList);
            case 'courses':
                return t('groups.courses', {
                    courses: getTerminologyPlural(ContentTerms.Course, SystemTerms.Course),
                    batches: getTerminologyPlural(ContentTerms.Batch, SystemTerms.Batch),
                });
            case 'structure':
                return t('groups.structure', {
                    course: getTerminology(ContentTerms.Course, SystemTerms.Course),
                });
            case 'enrolling':
                return t('groups.enrolling', { learners });
            default:
                return t(`groups.${id}`);
        }
    };

    const clearSearch = useCallback(() => {
        setQuery('');
        setFilter(null);
        setNoCorrect(false);
        setTyping(true);
    }, []);

    const ask = useCallback((q: string) => {
        setQuery(q);
        setTyping(false);
        setNoCorrect(false);
        setFilter(null);
        setPlaying(null);
        setSuggestOpen(false);
        trainingLocal.addRecent(q);
    }, []);

    const actions: TrainingActions = {
        play: (id, sectionKey) => {
            setSuggestOpen(false);
            if (searching) trainingLocal.addRecent(query);
            setPlaying({ id, section: sectionKey, back: searching ? 'results' : 'browse' });
        },
        openSection: (key) => {
            setSuggestOpen(false);
            clearSearch();
            setPlaying(null);
            setBrowse({ kind: 'section', key });
        },
        ask,
    };

    // New view → start at the top.
    const viewKey = playing
        ? `p:${playing.id}`
        : searching
          ? `q:${filter}`
          : browse.kind === 'section'
            ? `s:${browse.key}`
            : 'home';
    useEffect(() => {
        mainRef.current?.scrollTo({ top: 0 });
    }, [viewKey]);

    useEffect(() => {
        if (!open) return;
        const handleKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                event.key === '/' &&
                !target?.closest('input, textarea, [contenteditable="true"]')
            ) {
                event.preventDefault();
                inputRef.current?.focus();
                return;
            }
            if (event.key !== 'Escape') return;
            if (suggestOpen) setSuggestOpen(false);
            else if (playing) setPlaying(null);
            else if (query) clearSearch();
            else if (browse.kind === 'section') setBrowse({ kind: 'home' });
            else onClose();
        };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [open, suggestOpen, playing, query, browse, onClose, clearSearch]);

    if (!open) return null;

    const suggestions = [
        ...trainingLocal
            .recent()
            .slice(0, 4)
            .map((q) => ({ q, recent: true })),
        ...popular.slice(0, 7).map((q) => ({ q, recent: false })),
    ];

    const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (
            suggestOpen &&
            suggestions.length &&
            (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        ) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setSuggestIdx((i) => (i + step + suggestions.length) % suggestions.length);
            return;
        }
        if (event.key === 'Enter') {
            const picked = suggestOpen && suggestIdx >= 0 ? suggestions[suggestIdx] : undefined;
            if (picked) ask(picked.q);
            else {
                trainingLocal.addRecent(query);
                setTyping(false);
                setSuggestOpen(false);
            }
        }
    };

    const playingVideo = playing ? library.byId.get(playing.id) : undefined;
    const playingSection = playing ? library.sections.get(playing.section) : undefined;
    const openSection = browse.kind === 'section' ? library.sections.get(browse.key) : undefined;
    const watched = library.videos.filter((v) => trainingLocal.isDone(v.id)).length;
    const results = outcome?.results ?? [];
    const countIn = (s: Section) =>
        searching
            ? results.filter((r) =>
                  r.video.placements.some((p) => p.root + '|' + p.section === s.key)
              ).length
            : s.items.length;

    const backLabel =
        playing?.back === 'results'
            ? t('backToResults', { query: query.trim() })
            : openSection
              ? t('backToSection', { section: openSection.name })
              : t('backToAll');

    let body: React.ReactNode;
    if (videos.isPending) {
        body = (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <div
                        key={i}
                        className="flex flex-col gap-2 rounded-lg border border-border p-2"
                    >
                        <Skeleton className="aspect-video w-full rounded-md" />
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                ))}
            </div>
        );
    } else if (videos.isError) {
        body = <EmptyPane title={t('error')} />;
    } else if (!library.videos.length) {
        body = <EmptyPane title={t('noVideos')} description={t('noVideosDescription')} />;
    } else if (playing && playingVideo && playingSection) {
        body = (
            <TrainingPlayer
                library={library}
                video={playingVideo}
                section={playingSection}
                backLabel={backLabel}
                onBack={() => setPlaying(null)}
                onPlay={(id) => setPlaying((p) => (p ? { ...p, id } : p))}
            />
        );
    } else if (searching && outcome) {
        body = (
            <TrainingResults
                library={library}
                query={query}
                outcome={outcome}
                filter={filter}
                onFilter={setFilter}
                groupLabel={groupLabel}
                popular={popular}
                onSearchInstead={() => {
                    setNoCorrect(true);
                    setTyping(false);
                }}
                actions={actions}
            />
        );
    } else if (openSection) {
        body = (
            <TrainingSectionView
                library={library}
                section={openSection}
                actions={actions}
                onHome={() => setBrowse({ kind: 'home' })}
            />
        );
    } else {
        body = (
            <TrainingHome
                library={library}
                sections={browseSections}
                popular={popular}
                actions={actions}
            />
        );
    }

    const showSidebar =
        !playing && !videos.isPending && !videos.isError && library.videos.length > 0;

    return (
        <div
            className="fixed inset-0 z-50 flex justify-center bg-black/60 p-0 sm:p-4 lg:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="training-viewer-title"
            onClick={onClose}
        >
            <div
                className="flex size-full flex-col overflow-hidden bg-card text-card-foreground shadow-xl sm:rounded-lg"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header: title + search + close */}
                <div className="relative z-10 flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
                    <div className="flex min-w-0 flex-1 items-center gap-2 md:w-52 md:flex-none">
                        <PlayCircle size={22} weight="fill" className="shrink-0 text-primary-500" />
                        <h2
                            id="training-viewer-title"
                            className="truncate text-title font-semibold text-foreground"
                        >
                            {t('title')}
                        </h2>
                        {library.videos.length ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-caption text-neutral-500">
                                {t('videosCount', { count: library.videos.length })}
                            </span>
                        ) : null}
                    </div>
                    <div className="relative order-3 w-full md:order-none md:mx-auto md:max-w-2xl md:flex-1">
                        <MagnifyingGlass
                            size={18}
                            className="pointer-events-none absolute start-3.5 top-1/2 z-10 -translate-y-1/2 text-neutral-400"
                        />
                        <MyInput
                            ref={inputRef}
                            size="large"
                            input={query}
                            inputPlaceholder={t('searchPlaceholder')}
                            aria-label={t('searchAriaLabel')}
                            autoComplete="off"
                            spellCheck={false}
                            className="h-11 rounded-lg bg-muted/40 pe-12 ps-11 focus:bg-card sm:w-full"
                            onChangeFunction={(e) => {
                                const value = e.target.value;
                                setQuery(value);
                                setTyping(true);
                                setNoCorrect(false);
                                setFilter(null);
                                setPlaying(null);
                                setSuggestOpen(!value.trim());
                                setSuggestIdx(-1);
                            }}
                            onFocus={() => {
                                setSuggestOpen(!query.trim());
                                setSuggestIdx(-1);
                            }}
                            onBlur={() => setSuggestOpen(false)}
                            onKeyDown={onInputKey}
                        />
                        {query ? (
                            <MyButton
                                buttonType="text"
                                layoutVariant="icon"
                                scale="small"
                                aria-label={t('clearSearch')}
                                onClick={() => {
                                    clearSearch();
                                    inputRef.current?.focus();
                                }}
                                className="absolute end-3 top-1/2 -translate-y-1/2 text-neutral-500"
                            >
                                <X size={16} />
                            </MyButton>
                        ) : (
                            <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-sm border border-b-2 border-border bg-card px-1.5 text-caption font-semibold text-neutral-400 md:block">
                                /
                            </kbd>
                        )}
                        {suggestOpen && suggestions.length ? (
                            <div
                                className="absolute inset-x-0 top-full mt-2 max-h-96 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 text-body shadow-lg"
                                onMouseDown={(e) => e.preventDefault()}
                            >
                                {suggestions.map((s, i) => (
                                    <div key={`${s.recent}-${s.q}`}>
                                        {i === 0 || suggestions[i - 1]!.recent !== s.recent ? (
                                            <p className="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                                {s.recent ? t('recentSearches') : t('peopleAsk')}
                                            </p>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => ask(s.q)}
                                            className={cn(
                                                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-start text-neutral-700 hover:bg-muted',
                                                i === suggestIdx && 'bg-muted'
                                            )}
                                        >
                                            {s.recent ? (
                                                <ClockCounterClockwise
                                                    size={16}
                                                    className="shrink-0 text-neutral-400"
                                                />
                                            ) : (
                                                <TrendUp
                                                    size={16}
                                                    className="shrink-0 text-neutral-400"
                                                />
                                            )}
                                            {s.q}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    <MyButton
                        buttonType="text"
                        layoutVariant="icon"
                        scale="large"
                        aria-label={t('closeAriaLabel')}
                        onClick={onClose}
                        className="text-neutral-500"
                    >
                        <X size={20} />
                    </MyButton>
                </div>

                <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                    {showSidebar ? (
                        <aside className="flex max-h-52 w-full shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-border bg-muted/40 p-2 md:max-h-none md:w-72 md:border-b-0 md:border-e">
                            {library.roots.length > 1 && !searching ? (
                                <ChipToggleGroup
                                    value={activeModule}
                                    onChange={(m) => {
                                        setActiveModule(m);
                                        setBrowse({ kind: 'home' });
                                    }}
                                    ariaLabel={t('modules')}
                                    variant="outline"
                                    className="px-1 pb-2 pt-1"
                                    options={[
                                        { value: ALL_MODULES, label: t('allModules') },
                                        ...library.roots.map((r) => ({
                                            value: r,
                                            label: r,
                                            icon: moduleIcon(r),
                                        })),
                                    ]}
                                />
                            ) : null}
                            <NavItem
                                active={searching ? !filter : browse.kind === 'home'}
                                icon={
                                    searching ? <MagnifyingGlass size={16} /> : <House size={16} />
                                }
                                label={searching ? t('allResults') : t('home')}
                                count={searching ? results.length : browseCount}
                                onClick={() =>
                                    searching ? setFilter(null) : setBrowse({ kind: 'home' })
                                }
                            />
                            {(searching ? library.roots : browseRoots).map((root) => {
                                const sections = library.sectionList.filter((s) => s.root === root);
                                return (
                                    <div key={root} className="flex flex-col gap-0.5">
                                        {library.roots.length > 1 || searching ? (
                                            <p className="px-3 pb-1 pt-4 text-caption font-semibold uppercase tracking-wide text-neutral-400">
                                                {root}
                                            </p>
                                        ) : (
                                            <div className="pt-2" />
                                        )}
                                        {sections.map((s) => {
                                            const n = countIn(s);
                                            const done = s.items.filter((i) =>
                                                trainingLocal.isDone(i.video.id)
                                            ).length;
                                            return (
                                                <NavItem
                                                    key={s.key}
                                                    active={
                                                        searching
                                                            ? filter === s.key
                                                            : browse.kind === 'section' &&
                                                              browse.key === s.key
                                                    }
                                                    disabled={searching && !n}
                                                    icon={<SectionTile name={s.name} size="sm" />}
                                                    label={s.name}
                                                    count={
                                                        !searching && done
                                                            ? `${done}/${s.items.length}`
                                                            : n
                                                    }
                                                    progress={
                                                        !searching && done
                                                            ? (done / s.items.length) * 100
                                                            : undefined
                                                    }
                                                    onClick={() =>
                                                        searching
                                                            ? setFilter(s.key)
                                                            : actions.openSection(s.key)
                                                    }
                                                />
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            <div className="mt-auto hidden px-2 pt-4 md:block">
                                <div className="rounded-lg border border-border bg-card p-3">
                                    <p className="text-body font-semibold text-foreground">
                                        {t('yourProgress')}
                                    </p>
                                    <Progress
                                        value={(watched / library.videos.length) * 100}
                                        className="my-2 h-1.5 !bg-neutral-200"
                                    />
                                    <p className="text-caption text-neutral-500">
                                        {t('watchedOfTotal', {
                                            done: watched,
                                            total: library.videos.length,
                                        })}
                                    </p>
                                </div>
                            </div>
                        </aside>
                    ) : null}
                    <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
                        {body}
                    </main>
                </div>
            </div>
        </div>
    );
}

function NavItem({
    active,
    disabled,
    icon,
    label,
    count,
    progress,
    onClick,
}: {
    active: boolean;
    disabled?: boolean;
    icon: React.ReactNode;
    label: string;
    count: React.ReactNode;
    progress?: number;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={label}
            className={cn(
                'flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                    ? 'bg-card font-semibold text-foreground shadow-sm ring-1 ring-border'
                    : 'text-neutral-600 hover:bg-muted',
                disabled && 'cursor-default opacity-40 hover:bg-transparent'
            )}
        >
            {icon}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="line-clamp-2 break-words text-body leading-snug">{label}</span>
                {progress !== undefined ? (
                    <Progress value={progress} className="h-1 !bg-neutral-200" />
                ) : null}
            </span>
            <span className="shrink-0 text-caption tabular-nums text-neutral-400">{count}</span>
        </button>
    );
}

function EmptyPane({ title, description }: { title: string; description?: string }) {
    return (
        <div className="flex flex-col items-center justify-center gap-1 px-6 py-16 text-center">
            <PlayCircle size={28} className="text-neutral-300" />
            <p className="text-body font-semibold text-neutral-700">{title}</p>
            {description ? <p className="text-caption text-neutral-500">{description}</p> : null}
        </div>
    );
}
