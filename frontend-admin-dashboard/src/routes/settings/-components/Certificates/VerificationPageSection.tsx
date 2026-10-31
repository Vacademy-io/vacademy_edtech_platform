import { SealCheck } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';

/**
 * The page a scanned certificate opens, and the little of it an institute
 * decides.
 *
 * <p>Two things belong here and nothing else. First, the address: admins were
 * being asked to supply a verification URL, which implied they had to go and
 * build the page — they do not, the platform hosts it on their own learner
 * portal, so the address is a fact to state rather than a field to fill. Second,
 * a preview: this page is only ever seen by strangers holding a certificate, so
 * the institute would otherwise never lay eyes on it.
 */
/** What the institute has decided about the page it never sees. */
export interface VerificationPageConfig {
    headline: string;
    note: string;
    showCourse: boolean;
    showIssueDate: boolean;
    showCompletion: boolean;
    /**
     * What a scan opens: the built-in page, or a document the institute supplied.
     * 'PAGE' is the default and what every institute has today.
     */
    mode: 'PAGE' | 'DOCUMENT';
    /**
     * How the supplied document was made. 'HTML' is designed here and carries
     * dynamic fields; 'PDF' is served exactly as uploaded and cannot, because a
     * finished PDF has no text to substitute into.
     */
    documentType: 'HTML' | 'PDF';
    /** The designed document, tokens and all. */
    documentHtml: string;
    /** Media id of a PDF served verbatim. */
    documentFileId: string;
    /** Canvas background derived from an uploaded PDF's first page. */
    documentBackgroundUrl: string;
}

export const DEFAULT_VERIFICATION_HEADLINE = 'This certificate is genuine';

interface Props {
    /** Where a scan lands, already resolved. Empty when no portal is configured. */
    verificationPageUrl: string;
    instituteName: string;
    logoUrl: string;
    themeColor: string;
    config: VerificationPageConfig;
    onConfigChange: (patch: Partial<VerificationPageConfig>) => void;
    /** A link the institute set before this section existed, if any. */
    customUrl: string;
    onClearCustomUrl: () => void;
    sampleCertificateId: string;
    /**
     * Upload a PDF and get back a canvas to lay fields on. Resolves to the
     * background's URL, or rejects with a message worth showing the admin.
     */
    onUploadDocument?: (file: File) => Promise<void>;
    /** Open the visual editor on the verification document. */
    onEditDocument?: () => void;
    uploading?: boolean;
    disabled?: boolean;
}

