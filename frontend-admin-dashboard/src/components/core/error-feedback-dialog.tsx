import { useState, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { useLocation } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Loader2, Send } from 'lucide-react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { getCachedInstituteBranding } from '@/services/domain-routing';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { getComponentStack } from '@/lib/error-component-stack';
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

    const host = window.location.hostname.replace(/^(admin\.|app\.|www\.)/, '');
    const domain = host.split('.')[0];
    if (!domain) return 'Vacademy';
    return domain.charAt(0).toUpperCase() + domain.slice(1);
}

// All Slack calls go through a server-side proxy:
//   /slack-api/*   → https://slack.com/api/*     (Authorization injected server-side)
//   /slack-files/* → https://files.slack.com/*   (pre-signed URL, no auth needed)
// Dev: vite.config.ts `server.proxy` block reads SLACK_BOT_TOKEN from .env.local.
// Prod: functions/slack-api/[[path]].js reads context.env.SLACK_BOT_TOKEN.
// The bot token is NEVER bundled into client code.
const SLACK_API = '/slack-api';
const SLACK_FILES = '/slack-files';

async function uploadFileToSlack(file: File): Promise<string | null> {
    try {
        const urlRes = await fetch(
            `${SLACK_API}/files.getUploadURLExternal?filename=${encodeURIComponent(file.name)}&length=${file.size}`
        );
        const urlData = await urlRes.json();
        if (!urlData.ok) return null;

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

async function completeSlackUploads(
    fileIds: string[],
    channelId: string,
    initialComment: string
) {
    await fetch(`${SLACK_API}/files.completeUploadExternal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            files: fileIds.map((id) => ({ id })),
            channel_id: channelId,
            initial_comment: initialComment,
        }),
    });
}

// Top frames are what locate the bug; Slack also rejects section text over 3000 chars.
const MAX_TRACE_LINES = 12;
const MAX_TRACE_CHARS = 1500;

/** A stack trimmed to its top frames, as a Slack code-block section (null when absent). */
function traceSection(title: string, trace: string | undefined) {
    if (!trace) return null;
    const text = trace
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, MAX_TRACE_LINES)
        .join('\n')
        // Same-origin URLs are noise — the chunk name and line:col are what find the code.
        .split(window.location.origin)
        .join('')
        .replace(/```/g, "'''")
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Cap AFTER escaping (entities lengthen the text); an over-long section makes
        // Slack reject the whole report. Drop an entity the cut split in half.
        .slice(0, MAX_TRACE_CHARS)
        .replace(/&[a-z]*$/, '');
    return {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${title}:*\n\`\`\`${text}\`\`\`` },
    };
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
    // Support channel — user reports land here.
    const channelId = import.meta.env.VITE_SLACK_SUPPORT_CHANNEL_ID;
    if (!channelId) return;

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
        ...[
            traceSection('Stack', error instanceof Error ? error.stack : undefined),
            traceSection('Component stack', getComponentStack(error)),
        ].filter((block) => block !== null),
    ];

    const msgRes = await fetch(`${SLACK_API}/chat.postMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            channel: channelId,
            text: `Error report from ${username} (${instituteName})`,
            blocks,
        }),
    });
    const msgData = await msgRes.json();

    if (files && files.length > 0 && msgData.ok) {
        const fileIds: string[] = [];
        for (const file of Array.from(files)) {
            const id = await uploadFileToSlack(file);
            if (id) fileIds.push(id);
        }
        if (fileIds.length > 0) {
            await completeSlackUploads(
                fileIds,
                channelId,
                `Attachments for error report by ${username} (${instituteName})`
            );
        }
    }
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
            const tokenData = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken));
            const username = (tokenData?.username ?? name) || 'Anonymous';
            const userEmail = (tokenData?.email ?? email) || 'unknown@example.com';

            await sendToSlack({
                instituteName: getInstituteName(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                username,
                email: userEmail,
                description,
                files,
                route: location.pathname,
                error,
            });

            // Record feedback in Sentry's User Feedback UI for retention.
            // We intentionally do NOT call Sentry.captureMessage here — that would
            // create an issue, which the Sentry → webhook → send-alert.js rule
            // routes to the crash channel, duplicating the Slack post above.
            if (import.meta.env.VITE_ENABLE_SENTRY === 'true') {
                await Sentry.captureFeedback({
                    associatedEventId: initialEventId,
                    name: name || 'Anonymous',
                    email: email || 'anonymous@example.com',
                    message: description,
                });
            }

            toast.success('Thank you! Your report has been sent.');
            setIsOpen(false);
            setDescription('');
            setFiles(null);
        } catch (err) {
            console.error('Failed to submit feedback', err);
            toast.error('Failed to submit report. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                {trigger || <MyButton buttonType="secondary">Report an Issue</MyButton>}
            </SheetTrigger>
            <SheetContent className="sm:max-w-md w-[90vw] overflow-y-auto bg-white border-l border-gray-200 p-6">
                <SheetHeader className="mb-6">
                    <SheetTitle className="text-xl font-bold text-gray-900">Report an Issue</SheetTitle>
                    <SheetDescription className="text-gray-500">
                        Help us improve by providing details. Context is automatically included.
                    </SheetDescription>
                </SheetHeader>

                <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                            Name (Optional)
                        </Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your name"
                            className="bg-white border-gray-300 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                            Email (Optional)
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Your email for follow-up"
                            className="bg-white border-gray-300 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="description" className="text-sm font-medium text-gray-700">
                            What went wrong? <span className="text-red-500">*</span>
                        </Label>
                        <Textarea
                            id="description"
                            required
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Please describe what you were doing when the error occurred..."
                            className="min-h-[120px] resize-y bg-white border-gray-300 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label className="text-sm font-medium text-gray-700">
                            Attachments
                        </Label>
                        <Input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            onChange={(e) => setFiles(e.target.files)}
                            className="cursor-pointer file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 focus-visible:ring-1 focus-visible:ring-primary-500"
                        />
                        {files && files.length > 0 && (
                            <p className="text-xs text-gray-500 mt-1">
                                {files.length} file(s) selected
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
                            Cancel
                        </MyButton>
                        <MyButton
                            type="submit"
                            buttonType="primary"
                            disabled={isSubmitting}
                            className="w-full"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Sending...
                                </>
                            ) : (
                                <>
                                    <Send className="mr-2 h-4 w-4" />
                                    Send Report
                                </>
                            )}
                        </MyButton>
                    </div>
                </form>
            </SheetContent>
        </Sheet>
    );
}
