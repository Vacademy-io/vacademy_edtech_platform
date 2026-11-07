import { useState } from 'react';
import { DeviceMobile, DeviceTablet, Envelope, Laptop } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { EmptyState } from '../../create/-components/primitives';

const isFullDocument = (html: string) =>
    /<html[\s\S]*<\/html>/i.test(html) ||
    /<head[\s\S]*<\/head>/i.test(html) ||
    /<body[\s\S]*<\/body>/i.test(html);

/** Wrap fragment HTML so the iframe renders it the way an inbox would. */
export const emailDocument = (html: string) =>
    isFullDocument(html)
        ? html
        : `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>*,*::before,*::after{box-sizing:border-box}body{margin:0;padding:16px;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;line-height:1.5}img,video{max-width:100%;height:auto}table{max-width:100%}.container,.ProseMirror{max-width:none!important}</style></head><body>${html}</body></html>`;

export type PreviewDevice = 'mobile' | 'tablet' | 'desktop';

/** Fixed frame widths are the whole point of a device preview, so they are set inline. */
const DEVICE_WIDTH: Record<PreviewDevice, number> = { mobile: 390, tablet: 768, desktop: 1100 };

interface EmailPreviewFrameProps {
    subject: string;
    previewText: string;
    htmlContent: string;
    senderLabel: string;
    className?: string;
    /** Constrains the frame to a device width; omit to fill the container. */
    device?: PreviewDevice;
}

export function EmailPreviewFrame({
    subject,
    previewText,
    htmlContent,
    senderLabel,
    className,
    device,
}: EmailPreviewFrameProps) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    return (
        <div
            className={cn(
                'mx-auto flex w-full flex-col overflow-hidden rounded-md border bg-card shadow-sm',
                className
            )}
            // Device width is a simulation value, not a design token — see DEVICE_WIDTH.
            style={device ? { maxWidth: DEVICE_WIDTH[device] } : undefined}
        >
            <div className="shrink-0 space-y-0.5 border-b bg-muted/50 px-3 py-2">
                <p className="truncate text-caption text-muted-foreground">
                    <span className="font-semibold text-foreground">{t('preview.from')}</span>{' '}
                    {senderLabel || t('preview.yourInstitute')}
                </p>
                <p className="truncate text-caption text-muted-foreground">
                    <span className="font-semibold text-foreground">{t('preview.to')}</span>{' '}
                    {t('preview.recipients')}
                </p>
                <p className="truncate pt-1 text-body font-semibold text-foreground">
                    {subject || t('preview.noSubject')}
                </p>
                {previewText && (
                    <p className="truncate text-caption text-muted-foreground">{previewText}</p>
                )}
            </div>
            {htmlContent ? (
                <iframe
                    title={t('preview.frameTitle')}
                    sandbox="allow-same-origin"
                    className="size-full min-h-64 flex-1 border-0 bg-card"
                    srcDoc={emailDocument(htmlContent)}
                />
            ) : (
                <div className="flex flex-1 items-center justify-center p-6">
                    <EmptyState
                        Icon={Envelope}
                        title={t('preview.emptyTitle')}
                        description={t('preview.emptyDescription')}
                        className="border-0 bg-transparent"
                    />
                </div>
            )}
        </div>
    );
}

interface EmailPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    subject: string;
    previewText: string;
    htmlContent: string;
    senderLabel: string;
}

/** Full-size preview with the three device widths — opened from the content section. */
export function EmailPreviewDialog(props: EmailPreviewDialogProps) {
    const { t } = useTranslation('announcementEmailCampaigningIndex');
    const [device, setDevice] = useState<PreviewDevice>('desktop');

    const devices: Array<{ value: PreviewDevice; label: string; Icon: typeof Laptop }> = [
        { value: 'mobile', label: t('preview.device.mobile'), Icon: DeviceMobile },
        { value: 'tablet', label: t('preview.device.tablet'), Icon: DeviceTablet },
        { value: 'desktop', label: t('preview.device.desktop'), Icon: Laptop },
    ];

    return (
        <MyDialog
            heading={t('preview.dialogTitle')}
            open={props.open}
            onOpenChange={props.onOpenChange}
            dialogWidth="w-dialog-xl"
        >
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-caption text-muted-foreground">
                        {t('preview.dialogDescription')}
                    </p>
                    <div className="flex items-center gap-1 rounded-md border p-0.5">
                        {devices.map(({ value, label, Icon }) => (
                            <MyButton
                                key={value}
                                buttonType={device === value ? 'primary' : 'text'}
                                scale="small"
                                onClick={() => setDevice(value)}
                                aria-pressed={device === value}
                            >
                                <Icon className="me-1 size-4" />
                                {label}
                            </MyButton>
                        ))}
                    </div>
                </div>
                <div className="overflow-auto rounded-md bg-muted/40 p-3">
                    <EmailPreviewFrame
                        subject={props.subject}
                        previewText={props.previewText}
                        htmlContent={props.htmlContent}
                        senderLabel={props.senderLabel}
                        device={device}
                        className="h-preview-dialog"
                    />
                </div>
            </div>
        </MyDialog>
    );
}
