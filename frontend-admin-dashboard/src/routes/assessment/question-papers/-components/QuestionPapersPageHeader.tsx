import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Files, Plus, Star } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useQuestionPaperStats } from '../-utils/question-paper-list';
import { useAddPaperFlowStore } from '../-global-states/add-paper-flow-store';

const StatCard = ({
    icon,
    iconClassName,
    label,
    value,
    hint,
    loading,
}: {
    icon: ReactNode;
    iconClassName: string;
    label: string;
    value: ReactNode;
    hint: ReactNode;
    loading: boolean;
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
        <div className="flex min-w-0 flex-col">
            <span className="text-caption font-semibold text-neutral-500">{label}</span>
            {loading ? (
                <Skeleton className="my-1 h-7 w-12" />
            ) : (
                <span className="text-h2-semibold text-neutral-700">{value}</span>
            )}
            <span className="flex items-center gap-1 text-caption text-neutral-500">{hint}</span>
        </div>
    </div>
);

/** Question Papers page: hero with the Add button, then three headline figures. */
export const QuestionPapersPageHeader = () => {
    const { t } = useTranslation('assessmentQuestionPapersPage');
    const setChooserOpen = useAddPaperFlowStore((s) => s.setChooserOpen);
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const tokenData = getTokenDecodedData(accessToken);
    const instituteId = tokenData && Object.keys(tokenData.authorities)[0];
    const { data: stats, isLoading } = useQuestionPaperStats(instituteId);

    const delta = stats ? stats.thisWeek - stats.lastWeek : 0;

    return (
        <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-4 rounded-lg border border-primary-100 bg-gradient-to-r from-primary-50 to-white p-6 sm:flex-row sm:items-center">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-primary-100 bg-white text-primary-500 shadow-sm">
                    <Files size={28} />
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
                <MyButton
                    type="button"
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    className="gap-2 self-start sm:self-center"
                    onClick={() => setChooserOpen(true)}
                >
                    <Plus size={18} />
                    {t('header.addQuestionPaper')}
                </MyButton>
            </section>
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard
                    loading={isLoading}
                    icon={<Files size={18} />}
                    iconClassName="bg-primary-50 text-primary-500"
                    label={t('stats.papers')}
                    value={stats?.total ?? 0}
                    hint={t('stats.papersHint')}
                />
                <StatCard
                    loading={isLoading}
                    icon={<Clock size={18} />}
                    iconClassName="bg-success-50 text-success-600"
                    label={t('stats.addedThisWeek')}
                    value={
                        stats?.thisWeekCapped
                            ? t('stats.addedThisWeekMore', { count: stats.thisWeek })
                            : stats?.thisWeek ?? 0
                    }
                    hint={
                        !stats?.thisWeek ? (
                            t('stats.nothingNew')
                        ) : stats.deltaKnown && delta !== 0 ? (
                            <>
                                <span
                                    className={cn(
                                        'rounded-full px-2 font-semibold',
                                        delta > 0
                                            ? 'bg-success-50 text-success-600'
                                            : 'bg-danger-50 text-danger-600'
                                    )}
                                >
                                    {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
                                </span>
                                {t('stats.vsLastWeek')}
                            </>
                        ) : stats.deltaKnown ? (
                            t('stats.sameAsLastWeek')
                        ) : null
                    }
                />
                <StatCard
                    loading={isLoading}
                    icon={<Star size={18} />}
                    iconClassName="bg-warning-50 text-warning-600"
                    label={t('stats.favourites')}
                    value={stats?.favourites ?? 0}
                    hint={
                        stats?.favourites ? t('stats.favouritesHint') : t('stats.favouritesEmpty')
                    }
                />
            </section>
        </div>
    );
};
