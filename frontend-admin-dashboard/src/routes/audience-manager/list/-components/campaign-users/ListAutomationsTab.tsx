import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
    Bell,
    CalendarCheck,
    FlowArrow,
    PencilSimple,
    Plus,
    UsersThree,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { SettingsQuickAccessButton } from '@/components/settings/quick-access/SettingsQuickAccessButton';
import { SettingsTabs } from '@/routes/settings/-constants/terms';
import { getActiveWorkflowsQuery } from '@/services/workflow-service';
import type { CounselorPoolDTO } from '@/services/counselor-pool';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { cn } from '@/lib/utils';
import type { CampaignItem } from '../../-services/get-campaigns-list';
import type { CustomFieldConfig } from '../../-utils/lead-bulk-import-utils';
import { LinkedWorkflowsDialog } from '../audience-invite/linked-workflows-dialog';
import { ConfigureAudienceWorkflowDialog } from '../audience-invite/configure-audience-workflow-dialog';
import { BookingSettingsDialog } from '../booking-settings/BookingSettingsDialog';

/** Form section that holds notifications and the initial lead score. */
const STEP_NOTIFY = 4;

/** Same event match as the card menu count and the Linked Workflows dialog. */
const LEAD_SUBMITTED = 'AUDIENCE_LEAD_SUBMISSION';

/**
 * "Automations" tab of one lead list: what runs when a lead arrives, the booking
 * page, the counsellor pool and the list's notification settings. Uses the active
 * workflow list the card menu already loads (same query key) and the pool the page
 * already has; the dialogs are the card menu's own.
 */
