import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowSquareOut,
    Code,
    Copy,
    LinkSimple,
    ListChecks,
    Palette,
    PencilSimple,
    Plug,
    QrCode,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { copyTextToClipboard } from '@/lib/clipboard';
import {
    EmptyChart,
    SectionCard,
} from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import type { CampaignItem } from '../../-services/get-campaigns-list';
import type { CustomFieldConfig } from '../../-utils/lead-bulk-import-utils';
import createCampaignLink from '../../-utils/createCampaignLink';
import { ShareQrDialog } from '../share-qr-dialog/ShareQrDialog';
import { EmbedCodeDialog } from '../embed-code-dialog/EmbedCodeDialog';
import { ApiIntegrationDialog } from '../api-integration-dialog/ApiIntegrationDialog';

/** Form sections the edit buttons here scroll to (see CreateCampaignForm). */
const STEP_FIELDS = 1;
const STEP_AFTER_SUBMIT = 2;

/**
 * "Share & form" tab of one lead list: the form link, QR / embed / API (the same
 * dialogs as the card menu), and what the form asks. Nothing here is fetched —
 * the list record and its fields are already on the page.
 */
export function ListShareTab({
    campaignId,
    campaign,
    formFields,
    onEdit,
}: {
    campaignId: string;
    campaign: CampaignItem | undefined;
    formFields: CustomFieldConfig[];
    onEdit: (step: number) => void;
}) {
    const { t } = useTranslation('audienceManagerCampaignUsersTable');
    const { instituteDetails } = useInstituteDetailsStore();
    const [dialog, setDialog] = useState<'qr' | 'embed' | 'api' | null>(null);

    if (!campaign) {
        return <EmptyChart text={t('detail.loadingList')} className="h-32" />;
    }

    const active = (campaign.status || '').toUpperCase() === 'ACTIVE';
    const link = createCampaignLink(campaignId, instituteDetails?.learner_portal_base_url);
    const copy = async () => {
        const ok = await copyTextToClipboard(link);
        if (ok) toast.success(t('detail.share.copied'));
        else toast.error(t('detail.share.copyFailed'));
    };

    const shareCards = [
        {
            key: 'qr' as const,
            icon: QrCode,
            title: t('detail.share.qrTitle'),
            text: t('detail.share.qrText'),
            action: t('detail.share.qrOpen'),
        },
        {
            key: 'embed' as const,
            icon: Code,
            title: t('detail.share.embedTitle'),
            text: t('detail.share.embedText'),
            action: t('detail.share.embedOpen'),
        },
        {
            key: 'api' as const,
            icon: Plug,
            title: t('detail.share.apiTitle'),
            text: t('detail.share.apiText'),
            action: t('detail.share.apiOpen'),
        },
    ];

    return (
        <div className="flex flex-col gap-4">
            <SectionCard
                icon={LinkSimple}
                title={t('detail.share.linkTitle')}
                subtitle={t('detail.share.linkSub')}
            >
                {active ? (
                    <div className="flex flex-col gap-3">
                        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                            <LinkSimple size={14} className="shrink-0 text-neutral-500" />
                            <span
                                className="min-w-0 flex-1 truncate font-mono text-caption text-neutral-700"
                                title={link}
                            >
                                {link}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <MyButton buttonType="primary" scale="small" onClick={copy}>
                                <Copy size={14} />
                                {t('detail.share.copy')}
                            </MyButton>
                            <a
                                href={link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-caption font-medium text-neutral-700 hover:bg-neutral-50"
                            >
                                <ArrowSquareOut size={14} />
                                {t('detail.share.open')}
                            </a>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5">
                        <span className="flex-1 text-caption text-warning-700">
                            {t('detail.share.inactive')}
                        </span>
                        <MyButton buttonType="secondary" scale="small" onClick={() => onEdit(0)}>
                            {t('detail.share.changeStatus')}
                        </MyButton>
                    </div>
                )}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {shareCards.map((c) => (
                    <SectionCard key={c.key} icon={c.icon} title={c.title} subtitle={c.text}>
                        <div className="mt-auto">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setDialog(c.key)}
                            >
                                {c.action}
                            </MyButton>
                        </div>
                    </SectionCard>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <SectionCard
                    icon={ListChecks}
                    title={t('detail.share.fieldsTitle')}
                    subtitle={t('detail.share.fieldsSub', { count: formFields.length })}
                    right={
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onEdit(STEP_FIELDS)}
                        >
                            <PencilSimple size={14} />
                            {t('detail.share.editForm')}
                        </MyButton>
                    }
                >
                    {formFields.length === 0 ? (
                        <EmptyChart text={t('detail.share.fieldsEmpty')} className="h-24" />
                    ) : (
                        <ul className="flex flex-col divide-y divide-neutral-100">
                            {formFields.map((f, i) => (
                                <li key={f.id} className="flex items-center gap-3 py-2">
                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600">
                                        {i + 1}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-body font-medium text-neutral-800">
                                            {f.fieldName}
                                        </span>
                                        <span className="block text-caption text-neutral-500">
                                            {f.fieldType}
                                        </span>
                                    </span>
                                    <span
                                        className={
                                            f.isMandatory
                                                ? 'rounded-full bg-primary-50 px-2 py-0.5 text-caption font-medium text-primary-600'
                                                : 'rounded-full bg-neutral-100 px-2 py-0.5 text-caption text-neutral-600'
                                        }
                                    >
                                        {f.isMandatory
                                            ? t('detail.share.required')
                                            : t('detail.share.optional')}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </SectionCard>

                <SectionCard
                    icon={Palette}
                    title={t('detail.share.afterTitle')}
                    subtitle={t('detail.share.afterText')}
                    right={
                        <MyButton
                            buttonType="secondary"
                            scale="small"
                            onClick={() => onEdit(STEP_AFTER_SUBMIT)}
                        >
                            <PencilSimple size={14} />
                            {t('detail.share.afterEdit')}
                        </MyButton>
                    }
                >
                    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {[
                            {
                                k: 'objective',
                                label: t('detail.share.objective'),
                                v: campaign.campaign_objective,
                            },
                            {
                                k: 'description',
                                label: t('detail.share.description'),
                                v: campaign.description,
                            },
                        ].map((row) => (
                            <div key={row.k} className="min-w-0">
                                <dt className="text-caption text-neutral-500">{row.label}</dt>
                                <dd className="line-clamp-3 text-body text-neutral-800">
                                    {row.v || t('detail.none')}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </SectionCard>
            </div>

            <ShareQrDialog
                isOpen={dialog === 'qr'}
                onClose={() => setDialog(null)}
                campaign={campaign}
            />
            <EmbedCodeDialog
                isOpen={dialog === 'embed'}
                onClose={() => setDialog(null)}
                campaign={campaign}
            />
            <ApiIntegrationDialog
                isOpen={dialog === 'api'}
                onClose={() => setDialog(null)}
                campaign={campaign}
            />
        </div>
    );
}
