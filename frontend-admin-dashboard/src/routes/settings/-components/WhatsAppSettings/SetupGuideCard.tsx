import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { DownloadSimple, Eye, FilePdf, LinkSimple } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

// Hosted on the public media CDN. A new version goes to a new dated key; the
// "-download" copy is stored with Content-Disposition: attachment.
const GUIDE_URL =
    'https://d1om4dxj9e7kkd.cloudfront.net/guides/whatsapp-integration-requirements-2026-10-26.pdf';
const GUIDE_DOWNLOAD_URL =
    'https://d1om4dxj9e7kkd.cloudfront.net/guides/whatsapp-integration-requirements-2026-10-26-download.pdf';

export function SetupGuideCard() {
    const { t } = useTranslation('settingsWhatsApp');
    const [previewOpen, setPreviewOpen] = useState(false);

    const handleDownload = () => {
        const link = document.createElement('a');
        link.href = GUIDE_DOWNLOAD_URL;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(GUIDE_URL);
            toast.success(t('setupGuide.linkCopied'));
        } catch {
            toast.error(t('setupGuide.copyFailed'));
        }
    };

    const shareActions = (
        <>
            <MyButton buttonType="secondary" scale="small" onClick={handleCopyLink}>
                <LinkSimple className="size-4" />
                {t('setupGuide.copyLink')}
            </MyButton>
            <MyButton buttonType="primary" scale="small" onClick={handleDownload}>
                <DownloadSimple className="size-4" />
                {t('setupGuide.download')}
            </MyButton>
        </>
    );

    return (
        <Card className="rounded-lg">
            <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-success-50">
                        <FilePdf className="size-5 text-success-600" />
                    </div>
                    <div>
                        <p className="text-subtitle font-semibold">{t('setupGuide.title')}</p>
                        <p className="text-caption text-muted-foreground">
                            {t('setupGuide.description')}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setPreviewOpen(true)}
                    >
                        <Eye className="size-4" />
                        {t('setupGuide.preview')}
                    </MyButton>
                    {shareActions}
                </div>
            </CardContent>

            <MyDialog
                heading={t('setupGuide.title')}
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                dialogWidth="max-w-3xl"
                footer={shareActions}
            >
                <iframe
                    src={`${GUIDE_URL}#view=FitH`}
                    title={t('setupGuide.title')}
                    className="aspect-[210/297] w-full rounded-md border"
                />
            </MyDialog>
        </Card>
    );
}
