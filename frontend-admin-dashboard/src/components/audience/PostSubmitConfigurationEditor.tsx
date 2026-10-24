/**
 * Post-Submit Configuration editor — the single UI for "what happens after an
 * audience form is submitted".
 *
 * Laid out to match the enroll invite's Post Form Fill Configuration card: one
 * column of stacked, labelled fields. The thank-you screen preview sits behind
 * a Preview button rather than a permanent side-by-side pane, which would take
 * half the dialog to show a few lines of text.
 *
 * Deliberately controlled (value + onChange) rather than react-hook-form bound,
 * because it is rendered in two places that own their state differently:
 *
 *   • Audience list → Create/Edit campaign  (react-hook-form, via Controller)
 *   • Settings → Lead Settings → Forms      (plain useState, institute default)
 */
import { useState, type ReactNode } from 'react';
import { CaretDown, Eye, Plus, TrashSimple } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { cn } from '@/lib/utils';
import {
    AudiencePostSubmitConfiguration,
    createPostSubmitButton,
    isValidPostSubmitUrl,
    MAX_POST_SUBMIT_BUTTONS,
    type PostSubmitButton,
} from '@/services/audience-post-submit-settings';
import {
    getTerminology,
    getTerminologyPlural,
} from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

interface PostSubmitConfigurationEditorProps {
    value: AudiencePostSubmitConfiguration;
    onChange: (next: AudiencePostSubmitConfiguration) => void;
    /** Rendered under the card title. Differs between campaign and settings. */
    description?: string;
    title?: string;
    /** `false` drops the Card chrome so a host can supply its own. */
    withCard?: boolean;
    /**
     * Render the card collapsed behind a disclosure header. Used inside the
     * campaign create/edit form, where this is an optional advanced block and
     * must not push the fields admins actually came for below the fold.
     */
    collapsible?: boolean;
    disabled?: boolean;
    /** Name shown in the preview for the `{{campaignName}}` token. */
    previewCampaignName?: string;
}

/** Preview-only token substitution. The learner app owns the real one. */
const previewTokens = (text: string, campaignName: string): string =>
    text
        .replace(/\{\{\s*name\s*\}\}/g, 'Asha Rao')
        .replace(/\{\{\s*email\s*\}\}/g, 'asha@example.com')
        .replace(/\{\{\s*campaignName\s*\}\}/g, campaignName);

/**
 * TipTap emits `<p></p>` for "nothing typed". Storing that would silently
 * shadow the plain-text message, so an empty document normalizes back to ''.
 */
const normalizeRichText = (html: string): string => {
    const stripped = html.replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/gi, '').trim();
    return stripped ? html : '';
};

const HelpText = ({ children }: { children: ReactNode }) => (
    <p className="mt-1 text-xs text-neutral-500">{children}</p>
);

const ErrorText = ({ children }: { children: ReactNode }) => (
    <p className="mt-1 text-xs text-danger-600">{children}</p>
);

const ToggleRow = ({
    label,
    help,
    checked,
    onCheckedChange,
    disabled,
}: {
    label: string;
    help: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    disabled?: boolean;
}) => (
    <div className="flex flex-row items-center justify-between gap-4 rounded-lg border border-neutral-200 p-4">
        <div className="space-y-0.5">
            <Label className="text-sm font-semibold">{label}</Label>
            <p className="text-xs text-neutral-500">{help}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
);

