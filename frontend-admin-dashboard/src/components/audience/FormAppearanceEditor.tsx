/**
 * Form Appearance editor — "how does the public response form look".
 *
 * The sibling of PostSubmitConfigurationEditor, and deliberately built to the
 * same recipe: a collapsible card, one column of stacked labelled fields, fully
 * controlled (value + onChange) rather than react-hook-form bound so it can be
 * hosted anywhere.
 *
 * Two differences from the post-submit card, both intentional:
 *
 *   • **No master switch.** There is nothing to turn on — every campaign
 *     already renders with the defaults, and this block only describes
 *     deviations. The collapsed chip says "Default" or "Custom" instead of
 *     "Off"/"On".
 *   • **The preview is a live miniature**, not a dialog. Layout, accent and
 *     card style are things you judge by looking, so the thumbnail sits beside
 *     the controls and repaints as they change.
 *
 * Labels are hardcoded English, matching PostSubmitConfigurationEditor — the
 * host passes an i18n'd title/description for the card header. Same reason for
 * using the `@/components/ui` primitives rather than `MyInput`/`SelectField`:
 * this card sits directly above the post-submit one and has to match it. (MyInput
 * also carries a `sm:w-60` width cap that a full-width form field has to fight.)
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowsOut, CaretDown, Plus, TrashSimple } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { isValidPostSubmitUrl } from '@/services/audience-post-submit-settings';
import {
    AUDIENCE_FORM_HOOK_CLASSES,
    createFormHighlight,
    DEFAULT_FORM_APPEARANCE,
    FORM_ACCENTS,
    FORM_BACKGROUNDS,
    FORM_CARD_STYLES,
    FORM_HIGHLIGHT_ICONS,
    FORM_LAYOUTS,
    FORM_WIDTHS,
    isDefaultFormAppearance,
    MAX_FORM_HIGHLIGHTS,
    type AudienceFormAccent,
    type AudienceFormAppearance,
    type AudienceFormHighlight,
    type AudienceFormHighlightIcon,
} from '@/services/audience-form-appearance';
import { buildFormAppearancePreview, type PreviewField } from './form-appearance-preview';

interface FormAppearanceEditorProps {
    value: AudienceFormAppearance;
    onChange: (next: AudienceFormAppearance) => void;
    /** Rendered under the card title. */
    description?: string;
    title?: string;
    /** `false` drops the Card chrome so a host can supply its own. */
    withCard?: boolean;
    /** Render collapsed behind a disclosure header (the campaign form does). */
    collapsible?: boolean;
    disabled?: boolean;
    /** Shown in the preview where the campaign's own name would appear. */
    previewCampaignName?: string;
    /** Shown in the preview where the campaign's own description would appear. */
    previewCampaignDescription?: string;
    /** Shown in the preview's objective block. */
    previewCampaignObjective?: string;
    /** Branding name in the preview's header bar. */
    previewInstituteName?: string;
    /** The campaign's own fields, so the preview shows real labels. */
    previewFields?: PreviewField[];
}

/** Human labels for the closed enums. Order follows the service's arrays. */
const LAYOUT_LABELS: Record<(typeof FORM_LAYOUTS)[number], string> = {
    classic: 'Classic — heading in its own card',
    hero: 'Hero — heading on the page, form below',
    split: 'Split — heading left, form right',
};

const WIDTH_LABELS: Record<(typeof FORM_WIDTHS)[number], string> = {
    narrow: 'Narrow',
    regular: 'Regular',
    wide: 'Wide',
};

const BACKGROUND_LABELS: Record<(typeof FORM_BACKGROUNDS)[number], string> = {
    muted: 'Neutral — recommended',
    plain: 'White',
    gradient: 'Brand wash',
};

const ACCENT_LABELS: Record<AudienceFormAccent, string> = {
    primary: 'Brand',
    success: 'Green',
    info: 'Blue',
    warning: 'Amber',
    neutral: 'Grey',
};

const CARD_STYLE_LABELS: Record<(typeof FORM_CARD_STYLES)[number], string> = {
    glass: 'Glass',
    elevated: 'Elevated',
    outlined: 'Outlined',
    flat: 'Flat',
};

const HIGHLIGHT_ICON_LABELS: Record<AudienceFormHighlightIcon, string> = {
    sparkle: 'Sparkle',
    shield: 'Shield',
    clock: 'Clock',
    check: 'Check',
    users: 'People',
    chat: 'Chat',
};

