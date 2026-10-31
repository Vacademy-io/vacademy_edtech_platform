import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import type { Icon } from '@phosphor-icons/react';
import {
    FacebookLogo,
    Globe,
    GoogleLogo,
    InstagramLogo,
    ListBullets,
    PencilSimple,
    PhoneIncoming,
    UserMinus,
    UserPlus,
    UsersThree,
    WhatsappLogo,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip, type StatusType } from '@/components/design-system/status-chips';
import type { CampaignItem } from '../../-services/get-campaigns-list';
import { AudienceCampaignCardMenuOptions } from '../audience-invite/audience-campaign-card-menu-options';

/** A tile icon for the list's campaign type (types are free text, matched by part). */
export function campaignTypeIcon(type: string | undefined): Icon {
    const v = (type ?? '').toUpperCase();
    if (v.includes('OPT_OUT')) return UserMinus;
    if (v.includes('WHATSAPP')) return WhatsappLogo;
    if (v.includes('PHONE') || v.includes('CALL')) return PhoneIncoming;
    if (v.includes('GOOGLE')) return GoogleLogo;
    if (v.includes('FACEBOOK') || v.includes('META')) return FacebookLogo;
    if (v.includes('INSTAGRAM')) return InstagramLogo;
    if (v.includes('WEB')) return Globe;
    return ListBullets;
}

const STATUS_TONE: Record<string, StatusType> = {
    ACTIVE: 'SUCCESS',
    DRAFT: 'WARNING',
    INACTIVE: 'INFO',
};

interface LeadListDetailHeaderProps {
    campaign: CampaignItem | undefined;
    fallbackName: string;
    respondentsLabel: string;
    isOptOut: boolean;
    pool: { name: string; members?: unknown[] | null } | null | undefined;
    onAddResponse: () => void;
    onEdit: () => void;
}

/**
 * Lead list page heading: type tile, name, status, the one-line summary
 * (respondents · campaign type · run dates), the pool it feeds and the list's
 * actions. "More" is the same menu the list card has on Lead Lists.
 */
export function LeadListDetailHeader({
    campaign,
    fallbackName,
    respondentsLabel,
    isOptOut,
    pool,
    onAddResponse,
    onEdit,
}: LeadListDetailHeaderProps) {
    const { t, i18n } = useTranslation('audienceManagerCampaignUsersTable');
    const navigate = useNavigate();
    const TypeIcon = campaignTypeIcon(campaign?.campaign_type);
    const status = (campaign?.status ?? '').toUpperCase();
    const fmtDate = (v: string | undefined) => {
        if (!v) return '';
        const d = new Date(v);
        return Number.isNaN(d.getTime())
            ? v
            : d.toLocaleDateString(i18n.language, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
              });
    };
    const start = fmtDate(campaign?.start_date_local);
    const end = fmtDate(campaign?.end_date_local);
    const name = campaign?.campaign_name || fallbackName;
    const memberCount = pool?.members?.length ?? 0;

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                    <TypeIcon size={22} weight="duotone" />
                </span>
                <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h1
                            className="truncate text-h2 font-semibold text-neutral-900"
                            title={name}
                        >
                            {name}
                        </h1>
                        {status && (
                            <StatusChip
                                text={t(`detail.status.${status}`, { defaultValue: status })}
                                textSize="text-caption"
                                status={STATUS_TONE[status] ?? 'INFO'}
                                showIcon={false}
                            />
                        )}
                    </div>
                    <p className="mt-1 text-body text-neutral-500">
                        {[
                            respondentsLabel,
                            campaign?.campaign_type,
                            start && end ? t('detail.runs', { start, end }) : '',
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </p>
                    {/* Where this list's leads get routed. Only auto-assigned lists have a
                        pool, so its absence is meaningful rather than missing data. */}
                    {pool && (
                        <span
                            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-caption font-medium text-primary-600"
                            title={t('detail.pool.title', { name: pool.name })}
                        >
                            <UsersThree className="size-3.5" weight="fill" />
                            {pool.name}
                            {memberCount ? (
                                <span className="font-regular text-primary-500">
                                    · {t('detail.pool.members', { count: memberCount })}
                                </span>
                            ) : null}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                {campaign && (
                    <MyButton buttonType="secondary" scale="medium" onClick={onEdit}>
                        <PencilSimple size={16} />
                        {t('detail.editList')}
                    </MyButton>
                )}
                {campaign && (
                    <span className="rounded-md border border-neutral-200 bg-white">
                        <AudienceCampaignCardMenuOptions
                            campaign={campaign}
                            onEdit={onEdit}
                            onDeleted={() => navigate({ to: '/audience-manager/list' })}
                        />
                    </span>
                )}
                {!isOptOut && (
                    <MyButton buttonType="primary" scale="medium" onClick={onAddResponse}>
                        <UserPlus size={16} />
                        {t('heading.addResponse')}
                    </MyButton>
                )}
            </div>
        </div>
    );
}
