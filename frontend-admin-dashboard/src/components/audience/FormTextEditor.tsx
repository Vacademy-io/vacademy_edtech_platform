/**
 * Form Heading & Text editor — the words a respondent reads at the top of the
 * public response form, and where they sit.
 *
 * Two blocks, each with its own alignment, plus a switch for the page header:
 *
 *   • **Page header** — the institute logo + name bar at the very top. On by
 *     default; off for a form embedded under the institute's own site header.
 *   • **Page heading** — the big title above the form. Defaults to the
 *     audience list's own name; the admin can replace it with rich text
 *     ("Fill this form to book a free demo", in bold, centred, …) or hide it.
 *   • **Form header** — the "Please fill in your details" heading and the
 *     "This information will be used…" line at the top of the form card.
 *
 * Lives outside FormAppearanceEditor on purpose: that card is hidden behind an
 * institute switch (Settings → Lead Settings → Forms), while changing these
 * words is something every campaign needs. Both edit the same
 * `formAppearance` value, so the save path is unchanged — `applyFormAppearance`
 * already writes every key. These fields are NOT repeated in the appearance
 * card, so there is one place to edit them.
 *
 * Rich text uses the app's RichTextEditor in `minimalToolbar` mode. That is
 * load-bearing, not cosmetic: the full toolbar's link modal has buttons with no
 * `type="button"`, and inside the campaign <form> they would submit it.
 * Alignment is a separate control (not the editor's own) so it applies to the
 * whole block — heading, eyebrow, intro and chips move together.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
    CaretDown,
    Eye,
    TextAlignCenter,
    TextAlignLeft,
    TextAlignRight,
    type Icon,
} from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MyButton } from '@/components/design-system/button';
import { RichTextEditor } from '@/components/editor/RichTextEditor';
import { cn } from '@/lib/utils';
import {
    DEFAULT_FORM_APPEARANCE,
    FORM_TEXT_ALIGNS,
    type AudienceFormAppearance,
    type AudienceFormTextAlign,
} from '@/services/audience-form-appearance';
import { ToggleRow } from './FormAppearanceEditor';
import { buildFormAppearancePreview, type PreviewField } from './form-appearance-preview';

/** The learner page's own wording when these fields are left blank. */
const DEFAULT_FORM_TITLE = 'Please fill in your details';
const DEFAULT_FORM_SUBTITLE = 'This information will be used to contact you about the campaign.';

const ALIGN_OPTIONS: Record<AudienceFormTextAlign, { label: string; icon: Icon }> = {
    left: { label: 'Align left', icon: TextAlignLeft },
    center: { label: 'Align center', icon: TextAlignCenter },
    right: { label: 'Align right', icon: TextAlignRight },
};

interface FormTextEditorProps {
    value: AudienceFormAppearance;
    onChange: (next: AudienceFormAppearance) => void;
    title?: string;
    /** Rendered under the card title. */
    description?: string;
    /** Render collapsed behind a disclosure header (the campaign form does). */
    collapsible?: boolean;
    disabled?: boolean;
    /** The audience list's name — the heading shown when none is set. */
    previewCampaignName?: string;
    previewCampaignDescription?: string;
    previewCampaignObjective?: string;
    previewInstituteName?: string;
    previewFields?: PreviewField[];
}

/**
 * TipTap emits `<p></p>` for "nothing typed". Storing that would make a blank
 * heading look customised, so an empty document normalizes back to ''. Same
 * rule as PostSubmitConfigurationEditor.
 */
const normalizeRichText = (html: string): string => {
    const stripped = html.replace(/<p>\s*(<br\s*\/?>)?\s*<\/p>/gi, '').trim();
    return stripped ? html : '';
};

const HelpText = ({ children }: { children: ReactNode }) => (
    <p className="mt-1 text-xs text-neutral-500">{children}</p>
);

const AlignControl = ({
    value,
    onChange,
    disabled,
    label,
}: {
    value: AudienceFormTextAlign;
    onChange: (next: AudienceFormTextAlign) => void;
    disabled?: boolean;
    label: string;
}) => (
    <div role="group" aria-label={label} className="flex items-center gap-1">
        {FORM_TEXT_ALIGNS.map((align) => {
            const { label: alignLabel, icon: AlignIcon } = ALIGN_OPTIONS[align];
            const selected = value === align;
            return (
                <MyButton
                    key={align}
                    // type="button": this sits inside the campaign <form>.
                    type="button"
                    layoutVariant="icon"
                    scale="medium"
                    buttonType={selected ? 'primary' : 'secondary'}
                    title={alignLabel}
                    aria-label={alignLabel}
                    aria-pressed={selected}
                    disable={disabled}
                    onClick={() => onChange(align)}
                >
                    <AlignIcon className="size-4" weight="bold" />
                </MyButton>
            );
        })}
    </div>
);

/** True when none of the fields this card owns deviate from the default. */
const isDefaultFormText = (value: AudienceFormAppearance): boolean => {
    const d = DEFAULT_FORM_APPEARANCE;
    return (
        value.showHeader === d.showHeader &&
        value.showHeadline === d.showHeadline &&
        value.headline === d.headline &&
        value.headingAlign === d.headingAlign &&
        value.formTitle === d.formTitle &&
        value.formSubtitle === d.formSubtitle &&
        value.formHeaderAlign === d.formHeaderAlign
    );
};

