import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Books,
    ChartBar,
    Files,
    FolderSimple,
    Lightbulb,
    Plus,
    Stack,
    Tag,
    Tray,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { LibraryNode, LibrarySummary } from '../-services/question-library-services';
import { DIFFICULTIES, difficultyBar } from './library-constants';

const StatCard = ({
    icon,
    iconClassName,
    label,
    value,
    hint,
    loading,
    children,
}: {
    icon: ReactNode;
    iconClassName: string;
    label: string;
    value?: ReactNode;
    hint?: ReactNode;
    loading: boolean;
    children?: ReactNode;
}) => (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <span
            className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-md',
                iconClassName
            )}
        >
            {icon}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-caption font-semibold text-neutral-500">{label}</span>
            {loading ? (
                <Skeleton className="my-1 h-7 w-16" />
            ) : (
                <>
                    {value !== undefined && (
                        <span className="text-h2-semibold text-neutral-700">{value}</span>
                    )}
                    {children}
                </>
            )}
            {hint && !loading && (
                <span className="flex items-center gap-1 text-caption text-neutral-500">
                    {hint}
                </span>
            )}
        </div>
    </div>
);

/** One stacked bar for an EASY/MEDIUM/HARD split, with a legend. */
export const DifficultyBar = ({ counts }: { counts: Record<string, number> }) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const total = DIFFICULTIES.reduce((sum, level) => sum + (counts[level] ?? 0), 0);
    if (total === 0) {
        return <span className="text-caption text-neutral-400">{t('stats.noDifficulty')}</span>;
    }
    return (
        <div className="flex flex-col gap-2">
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                {DIFFICULTIES.map((level) =>
                    counts[level] ? (
                        <div
                            key={level}
                            className={cn('h-full', difficultyBar[level])}
                            // Data-driven share of the bar; no token can express it.
                            style={{ width: `${(counts[level] / total) * 100}%` }}
                        />
                    ) : null
                )}
            </div>
            <div className="flex flex-wrap gap-3 text-caption text-neutral-600">
                {DIFFICULTIES.map((level) => (
                    <span key={level} className="flex items-center gap-1">
                        <span className={cn('size-2 rounded-full', difficultyBar[level])} />
                        {t(`difficulty.${level}`)} {counts[level] ?? 0}
                    </span>
                ))}
            </div>
        </div>
    );
};

export const LibraryHeader = ({
    summary,
    nodes,
    loading,
    onNewTopic,
    onImportPaper,
    onImportTags,
    onShowUnsorted,
    onOpenTopic,
}: {
    summary?: LibrarySummary;
    nodes: LibraryNode[];
    loading: boolean;
    onNewTopic: () => void;
    onImportPaper: () => void;
    onImportTags: () => void;
    onShowUnsorted: () => void;
    onOpenTopic: (id: string) => void;
}) => {
    const { t } = useTranslation('assessmentQuestionLibrary');
    const total = summary?.total_questions ?? 0;
    const unsorted = summary?.unsorted_questions ?? 0;
    const sortedShare = total > 0 ? Math.round(((total - unsorted) / total) * 100) : 0;

    // Leaf topics are where questions are actually picked from, so "thin" is judged there.
    const parents = new Set(nodes.map((node) => node.parent_id).filter(Boolean));
    const leaves = nodes.filter((node) => !parents.has(node.id));
    const thinnest = [...leaves].sort((a, b) => a.question_count - b.question_count).slice(0, 3);
    const biggest = [...nodes].sort((a, b) => b.question_count - a.question_count)[0];

    return (
        <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-4 rounded-lg border border-primary-100 bg-gradient-to-r from-primary-50 to-white p-6 lg:flex-row lg:items-center">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-white text-primary-500 shadow-sm">
                    <Books size={28} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-caption font-semibold uppercase tracking-wide text-primary-500">
                        {t('header.eyebrow')}
                    </span>
                    <h1 className="text-h2-semibold text-neutral-700">{t('header.title')}</h1>
                    <p className="max-w-2xl text-body text-neutral-600">
                        {t('header.description')}
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="gap-2"
                        onClick={onImportTags}
                    >
                        <Tag size={16} />
                        {t('header.importTags')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        className="gap-2"
                        onClick={onImportPaper}
                    >
                        <Files size={16} />
                        {t('header.importPaper')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        className="gap-2"
                        onClick={onNewTopic}
                    >
                        <Plus size={16} />
                        {t('header.newTopic')}
                    </MyButton>
                </div>
            </section>

            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                    loading={loading}
                    icon={<Stack size={18} />}
                    iconClassName="bg-primary-50 text-primary-500"
                    label={t('stats.questions')}
                    value={total}
                    hint={
                        summary?.added_last_week ? (
                            <>
                                <span className="rounded-full bg-success-50 px-2 font-semibold text-success-600">
                                    ▲ {summary.added_last_week}
                                </span>
                                {t('stats.thisWeek')}
                            </>
                        ) : (
                            t('stats.nothingNew')
                        )
                    }
                />
                <StatCard
                    loading={loading}
                    icon={<FolderSimple size={18} />}
                    iconClassName="bg-info-50 text-info-600"
                    label={t('stats.topics')}
                    value={summary?.topic_count ?? 0}
                    hint={
                        biggest && biggest.question_count > 0
                            ? t('stats.biggest', {
                                  name: biggest.name,
                                  count: biggest.question_count,
                              })
                            : t('stats.noTopicsYet')
                    }
                />
                <StatCard
                    loading={loading}
                    icon={<Tray size={18} />}
                    iconClassName="bg-warning-50 text-warning-600"
                    label={t('stats.sorted')}
                    value={`${sortedShare}%`}
                    hint={
                        unsorted > 0 ? (
                            <button
                                type="button"
                                onClick={onShowUnsorted}
                                className="font-semibold text-warning-600 underline-offset-2 hover:underline"
                            >
                                {t('stats.unsortedLink', { count: unsorted })}
                            </button>
                        ) : (
                            t('stats.allSorted')
                        )
                    }
                />
                <StatCard
                    loading={loading}
                    icon={<ChartBar size={18} />}
                    iconClassName="bg-success-50 text-success-600"
                    label={t('stats.difficultyMix')}
                >
                    <DifficultyBar counts={summary?.by_difficulty ?? {}} />
                </StatCard>
            </section>

            {!loading && thinnest.length > 0 && thinnest[0]!.question_count < 10 && (
                <section className="flex flex-col gap-2 rounded-lg border border-warning-200 bg-warning-50 p-4 sm:flex-row sm:items-center">
                    <span className="flex items-center gap-2 text-body font-semibold text-neutral-700">
                        <Lightbulb size={18} className="text-warning-600" />
                        {t('insights.thinTopics')}
                    </span>
                    <div className="flex flex-wrap gap-2">
                        {thinnest
                            .filter((node) => node.question_count < 10)
                            .map((node) => (
                                <button
                                    key={node.id}
                                    type="button"
                                    onClick={() => onOpenTopic(node.id)}
                                    className="rounded-full border border-warning-200 bg-white px-3 py-1 text-caption text-neutral-700 hover:border-warning-400"
                                >
                                    {node.name} ·{' '}
                                    {t('insights.questions', { count: node.question_count })}
                                </button>
                            ))}
                    </div>
                </section>
            )}
        </div>
    );
};
