import { useState } from 'react';
import { Bell, DeviceMobile, Laptop, PushPin } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ModeType } from '@/services/announcement';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';
import type { PushConfig, WhatsAppConfig } from '../-types';
import { buildWhatsAppValueSources } from '../-utils/constants';
import { whatsAppVariableNames } from '../-utils/validation';

interface PreviewPanelProps {
    title: string;
    previewText: string;
    htmlContent: string;
    contentText: string;
    modes: ModeType[];
    push: PushConfig;
    whatsapp: WhatsAppConfig;
    whatsappTemplate: WhatsAppTemplateDTO | null;
    senderName: string;
}

const isFullDocument = (html: string) =>
    /<html[\s\S]*<\/html>/i.test(html) ||
    /<head[\s\S]*<\/head>/i.test(html) ||
    /<body[\s\S]*<\/body>/i.test(html);

/** Wrap fragment HTML so the iframe renders it the way an inbox would. */
const emailDocument = (html: string) =>
    isFullDocument(html)
        ? html
        : `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>*,*::before,*::after{box-sizing:border-box}body{margin:0;padding:16px;font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial}img,video{max-width:100%;height:auto}.container,.ProseMirror{max-width:none!important}</style></head><body>${html}</body></html>`;

function PhoneFrame({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto w-full max-w-xs rounded-lg border bg-muted/40 p-3">{children}</div>
    );
}

function InAppPreview({
    title,
    contentText,
    modes,
}: {
    title: string;
    contentText: string;
    modes: ModeType[];
}) {
    const { t } = useTranslation('announcementCreatePreviewPanel');
    const pinned = modes.includes('DASHBOARD_PIN');
    return (
        <PhoneFrame>
            <div className="rounded-md border bg-card p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-caption font-semibold text-muted-foreground">
                        <Bell className="size-3.5" weight="fill" />
                        {t('inApp.badge')}
                    </span>
                    {pinned && (
                        <span className="flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-caption text-primary-600">
                            <PushPin className="size-3" weight="fill" />
                            {t('inApp.pinned')}
                        </span>
                    )}
                </div>
                <p className="text-body font-semibold text-foreground">
                    {title || t('inApp.titlePlaceholder')}
                </p>
                <p className="mt-1 line-clamp-6 text-caption text-muted-foreground">
                    {contentText || t('inApp.contentPlaceholder')}
                </p>
            </div>
        </PhoneFrame>
    );
}

function PushPreview({ push, senderName }: { push: PushConfig; senderName: string }) {
    const { t } = useTranslation('announcementCreatePreviewPanel');
    return (
        <PhoneFrame>
            <div className="rounded-md border bg-card p-3 shadow-sm">
                <p className="text-caption text-muted-foreground">
                    {senderName || t('push.senderPlaceholder')}
                </p>
                <p className="mt-1 text-body font-semibold text-foreground">
                    {push.title || t('push.titlePlaceholder')}
                </p>
                <p className="line-clamp-3 text-caption text-muted-foreground">
                    {push.body || t('push.bodyPlaceholder')}
                </p>
            </div>
        </PhoneFrame>
    );
}

function WhatsAppPreview({
    template,
    config,
    title,
    contentText,
    senderName,
}: {
    template: WhatsAppTemplateDTO | null;
    config: WhatsAppConfig;
    title: string;
    contentText: string;
    senderName: string;
}) {
    const { t } = useTranslation('announcementCreatePreviewPanel');

    if (!template) {
        return (
            <p className="rounded-md border border-dashed bg-muted/40 px-3 py-6 text-center text-caption text-muted-foreground">
                {t('whatsapp.noTemplate')}
            </p>
        );
    }

    // Stand-in recipient, so the preview reads like a real message rather than a row of tokens.
    const SAMPLE = {
        name: 'Riya Sharma',
        username: 'riya.sharma',
        email: 'riya.sharma@example.com',
        phone: '+91 98765 43210',
        id: 'usr_8f21c4',
    };

    const resolve = (name: string) => {
        const binding = config.variables[name];
        if (!binding) return `{{${name}}}`;
        switch (binding.source) {
            case 'ANNOUNCEMENT_TITLE':
                return title || 'Announcement title';
            case 'ANNOUNCEMENT_CONTENT':
                return contentText.slice(0, 100) || 'Announcement content';
            case 'SENDER_NAME':
                return senderName || 'Sender';
            case 'RECIPIENT_NAME':
            case 'RECIPIENT_FULL_NAME':
                return SAMPLE.name;
            case 'RECIPIENT_USERNAME':
                return SAMPLE.username;
            case 'RECIPIENT_EMAIL':
                return SAMPLE.email;
            case 'RECIPIENT_PHONE':
                return SAMPLE.phone;
            case 'RECIPIENT_ID':
                return SAMPLE.id;
            case 'CURRENT_DATE':
                return new Date().toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                });
            case 'CURRENT_TIME':
                return new Date().toLocaleTimeString('en-GB', {
                    hour: '2-digit',
                    minute: '2-digit',
                });
            default:
                return (
                    binding.customValue ||
                    buildWhatsAppValueSources(t).find((s) => s.value === binding.source)?.label ||
                    `{{${name}}}`
                );
        }
    };

    let body = template.bodyText ?? '';
    whatsAppVariableNames(template).forEach((name) => {
        body = body.split(`{{${name}}}`).join(resolve(name));
    });

    return (
        <PhoneFrame>
            <div className="rounded-md border border-success-400 bg-card p-3 shadow-sm">
                {template.headerText && (
                    <p className="mb-1 text-body font-semibold">{template.headerText}</p>
                )}
                <p className="whitespace-pre-wrap text-caption text-foreground">{body}</p>
                {template.footerText && (
                    <p className="mt-2 text-caption text-muted-foreground">{template.footerText}</p>
                )}
                {(template.buttons ?? []).length > 0 && (
                    <div className="mt-2 space-y-1 border-t pt-2">
                        {(template.buttons ?? []).map((button) => (
                            <p key={button.text} className="text-center text-caption text-info-600">
                                {button.text}
                            </p>
                        ))}
                    </div>
                )}
            </div>
        </PhoneFrame>
    );
}