export const FormTextEditor = ({
    value,
    onChange,
    title = 'Form Heading & Text',
    description = 'The heading at the top of the form and the text above the fields.',
    collapsible = false,
    disabled = false,
    previewCampaignName = 'Your Campaign',
    previewCampaignDescription = '',
    previewCampaignObjective = '',
    previewInstituteName = 'Your Institute',
    previewFields = [],
}: FormTextEditorProps) => {
    const [open, setOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);

    const patch = (changes: Partial<AudienceFormAppearance>) => onChange({ ...value, ...changes });

    // Built only while the dialog is open — no point rendering a document
    // nobody is looking at on every keystroke.
    const previewDoc = useMemo(
        () =>
            previewOpen
                ? buildFormAppearancePreview(value, {
                      campaignName: previewCampaignName,
                      campaignDescription: previewCampaignDescription,
                      campaignObjective: previewCampaignObjective,
                      instituteName: previewInstituteName,
                      fields: previewFields,
                  })
                : '',
        [
            previewOpen,
            value,
            previewCampaignName,
            previewCampaignDescription,
            previewCampaignObjective,
            previewInstituteName,
            previewFields,
        ]
    );

    const body = (
        <div className="space-y-6">
            {/* ── Page header ── */}
            <ToggleRow
                label="Show Page Header"
                help={`The bar at the very top with the institute logo and name${
                    previewInstituteName ? ` (“${previewInstituteName}”)` : ''
                }. Also hides it on the thank-you screen.`}
                checked={value.showHeader}
                disabled={disabled}
                onCheckedChange={(showHeader) => patch({ showHeader })}
            />

            {/* ── Page heading ── */}
            <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <p className="text-sm font-semibold text-neutral-800">Page Heading</p>
                        <p className="text-xs text-neutral-500">
                            The title at the top of the page.
                        </p>
                    </div>
                    {/* Stays visible with the heading off: the same alignment
                        also places the eyebrow, intro and highlights. */}
                    <AlignControl
                        label="Page heading alignment"
                        value={value.headingAlign}
                        disabled={disabled}
                        onChange={(headingAlign) => patch({ headingAlign })}
                    />
                </div>
                <ToggleRow
                    label="Show Page Heading"
                    help="Turn off to hide the title — the audience list name or your own heading."
                    checked={value.showHeadline}
                    disabled={disabled}
                    onCheckedChange={(showHeadline) => patch({ showHeadline })}
                />
                {/* Hidden, not cleared: switching the heading back on brings
                    back whatever was typed. */}
                {value.showHeadline && (
                    <div>
                        <RichTextEditor
                            value={value.headline}
                            onChange={(html) => patch({ headline: normalizeRichText(html) })}
                            minimalToolbar
                            placeholder={previewCampaignName}
                            minHeight={60}
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <HelpText>
                                Leave empty to show the audience list name
                                {previewCampaignName ? ` (“${previewCampaignName}”)` : ''}.
                            </HelpText>
                            {value.headline && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    disable={disabled}
                                    onClick={() => patch({ headline: '' })}
                                >
                                    Use audience list name
                                </MyButton>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Form header ── */}
            <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <p className="text-sm font-semibold text-neutral-800">Form Header</p>
                        <p className="text-xs text-neutral-500">
                            The heading and text at the top of the form, above the fields.
                        </p>
                    </div>
                    <AlignControl
                        label="Form header alignment"
                        value={value.formHeaderAlign}
                        disabled={disabled}
                        onChange={(formHeaderAlign) => patch({ formHeaderAlign })}
                    />
                </div>
                <div>
                    <Label className="text-sm font-semibold">Form Heading</Label>
                    <Input
                        value={value.formTitle}
                        disabled={disabled}
                        placeholder={DEFAULT_FORM_TITLE}
                        onChange={(e) => patch({ formTitle: e.target.value })}
                        className="mt-2"
                    />
                    <HelpText>Leave empty to keep &ldquo;{DEFAULT_FORM_TITLE}&rdquo;.</HelpText>
                </div>
                <div>
                    <Label className="text-sm font-semibold">Form Sub-heading</Label>
                    <div className="mt-2">
                        <RichTextEditor
                            value={value.formSubtitle}
                            onChange={(html) => patch({ formSubtitle: normalizeRichText(html) })}
                            minimalToolbar
                            placeholder={DEFAULT_FORM_SUBTITLE}
                            minHeight={60}
                        />
                    </div>
                    <HelpText>Leave empty to keep the standard line.</HelpText>
                </div>
            </div>

            <div className="flex justify-end">
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    onClick={() => setPreviewOpen(true)}
                >
                    <Eye className="size-4" />
                    Preview
                </MyButton>
            </div>

            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="w-dialog-xl">
                    <DialogHeader>
                        <DialogTitle>Response form preview</DialogTitle>
                    </DialogHeader>
                    <iframe
                        // sandbox="" grants nothing: no scripts, no forms, no
                        // navigation, no same-origin.
                        sandbox=""
                        title="Response form preview"
                        srcDoc={previewDoc}
                        className="h-preview-dialog w-full rounded-md border border-neutral-200 bg-white"
                    />
                    <p className="text-xs text-neutral-500">
                        An approximation for layout and wording. The live page uses the
                        institute&rsquo;s own theme, fonts and real inputs.
                    </p>
                </DialogContent>
            </Dialog>
        </div>
    );

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

    const isDefault = isDefaultFormText(value);

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
                                    isDefault
                                        ? 'bg-neutral-200 text-neutral-600'
                                        : 'bg-primary-50 text-primary-500'
                                )}
                            >
                                {isDefault ? 'Default' : 'Custom'}
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

export default FormTextEditor;