export const VerificationPageSection = ({
    verificationPageUrl,
    instituteName,
    logoUrl,
    themeColor,
    config,
    onConfigChange,
    customUrl,
    onClearCustomUrl,
    sampleCertificateId,
    onUploadDocument,
    onEditDocument,
    uploading,
    disabled,
}: Props) => {
    const { t } = useTranslation('settingsVerificationPage');
    const defaultHeadline = t('preview.defaultHeadline') || DEFAULT_VERIFICATION_HEADLINE;
    const displayName = instituteName || t('preview.defaultInstituteName');
    const headline = config.headline.trim() || defaultHeadline;

    const modeOptions = [
        {
            value: 'PAGE' as const,
            title: t('modeSection.options.page.title'),
            hint: t('modeSection.options.page.hint'),
        },
        {
            value: 'DOCUMENT' as const,
            title: t('modeSection.options.document.title'),
            hint: t('modeSection.options.document.hint'),
        },
    ];

    return (
        <div className="space-y-5 rounded-lg border bg-card p-6">
            <div>
                <h3 className="text-base font-semibold">{t('header.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('header.description')}</p>
            </div>

            <div className="space-y-3 rounded-md border border-neutral-200 bg-neutral-50/60 p-4">
                <div className="text-sm font-medium">{t('modeSection.title')}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                    {modeOptions.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            disabled={disabled}
                            onClick={() => onConfigChange({ mode: option.value })}
                            className={cn(
                                'rounded-md border p-3 text-left transition',
                                config.mode === option.value
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-neutral-200 bg-white hover:border-neutral-300'
                            )}
                        >
                            <div className="text-sm font-medium">{option.title}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                                {option.hint}
                            </div>
                        </button>
                    ))}
                </div>

                {config.mode === 'DOCUMENT' && (
                    <div className="space-y-3 border-t pt-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                id="verification-doc-file"
                                type="file"
                                accept="application/pdf"
                                className="hidden"
                                disabled={disabled || uploading}
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    // Reset immediately so re-picking the same file
                                    // still fires a change event.
                                    e.target.value = '';
                                    if (file && onUploadDocument) void onUploadDocument(file);
                                }}
                            />
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                disable={disabled || uploading}
                                onClick={() =>
                                    document.getElementById('verification-doc-file')?.click()
                                }
                            >
                                {uploading
                                    ? t('modeSection.uploadingButton')
                                    : t('modeSection.uploadButton')}
                            </MyButton>
                            {config.documentBackgroundUrl && (
                                <MyButton
                                    type="button"
                                    buttonType="primary"
                                    scale="medium"
                                    disable={disabled}
                                    onClick={() => onEditDocument?.()}
                                >
                                    {t('modeSection.placeFieldsButton')}
                                </MyButton>
                            )}
                        </div>

                        {config.documentBackgroundUrl ? (
                            <div className="flex items-start gap-3">
                                <img
                                    src={config.documentBackgroundUrl}
                                    alt={t('modeSection.documentAlt')}
                                    className="h-24 w-auto rounded border bg-white object-contain"
                                />
                                <p className="text-xs text-muted-foreground">
                                    {t('modeSection.fieldsHint')}
                                </p>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                {t('modeSection.uploadHint')}
                            </p>
                        )}

                        <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 p-3">
                            <span className="text-xs text-warning-700">
                                {t('modeSection.fallbackWarning')}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                    <div>
                        <div className="text-sm font-medium">{t('address.label')}</div>
                        {verificationPageUrl ? (
                            <p className="mt-1 break-all rounded border bg-muted/30 p-3 font-mono text-xs">
                                {verificationPageUrl}
                            </p>
                        ) : (
                            <p className="mt-1 rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
                                {t('address.unset')}
                            </p>
                        )}
                    </div>

                    {customUrl && (
                        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                            <span>
                                {t('customUrl.part1')}{' '}
                                <span className="font-mono">{customUrl}</span>
                                {t('customUrl.part2')}
                            </span>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={onClearCustomUrl}
                                disable={disabled}
                            >
                                {t('customUrl.useMyPortal')}
                            </MyButton>
                        </div>
                    )}

                    <div>
                        <Label htmlFor="verification-headline">{t('headline.label')}</Label>
                        <Input
                            id="verification-headline"
                            value={config.headline}
                            disabled={disabled}
                            maxLength={80}
                            placeholder={defaultHeadline}
                            onChange={(e) => onConfigChange({ headline: e.target.value })}
                            className="mt-1"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            {t('headline.hintPart1')}
                            {defaultHeadline}
                            {t('headline.hintPart2')}
                        </p>
                    </div>

                    <div>
                        <Label htmlFor="verification-note">{t('note.label')}</Label>
                        <Input
                            id="verification-note"
                            value={config.note}
                            disabled={disabled}
                            maxLength={200}
                            placeholder={t('note.placeholder')}
                            onChange={(e) => onConfigChange({ note: e.target.value })}
                            className="mt-1"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">{t('note.hint')}</p>
                    </div>

                    {/* The recipient's masked name and the certificate number are
                        not on this list: without them the page confirms that a
                        certificate exists rather than the one being held. */}
                    <div className="flex flex-col gap-2">
                        <Label>{t('detailsList.label')}</Label>
                        <DetailToggle
                            label={t('detailsList.courseName')}
                            checked={config.showCourse}
                            disabled={disabled}
                            onChange={(showCourse) => onConfigChange({ showCourse })}
                        />
                        <DetailToggle
                            label={t('detailsList.issueDate')}
                            checked={config.showIssueDate}
                            disabled={disabled}
                            onChange={(showIssueDate) => onConfigChange({ showIssueDate })}
                        />
                        <DetailToggle
                            label={t('detailsList.completionPercentage')}
                            checked={config.showCompletion}
                            disabled={disabled}
                            onChange={(showCompletion) => onConfigChange({ showCompletion })}
                        />
                        <p className="text-xs text-muted-foreground">{t('detailsList.hint')}</p>
                    </div>
                </div>

                {/* A miniature of the real page rather than a description of it.
                    The institute never sees this page in the course of its own
                    work — only the people it is trying to convince do. */}
                <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('preview.sectionTitle')}
                    </div>
                    <div className="overflow-hidden rounded-lg border bg-white">
                        <div
                            className="h-2 w-full"
                            // The institute's own colour: runtime data, not a token.
                            style={{ backgroundColor: themeColor }} // design-lint-ignore: institute branding
                        />
                        <div className="flex flex-col items-center gap-2 px-5 pb-4 pt-5 text-center">
                            {logoUrl ? (
                                <img
                                    src={logoUrl}
                                    alt={displayName}
                                    className="size-12 rounded-full object-contain"
                                />
                            ) : (
                                <div
                                    className="flex size-12 items-center justify-center rounded-full text-lg font-semibold text-white"
                                    style={{ backgroundColor: themeColor }} // design-lint-ignore: institute branding
                                >
                                    {displayName.charAt(0).toUpperCase()}
                                </div>
                            )}
                            <div className="text-caption uppercase tracking-widest text-neutral-400">
                                {t('preview.verifiedBy')}
                            </div>
                            <div className="text-sm font-semibold text-neutral-700">
                                {displayName}
                            </div>
                        </div>
                        <div className="flex flex-col items-center gap-1 border-y bg-success-50 px-5 py-3 text-center">
                            <SealCheck weight="fill" className="size-6 text-success-500" />
                            <div className="text-xs font-medium text-neutral-700">{headline}</div>
                        </div>
                        <dl className="flex flex-col gap-1.5 px-5 py-4 text-xs">
                            <PreviewRow
                                label={t('preview.issuedTo')}
                                value={t('preview.issuedToValue')}
                            />
                            {config.showCourse && (
                                <PreviewRow
                                    label={t('preview.course')}
                                    value={t('preview.courseValue')}
                                />
                            )}
                            <PreviewRow
                                label={t('preview.certificateNumber')}
                                value={sampleCertificateId}
                            />
                            {config.showIssueDate && (
                                <PreviewRow
                                    label={t('preview.issuedOn')}
                                    value={t('preview.issuedOnValue')}
                                />
                            )}
                            {config.showCompletion && (
                                <PreviewRow
                                    label={t('preview.completion')}
                                    value={t('preview.completionValue')}
                                />
                            )}
                        </dl>
                        {config.note.trim() && (
                            <p className="border-t px-5 py-3 text-xs text-neutral-600">
                                {config.note.trim()}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const DetailToggle = ({
    label,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
}) => (
    <label className="flex items-center gap-3 text-sm">
        <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
        {label}
    </label>
);

const PreviewRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline justify-between gap-3">
        <dt className="shrink-0 text-neutral-400">{label}</dt>
        <dd className="truncate text-right font-medium text-neutral-700">{value}</dd>
    </div>
);