export const PostSubmitConfigurationEditor = ({
    value,
    onChange,
    description = 'Controls the thank-you screen a respondent sees the moment they submit this form.',
    title = 'Post Submit Configuration',
    withCard = true,
    collapsible = false,
    disabled = false,
    previewCampaignName = 'Your Campaign',
}: PostSubmitConfigurationEditorProps) => {
    // Collapsed by default — an admin creating a campaign should see the same
    // form they always saw, with this available but out of the way.
    const [open, setOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    // Power users occasionally need markup the toolbar can't build. The rich
    // editor stays the default; this is the escape hatch.
    const [htmlSourceMode, setHtmlSourceMode] = useState(false);

    const patch = (changes: Partial<AudiencePostSubmitConfiguration>) =>
        onChange({ ...value, ...changes });

    const patchButton = (id: string, changes: Partial<PostSubmitButton>) =>
        patch({
            buttons: value.buttons.map((button) =>
                button.id === id ? { ...button, ...changes } : button
            ),
        });

    const addButton = () =>
        patch({ buttons: [...value.buttons, createPostSubmitButton(value.buttons.length)] });

    const removeButton = (id: string) =>
        patch({ buttons: value.buttons.filter((button) => button.id !== id) });

    const redirectInvalid = !isValidPostSubmitUrl(value.redirectUrl);

    // ── Fields: one column, same rhythm as the enroll invite card ──
    const controls = (
        <div className="space-y-6">
            <div>
                <Label className="text-sm font-semibold">Heading</Label>
                <Input
                    value={value.successTitle}
                    disabled={disabled}
                    placeholder="Registration Successful!"
                    onChange={(e) => patch({ successTitle: e.target.value })}
                    className="mt-2"
                />
                <HelpText>Leave blank to hide the heading.</HelpText>
            </div>

            <div>
                <Label className="text-sm font-semibold">Message</Label>
                <Textarea
                    rows={3}
                    value={value.successMessage}
                    disabled={disabled}
                    placeholder="Thank you for your response. Your form has been submitted successfully."
                    onChange={(e) => patch({ successMessage: e.target.value })}
                    className="mt-2"
                />
                <HelpText>
                    Supported tokens: <code>{'{{name}}'}</code>, <code>{'{{email}}'}</code>,{' '}
                    <code>{'{{campaignName}}'}</code>.
                </HelpText>
            </div>

            <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-sm font-semibold">Formatted Message (Optional)</Label>
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => setHtmlSourceMode((prev) => !prev)}
                        className="text-xs font-semibold text-primary-500 hover:underline disabled:opacity-50"
                    >
                        {htmlSourceMode ? 'Use rich text editor' : 'Edit HTML source'}
                    </button>
                </div>
                {htmlSourceMode ? (
                    <Textarea
                        rows={5}
                        value={value.content}
                        disabled={disabled}
                        placeholder="<p>We'll call you within 24 hours.</p>"
                        onChange={(e) => patch({ content: e.target.value })}
                        className="mt-2 font-mono text-xs"
                    />
                ) : (
                    <div className="mt-2">
                        <RichTextEditor
                            value={value.content}
                            onChange={(html) => patch({ content: normalizeRichText(html) })}
                            // `minimalToolbar` is load-bearing, not cosmetic: it
                            // renders bold/italic/underline/lists only. The full
                            // toolbar's "More tools" menu opens a link modal whose
                            // Cancel/Apply/Remove buttons have no type="button", so
                            // inside this <form> they would submit the campaign.
                            minimalToolbar
                            placeholder="Add formatting or links…"
                            minHeight={120}
                        />
                    </div>
                )}
                <HelpText>When set, this replaces the plain message above.</HelpText>
            </div>

            {/* ── Buttons ── */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-sm font-semibold">Action Buttons</Label>
                    {value.buttons.length < MAX_POST_SUBMIT_BUTTONS && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={disabled}
                            onClick={addButton}
                        >
                            <Plus className="size-4" weight="bold" />
                            Add button
                        </MyButton>
                    )}
                </div>

                {value.buttons.length === 0 ? (
                    <HelpText>
                        Optional. Send respondents somewhere next — a WhatsApp group, a brochure,
                        your{' '}
                        {getTerminology(
                            ContentTerms.Course,
                            SystemTerms.Course
                        ).toLocaleLowerCase()}{' '}
                        catalogue.
                    </HelpText>
                ) : (
                    value.buttons.map((button, index) => {
                        const urlInvalid =
                            Boolean(button.url.trim()) && !isValidPostSubmitUrl(button.url);
                        return (
                            <div
                                key={button.id}
                                className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-12"
                            >
                                <div className="sm:col-span-5">
                                    <Label className="text-xs font-semibold">Text</Label>
                                    <Input
                                        value={button.text}
                                        disabled={disabled}
                                        placeholder={`Explore ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course)}`}
                                        onChange={(e) =>
                                            patchButton(button.id, { text: e.target.value })
                                        }
                                        className="mt-1"
                                    />
                                </div>
                                <div className="sm:col-span-5">
                                    <Label className="text-xs font-semibold">Link</Label>
                                    <Input
                                        value={button.url}
                                        disabled={disabled}
                                        placeholder="https://example.com/courses"
                                        onChange={(e) =>
                                            patchButton(button.id, { url: e.target.value })
                                        }
                                        className="mt-1"
                                    />
                                    {urlInvalid && (
                                        <ErrorText>Relative path or full http(s) link.</ErrorText>
                                    )}
                                </div>
                                <div className="sm:col-span-2">
                                    <Label className="text-xs font-semibold">Style</Label>
                                    <div className="mt-1 flex items-center gap-1">
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            onClick={() =>
                                                patchButton(button.id, {
                                                    variant:
                                                        button.variant === 'primary'
                                                            ? 'secondary'
                                                            : 'primary',
                                                })
                                            }
                                            className="flex-1 rounded-md border border-neutral-300 p-2 text-xs text-neutral-600 hover:border-primary-200 disabled:opacity-50"
                                        >
                                            {button.variant === 'primary' ? 'Solid' : 'Outline'}
                                        </button>
                                        <button
                                            type="button"
                                            disabled={disabled}
                                            aria-label={`Remove button ${index + 1}`}
                                            onClick={() => removeButton(button.id)}
                                            className="rounded-md border border-neutral-300 p-2 text-neutral-500 hover:border-danger-300 hover:text-danger-600 disabled:opacity-50"
                                        >
                                            <TrashSimple className="size-4" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <ToggleRow
                label="Allow Another Response"
                help="Shows a button that clears the form so the same visitor can submit again."
                checked={value.allowAnotherResponse}
                disabled={disabled}
                onCheckedChange={(checked) => patch({ allowAnotherResponse: checked })}
            />

            {value.allowAnotherResponse && (
                <div>
                    <Label className="text-xs font-semibold">Button Label</Label>
                    <Input
                        value={value.anotherResponseText}
                        disabled={disabled}
                        placeholder="Submit another response"
                        onChange={(e) => patch({ anotherResponseText: e.target.value })}
                        className="mt-1"
                    />
                </div>
            )}

            {/* ── Redirect ── */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2">
                    <Label className="text-sm font-semibold">Redirect URL (Optional)</Label>
                    <Input
                        value={value.redirectUrl}
                        disabled={disabled}
                        placeholder="/thank-you or https://example.com/thanks"
                        onChange={(e) => patch({ redirectUrl: e.target.value })}
                        className="mt-2"
                    />
                    {redirectInvalid ? (
                        <ErrorText>
                            Use a relative path (/thank-you) or a full http(s) link.
                        </ErrorText>
                    ) : (
                        <HelpText>
                            Tokens are URL-encoded, so <code>?email={'{{email}}'}</code> works.
                        </HelpText>
                    )}
                </div>
                <div>
                    <Label className="text-sm font-semibold">Delay</Label>
                    <div className="mt-2 flex items-center gap-2">
                        <Input
                            type="number"
                            min={0}
                            max={60}
                            value={value.redirectDelaySeconds}
                            disabled={disabled || !value.redirectUrl.trim()}
                            onChange={(e) => {
                                const parsed = Number.parseInt(e.target.value, 10);
                                patch({
                                    redirectDelaySeconds: Number.isFinite(parsed)
                                        ? Math.min(Math.max(parsed, 0), 60)
                                        : 0,
                                });
                            }}
                            className="w-20"
                        />
                        <span className="text-xs text-neutral-500">sec</span>
                    </div>
                    <HelpText>0 = immediate.</HelpText>
                </div>
            </div>
        </div>
    );

    // ── Preview, on demand ──
    const previewTitle = previewTokens(value.successTitle, previewCampaignName);
    const previewMessage = previewTokens(value.successMessage, previewCampaignName);
    const previewContent = value.content.trim()
        ? previewTokens(value.content, previewCampaignName)
        : '';

    const previewDialog = (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Thank-you screen preview</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 rounded-lg border border-neutral-200 p-6 text-center">
                    <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-100">
                        <svg
                            className="size-8 text-success-600"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                            />
                        </svg>
                    </div>
                    {previewTitle && (
                        <p className="text-lg font-bold text-neutral-800">{previewTitle}</p>
                    )}
                    {previewContent ? (
                        <div
                            className="text-sm text-neutral-600 [&_a]:text-primary-500 [&_a]:underline [&_li]:list-inside [&_ol]:list-decimal [&_ul]:list-disc"
                            // Admin-authored copy, previewed for its own author. The
                            // learner renderer sanitizes before any visitor sees it.
                            dangerouslySetInnerHTML={{ __html: previewContent }}
                        />
                    ) : (
                        previewMessage && (
                            <p className="whitespace-pre-line text-sm text-neutral-600">
                                {previewMessage}
                            </p>
                        )
                    )}
                    {value.redirectUrl.trim() && (
                        <p className="text-xs text-neutral-400">
                            {value.redirectDelaySeconds > 0
                                ? `Redirecting in ${value.redirectDelaySeconds} seconds…`
                                : 'Redirects immediately — respondents will not see this screen.'}
                        </p>
                    )}
                    {(value.buttons.length > 0 || value.allowAnotherResponse) && (
                        <div className="flex flex-wrap justify-center gap-2 pt-1">
                            {value.buttons.map((button) => (
                                <span
                                    key={button.id}
                                    className={cn(
                                        'rounded-md px-3 py-1.5 text-xs font-semibold',
                                        button.variant === 'primary'
                                            ? 'bg-primary-500 text-white'
                                            : 'border border-neutral-300 text-neutral-600'
                                    )}
                                >
                                    {button.text.trim() || 'Button'}
                                </span>
                            ))}
                            {value.allowAnotherResponse && (
                                <span className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600">
                                    {value.anotherResponseText.trim() || 'Submit another response'}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );

    // Master switch. Everything below it stays out of the DOM while off, so the
    // card reads as "not in use" rather than "a form you forgot to fill in".
    const body = (
        <div className="space-y-6">
            <ToggleRow
                label="Enable custom thank-you screen"
                help="Off: respondents see the standard confirmation, exactly as before. On: this campaign uses the screen configured below."
                checked={value.enabled}
                disabled={disabled}
                onCheckedChange={(checked) => patch({ enabled: checked })}
            />

            {value.enabled ? (
                <>
                    <div className="flex justify-end">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            onClick={() => setPreviewOpen(true)}
                        >
                            <Eye className="size-4" weight="bold" />
                            Preview
                        </MyButton>
                    </div>
                    {controls}
                    {previewDialog}
                </>
            ) : (
                <p className="text-xs text-neutral-500">
                    Turn this on to customise the confirmation message, action buttons and an
                    optional redirect.
                </p>
            )}
        </div>
    );

    if (!withCard) return body;

    if (!collapsible) {
        return (
            <Card className="rounded-sm bg-neutral-50/50 shadow-none">
                <CardHeader className="border-b bg-neutral-100/50 p-4">
                    <CardTitle className="text-base font-semibold text-neutral-800">
                        {title}
                    </CardTitle>
                    <p className="text-xs text-neutral-500">{description}</p>
                </CardHeader>
                <CardContent className="p-4">{body}</CardContent>
            </Card>
        );
    }

    // Chip tells the admin at a glance whether this campaign uses a custom
    // screen, so an enabled campaign never looks inert while collapsed.
    const off = !value.enabled;

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <Card className="rounded-sm bg-neutral-50/50 shadow-none">
                <CollapsibleTrigger asChild>
                    {/* type="button" is mandatory: this sits inside the campaign
                        <form>, and a bare <button> defaults to submit. */}
                    <button
                        type="button"
                        className="flex w-full items-start justify-between gap-4 rounded-t-sm border-b bg-neutral-100/50 p-4 text-left transition-colors hover:bg-neutral-100"
                    >
                        <div className="min-w-0">
                            <p className="text-base font-semibold text-neutral-800">{title}</p>
                            <p className="mt-1 text-xs text-neutral-500">{description}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            <span
                                className={cn(
                                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                                    off
                                        ? 'bg-neutral-200 text-neutral-600'
                                        : 'bg-primary-50 text-primary-500'
                                )}
                            >
                                {off ? 'Off' : 'On'}
                            </span>
                            <CaretDown
                                weight="bold"
                                className={cn(
                                    'size-4 text-neutral-500 transition-transform',
                                    open && 'rotate-180'
                                )}
                            />
                        </div>
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                    <CardContent className="p-4">{body}</CardContent>
                </CollapsibleContent>
            </Card>
        </Collapsible>
    );
};

export default PostSubmitConfigurationEditor;
