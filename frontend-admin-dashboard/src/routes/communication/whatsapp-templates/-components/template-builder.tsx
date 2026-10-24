import { useState, useMemo, useRef } from 'react';
import {
    ArrowLeft,
    CircleNotch,
    Plus,
    Trash,
    UploadSimple,
    WarningCircle,
    FileText,
    ImageSquare,
    TextAa,
    TextAlignLeft,
    HandTap,
    DeviceMobile,
    WhatsappLogo,
    type Icon,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getInstituteId } from '@/constants/helper';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { getUserId } from '@/utils/userDetails';
import { cn } from '@/lib/utils';
import { MyButton } from '@/components/design-system/button';
import { getBackendErrorBody, reportApiError } from '@/lib/report-api-error';
import { createTemplateDraft, updateTemplate, submitToMeta, WhatsAppTemplateDTO, TemplateButton } from '../-services/template-api';
import { WhatsAppTemplateBubble } from './whatsapp-template-bubble';
import {
    normalizeTemplateName,
    placeholderIndexes,
    problemFields,
    validateDraft,
    validateForSubmit,
    type TemplateProblem,
} from '../-utils/template-validation';

interface Props {
    template: WhatsAppTemplateDTO | null; // null = creating new
    onClose: () => void;
}

/** Meta's supported template languages. Built from `t` because the labels are user-visible. */
function buildLanguages(t: TFunction): { code: string; label: string }[] {
    return [
        { code: 'en', label: t('languages.en') }, { code: 'en_US', label: t('languages.en_US') },
        { code: 'hi', label: t('languages.hi') }, { code: 'es', label: t('languages.es') },
        { code: 'pt_BR', label: t('languages.pt_BR') }, { code: 'ar', label: t('languages.ar') },
        { code: 'fr', label: t('languages.fr') }, { code: 'de', label: t('languages.de') },
        { code: 'id', label: t('languages.id') }, { code: 'it', label: t('languages.it') },
        { code: 'ja', label: t('languages.ja') }, { code: 'ko', label: t('languages.ko') },
        { code: 'zh_CN', label: t('languages.zh_CN') },
    ];
}

const fieldClass =
    'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';
const buttonFieldClass =
    'w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none';
const labelClass = 'text-caption font-medium text-neutral-700';
const addButtonClass =
    'rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:border-primary-500 hover:bg-primary-50';
const hintClass = 'mt-1 text-caption text-neutral-500';

/** One titled card of the builder form (icon, title, one-line description, then the fields). */
function FormSection({
    icon: IconCmp,
    title,
    description,
    right,
    children,
}: {
    icon: Icon;
    title: string;
    description: string;
    right?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                        <IconCmp size={16} weight="duotone" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-subtitle font-semibold text-neutral-900">{title}</h3>
                        <p className="text-caption text-neutral-500">{description}</p>
                    </div>
                </div>
                {right}
            </div>
            {children}
        </section>
    );
}
/** Applied to whichever input the local check or the server pointed at. */
const invalidClass = 'border-danger-400 bg-danger-50 focus:border-danger-500';

/**
 * What Meta accepts as a media-header sample, per header type. Checked before the upload so a
 * wrong file is refused here, instead of surfacing as SAMPLE_MEDIA_UPLOAD_FAILED after the round
 * trip through S3 and Meta's resumable-upload API.
 */
const SAMPLE_MEDIA_RULES: Record<string, { accept: string; mimes: string[]; extensions: string[]; maxBytes: number }> = {
    IMAGE: {
        accept: 'image/jpeg,image/png',
        mimes: ['image/jpeg', 'image/png'],
        extensions: ['.jpg', '.jpeg', '.png'],
        maxBytes: 5 * 1024 * 1024,
    },
    VIDEO: {
        accept: 'video/mp4,video/3gpp',
        mimes: ['video/mp4', 'video/3gpp'],
        extensions: ['.mp4', '.3gp'],
        maxBytes: 16 * 1024 * 1024,
    },
    DOCUMENT: {
        accept: 'application/pdf',
        mimes: ['application/pdf'],
        extensions: ['.pdf'],
        maxBytes: 100 * 1024 * 1024,
    },
};

