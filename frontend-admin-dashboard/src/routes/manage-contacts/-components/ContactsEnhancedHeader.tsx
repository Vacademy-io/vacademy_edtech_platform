import { useTranslation } from 'react-i18next';
import { AddressBook, ChartPieSlice, GraduationCap, Tag } from '@phosphor-icons/react';
import { EnhancedHeader, StatStrip } from '@/components/shared/crm-enhance';
import { useIsInstituteAdmin } from '@/components/shared/crm-enhance/group-dashboard-shell';
import { formatNumber, formatPercent, pctChange } from '@/routes/dashboard/-utils/crm-dashboard';
import { useGroupDashboard, type ContactsSections } from '@/services/group-dashboard';

/**
 * All Contacts (admins): contact totals above the list, from the Contacts
 * Dashboard summary (same cached request). The list below is unchanged.
 */
export function ContactsEnhancedHeader() {
    const isAdmin = useIsInstituteAdmin();
    const { t } = useTranslation('crmPages');
    const q = useGroupDashboard<ContactsSections>('contacts', 30, isAdmin);
    if (!isAdmin) return null;
    const s = q.data?.sections.summary;
    const contacts = s ? s.learners + s.leads - s.both_count : undefined;
    const fresh = s ? s.new_learners + s.new_leads : undefined;
    const loading = q.isLoading;
    return (
        <EnhancedHeader>
            <StatStrip
                deltaTitle={t('contactsDash.hero.deltaTitle')}
                items={[
                    {
                        key: 'contacts',
                        icon: AddressBook,
                        label: t('contactsDash.hero.unit'),
                        value: contacts,
                        delta: s
                            ? pctChange(fresh ?? 0, s.prev_new_learners + s.prev_new_leads)
                            : null,
                        detail: s
                            ? t('contactsList.newDetail', { total: formatNumber(fresh) })
                            : undefined,
                        href: '/manage-contacts/dashboard',
                        loading,
                    },
                    {
                        key: 'active',
                        icon: GraduationCap,
                        tint: 'success',
                        label: t('contactsDash.stats.active'),
                        value: s?.active_learners,
                        detail: s
                            ? t('contactsDash.stats.activeDetail', {
                                  invited: formatNumber(s.invited_learners),
                              })
                            : undefined,
                        loading,
                    },
                    {
                        key: 'converted',
                        icon: ChartPieSlice,
                        tint: 'info',
                        label: t('contactsDash.stats.converted'),
                        value: s ? formatPercent(s.both_count, s.leads) : undefined,
                        detail: s
                            ? t('contactsDash.stats.convertedDetail', {
                                  total: formatNumber(s.both_count),
                              })
                            : undefined,
                        loading,
                    },
                    {
                        key: 'tags',
                        icon: Tag,
                        tint: 'warning',
                        label: t('contactsDash.stats.tags'),
                        value: s && contacts ? formatPercent(s.tagged, contacts, 0) : undefined,
                        detail: s
                            ? t('contactsDash.stats.tagsDetail', { total: formatNumber(s.tagged) })
                            : undefined,
                        href: '/user-tags/institute',
                        loading,
                    },
                ]}
            />
        </EnhancedHeader>
    );
}
