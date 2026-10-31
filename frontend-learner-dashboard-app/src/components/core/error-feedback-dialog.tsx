import { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { useLocation } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { SpinnerGap, Bug, PaperPlaneTilt, User, Envelope, FileText, Image as ImageIcon } from '@phosphor-icons/react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getCachedInstituteBranding } from '@/services/domain-routing';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/study-library/useInstituteDetails';
import { MyButton } from '../design-system/button';

interface ErrorFeedbackDialogProps {
    error?: Error | unknown;
    eventId?: string;
    trigger?: React.ReactNode;
}

function getInstituteName(): string {
    const branding = getCachedInstituteBranding();
    if (branding?.instituteName) return branding.instituteName;

    const storeDetails = useInstituteDetailsStore.getState().instituteDetails;
    if (storeDetails?.institute_name) return storeDetails.institute_name;

    // Derive a readable name from the hostname as last resort
    const host = window.location.hostname.replace(/^(admin\.|app\.|www\.)/, '');
    const domain = host.split('.')[0];
    if (!domain) return 'Vacademy';
    return domain.charAt(0).toUpperCase() + domain.slice(1);
}

// In dev: Vite proxies /slack-api → https://slack.com/api and /slack-files → https://files.slack.com
// In prod: set VITE_SLACK_API_BASE to your backend proxy URL
const SLACK_API = import.meta.env.VITE_SLACK_API_BASE ?? '/slack-api';
const SLACK_FILES = import.meta.env.VITE_SLACK_FILES_BASE ?? '/slack-files';

async function uploadFileToSlack(file: File, token: string): Promise<string | null> {
    try {
        // Step 1: get upload URL (proxied to avoid CORS)
        const urlRes = await fetch(
            `${SLACK_API}/files.getUploadURLExternal?filename=${encodeURIComponent(file.name)}&length=${file.size}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const urlData = await urlRes.json();
        if (!urlData.ok) return null;

        // Step 2: upload file — rewrite upload_url to go through our proxy
        const proxyUploadUrl = (urlData.upload_url as string).replace(
            'https://files.slack.com',
            SLACK_FILES
        );
        await fetch(proxyUploadUrl, {
            method: 'POST',
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });

        return urlData.file_id as string;
    } catch {
        return null;
    }
}

async function completeSlackUploads(fileIds: string[], channelId: string, token: string, initialComment: string) {
    await fetch(`${SLACK_API}/files.completeUploadExternal`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            files: fileIds.map((id) => ({ id })),
            channel_id: channelId,
            initial_comment: initialComment,
        }),
    });
}

async function sendToSlack({
    instituteName,
    timezone,
    username,
    email,
    description,
    files,
    route,
    error,
}: {
    instituteName: string;
    timezone: string;
    username: string;
    email: string;
    description: string;
    files: FileList | null;
    route: string;
    error: unknown;
}) {
    const webhookUrl = import.meta.env.VITE_SLACK_WEBHOOK_URL;
    const botToken = import.meta.env.VITE_SLACK_BOT_TOKEN;
    const channelId = import.meta.env.VITE_SLACK_CHANNEL_ID;
    if (!webhookUrl && !botToken) return;

    const errorText = error ? String(error) : 'No error object';

    const blocks = [
        {
            type: 'header',
            text: { type: 'plain_text', text: '🚨 Error Report from Admin Dashboard', emoji: true },
        },
        {
            type: 'section',
            fields: [
                { type: 'mrkdwn', text: `*Institute:*\n${instituteName}` },
                { type: 'mrkdwn', text: `*Timezone:*\n${timezone}` },
                { type: 'mrkdwn', text: `*User:*\n${username}` },
                { type: 'mrkdwn', text: `*Email:*\n${email}` },
            ],
        },
        { type: 'divider' },
        {
            type: 'section',
            text: { type: 'mrkdwn', text: `*What Went Wrong:*\n${description}` },
        },
        { type: 'divider' },
        {
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `*Route:* \`${route}\` | *Error:* \`${errorText.slice(0, 200)}\``,
                },
            ],
        },
    ];

    // If bot token + channel are set, use the proper API (supports file uploads)
    if (botToken && channelId) {
        const msgRes = await fetch(`${SLACK_API}/chat.postMessage`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${botToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ channel: channelId, blocks }),
        });
        const msgData = await msgRes.json();

        // Upload files if any
        if (files && files.length > 0 && msgData.ok) {
            const fileIds: string[] = [];
            for (const file of Array.from(files)) {
                const id = await uploadFileToSlack(file, botToken);
                if (id) fileIds.push(id);
            }
            if (fileIds.length > 0) {
                await completeSlackUploads(
                    fileIds,
                    channelId,
                    botToken,
                    `Attachments for error report by ${username} (${instituteName})`
                );
            }
        }
        return;
    }

    // Fallback: webhook (no file upload, fire-and-forget)
    const fileList =
        files && files.length > 0
            ? Array.from(files)
                  .map((f) => `• ${f.name} (${(f.size / 1024).toFixed(1)} KB)`)
                  .join('\n')
            : 'None';

    const blocksWithFiles = [
        ...blocks,
        {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Attachments:*\n${fileList}` },
        },
    ];

    await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ blocks: blocksWithFiles }),
    });
}

export function ErrorFeedbackDialog({
    error,
    eventId: initialEventId,
    trigger,
}: ErrorFeedbackDialogProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [description, setDescription] = useState('');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [files, setFiles] = useState<FileList | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const location = useLocation();
    const { t } = useTranslation('courseComponentsExtra');

    // Pre-fill name/email from JWT token when dialog opens
    useEffect(() => {
        if (!isOpen) return;
        const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
        if (tokenData?.username && !name) setName(tokenData.username);
        if (tokenData?.email && !email) setEmail(tokenData.email);
    }, [isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const instituteName = getInstituteName();
            const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
            const username = (tokenData?.username ?? name) || 'Anonymous';
            const userEmail = (tokenData?.email ?? email) || 'unknown@example.com';

            await sendToSlack({
                instituteName,
                timezone,
                username,
                email: userEmail,
                description,
                files,
                route: location.pathname,
                error,
            });

            if (import.meta.env.VITE_ENABLE_SENTRY === 'true') {
                // captureFeedback creates its own feedback event in Sentry —
                // no synthetic info-level captureMessage needed. Attachments
                // ride along on the same event via the hint.
                const attachments =
                    files && files.length > 0
                        ? await Promise.all(
                              Array.from(files).map(async (file) => ({
                                  filename: file.name,
                                  data: new Uint8Array(await file.arrayBuffer()),
                                  contentType: file.type,
                              }))
                          )
                        : undefined;

                await Sentry.captureFeedback(
                    {
                        associatedEventId: initialEventId,
                        name: name || 'Anonymous',
                        email: email || 'anonymous@example.com',
                        message: error
                            ? `${description}\n\nError: ${String(error)}`
                            : description,
                        url: location.pathname,
                    },
                    attachments ? { attachments } : undefined
                );
            }

            toast.success(t('errorFeedbackDialog.submitSuccess'));
            setIsOpen(false);
            setDescription('');
            setFiles(null);
        } catch (err) {
            console.error('Failed to submit feedback', err);
            toast.error(t('errorFeedbackDialog.submitFailure'));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                {trigger || <MyButton buttonType="secondary">{t('common.reportIssue')}</MyButton>}
            </SheetTrigger>
            <SheetContent className="sm:max-w-md w-vw-90 overflow-y-auto bg-white border-s border-gray-200 p-6 space-y-section">
                <SheetHeader>
                    <SheetTitle className="text-xl font-bold text-gray-900">{t('common.reportIssue')}</SheetTitle>
                    <SheetDescription className="text-gray-500">
                        {t('errorFeedbackDialog.description')}
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                            {t('errorFeedbackDialog.nameLabel')}
                        </Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t('errorFeedbackDialog.namePlaceholder')}
                            className="bg-white border-gray-300 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                            {t('errorFeedbackDialog.emailLabel')}
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder={t('errorFeedbackDialog.emailPlaceholder')}
                            className="bg-white border-gray-300 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="description" className="text-sm font-medium text-gray-700">
                            {t('errorFeedbackDialog.whatWentWrongLabel')} <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="description"
                            required
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder={t('errorFeedbackDialog.descriptionPlaceholder')}
                            className="min-h-reg-120 resize-y bg-white border-gray-300 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label className="text-sm font-medium text-gray-700">
                            {t('errorFeedbackDialog.attachments')}
                        </Label>
                        <Input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            onChange={(e) => setFiles(e.target.files)}
                            className="cursor-pointer file:me-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                        {files && files.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                                {t('errorFeedbackDialog.filesSelected', { count: files.length })}
                            </p>
                        )}
                    </div>

                    <div className="flex gap-3 pt-4 mt-2 border-t border-gray-100">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            onClick={() => setIsOpen(false)}
                            className="w-full"
                        >
                            {t('common.cancel')}
                        </MyButton>
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            disabled={isSubmitting}
                            className="w-full"
                        >
                            {isSubmitting ? (
                                <>
                                    <SpinnerGap className="me-2 h-4 w-4 animate-spin" />
                                    {t('errorFeedbackDialog.sending')}
                                </>
                            ) : (
                                <>
                                    <PaperPlaneTilt className="me-2 h-4 w-4" />
                                    {t('errorFeedbackDialog.sendReport')}
                                </>
                            )}
                        </MyButton>
                    </div>
                </form>
            </SheetContent>
        </Sheet>
    );
}