/** Browsers leave `file.type` empty for unregistered extensions, so fall back to the name. */
function isAllowedSampleFile(file: File, rule: (typeof SAMPLE_MEDIA_RULES)[string]): boolean {
    if (file.type) return rule.mimes.includes(file.type.toLowerCase());
    const name = file.name.toLowerCase();
    return rule.extensions.some((ext) => name.endsWith(ext));
}

export function TemplateBuilder({ template, onClose }: Props) {
    const { t } = useTranslation('communicationTemplateBuilder');
    // The validators' messages live in their own catalog; handing them the builder's `t` renders
    // every problem as a raw key like `bodyRequired`.
    const { t: tValidation } = useTranslation('communicationTemplateValidation');
    const LANGUAGES = useMemo(() => buildLanguages(t), [t]);
    const isEditing = !!template?.id;
    const instituteId = getInstituteId() || '';

    const [name, setName] = useState(template?.name || '');
    const [language, setLanguage] = useState(template?.language || 'en');
    const [category, setCategory] = useState(template?.category || 'MARKETING');
    const [headerType, setHeaderType] = useState(template?.headerType || 'NONE');
    const [headerText, setHeaderText] = useState(template?.headerText || '');
    const [headerSampleUrl, setHeaderSampleUrl] = useState(template?.headerSampleUrl || '');
    const [headerSampleValues, setHeaderSampleValues] = useState<string[]>(
        template?.headerSampleValues || []
    );
    const [bodyText, setBodyText] = useState(template?.bodyText || '');
    const [footerText, setFooterText] = useState(template?.footerText || '');
    const [buttons, setButtons] = useState<TemplateButton[]>(template?.buttons || []);
    const [bodySampleValues, setBodySampleValues] = useState<string[]>(template?.bodySampleValues || []);
    const [bodyVariableNames, setBodyVariableNames] = useState<string[]>(template?.bodyVariableNames || []);
    const [saving, setSaving] = useState(false);
    const [problems, setProblems] = useState<TemplateProblem[]>([]);
    // A submit is create-then-submit. If the submit leg fails, the draft is already saved — hold on
    // to its id so a retry updates that row instead of creating a second one and hitting the
    // duplicate-name 409, which used to strand the admin with an invisible orphan draft.
    const [draftId, setDraftId] = useState<string | undefined>(template?.id);
    const [uploadingSample, setUploadingSample] = useState(false);
    const sampleFileInputRef = useRef<HTMLInputElement>(null);
    const { uploadFile } = useFileUpload();

    const invalidFields = useMemo(() => problemFields(problems), [problems]);
    const isInvalid = (field: string) => invalidFields.has(field);

    /**
     * Upload the header sample and drop its public URL into the field, so the admin doesn't need
     * somewhere else to host the file. `publicUrl` copies the object to the public bucket and the
     * URL never expires — Meta downloads it during review, and the renderer reuses it as the header
     * media on every send of this template, so a signed/expiring URL would break sends later.
     */
    const handleSampleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Clear the input so choosing the same file again after a rejection still fires onChange.
        e.target.value = '';
        const rule = SAMPLE_MEDIA_RULES[headerType];
        if (!file || !rule) return;

        const kind = t(`headerKind.${headerType.toLowerCase()}`);
        const formats = t(`fields.headerSampleFormats.${headerType.toLowerCase()}`);
        if (!isAllowedSampleFile(file, rule)) {
            toast.error(t('toast.sampleWrongType', { kind, formats }));
            return;
        }
        if (file.size > rule.maxBytes) {
            toast.error(t('toast.sampleTooLarge', { formats }));
            return;
        }

        setUploadingSample(true);
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: setUploadingSample,
                userId: getUserId(),
                source: 'WHATSAPP_TEMPLATE_MEDIA',
                sourceId: instituteId || 'ADMIN',
                publicUrl: true,
            });
            const url = fileId ? await getPublicUrl(fileId) : '';
            if (!url) throw new Error('Upload finished but the media service returned no public URL');
            setHeaderSampleUrl(url);
            setProblems((prev) => prev.filter((p) => p.field !== 'headerSampleUrl'));
            toast.success(t('toast.sampleUploaded', { kind }));
        } catch (err) {
            reportApiError(err, {
                feature: 'whatsapp-template-sample-upload',
                fallbackMessage: t('toast.sampleUploadFailed', { kind }),
            });
        } finally {
            setUploadingSample(false);
        }
    };

    // How many distinct variables the body declares: {{1}} … {{N}}. Uses the highest index rather
    // than the match count so a body that repeats {{1}} still asks for exactly one sample.
    const placeholderCount = useMemo(() => {
        const indexes = placeholderIndexes(bodyText);
        return indexes.length ? Math.max(...indexes) : 0;
    }, [bodyText]);

    // Auto-adjust sample values array size
    const adjustedSamples = useMemo(() => {
        const arr = [...bodySampleValues];
        while (arr.length < placeholderCount) arr.push('');
        return arr.slice(0, placeholderCount);
    }, [bodySampleValues, placeholderCount]);

    // Auto-adjust variable names array size
    const adjustedVarNames = useMemo(() => {
        const arr = [...bodyVariableNames];
        while (arr.length < placeholderCount) arr.push('');
        return arr.slice(0, placeholderCount);
    }, [bodyVariableNames, placeholderCount]);

    const insertPlaceholder = () => {
        const nextNum = placeholderCount + 1;
        setBodyText((prev) => prev + `{{${nextNum}}}`);
    };

    const previewBody = useMemo(() => {
        let text = bodyText;
        adjustedSamples.forEach((val, i) => {
            text = text.replace(`{{${i + 1}}}`, val || `[Variable ${i + 1}]`);
        });
        return text;
    }, [bodyText, adjustedSamples]);

    const buildDTO = (): WhatsAppTemplateDTO => ({
        instituteId,
        name: normalizeTemplateName(name.trim()),
        language,
        category,
        headerType,
        headerText: headerType === 'TEXT' ? headerText : undefined,
        headerSampleUrl: headerType !== 'NONE' && headerType !== 'TEXT' ? headerSampleUrl : undefined,
        headerSampleValues:
            headerType === 'TEXT' && headerSampleValues.some((v) => v.trim())
                ? headerSampleValues
                : undefined,
        bodyText,
        footerText: footerText || undefined,
        buttons: buttons.length > 0 ? buttons : undefined,
        bodySampleValues: adjustedSamples.length > 0 ? adjustedSamples : undefined,
        bodyVariableNames: adjustedVarNames.some(v => v.trim()) ? adjustedVarNames : undefined,
    });

    /**
     * Put the server's verdict back on the form. The template endpoints return
     * `{ message, hint, field, code }`, so a rejection can highlight the offending input rather than
     * just flashing a toast the admin has to interpret.
     */
    const applyServerProblem = (err: unknown, feature: string, fallbackMessage: string) => {
        const body = getBackendErrorBody(err);
        // reportApiError shows the toast (message + hint) and logs/reports the failure.
        const shown = reportApiError(err, { feature, fallbackMessage });
        setProblems(body?.field ? [{ field: body.field, message: shown }] : []);
    };

    const showLocalProblems = (found: TemplateProblem[]) => {
        setProblems(found);
        toast.error(
            found.length === 1
                ? found[0]!.message
                : t('toast.multipleProblems', { count: found.length })
        );
    };

    const handleSaveDraft = async () => {
        const found = validateDraft(tValidation, { name, category, bodyText });
        if (found.length > 0) { showLocalProblems(found); return; }

        setSaving(true);
        try {
            // Reuse the id from a previous partial attempt so re-saving updates rather than
            // duplicating.
            const saved = draftId
                ? await updateTemplate(draftId, buildDTO())
                : await createTemplateDraft(buildDTO());
            setDraftId(saved.id);
            setProblems([]);
            toast.success(t('toast.draftSaved'));
            onClose();
        } catch (err) {
            applyServerProblem(err, 'whatsapp-template-save', t('toast.saveDraftFailed'));
        } finally { setSaving(false); }
    };

    const handleSubmit = async () => {
        const found = validateForSubmit(tValidation, {
            name,
            language,
            category,
            headerType,
            headerText,
            headerSampleUrl,
            headerSampleValues,
            bodyText,
            footerText,
            buttons,
            bodySampleValues: adjustedSamples,
        });
        if (found.length > 0) { showLocalProblems(found); return; }

        setSaving(true);
        // Two calls, two different failures to report. Saving succeeds far more often than the Meta
        // submit does, so they're reported separately — "Meta rejected the body" must never read as
        // "could not save".
        let id = draftId;
        try {
            const saved = id
                ? await updateTemplate(id, buildDTO())
                : await createTemplateDraft(buildDTO());
            id = saved.id;
            setDraftId(id);
        } catch (err) {
            applyServerProblem(err, 'whatsapp-template-save', t('toast.saveTemplateFailed'));
            setSaving(false);
            return;
        }

        try {
            const submitted = await submitToMeta(id!);
            setProblems([]);
            toast.success(
                submitted.status === 'APPROVED'
                    ? t('toast.approvedByMeta')
                    : t('toast.submittedToMeta')
            );
            onClose();
        } catch (err) {
            // The draft is saved; only the Meta hand-off failed. Say so, or the admin re-enters
            // everything and then collides with their own draft.
            applyServerProblem(
                err,
                'whatsapp-template-submit',
                t('toast.metaRejected')
            );
            toast.info(t('toast.draftSavedRetry'));
        } finally { setSaving(false); }
    };

    const addButton = (type: string) => {
        if (buttons.length >= 3) { toast.error(t('toast.maxButtons')); return; }
        setButtons([...buttons, { type, text: '', url: type === 'URL' ? 'https://' : undefined }]);
    };

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-start gap-3">
                    <button
                        onClick={onClose}
                        aria-label={t('header.back')}
                        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0">
                        <h2 className="truncate text-h3 font-semibold text-neutral-900">
                            {isEditing ? t('header.edit') : t('header.create')}
                        </h2>
                        <p className="text-caption text-neutral-500">
                            {isEditing
                                ? t('header.subtitleEdit', { name: template?.name ?? '' })
                                : t('header.subtitleCreate')}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        onClick={handleSaveDraft}
                        disable={saving}
                        className="sm:min-w-0"
                    >
                        {t('header.saveDraft')}
                    </MyButton>
                    <MyButton
                        buttonType="primary"
                        scale="medium"
                        onClick={handleSubmit}
                        disable={saving}
                        className="sm:min-w-0"
                    >
                        {saving ? t('header.submitting') : t('header.submitForApproval')}
                    </MyButton>
                </div>
            </div>

            {/* Builder + Preview split. Stacks vertically below lg. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-neutral-50 lg:flex-row lg:overflow-hidden">
                {/* Builder (left) */}
                <div className="min-w-0 flex-1 space-y-4 p-4 sm:p-6 lg:overflow-y-auto">
                    {/* What went wrong. Everything Meta would reject is listed at once so the admin
                        fixes it in one pass instead of discovering problems one submit at a time. */}
                    {problems.length > 0 && (
                        <div
                            className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3"
                            role="alert"
                        >
                            <WarningCircle size={18} className="mt-0.5 shrink-0 text-danger-600" />
                            <div className="min-w-0 text-sm text-danger-600">
                                <p className="font-medium">
                                    {problems.length === 1
                                        ? t('problemsBanner.single')
                                        : t('problemsBanner.multiple', { count: problems.length })}
                                </p>
                                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                    {problems.map((p, i) => (
                                        <li key={`${p.field}-${i}`}>{p.message}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}

                    {/* Meta info */}
                    <FormSection
                        icon={FileText}
                        title={t('sections.basics.title')}
                        description={t('sections.basics.description')}
                    >
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                                <label className={labelClass}>{t('fields.templateName')}</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="order_confirmation"
                                    aria-invalid={isInvalid('name')}
                                    className={cn(fieldClass, isInvalid('name') && invalidClass)}
                                />
                                <p className={hintClass}>{t('fields.templateNameHint')}</p>
                            </div>
                            <div>
                                <label className={labelClass}>{t('fields.category')}</label>
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    className={cn(
                                        fieldClass,
                                        isInvalid('category') && invalidClass
                                    )}
                                >
                                    <option value="MARKETING">
                                        {t('fields.categoryMarketing')}
                                    </option>
                                    <option value="UTILITY">{t('fields.categoryUtility')}</option>
                                    <option value="AUTHENTICATION">
                                        {t('fields.categoryAuthentication')}
                                    </option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClass}>{t('fields.language')}</label>
                                <select
                                    value={language}
                                    onChange={(e) => setLanguage(e.target.value)}
                                    className={cn(
                                        fieldClass,
                                        isInvalid('language') && invalidClass
                                    )}
                                >
                                    {LANGUAGES.map((l) => (
                                        <option key={l.code} value={l.code}>
                                            {l.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </FormSection>

                    {/* Header */}
                    <FormSection
                        icon={ImageSquare}
                        title={t('fields.header')}
                        description={t('sections.header.description')}
                    >
                        <select
                            value={headerType}
                            onChange={(e) => setHeaderType(e.target.value)}
                            className={cn(fieldClass, isInvalid('headerType') && invalidClass)}
                        >
                            <option value="NONE">{t('fields.headerNone')}</option>
                            <option value="TEXT">{t('fields.headerText')}</option>
                            <option value="IMAGE">{t('fields.headerImage')}</option>
                            <option value="VIDEO">{t('fields.headerVideo')}</option>
                            <option value="DOCUMENT">{t('fields.headerDocument')}</option>
                        </select>
                        {headerType === 'TEXT' && (
                            <input
                                type="text"
                                value={headerText}
                                onChange={(e) => setHeaderText(e.target.value)}
                                placeholder={t('fields.headerTextPlaceholder')}
                                maxLength={60}
                                aria-invalid={isInvalid('headerText')}
                                className={cn(
                                    fieldClass,
                                    'mt-2',
                                    isInvalid('headerText') && invalidClass
                                )}
                            />
                        )}
                        {/* A header variable is only reviewable by Meta with an example filled in,
                            so the field appears as soon as one is typed. */}
                        {headerType === 'TEXT' && placeholderIndexes(headerText).length > 0 && (
                            <input
                                type="text"
                                value={headerSampleValues[0] || ''}
                                onChange={(e) => setHeaderSampleValues([e.target.value])}
                                placeholder={t('fields.headerSampleValuePlaceholder')}
                                aria-invalid={isInvalid('headerSampleValues')}
                                className={cn(
                                    fieldClass,
                                    'mt-2',
                                    isInvalid('headerSampleValues') && invalidClass
                                )}
                            />
                        )}
                        {headerType !== 'NONE' && headerType !== 'TEXT' && (
                            <div className="mt-2">
                                <div className="flex items-start gap-2">
                                    <input
                                        type="text"
                                        value={headerSampleUrl}
                                        onChange={(e) => setHeaderSampleUrl(e.target.value)}
                                        placeholder={t('fields.headerSampleUrlPlaceholder', {
                                            kind: t(`headerKind.${headerType.toLowerCase()}`),
                                        })}
                                        aria-invalid={isInvalid('headerSampleUrl')}
                                        className={cn(
                                            fieldClass,
                                            'min-w-0 flex-1',
                                            isInvalid('headerSampleUrl') && invalidClass
                                        )}
                                    />
                                    {/* Hidden picker; `accept` follows the header type so the OS dialog
                                        only offers files Meta will take. */}
                                    <input
                                        ref={sampleFileInputRef}
                                        type="file"
                                        className="hidden"
                                        accept={SAMPLE_MEDIA_RULES[headerType]?.accept}
                                        onChange={handleSampleFile}
                                        data-testid="header-sample-file"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => sampleFileInputRef.current?.click()}
                                        disabled={uploadingSample || saving}
                                        className="mt-1 flex h-9 shrink-0 items-center gap-1 rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:border-primary-500 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {uploadingSample ? (
                                            <CircleNotch size={14} className="animate-spin" />
                                        ) : (
                                            <UploadSimple size={14} />
                                        )}
                                        {uploadingSample
                                            ? t('fields.headerSampleUploading')
                                            : t('fields.headerSampleUpload')}
                                    </button>
                                </div>
                                <p className={hintClass}>
                                    {t('fields.headerSampleUrlHint', {
                                        formats: t(
                                            `fields.headerSampleFormats.${headerType.toLowerCase()}`
                                        ),
                                    })}
                                </p>
                            </div>
                        )}
                    </FormSection>

                    {/* Body */}
                    <FormSection
                        icon={TextAlignLeft}
                        title={t('fields.bodyText')}
                        description={t('sections.body.description', {
                            first: '{{1}}',
                            second: '{{2}}',
                        })}
                        right={
                            <button
                                onClick={insertPlaceholder}
                                className="flex shrink-0 items-center gap-0.5 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-100"
                            >
                                <Plus size={12} /> {t('fields.addVariable')}{' '}
                                {`{{${placeholderCount + 1}}}`}
                            </button>
                        }
                    >
                        {/* The placeholder itself demonstrates Meta's literal {{n}} template syntax to
                            the admin, so it is left untranslated rather than risk colliding with
                            i18next's own {{ }} interpolation markers. */}
                        <textarea
                            value={bodyText}
                            onChange={(e) => setBodyText(e.target.value)}
                            placeholder="Hello {{1}}, your order {{2}} is confirmed for {{3}}."
                            aria-invalid={isInvalid('bodyText')}
                            className={cn(
                                fieldClass,
                                'h-24 resize-y',
                                isInvalid('bodyText') && invalidClass
                            )}
                            maxLength={1024}
                        />
                        <p className={`${hintClass} text-right`}>
                            {t('fields.charCount', { count: bodyText.length })}
                        </p>

                        {/* Variable names + Sample values */}
                        {placeholderCount > 0 && (
                            <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
                                <p className="text-caption font-semibold text-neutral-700">
                                    {t('fields.variableConfiguration')}
                                </p>
                                {adjustedSamples.map((val, i) => (
                                    <div key={i} className="flex items-start gap-2">
                                        <span className="mt-0.5 w-12 shrink-0 rounded-md bg-neutral-100 px-1.5 py-1 text-center font-mono text-xs text-neutral-600">{`{{${i + 1}}}`}</span>
                                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                                            <input
                                                type="text"
                                                value={adjustedVarNames[i] || ''}
                                                onChange={(e) => {
                                                    const arr = [...adjustedVarNames];
                                                    arr[i] = e.target.value;
                                                    setBodyVariableNames(arr);
                                                }}
                                                placeholder={t('fields.variableNamePlaceholder')}
                                                className={cn(buttonFieldClass, 'min-w-0 flex-1')}
                                            />
                                            <input
                                                type="text"
                                                value={val}
                                                onChange={(e) => {
                                                    const arr = [...adjustedSamples];
                                                    arr[i] = e.target.value;
                                                    setBodySampleValues(arr);
                                                }}
                                                placeholder={t('fields.sampleValuePlaceholder')}
                                                aria-invalid={
                                                    isInvalid('bodySampleValues') && !val.trim()
                                                }
                                                className={cn(
                                                    buttonFieldClass,
                                                    'min-w-0 flex-1',
                                                    isInvalid('bodySampleValues') &&
                                                        !val.trim() &&
                                                        invalidClass
                                                )}
                                            />
                                        </div>
                                    </div>
                                ))}
                                <p className={hintClass}>{t('fields.apiNamedParamsHint')}</p>
                            </div>
                        )}
                    </FormSection>

                    {/* Footer */}
                    <FormSection
                        icon={TextAa}
                        title={t('fields.footer')}
                        description={t('sections.footer.description')}
                    >
                        <input
                            type="text"
                            value={footerText}
                            onChange={(e) => setFooterText(e.target.value)}
                            placeholder={t('fields.footerPlaceholder')}
                            maxLength={60}
                            aria-invalid={isInvalid('footerText')}
                            className={cn(fieldClass, isInvalid('footerText') && invalidClass)}
                        />
                    </FormSection>

                    {/* Buttons */}
                    <FormSection
                        icon={HandTap}
                        title={t('fields.buttons')}
                        description={t('sections.buttons.description', { used: buttons.length })}
                    >
                        <div className="space-y-2">
                            {buttons.map((btn, i) => (
                                <div
                                    key={i}
                                    className="flex items-start gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5"
                                >
                                    <div className="flex-1 space-y-1.5">
                                        <span className="inline-block rounded-md bg-white px-1.5 py-0.5 text-caption font-medium text-neutral-600">
                                            {btn.type}
                                        </span>
                                        <input
                                            type="text"
                                            value={btn.text}
                                            onChange={(e) => {
                                                const u = [...buttons];
                                                u[i] = { ...btn, text: e.target.value };
                                                setButtons(u);
                                            }}
                                            placeholder={t('fields.buttonTextPlaceholder')}
                                            maxLength={25}
                                            aria-invalid={isInvalid(`buttons.${i}.text`)}
                                            className={cn(
                                                buttonFieldClass,
                                                isInvalid(`buttons.${i}.text`) && invalidClass
                                            )}
                                        />
                                        {/* Untranslated for the same {{n}} literal-syntax reason as the body
                                            placeholder above. */}
                                        {btn.type === 'URL' && (
                                            <input
                                                type="text"
                                                value={btn.url || ''}
                                                onChange={(e) => {
                                                    const u = [...buttons];
                                                    u[i] = { ...btn, url: e.target.value };
                                                    setButtons(u);
                                                }}
                                                placeholder="https://example.com/track/{{1}}"
                                                aria-invalid={isInvalid(`buttons.${i}.url`)}
                                                className={cn(
                                                    buttonFieldClass,
                                                    isInvalid(`buttons.${i}.url`) && invalidClass
                                                )}
                                            />
                                        )}
                                        {/* Meta reviews a dynamic link by following a filled-in example, so a
                                            URL with {{1}} is rejected without one. */}
                                        {btn.type === 'URL' &&
                                            placeholderIndexes(btn.url || '').length > 0 && (
                                                <input
                                                    type="text"
                                                    value={btn.example?.[0] || ''}
                                                    onChange={(e) => {
                                                        const u = [...buttons];
                                                        u[i] = {
                                                            ...btn,
                                                            example: [e.target.value],
                                                        };
                                                        setButtons(u);
                                                    }}
                                                    placeholder={t(
                                                        'fields.buttonUrlSamplePlaceholder'
                                                    )}
                                                    aria-invalid={isInvalid(`buttons.${i}.example`)}
                                                    className={cn(
                                                        buttonFieldClass,
                                                        isInvalid(`buttons.${i}.example`) &&
                                                            invalidClass
                                                    )}
                                                />
                                            )}
                                        {btn.type === 'PHONE_NUMBER' && (
                                            <input
                                                type="text"
                                                value={btn.phoneNumber || ''}
                                                onChange={(e) => {
                                                    const u = [...buttons];
                                                    u[i] = { ...btn, phoneNumber: e.target.value };
                                                    setButtons(u);
                                                }}
                                                placeholder={t('fields.buttonPhonePlaceholder')}
                                                aria-invalid={isInvalid(`buttons.${i}.phoneNumber`)}
                                                className={cn(
                                                    buttonFieldClass,
                                                    isInvalid(`buttons.${i}.phoneNumber`) &&
                                                        invalidClass
                                                )}
                                            />
                                        )}
                                    </div>
                                    <button
                                        onClick={() =>
                                            setButtons(buttons.filter((_, j) => j !== i))
                                        }
                                        className="mt-1 rounded-md p-1 text-danger-400 hover:bg-danger-50 hover:text-danger-600"
                                    >
                                        <Trash size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        {buttons.length < 3 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    onClick={() => addButton('QUICK_REPLY')}
                                    className={addButtonClass}
                                >
                                    {t('fields.addQuickReply')}
                                </button>
                                <button onClick={() => addButton('URL')} className={addButtonClass}>
                                    {t('fields.addUrlButton')}
                                </button>
                                <button
                                    onClick={() => addButton('PHONE_NUMBER')}
                                    className={addButtonClass}
                                >
                                    {t('fields.addPhone')}
                                </button>
                            </div>
                        )}
                    </FormSection>
                </div>

                {/* Preview (right) */}
                <div className="w-full shrink-0 border-t border-neutral-200 bg-white p-4 sm:p-6 lg:w-96 lg:overflow-y-auto lg:border-l lg:border-t-0">
                    <div className="mx-auto w-full max-w-sm">
                        <div className="mb-3 flex items-center gap-2">
                            <span className="flex size-8 items-center justify-center rounded-lg bg-success-50 text-success-600">
                                <DeviceMobile size={16} weight="duotone" />
                            </span>
                            <p className="text-subtitle font-semibold text-neutral-900">
                                {t('preview.title')}
                            </p>
                        </div>
                        {/* Phone frame */}
                        <div className="mx-auto w-72 max-w-full overflow-hidden rounded-xl border-8 border-neutral-800 bg-neutral-100">
                            <div className="flex items-center gap-2 bg-success-700 px-3 py-2 text-white">
                                <WhatsappLogo size={16} weight="fill" />
                                <span className="truncate text-caption font-semibold">
                                    {t('preview.title')}
                                </span>
                            </div>
                            <div className="min-h-80 p-3">
                                <WhatsAppTemplateBubble
                                    headerType={headerType}
                                    headerText={headerText}
                                    headerSampleUrl={headerSampleUrl}
                                    bodyText={previewBody}
                                    footerText={footerText}
                                    buttons={buttons}
                                    timestamp={`${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} ✓✓`}
                                />
                            </div>
                        </div>

                        {/* Info */}
                        <dl className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200 px-3 text-caption">
                            <div className="flex justify-between gap-3 py-2">
                                <dt className="text-neutral-500">{t('preview.category')}</dt>
                                <dd className="font-medium text-neutral-800">{category}</dd>
                            </div>
                            <div className="flex justify-between gap-3 py-2">
                                <dt className="text-neutral-500">{t('preview.language')}</dt>
                                <dd className="font-medium text-neutral-800">{language}</dd>
                            </div>
                            <div className="flex justify-between gap-3 py-2">
                                <dt className="text-neutral-500">{t('preview.placeholders')}</dt>
                                <dd className="font-medium text-neutral-800">{placeholderCount}</dd>
                            </div>
                            <div className="flex justify-between gap-3 py-2">
                                <dt className="text-neutral-500">{t('preview.buttonsCount')}</dt>
                                <dd className="font-medium text-neutral-800">{buttons.length}/3</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </div>
        </div>
    );
}