function EmailFrame({
    title,
    previewText,
    htmlContent,
    senderName,
    className,
}: {
    title: string;
    previewText: string;
    htmlContent: string;
    senderName: string;
    className?: string;
}) {
    return (
        <div
            className={cn(
                'mx-auto flex w-full flex-col overflow-hidden rounded-md border bg-card shadow-sm',
                className
            )}
        >
            <div className="shrink-0 border-b bg-muted/50 px-3 py-2">
                <p className="text-caption text-muted-foreground">
                    From: {senderName || 'Your institute'}
                </p>
                <p className="mt-0.5 truncate text-body font-semibold text-foreground">
                    {title || '(No subject)'}
                </p>
                {previewText && (
                    <p className="truncate text-caption text-muted-foreground">{previewText}</p>
                )}
            </div>
            <iframe
                title="Email preview"
                sandbox="allow-same-origin"
                className="size-full min-h-64 flex-1 border-0 bg-card"
                srcDoc={emailDocument(htmlContent)}
            />
        </div>
    );
}

/**
 * The four channel previews, shown in the review dialog rather than beside the form.
 *
 * This used to be a permanent side rail. It cost roughly a third of the page width for something
 * you only need once, right before sending — so it now lives at the end of the flow.
 */
export function PreviewPanel(props: PreviewPanelProps) {
    const [device, setDevice] = useState<'mobile' | 'desktop'>('desktop');

    return (
        <Tabs defaultValue="in-app">
            <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="in-app" className="text-caption">
                    In-app
                </TabsTrigger>
                <TabsTrigger value="push" className="text-caption">
                    Push
                </TabsTrigger>
                <TabsTrigger value="email" className="text-caption">
                    Email
                </TabsTrigger>
                <TabsTrigger value="whatsapp" className="text-caption">
                    WhatsApp
                </TabsTrigger>
            </TabsList>

            <TabsContent value="in-app" className="mt-4">
                <InAppPreview
                    title={props.title}
                    contentText={props.contentText}
                    modes={props.modes}
                />
            </TabsContent>

            <TabsContent value="push" className="mt-4">
                <PushPreview push={props.push} senderName={props.senderName} />
            </TabsContent>

            <TabsContent value="email" className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <MyButton
                        buttonType={device === 'mobile' ? 'primary' : 'secondary'}
                        scale="small"
                        onClick={() => setDevice('mobile')}
                    >
                        <DeviceMobile className="mr-1 size-4" />
                        Mobile
                    </MyButton>
                    <MyButton
                        buttonType={device === 'desktop' ? 'primary' : 'secondary'}
                        scale="small"
                        onClick={() => setDevice('desktop')}
                    >
                        <Laptop className="mr-1 size-4" />
                        Desktop
                    </MyButton>
                </div>
                <div className="rounded-md bg-muted/40 p-3">
                    <EmailFrame
                        title={props.title}
                        previewText={props.previewText}
                        htmlContent={props.htmlContent}
                        senderName={props.senderName}
                        className={cn('h-96', device === 'mobile' ? 'max-w-sm' : 'max-w-3xl')}
                    />
                </div>
            </TabsContent>

            <TabsContent value="whatsapp" className="mt-4">
                <WhatsAppPreview
                    template={props.whatsappTemplate}
                    config={props.whatsapp}
                    title={props.title}
                    contentText={props.contentText}
                    senderName={props.senderName}
                />
            </TabsContent>
        </Tabs>
    );
}
