/**
 * Social accounts & posts: connected profiles on the left, the post calendar and the
 * composer on the right. View, month and status filter are URL state; the post being
 * edited is component state (spec §7).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Plus, ShareNetwork } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { PillTabs, ScreenHeader } from '@/components/shared/crm-enhance/screen-header';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getUserId } from '@/utils/userDetails';
import { ConnectAccountsDialog } from '../../-marketing/connect-dialog';
import { useOAuthReturn } from '../../-marketing/use-oauth-return';
import { useSocialAccounts, useSocialPosts } from '../../-marketing/use-marketing';
import type { SocialPost } from '../../-marketing/types';
import type { SocialPostsSearch, SocialView } from '../index';
import { AccountsPanel } from './accounts-panel';
import { PostCalendar } from './post-calendar';
import { PostComposer } from './post-composer';
import {
    isCurrentUserAdmin,
    monthWindow,
    parseMonthKey,
    postDate,
    toMonthKey,
    toStatusFilter,
    type StatusFilter,
} from './social-utils';

const PANEL = 'flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 sm:p-5';

export function SocialPostsPage() {
    const { t, i18n } = useTranslation('marketingSocial');
    const setNavHeading = useNavHeadingStore((s) => s.setNavHeading);
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('page.title')}</h1>);
    }, [setNavHeading, t]);

    const navigate = useNavigate({ from: '/audience-manager/social-posts/' });
    const search = useSearch({ from: '/audience-manager/social-posts/' });
    const view: SocialView = search.view ?? 'calendar';
    const month = useMemo(() => parseMonthKey(search.month), [search.month]);
    const filter = toStatusFilter(search.status);

    const isAdmin = useMemo(() => isCurrentUserAdmin(), []);
    const currentUserId = useMemo(() => getUserId(), []);

    const accountsQuery = useSocialAccounts();
    const range = useMemo(() => monthWindow(month), [month]);
    const postsQuery = useSocialPosts(range);

    const [editingPost, setEditingPost] = useState<SocialPost | null>(null);

    const oauth = useOAuthReturn();
    const [connectOpen, setConnectOpen] = useState(() => !!oauth.sessionKey);

    const setSearch = (patch: Partial<SocialPostsSearch>) =>
        navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

    const isCurrentMonth = toMonthKey(month) === toMonthKey(new Date());
    const scheduledCount = (postsQuery.data ?? []).filter((p) => p.status === 'SCHEDULED').length;
    const monthName = new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(month);

    const openComposer = () => {
        setEditingPost(null);
        setSearch({ view: 'new' });
    };
    const editPost = (post: SocialPost) => {
        setEditingPost(post);
        setSearch({ view: 'new' });
    };
    const onSaved = (post: SocialPost | undefined) => {
        setEditingPost(null);
        const target = post ? toMonthKey(postDate(post)) : toMonthKey(month);
        setSearch({
            view: undefined,
            month: target === toMonthKey(new Date()) ? undefined : target,
            status: undefined,
        });
    };

    return (
        <div className="flex flex-col gap-6 pb-10">
            <ScreenHeader
                icon={ShareNetwork}
                title={t('page.title')}
                subtitle={t('page.subtitle')}
                actions={
                    view === 'calendar' ? (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            className="gap-1.5"
                            onClick={openComposer}
                        >
                            <Plus size={16} weight="bold" aria-hidden />
                            {t('page.newPost')}
                        </MyButton>
                    ) : null
                }
            />

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
                <div className="lg:col-span-1">
                    <AccountsPanel isAdmin={isAdmin} />
                </div>

                <section className={`${PANEL} lg:col-span-2`} aria-label={t('page.postsLabel')}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <PillTabs
                            tabs={[
                                { key: 'calendar', label: t('tabs.calendar') },
                                {
                                    key: 'new',
                                    label: editingPost ? t('tabs.edit') : t('tabs.new'),
                                },
                            ]}
                            value={view}
                            onChange={(key) =>
                                setSearch({ view: key === 'new' ? 'new' : undefined })
                            }
                        />
                        {postsQuery.data && (
                            <p className="text-caption tabular-nums text-neutral-500">
                                {isCurrentMonth
                                    ? t('page.scheduledThisMonth', { count: scheduledCount })
                                    : t('page.scheduledInMonth', {
                                          count: scheduledCount,
                                          month: monthName,
                                      })}
                            </p>
                        )}
                    </div>

                    {view === 'calendar' ? (
                        <PostCalendar
                            month={month}
                            onMonthChange={(next) => {
                                const key = toMonthKey(next);
                                setSearch({
                                    month: key === toMonthKey(new Date()) ? undefined : key,
                                });
                            }}
                            filter={filter}
                            onFilterChange={(next: StatusFilter) =>
                                setSearch({ status: next === 'ALL' ? undefined : next })
                            }
                            posts={postsQuery.data}
                            isLoading={postsQuery.isLoading}
                            isFetching={postsQuery.isFetching}
                            error={postsQuery.error}
                            onRetry={() => postsQuery.refetch()}
                            isAdmin={isAdmin}
                            currentUserId={currentUserId}
                            onEdit={editPost}
                            onCreate={openComposer}
                        />
                    ) : (
                        <PostComposer
                            key={editingPost?.id ?? 'new'}
                            accounts={accountsQuery.data}
                            accountsLoading={accountsQuery.isLoading}
                            isAdmin={isAdmin}
                            editingPost={editingPost}
                            onSaved={onSaved}
                            onCancelEdit={() => setEditingPost(null)}
                        />
                    )}
                </section>
            </div>

            <ConnectAccountsDialog
                sessionKey={oauth.sessionKey}
                provider={oauth.provider}
                open={connectOpen && !!oauth.sessionKey}
                onOpenChange={(open) => {
                    setConnectOpen(open);
                    if (!open) oauth.clear();
                }}
            />
        </div>
    );
}
