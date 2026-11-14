import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowSquareOut, Code, Copy, LinkSimple, Plug, QrCode } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useListCampaign } from '../../-hooks/useListCampaign';
import createCampaignLink from '../../-utils/createCampaignLink';
import { ShareQrDialog } from '../share-qr-dialog/ShareQrDialog';
import { EmbedCodeDialog } from '../embed-code-dialog/EmbedCodeDialog';
import { ApiIntegrationDialog } from '../api-integration-dialog/ApiIntegrationDialog';

/**
 * Lead list page: the form link with copy / open, and the QR, embed and
 * API dialogs the list card menu already has — so sharing does not mean going back
 * to the Lead Lists page. The list itself comes from the Lead Lists cache when the
 * page was opened from there; otherwise it is fetched once (useListCampaign).
 */
export function ListShareBar({ campaignId }: { campaignId: string }) {
    const { t } = useTranslation('crmPages');
    const { instituteDetails } = useInstituteDetailsStore();
    const [dialog, setDialog] = useState<'qr' | 'embed' | 'api' | null>(null);
    const { data: campaign } = useListCampaign(campaignId);
    if (!campaign) return null;

    const active = (campaign.status || '').toUpperCase() === 'ACTIVE';
    const link = createCampaignLink(campaignId, instituteDetails?.learner_portal_base_url);
    const copy = async () => {
        const ok = await copyTextToClipboard(link);
        if (ok) toast.success(t('listShare.copied'));
        else toast.error(t('listShare.copyFailed'));
    };

    return (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
            {active ? (
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5">
                    <LinkSimple size={14} className="shrink-0 text-neutral-500" />
                    <span className="min-w-0 truncate font-mono text-neutral-700" title={link}>
                        <span className="text-caption">{link}</span>
                    </span>
                    <MyButton buttonType="text" scale="small" onClick={copy}>
                        <Copy size={14} />
                        {t('listShare.copy')}
                    </MyButton>
                    <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-primary-600 hover:text-primary-700"
                    >
                        <ArrowSquareOut size={14} />
                        <span className="text-caption">{t('listShare.open')}</span>
                    </a>
                </div>
            ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2 text-neutral-600">
                    <LinkSimple size={14} />
                    <span className="text-caption">{t('listShare.inactive')}</span>
                </div>
            )}
            <MyButton buttonType="secondary" scale="small" onClick={() => setDialog('qr')}>
                <QrCode size={14} />
                {t('listShare.qr')}
            </MyButton>
            <MyButton buttonType="secondary" scale="small" onClick={() => setDialog('embed')}>
                <Code size={14} />
                {t('listShare.embed')}
            </MyButton>
            <MyButton buttonType="secondary" scale="small" onClick={() => setDialog('api')}>
                <Plug size={14} />
                {t('listShare.api')}
            </MyButton>
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