/**
 * Example markup shown in the two code boxes. Module constants so the CSS
 * sample can carry its lint opt-out on one line — the hex in it is text the
 * admin reads, not a colour this UI paints with.
 */
const HERO_HTML_PLACEHOLDER =
    '<h1 class="my-title">Connect with our team</h1>\n<p>We reply within a day.</p>';
const CUSTOM_CSS_PLACEHOLDER =
    '.vac-af-page { background: #f6f7fb; }\n.vac-af-submit { border-radius: 999px; }'; // design-lint-ignore

const HelpText = ({ children }: { children: ReactNode }) => (
    <p className="mt-1 text-xs text-neutral-500">{children}</p>
);

const ErrorText = ({ children }: { children: ReactNode }) => (
    <p className="mt-1 text-xs text-danger-600">{children}</p>
);

export const ToggleRow = ({
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

/** A labelled dropdown over one of the closed enums. */
const EnumField = <T extends string>({
    label,
    help,
    options,
    labels,
    value,
    onValueChange,
    disabled,
}: {
    label: string;
    help?: string;
    options: readonly T[];
    labels: Record<T, string>;
    value: T;
    onValueChange: (next: T) => void;
    disabled?: boolean;
}) => (
    <div>
        <Label className="text-sm font-semibold">{label}</Label>
        <Select
            value={value}
            onValueChange={(next) => onValueChange(next as T)}
            disabled={disabled}
        >
            <SelectTrigger className="mt-2">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((option) => (
                    <SelectItem key={option} value={option}>
                        {labels[option]}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
        {help && <HelpText>{help}</HelpText>}
    </div>
);

export const FormAppearanceEditor = ({
    value,
    onChange,
    description = 'Controls how the public response form looks — layout, colours and the wording around the fields.',
    title = 'Form Appearance',
    withCard = true,
    collapsible = false,
    disabled = false,
    previewCampaignName = 'Your Campaign',
    previewCampaignDescription = '',
    previewCampaignObjective = '',
    previewInstituteName = 'Your Institute',
    previewFields = [],
}: FormAppearanceEditorProps) => {
    const [open, setOpen] = useState(false);
    // The card opens on Basics only. Everything else is a step the admin has to
    // ask for — that is what keeps this a simple UI with a full-control hatch
    // rather than a wall of forty inputs.
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [codeOpen, setCodeOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);

    // Rebuilding the preview document swaps the iframe's srcDoc, which reloads
    // it — on every keystroke that flickers. Settle first, then repaint.
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedValue(value), 250);
        return () => window.clearTimeout(timer);
    }, [value]);

    const patch = (changes: Partial<AudienceFormAppearance>) => onChange({ ...value, ...changes });

    const patchHighlight = (id: string, changes: Partial<AudienceFormHighlight>) =>
        patch({
            highlights: value.highlights.map((highlight) =>
                highlight.id === id ? { ...highlight, ...changes } : highlight
            ),
        });

    const addHighlight = () =>
        patch({ highlights: [...value.highlights, createFormHighlight(value.highlights.length)] });

    const removeHighlight = (id: string) =>
        patch({ highlights: value.highlights.filter((highlight) => highlight.id !== id) });

    const coverInvalid =
        Boolean(value.coverImageUrl.trim()) && !isValidPostSubmitUrl(value.coverImageUrl);

    const hasCustomCode = Boolean(value.heroHtml.trim() || value.customCss.trim());

    // ── Live preview ──
    // A real render of the page in a sandboxed iframe, not a skeleton sketch:
    // it is the only way the admin's own Custom CSS can be shown applying, and
    // grey placeholder bars never answered "does my wording fit".
    const previewDoc = useMemo(
        () =>
            buildFormAppearancePreview(debouncedValue, {
                campaignName: previewCampaignName,
                campaignDescription: previewCampaignDescription,
                campaignObjective: previewCampaignObjective,
                instituteName: previewInstituteName,
                fields: previewFields,
            }),
        [
            debouncedValue,
            previewCampaignName,
            previewCampaignDescription,
            previewCampaignObjective,
            previewInstituteName,
            previewFields,
        ]
    );

    const previewFrame = (className: string) => (
        <iframe
            // sandbox="" grants nothing: no scripts, no forms, no navigation,
            // no same-origin. The admin's HTML and CSS render but cannot reach
            // the dashboard around them.
            sandbox=""
            title="Response form preview"
            srcDoc={previewDoc}
            className={cn('w-full rounded-md border border-neutral-200 bg-white', className)}
        />
    );

    const preview = (
        <div className="rounded-lg border border-neutral-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-neutral-600">Preview</p>
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="small"
                    onClick={() => setPreviewOpen(true)}
                >
                    <ArrowsOut className="size-4" weight="bold" />
                    Full preview
                </MyButton>
            </div>
            {previewFrame('h-preview-inline')}
            <HelpText>An approximation of the live page, including your custom CSS.</HelpText>
        </div>
    );

    const previewDialog = (
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogContent className="w-dialog-xl">
                <DialogHeader>
                    <DialogTitle>Response form preview</DialogTitle>
                </DialogHeader>
                {previewFrame('h-preview-dialog')}
                <p className="text-xs text-neutral-500">
                    An approximation for layout and colour. The live page uses the institute&rsquo;s
                    own theme, fonts and real inputs.
                </p>
            </DialogContent>
        </Dialog>
    );

    // ── Basics: the things admins actually change ──
    // The page heading and the form heading / sub-heading are NOT here: they
    // live in FormTextEditor ("Form Heading & Text"), which every campaign gets
    // without this card's institute switch. One place to edit each field.
    const basics = (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                    <Label className="text-sm font-semibold">Submit Button</Label>
                    <Input
                        value={value.submitLabel}
                        disabled={disabled}
                        placeholder="Submit Response"
                        onChange={(e) => patch({ submitLabel: e.target.value })}
                        className="mt-2"
                    />
                </div>
                <EnumField
                    label="Layout"
                    options={FORM_LAYOUTS}
                    labels={LAYOUT_LABELS}
                    value={value.layout}
                    disabled={disabled}
                    onValueChange={(layout) => patch({ layout })}
                />
                <EnumField
                    label="Accent"
                    options={FORM_ACCENTS}
                    labels={ACCENT_LABELS}
                    value={value.accent}
                    disabled={disabled}
                    onValueChange={(accent) => patch({ accent })}
                />
            </div>
        </div>
    );

    // ── Advanced: everything else about the built-in page ──
    const advanced = (
        <div className="space-y-6 pt-4">
            <div className="space-y-4">
                <p className="text-sm font-semibold text-neutral-800">Heading block</p>
                <div>
                    <Label className="text-sm font-semibold">Eyebrow</Label>
                    <Input
                        value={value.eyebrow}
                        disabled={disabled}
                        placeholder="Admissions 2026"
                        onChange={(e) => patch({ eyebrow: e.target.value })}
                        className="mt-2"
                    />
                    <HelpText>
                        Small label above the heading. The heading itself is set in Form Heading
                        &amp; Text.
                    </HelpText>
                </div>
                <div>
                    <Label className="text-sm font-semibold">Page Intro</Label>
                    <Textarea
                        rows={2}
                        value={value.subheadline}
                        disabled={disabled}
                        placeholder="Blank uses the campaign description."
                        onChange={(e) => patch({ subheadline: e.target.value })}
                        className="mt-2"
                    />
                </div>
                <div>
                    <Label className="text-sm font-semibold">Cover Image</Label>
                    <Input
                        value={value.coverImageUrl}
                        disabled={disabled}
                        placeholder="https://example.com/banner.png"
                        onChange={(e) => patch({ coverImageUrl: e.target.value })}
                        className="mt-2"
                    />
                    {coverInvalid ? (
                        <ErrorText>
                            Use a relative path (/banner.png) or a full http(s) link.
                        </ErrorText>
                    ) : (
                        <HelpText>Banner shown above the heading.</HelpText>
                    )}
                </div>
                <div>
                    <Label className="text-sm font-semibold">Footer Note</Label>
                    <Textarea
                        rows={2}
                        value={value.footerNote}
                        disabled={disabled}
                        placeholder="Questions? Write to admissions@example.com"
                        onChange={(e) => patch({ footerNote: e.target.value })}
                        className="mt-2"
                    />
                    <HelpText>Small print under the form.</HelpText>
                </div>
            </div>

            <div className="space-y-4">
                <p className="text-sm font-semibold text-neutral-800">Shape</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <EnumField
                        label="Width"
                        options={FORM_WIDTHS}
                        labels={WIDTH_LABELS}
                        value={value.width}
                        disabled={disabled}
                        onValueChange={(width) => patch({ width })}
                    />
                    <EnumField
                        label="Background"
                        options={FORM_BACKGROUNDS}
                        labels={BACKGROUND_LABELS}
                        value={value.background}
                        disabled={disabled}
                        onValueChange={(background) => patch({ background })}
                    />
                    <EnumField
                        label="Card Style"
                        options={FORM_CARD_STYLES}
                        labels={CARD_STYLE_LABELS}
                        value={value.cardStyle}
                        disabled={disabled}
                        onValueChange={(cardStyle) => patch({ cardStyle })}
                    />
                </div>
            </div>

            <div className="space-y-3">
                <ToggleRow
                    label="Show Description"
                    help="The campaign description (or the Page Intro above) under the heading."
                    checked={value.showDescription}
                    disabled={disabled}
                    onCheckedChange={(showDescription) => patch({ showDescription })}
                />
                <ToggleRow
                    label="Show Objective"
                    help="The campaign objective, in its own box under the description."
                    checked={value.showObjective}
                    disabled={disabled}
                    onCheckedChange={(showObjective) => patch({ showObjective })}
                />
                <ToggleRow
                    label="Show Completion Meter"
                    help="A '2 of 5 required fields completed' bar in the form header. Useful on long forms."
                    checked={value.showProgress}
                    disabled={disabled}
                    onCheckedChange={(showProgress) => patch({ showProgress })}
                />
                <ToggleRow
                    label="Show Required-field Legend"
                    help="A '* Required field' line under the form heading. Every required field already carries an asterisk."
                    checked={value.showRequiredLegend}
                    disabled={disabled}
                    onCheckedChange={(showRequiredLegend) => patch({ showRequiredLegend })}
                />
            </div>

            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-sm font-semibold">Highlights</Label>
                    {value.highlights.length < MAX_FORM_HIGHLIGHTS && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={disabled}
                            onClick={addHighlight}
                        >
                            <Plus className="size-4" weight="bold" />
                            Add highlight
                        </MyButton>
                    )}
                </div>

                {value.highlights.length === 0 ? (
                    <HelpText>
                        Optional reassurance chips beside the heading — &ldquo;We never share your
                        details&rdquo;, &ldquo;Reply within 1 working day&rdquo;.
                    </HelpText>
                ) : (
                    value.highlights.map((highlight, index) => (
                        <div
                            key={highlight.id}
                            className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-12"
                        >
                            <div className="sm:col-span-4">
                                <Label className="text-xs font-semibold">Icon</Label>
                                <Select
                                    value={highlight.icon}
                                    disabled={disabled}
                                    onValueChange={(icon) =>
                                        patchHighlight(highlight.id, {
                                            icon: icon as AudienceFormHighlightIcon,
                                        })
                                    }
                                >
                                    <SelectTrigger className="mt-1">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {FORM_HIGHLIGHT_ICONS.map((icon) => (
                                            <SelectItem key={icon} value={icon}>
                                                {HIGHLIGHT_ICON_LABELS[icon]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="sm:col-span-7">
                                <Label className="text-xs font-semibold">Text</Label>
                                <Input
                                    value={highlight.text}
                                    disabled={disabled}
                                    placeholder="We never share your details"
                                    onChange={(e) =>
                                        patchHighlight(highlight.id, { text: e.target.value })
                                    }
                                    className="mt-1"
                                />
                            </div>
                            <div className="flex items-end sm:col-span-1">
                                <button
                                    type="button"
                                    disabled={disabled}
                                    aria-label={`Remove highlight ${index + 1}`}
                                    onClick={() => removeHighlight(highlight.id)}
                                    className="w-full rounded-md border border-neutral-300 p-2 text-neutral-500 hover:border-danger-300 hover:text-danger-600 disabled:opacity-50"
                                >
                                    <TrashSimple className="mx-auto size-4" />
                                </button>
                            </div>
                        </div>
                    ))
                )}
                <HelpText>Blank rows are dropped when the campaign is saved.</HelpText>
            </div>
        </div>
    );

    // ── Full control: hand-built heading block + page CSS ──
    const customCode = (
        <div className="space-y-4 pt-4">
            <div>
                <Label className="text-sm font-semibold">Custom Heading HTML</Label>
                <Textarea
                    rows={6}
                    value={value.heroHtml}
                    disabled={disabled}
                    placeholder={HERO_HTML_PLACEHOLDER}
                    onChange={(e) => patch({ heroHtml: e.target.value })}
                    className="mt-2 font-mono text-xs"
                />
                <HelpText>
                    Replaces the whole heading block above the form — cover, eyebrow, heading,
                    intro, objective and highlights. It is styled only by your CSS below, so give
                    your elements classes. Scripts and iframes are stripped before a respondent sees
                    it, and the form itself is always built from this campaign&rsquo;s fields.
                </HelpText>
            </div>

            <div>
                <Label className="text-sm font-semibold">Custom CSS</Label>
                <Textarea
                    rows={8}
                    value={value.customCss}
                    disabled={disabled}
                    placeholder={CUSTOM_CSS_PLACEHOLDER}
                    onChange={(e) => patch({ customCss: e.target.value })}
                    className="mt-2 font-mono text-xs"
                />
                <HelpText>
                    Applies to this response page only. <code>@import</code> and legacy script
                    vectors are stripped.
                </HelpText>
            </div>

            <div className="rounded-lg border border-neutral-200 p-3">
                <p className="text-xs font-semibold text-neutral-600">Classes you can target</p>
                <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                    {AUDIENCE_FORM_HOOK_CLASSES.map((hook) => (
                        <div key={hook.name} className="flex items-baseline gap-2">
                            <dt className="font-mono text-xs text-primary-500">.{hook.name}</dt>
                            <dd className="text-xs text-neutral-500">{hook.what}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );

    const section = (
        key: string,
        label: string,
        summary: string,
        content: ReactNode,
        isOpen: boolean,
        setOpen: (next: boolean) => void
    ) => (
        <Collapsible key={key} open={isOpen} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
                {/* type="button": this sits inside the campaign <form>. */}
                <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 rounded-lg border border-neutral-200 p-3 text-left transition-colors hover:bg-neutral-50"
                >
                    <span>
                        <span className="block text-sm font-semibold text-neutral-800">
                            {label}
                        </span>
                        <span className="block text-xs text-neutral-500">{summary}</span>
                    </span>
                    <CaretDown
                        weight="bold"
                        className={cn(
                            'size-4 shrink-0 text-neutral-500 transition-transform',
                            isOpen && 'rotate-180'
                        )}
                    />
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>{content}</CollapsibleContent>
        </Collapsible>
    );

    const controls = (
        <div className="space-y-4">
            {basics}
            {section(
                'advanced',
                'More options',
                'Eyebrow, intro, cover, shape, toggles and highlights.',
                advanced,
                advancedOpen,
                setAdvancedOpen
            )}
            {section(
                'code',
                'Custom HTML & CSS',
                hasCustomCode
                    ? 'In use — this campaign styles the page itself.'
                    : 'Take over the heading block and style the page yourself.',
                customCode,
                codeOpen,
                setCodeOpen
            )}
        </div>
    );

    const body = (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {previewDialog}
            <div className="lg:col-span-7">{controls}</div>
            <div className="lg:col-span-5">
                <div className="lg:sticky lg:top-4">{preview}</div>
            </div>
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

    // Chip tells the admin at a glance whether this campaign deviates from the
    // standard look, so a customised campaign never looks inert while collapsed.
    // The heading / form-header fields belong to FormTextEditor and carry their
    // own chip there, so they don't count as "this card was customised".
    // Same for `template`, which FormTemplatePicker owns.
    const isDefault = isDefaultFormAppearance({
        ...value,
        template: DEFAULT_FORM_APPEARANCE.template,
        showHeader: DEFAULT_FORM_APPEARANCE.showHeader,
        showHeadline: DEFAULT_FORM_APPEARANCE.showHeadline,
        headline: DEFAULT_FORM_APPEARANCE.headline,
        headingAlign: DEFAULT_FORM_APPEARANCE.headingAlign,
        formTitle: DEFAULT_FORM_APPEARANCE.formTitle,
        formSubtitle: DEFAULT_FORM_APPEARANCE.formSubtitle,
        formHeaderAlign: DEFAULT_FORM_APPEARANCE.formHeaderAlign,
    });

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

export default FormAppearanceEditor;
