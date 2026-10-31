import { useState } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
    AddressBook,
    ChartPieSlice,
    GraduationCap,
    Tag,
    UserPlus,
    UsersThree,
} from '@phosphor-icons/react';
import { InsightStrip, StatStrip, type Insight } from '@/components/shared/crm-enhance';
import { GroupHero } from '@/components/shared/crm-enhance/group-hero';
import {
    GroupDashboardShell,
    useIsInstituteAdmin,
} from '@/components/shared/crm-enhance/group-dashboard-shell';
import { CrmLink, Meter } from '@/routes/dashboard/-components/crm/crm-cards';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { formatNumber, formatPercent, pctChange } from '@/routes/dashboard/-utils/crm-dashboard';
import {
    useGroupDashboard,
    type ContactsSections,
    type GroupRangeDays,
} from '@/services/group-dashboard';

export const Route = createLazyFileRoute('/manage-contacts/dashboard/')({
    component: ContactsDashboardPage,
});

const LINK_BTN =
    'inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-1.5 font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-600';

/**
 * Contacts Dashboard: one row per person across learners and lead respondents —
 * how many there are, who is new, how many leads became learners and how well
 * contacts are tagged. Whole-institute numbers, so admins only.
 */
function ContactsDashboardPage() {
    const { t } = useTranslation('crmPages');
    const isAdmin = useIsInstituteAdmin();
    const [days, setDays] = useState<GroupRangeDays>(30);
    const q = useGroupDashboard<ContactsSections>('contacts', days, isAdmin);
    const s = q.data?.sections.summary;
    const daily = q.data?.sections.daily ?? [];
    const tags = q.data?.sections.tags ?? [];

    const contacts = s ? s.learners + s.leads - s.both_count : 0;
    const newNow = s ? s.new_learners + s.new_leads : 0;
    const newPrev = s ? s.prev_new_learners + s.prev_new_leads : 0;
    const learnersOnly = s ? s.learners - s.both_count : 0;
    const leadsOnly = s ? s.leads - s.both_count : 0;

    const insights: Insight[] = [];
    if (s && contacts > 0) {
        const untagged = contacts - s.tagged;
        if (untagged / contacts >= 0.3) {
            insights.push({
                key: 'untagged',
                tone: 'warning',
                title: t('contactsDash.insights.untagged.title', {
                    share: formatPercent(untagged, contacts, 0),
                }),
                text: t('contactsDash.insights.untagged.text'),
                href: '/user-tags/institute',
            });
        }
        if (s.invited_learners > 0) {
            insights.push({
                key: 'invited',
                tone: 'info',
                title: t('contactsDash.insights.invited.title', {
                    total: formatNumber(s.invited_learners),
                }),
                text: t('contactsDash.insights.invited.text'),
                href: '/manage-students/students-list',
            });
        }
        if (s.leads > 0) {
            insights.push({
                key: 'conversion',
                tone: 'success',
                title: t('contactsDash.insights.conversion.title', {
                    rate: formatPercent(s.both_count, s.leads),
                }),
                text: t('contactsDash.insights.conversion.text', {
                    total: formatNumber(s.both_count),
                }),
                href: '/manage-contacts',
            });
        }
        const growth = pctChange(newNow, newPrev);
        if (growth !== null && Math.abs(growth) >= 20) {
            insights.push({
                key: 'growth',
                tone: growth > 0 ? 'success' : 'danger',
                title: t(
                    growth > 0
                        ? 'contactsDash.insights.up.title'
                        : 'contactsDash.insights.down.title',
                    {
                        pct: Math.abs(growth),
                    }
                ),
                text: t('contactsDash.insights.growthText', { days }),
            });
        }
    }

    const split = [
        { key: 'learnersOnly', n: learnersOnly, tone: 'success' as const },
        { key: 'leadsOnly', n: leadsOnly, tone: 'info' as const },
        { key: 'both', n: s?.both_count ?? 0, tone: 'primary' as const },
    ];
    const tagMax = Math.max(1, ...tags.map((x) => x.users), contacts - (s?.tagged ?? 0));

    return (
        <GroupDashboardShell
            title={t('contactsDash.title')}
            subtitle={t('contactsDash.subtitle')}
            isAdmin={isAdmin}
            isLoading={q.isLoading}
            isError={q.isError}
            actions={
                <>
                    <CrmLink href="/manage-contacts" className={LINK_BTN}>
                        <UsersThree size={14} />
                        <span className="text-caption">{t('contactsDash.allContacts')}</span>
                    </CrmLink>
                    <CrmLink href="/user-tags/institute" className={LINK_BTN}>
                        <Tag size={14} />
                        <span className="text-caption">{t('contactsDash.userTags')}</span>
                    </CrmLink>
                </>
            }
        >
            {s && (
                <>
                    <GroupHero
                        icon={AddressBook}
                        eyebrow={t('contactsDash.hero.eyebrow', { days })}
                        value={formatNumber(contacts)}
                        unit={t('contactsDash.hero.unit')}
                        delta={pctChange(newNow, newPrev)}
                        deltaTitle={t('contactsDash.hero.deltaTitle')}
                        sub={t('contactsDash.hero.sub', {
                            fresh: formatNumber(newNow),
                            learners: formatNumber(s.learners),
                            leads: formatNumber(leadsOnly),
                        })}
                        compare={t('contactsDash.hero.compare', {
                            days,
                            total: formatNumber(newPrev),
                        })}
                        days={daily.map((d) => d.day)}
                        series={[
                            {
                                key: 'leads',
                                label: t('contactsDash.hero.leads'),
                                tint: 'info',
                                values: daily.map((d) => d.leads),
                            },
                            {
                                key: 'learners',
                                label: t('contactsDash.hero.learners'),
                                tint: 'success',
                                values: daily.map((d) => d.learners),
                            },
                        ]}
                        range={days}
                        onRange={setDays}
                        fromDay={q.data?.from_day}
                        toDay={q.data?.to_day}
                    />
                    <StatStrip
                        deltaTitle={t('contactsDash.hero.deltaTitle')}
                        items={[
                            {
                                key: 'new',
                                icon: UserPlus,
                                label: t('contactsDash.stats.new'),
                                value: newNow,
                                delta: pctChange(newNow, newPrev),
                                detail: t('contactsDash.stats.newDetail', {
                                    total: formatNumber(Math.round(newNow / days)),
                                }),
                                spark: daily.map((d) => d.leads + d.learners),
                                href: '/manage-contacts',
                            },
                            {
                                key: 'active',
                                icon: GraduationCap,
                                tint: 'success',
                                label: t('contactsDash.stats.active'),
                                value: s.active_learners,
                                detail: t('contactsDash.stats.activeDetail', {
                                    invited: formatNumber(s.invited_learners),
                                }),
                                href: '/manage-students/students-list',
                            },
                            {
                                key: 'converted',
                                icon: ChartPieSlice,
                                tint: 'info',
                                label: t('contactsDash.stats.converted'),
                                value: formatPercent(s.both_count, s.leads),
                                detail: t('contactsDash.stats.convertedDetail', {
                                    total: formatNumber(s.both_count),
                                }),
                            },
                            {
                                key: 'tags',
                                icon: Tag,
                                tint: 'warning',
                                label: t('contactsDash.stats.tags'),
                                value: formatPercent(s.tagged, contacts, 0),
                                detail: t('contactsDash.stats.tagsDetail', {
                                    total: formatNumber(s.tagged),
                                }),
                                href: '/user-tags/institute',
                            },
                        ]}
                    />
                    <InsightStrip insights={insights} />
                    <div className="grid gap-4 xl:grid-cols-2">
                        <SectionCard
                            icon={ChartPieSlice}
                            title={t('contactsDash.split.title')}
                            subtitle={t('contactsDash.split.subtitle', {
                                total: formatNumber(contacts),
                            })}
                        >
                            <div className="space-y-3">
                                {split.map((r) => (
                                    <div
                                        key={r.key}
                                        className="grid grid-cols-12 items-center gap-3"
                                    >
                                        <span className="col-span-4 text-neutral-700">
                                            <span className="text-caption">
                                                {t(`contactsDash.split.${r.key}`)}
                                            </span>
                                        </span>
                                        <span className="col-span-5">
                                            <Meter
                                                value={r.n}
                                                max={Math.max(1, contacts)}
                                                tone={r.tone}
                                            />
                                        </span>
                                        <span className="col-span-3 text-right font-semibold tabular-nums text-neutral-900">
                                            <span className="text-caption">
                                                {formatNumber(r.n)} ·{' '}
                                                {formatPercent(r.n, contacts, 0)}
                                            </span>
                                        </span>
                                    </div>
                                ))}
                                <p className="pt-1 text-neutral-500">
                                    <span className="text-caption">
                                        {t('contactsDash.split.foot')}
                                    </span>
                                </p>
                            </div>
                        </SectionCard>
                        <SectionCard
                            icon={Tag}
                            title={t('contactsDash.tags.title')}
                            subtitle={t('contactsDash.tags.subtitle')}
                        >
                            {tags.length === 0 ? (
                                <EmptyChart text={t('contactsDash.tags.empty')} />
                            ) : (
                                <div className="space-y-2">
                                    {tags.map((x) => (
                                        <div
                                            key={x.tag_id}
                                            className="grid grid-cols-12 items-center gap-3"
                                        >
                                            <span
                                                className="col-span-4 truncate text-neutral-700"
                                                title={x.name}
                                            >
                                                <span className="text-caption">{x.name}</span>
                                            </span>
                                            <span className="col-span-6">
                                                <Meter value={x.users} max={tagMax} tone="info" />
                                            </span>
                                            <span className="col-span-2 text-right font-semibold tabular-nums text-neutral-900">
                                                <span className="text-caption">
                                                    {formatNumber(x.users)}
                                                </span>
                                            </span>
                                        </div>
                                    ))}
                                    <div className="grid grid-cols-12 items-center gap-3">
                                        <span className="col-span-4 text-danger-600">
                                            <span className="text-caption">
                                                {t('contactsDash.tags.none')}
                                            </span>
                                        </span>
                                        <span className="col-span-6">
                                            <Meter
                                                value={Math.max(0, contacts - s.tagged)}
                                                max={tagMax}
                                                tone="danger"
                                            />
                                        </span>
                                        <span className="col-span-2 text-right font-semibold tabular-nums text-neutral-900">
                                            <span className="text-caption">
                                                {formatNumber(Math.max(0, contacts - s.tagged))}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                            )}
                        </SectionCard>
                    </div>
                </>
            )}
        </GroupDashboardShell>
    );
}