export function ListAutomationsTab({
    campaignId,
    campaign,
    instituteId,
    pool,
    counsellorNames,
    formFields,
    onEdit,
}: {
    campaignId: string;
    campaign: CampaignItem | undefined;
    instituteId: string;
    pool: CounselorPoolDTO | null | undefined;
    counsellorNames: Map<string, string>;
    formFields: CustomFieldConfig[];
    onEdit: (step: number) => void;
}) {
    const { t } = useTranslation('audienceManagerCampaignUsersTable');
    const [dialog, setDialog] = useState<'linked' | 'configure' | 'booking' | null>(null);
    const listName = campaign?.campaign_name ?? '';

    const workflowsQuery = useQuery({
        ...getActiveWorkflowsQuery(instituteId),
        enabled: !!instituteId,
    });
    const linked = (workflowsQuery.data ?? [])
        .filter(
            (w) =>
                w.trigger?.trigger_event_name === LEAD_SUBMITTED &&
                (w.trigger.event_id === campaignId || w.trigger.event_id === null)
        )
        .map((w) => ({ ...w, isSpecific: w.trigger?.event_id === campaignId }))
        .sort((a, b) => Number(b.isSpecific) - Number(a.isSpecific));

    // Member rows are kept per list; show this list's rows, else one row per person.
    const activeMembers = (pool?.members ?? []).filter(
        (m) => (m.status ?? '').toUpperCase() !== 'INACTIVE'
    );
    const forThisList = activeMembers.filter((m) => m.audience_id === campaignId);
    const members = (forThisList.length ? forThisList : activeMembers)
        .filter(
            (m, i, all) => all.findIndex((x) => x.counselor_user_id === m.counselor_user_id) === i
        )
        .sort((a, b) => a.display_order - b.display_order);
    const emails = (campaign?.to_notify ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <SectionCard
                    className="lg:col-span-2"
                    icon={FlowArrow}
                    title={t('detail.auto.workflowsTitle')}
                    subtitle={t('detail.auto.workflowsSub', { count: linked.length })}
                    right={
                        <div className="flex flex-wrap gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setDialog('linked')}
                            >
                                {t('detail.auto.viewAll')}
                            </MyButton>
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                onClick={() => setDialog('configure')}
                                disable={!campaign}
                            >
                                <Plus size={14} />
                                {t('detail.auto.configure')}
                            </MyButton>
                        </div>
                    }
                >
                    {workflowsQuery.isLoading ? (
                        <EmptyChart text={t('detail.auto.loading')} className="h-24" />
                    ) : workflowsQuery.isError ? (
                        <EmptyChart text={t('detail.auto.loadError')} className="h-24" />
                    ) : linked.length === 0 ? (
                        <EmptyChart text={t('detail.auto.workflowsEmpty')} className="h-24" />
                    ) : (
                        <ul className="flex flex-col divide-y divide-neutral-100">
                            {linked.map((w) => (
                                <li key={w.id} className="flex items-center gap-3 py-2.5">
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-body font-medium text-neutral-800">
                                            {w.name}
                                        </span>
                                        {w.description && (
                                            <span className="block truncate text-caption text-neutral-500">
                                                {w.description}
                                            </span>
                                        )}
                                    </span>
                                    <span
                                        className={cn(
                                            'shrink-0 rounded-full px-2 py-0.5 text-caption font-medium',
                                            w.isSpecific
                                                ? 'bg-primary-50 text-primary-600'
                                                : 'bg-info-50 text-info-600'
                                        )}
                                    >
                                        {w.isSpecific
                                            ? t('detail.auto.thisList')
                                            : t('detail.auto.allLists')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="mt-3 text-caption text-neutral-500">
                        {t('detail.auto.workflowsFoot')}
                    </p>
                </SectionCard>

                <SectionCard
                    icon={CalendarCheck}
                    title={t('detail.auto.bookingTitle')}
                    subtitle={t('detail.auto.bookingText')}
                >
                    <div className="mt-auto">
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setDialog('booking')}
                        >
                            {t('detail.auto.bookingOpen')}
                        </MyButton>
                    </div>
                </SectionCard>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SectionCard
                    icon={UsersThree}
                    title={t('detail.auto.poolTitle')}
                    subtitle={pool ? pool.name : t('detail.auto.poolNone')}
                    right={
                        <SettingsQuickAccessButton
                            settingsKey={SettingsTabs.LeadSettings}
                            label={t('detail.auto.leadSettings')}
                        />
                    }
                >
                    {!pool ? (
                        <EmptyChart text={t('detail.auto.poolEmpty')} className="h-24" />
                    ) : members.length === 0 ? (
                        <EmptyChart text={t('detail.auto.poolNoMembers')} className="h-24" />
                    ) : (
                        <ul className="flex flex-col divide-y divide-neutral-100">
                            {members.map((m) => {
                                const name =
                                    counsellorNames.get(m.counselor_user_id) ??
                                    t('detail.auto.counsellorFallback');
                                return (
                                    <li key={m.id} className="flex items-center gap-3 py-2">
                                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600">
                                            {name.slice(0, 1).toUpperCase()}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-body text-neutral-800">
                                            {name}
                                        </span>
                                        {m.monthly_target != null && (
                                            <span className="shrink-0 text-caption text-neutral-500">
                                                {t('detail.auto.monthlyTarget', {
                                                    count: m.monthly_target,
                                                })}
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </SectionCard>

                <SectionCard
                    icon={Bell}
                    title={t('detail.auto.notifyTitle')}
                    right={
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onEdit(STEP_NOTIFY)}
                            disable={!campaign}
                        >
                            <PencilSimple size={14} />
                            {t('detail.auto.edit')}
                        </MyButton>
                    }
                >
                    <dl className="flex flex-col gap-3">
                        <div>
                            <dt className="text-caption text-neutral-500">
                                {t('detail.auto.teamNotify')}
                            </dt>
                            <dd className="break-words text-body text-neutral-800">
                                {emails.length ? emails.join(', ') : t('detail.none')}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-caption text-neutral-500">
                                {t('detail.auto.respondentEmail')}
                            </dt>
                            <dd className="text-body text-neutral-800">
                                {campaign?.send_respondent_email
                                    ? t('detail.auto.on')
                                    : t('detail.auto.off')}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-caption text-neutral-500">
                                {t('detail.auto.initialScore')}
                            </dt>
                            <dd className="text-body text-neutral-800">
                                {campaign?.default_initial_score ?? t('detail.none')}
                            </dd>
                        </div>
                    </dl>
                </SectionCard>
            </div>

            {instituteId && (
                <>
                    <LinkedWorkflowsDialog
                        open={dialog === 'linked'}
                        onOpenChange={(o) => !o && setDialog(null)}
                        audienceId={campaignId}
                        audienceName={listName}
                        instituteId={instituteId}
                    />
                    <ConfigureAudienceWorkflowDialog
                        open={dialog === 'configure'}
                        onOpenChange={(o) => !o && setDialog(null)}
                        audienceId={campaignId}
                        audienceName={listName}
                        instituteId={instituteId}
                        customFields={formFields}
                    />
                    <BookingSettingsDialog
                        open={dialog === 'booking'}
                        onOpenChange={(o) => !o && setDialog(null)}
                        audienceId={campaignId}
                        audienceName={listName}
                        instituteId={instituteId}
                    />
                </>
            )}
        </div>
    );
}
