import { useEffect, useRef, useState } from 'react';
import { Control, useController, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowDown,
    ArrowUp,
    Eye,
    FilePdf,
    FileText,
    ImageSquare,
    Info,
    PencilSimple,
    Trash,
    UploadSimple,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyInput } from '@/components/design-system/input';
import { MyDropdown } from '@/components/design-system/dropdown';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { UploadFileInS3 } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import type { BasicSectionFormType } from '@/types/assessments/assessment-steps';
import {
    EMPTY_REPORT_PAGES_FORM,
    MAX_REPORT_ASSET_BYTES,
    MAX_REPORT_PAGES,
    MAX_REPORT_PAGE_ASSETS,
    assetKeyFromName,
    movePage,
    normaliseConfig,
    pageCount,
    readScholarshipRule,
    reportPageValues,
    reportPagesFormFromResponse,
    reportPagesPreviewBody,
    writeScholarshipRule,
    type ReportPage,
    type ReportPageSide,
    type ReportPagesConfig,
    type ReportPagesForm,
    type ReportPagesMode,
} from '@/types/assessments/report-pages';
import {
    getAssessmentReportPages,
    getReportProfile,
    listReportProfiles,
    previewReportPages,
} from '../../../-services/report-pages-services';
import { ReportPageEditorDialog } from './ReportPageEditorDialog';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PAGE_BYTES = 10 * 1024 * 1024;

const PAGE_ICON = { TEMPLATE: FileText, PDF: FilePdf, IMAGE: ImageSquare } as const;

const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });

/**
 * Step 1 "Extra pages in the report": fixed pages before and after the student's report
 * (a scholarship letter, a brochure, ...). Saved with Step 1 as this test's
 * own pages (types/assessments/report-pages.ts); pages shared with other tests are copied,
 * never changed for them.
 */
export const ReportPagesSection = ({
    control,
    instituteId,
    assessmentId,
}: {
    control: Control<BasicSectionFormType>;
    instituteId?: string;
    /** The saved test's id; empty for a test not saved yet. */
    assessmentId?: string | null;
}) => {
    const { t } = useTranslation('assessmentStep1BasicInfo');
    const { field } = useController({ control, name: 'reportPages' });
    const value = (field.value as ReportPagesForm | undefined) ?? EMPTY_REPORT_PAGES_FORM;
    const studentFields =
        (useWatch({ control, name: 'reportOptions.studentFields' }) as string[] | undefined) ?? [];

    const { data, isLoading, isError, refetch } = useQuery({
        queryKey: ['assessment-report-pages', instituteId, assessmentId || 'new'],
        queryFn: () => getAssessmentReportPages(instituteId as string, assessmentId),
        enabled: !!instituteId,
        // Always read fresh when Step 1 opens: a cached copy could undo a save made elsewhere.
        gcTime: 0,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (data && !value.loaded) field.onChange(reportPagesFormFromResponse(data));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, value.loaded]);

    const custom = value.mode === 'CUSTOM';
    const { data: profiles = [] } = useQuery({
        queryKey: ['report-profiles', instituteId],
        queryFn: () => listReportProfiles(instituteId as string),
        enabled: !!instituteId && custom,
        staleTime: 60 * 1000,
    });

    const [uploading, setUploading] = useState(false);
    const [editing, setEditing] = useState<{ side: ReportPageSide; index: number } | null>(null);
    const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

    const update = (patch: Partial<ReportPagesForm>) =>
        field.onChange({ ...value, ...patch, dirty: true });
    const setConfig = (config: ReportPagesConfig) => update({ config });
    const pagesOf = (side: ReportPageSide) => value.config[side] ?? [];
    const setPages = (side: ReportPageSide, pages: ReportPage[]) =>
        setConfig({ ...value.config, [side]: pages });

    const chooseMode = async (mode: ReportPagesMode) => {
        // Starting custom pages from nothing: begin with the institute default's pages, if any.
        if (mode === 'CUSTOM' && pageCount(value.config) === 0 && data?.institute_default && instituteId) {
            try {
                const def = await getReportProfile(instituteId, data.institute_default.id);
                update({
                    mode,
                    config: normaliseConfig(def.config),
                    profileId: def.id,
                    startedFromInstituteDefault: true,
                });
                return;
            } catch {
                // Fall through to empty pages.
            }
        }
        update({ mode });
    };

    const copyFrom = async (profileId: string) => {
        if (!instituteId) return;
        try {
            const p = await getReportProfile(instituteId, profileId);
            // profileId stays this test's own: the server copies whenever that is shared.
            setConfig(normaliseConfig(p.config));
            toast.success(t('reportOptions.pages.copied', { name: p.name }));
        } catch {
            toast.error(t('reportOptions.pages.loadFailed'));
        }
    };

    const upload = async (side: ReportPageSide, type: 'PDF' | 'IMAGE', file: File | undefined) => {
        if (!file || !instituteId) return;
        if (pageCount(value.config) >= MAX_REPORT_PAGES) {
            toast.error(t('reportOptions.pages.tooManyPages', { count: MAX_REPORT_PAGES }));
            return;
        }
        if (file.size > (type === 'PDF' ? MAX_PDF_BYTES : MAX_IMAGE_PAGE_BYTES)) {
            toast.error(t('reportOptions.pages.fileTooLarge'));
            return;
        }
        try {
            const userId = getTokenDecodedData(getTokenFromCookie(TokenKey.accessToken))?.user ?? '';
            const fileId = await UploadFileInS3(file, setUploading, userId, instituteId, 'REPORT_PAGES');
            if (!fileId) throw new Error('no file id');
            const name = file.name.replace(/\.[^.]+$/, '');
            setPages(side, [...pagesOf(side), { type, name, file_id: fileId }]);
        } catch {
            toast.error(t('reportOptions.pages.uploadFailed'));
        } finally {
            setUploading(false);
        }
    };

    const addAsset = async (file: File | undefined) => {
        if (!file) return;
        const assets = value.config.assets ?? {};
        if (Object.keys(assets).length >= MAX_REPORT_PAGE_ASSETS) {
            toast.error(t('reportOptions.pages.tooManyImages', { count: MAX_REPORT_PAGE_ASSETS }));
            return;
        }
        if (!/^image\/(png|jpe?g)$/.test(file.type) || file.size > MAX_REPORT_ASSET_BYTES) {
            toast.error(t('reportOptions.pages.imageTooLarge'));
            return;
        }
        const key = assetKeyFromName(file.name, Object.keys(assets));
        setConfig({ ...value.config, assets: { ...assets, [key]: await readAsDataUrl(file) } });
    };

    const removeAsset = (key: string) => {
        const assets = { ...(value.config.assets ?? {}) };
        delete assets[key];
        setConfig({ ...value.config, assets });
    };

    const preview = async () => {
        if (!instituteId || !assessmentId || !data?.sample_attempt_id) return;
        try {
            const blob = await previewReportPages(
                instituteId,
                assessmentId,
                data.sample_attempt_id,
                reportPagesPreviewBody(value)
            );
            window.open(URL.createObjectURL(blob), '_blank', 'noopener');
        } catch {
            toast.error(t('reportOptions.pages.previewFailed'));
        }
    };

    const scholarship = readScholarshipRule(value.config);
    const values = reportPageValues({ config: value.config, studentFields });
    const editingPage =
        editing && editing.index >= 0 ? (pagesOf(editing.side)[editing.index] ?? null) : null;

    const fileInput = (side: ReportPageSide, type: 'PDF' | 'IMAGE') => (
        <input
            ref={(el) => {
                fileInputs.current[`${side}-${type}`] = el;
            }}
            type="file"
            className="hidden"
            accept={type === 'PDF' ? 'application/pdf' : 'image/png,image/jpeg'}
            onChange={(e) => {
                upload(side, type, e.target.files?.[0]);
                e.target.value = '';
            }}
        />
    );

    const pageList = (side: ReportPageSide) => {
        const pages = pagesOf(side);
        return (
            <div className="flex flex-col gap-2">
                <span className="text-body font-semibold text-neutral-800">
                    {t(`reportOptions.pages.${side}`)}
                </span>
                {pages.length === 0 && (
                    <p className="text-caption text-neutral-500">{t('reportOptions.pages.noPages')}</p>
                )}
                {pages.map((page, index) => {
                    const Icon = PAGE_ICON[page.type] ?? FileText;
                    return (
                        <div
                            key={`${side}-${index}`}
                            className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2"
                        >
                            <Icon className="size-5 shrink-0 text-primary-500" />
                            <div className="min-w-0 flex-1">
                                <MyInput
                                    input={page.name ?? ''}
                                    onChangeFunction={(e) =>
                                        setPages(
                                            side,
                                            pages.map((p, i) => (i === index ? { ...p, name: e.target.value } : p))
                                        )
                                    }
                                    size="small"
                                    className="sm:w-full"
                                    inputPlaceholder={t('reportOptions.pages.untitledPage')}
                                />
                            </div>
                            <span className="text-caption text-neutral-500">
                                {t(`reportOptions.pages.pageTypes.${page.type}`)}
                            </span>
                            <MyButton
                                type="button"
                                buttonType="text"
                                layoutVariant="icon"
                                scale="small"
                                aria-label={t('reportOptions.pages.moveUp')}
                                disable={index === 0}
                                onClick={() => setPages(side, movePage(pages, index, -1))}
                            >
                                <ArrowUp />
                            </MyButton>
                            <MyButton
                                type="button"
                                buttonType="text"
                                layoutVariant="icon"
                                scale="small"
                                aria-label={t('reportOptions.pages.moveDown')}
                                disable={index === pages.length - 1}
                                onClick={() => setPages(side, movePage(pages, index, 1))}
                            >
                                <ArrowDown />
                            </MyButton>
                            {page.type === 'TEMPLATE' && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    layoutVariant="icon"
                                    scale="small"
                                    aria-label={t('reportOptions.pages.edit')}
                                    onClick={() => setEditing({ side, index })}
                                >
                                    <PencilSimple />
                                </MyButton>
                            )}
                            <MyButton
                                type="button"
                                buttonType="text"
                                layoutVariant="icon"
                                scale="small"
                                aria-label={t('reportOptions.pages.remove')}
                                onClick={() => setPages(side, pages.filter((_, i) => i !== index))}
                            >
                                <Trash className="text-danger-600" />
                            </MyButton>
                        </div>
                    );
                })}
                <div className="flex flex-wrap gap-2">
                    {fileInput(side, 'PDF')}
                    {fileInput(side, 'IMAGE')}
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={uploading}
                        onClick={() => fileInputs.current[`${side}-PDF`]?.click()}
                    >
                        <UploadSimple className="mr-1" />
                        {t('reportOptions.pages.uploadPdf')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={uploading}
                        onClick={() => fileInputs.current[`${side}-IMAGE`]?.click()}
                    >
                        <ImageSquare className="mr-1" />
                        {t('reportOptions.pages.uploadImage')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        onClick={() => setEditing({ side, index: -1 })}
                    >
                        <PencilSimple className="mr-1" />
                        {t('reportOptions.pages.writePage')}
                    </MyButton>
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-4 border-t border-neutral-100 pt-4" id="report-pages">
            <div className="flex flex-col">
                <span className="text-body text-neutral-900">{t('reportOptions.pages.title')}</span>
                <span className="text-caption text-neutral-500">{t('reportOptions.pages.description')}</span>
            </div>

            {isLoading && !value.loaded ? (
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-6 w-2/3" />
                    <Skeleton className="h-6 w-1/2" />
                </div>
            ) : isError && !value.loaded ? (
                <div className="flex items-center gap-2 text-caption text-danger-600">
                    <WarningCircle className="size-4" />
                    <span>{t('reportOptions.pages.loadFailed')}</span>
                    <MyButton type="button" buttonType="text" scale="small" onClick={() => refetch()}>
                        {t('reportOptions.pages.retry')}
                    </MyButton>
                </div>
            ) : (
                <>
                    <RadioGroup
                        value={value.mode}
                        onValueChange={(mode) => chooseMode(mode as ReportPagesMode)}
                        className="flex flex-col gap-2"
                    >
                        <div className="flex items-start gap-2">
                            <RadioGroupItem value="DEFAULT" id="report-pages-default" className="mt-1" />
                            <Label htmlFor="report-pages-default" className="flex flex-col gap-0.5">
                                <span className="text-body text-neutral-900">
                                    {t('reportOptions.pages.modeDefault')}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {data?.institute_default
                                        ? t('reportOptions.pages.modeDefaultWith', {
                                              name: data.institute_default.name,
                                              count: data.institute_default.pages,
                                          })
                                        : t('reportOptions.pages.modeDefaultNone')}
                                </span>
                            </Label>
                        </div>
                        <div className="flex items-start gap-2">
                            <RadioGroupItem value="NONE" id="report-pages-none" className="mt-1" />
                            <Label htmlFor="report-pages-none" className="text-body text-neutral-900">
                                {t('reportOptions.pages.modeNone')}
                            </Label>
                        </div>
                        <div className="flex items-start gap-2">
                            <RadioGroupItem value="CUSTOM" id="report-pages-custom" className="mt-1" />
                            <Label htmlFor="report-pages-custom" className="text-body text-neutral-900">
                                {t('reportOptions.pages.modeCustom')}
                            </Label>
                        </div>
                    </RadioGroup>

                    {custom && (
                        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                            {(value.sharedWith > 0 || value.startedFromInstituteDefault) && (
                                <p className="flex items-start gap-2 text-caption text-warning-600">
                                    <Info className="mt-0.5 size-3.5 shrink-0" />
                                    <span>
                                        {value.startedFromInstituteDefault
                                            ? t('reportOptions.pages.defaultNote')
                                            : t('reportOptions.pages.sharedNote', { count: value.sharedWith })}
                                    </span>
                                </p>
                            )}

                            {profiles.length > 0 && (
                                <div className="flex flex-col gap-1">
                                    <span className="text-caption text-neutral-600">
                                        {t('reportOptions.pages.copyFrom')}
                                    </span>
                                    <MyDropdown
                                        placeholder={t('reportOptions.pages.copyFromPlaceholder')}
                                        dropdownList={profiles.map((p) => ({ label: p.name, value: p.id }))}
                                        handleChange={(id: string) => copyFrom(id)}
                                        contentClassName="max-h-72 overflow-y-auto"
                                    />
                                </div>
                            )}

                            {pageList('before')}

                            <div className="rounded-md border border-dashed border-primary-300 bg-primary-50 px-3 py-3">
                                <span className="text-body font-semibold text-primary-500">
                                    {t('reportOptions.pages.reportBlock')}
                                </span>
                                <p className="text-caption text-neutral-600">
                                    {t('reportOptions.pages.reportBlockHint')}
                                </p>
                            </div>

                            {pageList('after')}

                            <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
                                <span className="text-body font-semibold text-neutral-800">
                                    {t('reportOptions.pages.settings')}
                                </span>
                                <div className="flex flex-col gap-2">
                                    <label className="flex items-center gap-2 text-body text-neutral-900">
                                        <Checkbox
                                            checked={scholarship.kind !== 'none'}
                                            onCheckedChange={(on) =>
                                                setConfig(writeScholarshipRule(value.config, on === true ? 40 : null))
                                            }
                                        />
                                        {t('reportOptions.pages.scholarshipLabel')}
                                    </label>
                                    {scholarship.kind === 'simple' && (
                                        <div className="flex flex-col gap-1 pl-6">
                                            <MyInput
                                                label={t('reportOptions.pages.scholarshipMin')}
                                                inputType="number"
                                                input={String(scholarship.minPercent)}
                                                onChangeFunction={(e) =>
                                                    setConfig(
                                                        writeScholarshipRule(value.config, Number(e.target.value) || 0)
                                                    )
                                                }
                                                size="small"
                                                min={0}
                                                max={100}
                                            />
                                            <span className="text-caption text-neutral-500">
                                                {t('reportOptions.pages.scholarshipHint', {
                                                    min: scholarship.minPercent,
                                                })}
                                            </span>
                                        </div>
                                    )}
                                    {scholarship.kind === 'custom' && (
                                        <span className="pl-6 text-caption text-neutral-500">
                                            {t('reportOptions.pages.scholarshipCustom')}
                                        </span>
                                    )}
                                </div>
                                <MyInput
                                    label={t('reportOptions.pages.resultDate')}
                                    inputPlaceholder={t('reportOptions.pages.resultDatePlaceholder')}
                                    input={value.config.result_date ?? ''}
                                    onChangeFunction={(e) =>
                                        setConfig({ ...value.config, result_date: e.target.value })
                                    }
                                    size="small"
                                    className="sm:w-80"
                                />
                                <MyInput
                                    label={t('reportOptions.pages.qrUrl')}
                                    inputPlaceholder="https://"
                                    input={value.config.qr_url ?? ''}
                                    onChangeFunction={(e) => setConfig({ ...value.config, qr_url: e.target.value.trim() })}
                                    size="small"
                                    className="sm:w-80"
                                />
                            </div>

                            <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3">
                                <span className="text-body font-semibold text-neutral-800">
                                    {t('reportOptions.pages.images')}
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {t('reportOptions.pages.imagesHint')}
                                </span>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(value.config.assets ?? {}).map(([key, uri]) => (
                                        <div
                                            key={key}
                                            className="flex items-center gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1"
                                        >
                                            <img src={uri} alt={key} className="h-8 w-auto max-w-24 object-contain" />
                                            <span className="text-caption text-neutral-700">{key}</span>
                                            <MyButton
                                                type="button"
                                                buttonType="text"
                                                layoutVariant="icon"
                                                scale="small"
                                                aria-label={t('reportOptions.pages.remove')}
                                                onClick={() => removeAsset(key)}
                                            >
                                                <Trash className="text-danger-600" />
                                            </MyButton>
                                        </div>
                                    ))}
                                </div>
                                <input
                                    ref={(el) => {
                                        fileInputs.current.asset = el;
                                    }}
                                    type="file"
                                    className="hidden"
                                    accept="image/png,image/jpeg"
                                    onChange={(e) => {
                                        addAsset(e.target.files?.[0]);
                                        e.target.value = '';
                                    }}
                                />
                                <div>
                                    <MyButton
                                        type="button"
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => fileInputs.current.asset?.click()}
                                    >
                                        <ImageSquare className="mr-1" />
                                        {t('reportOptions.pages.addImage')}
                                    </MyButton>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="small"
                            disable={!assessmentId || !data?.sample_attempt_id}
                            onAsyncClick={preview}
                            loadingText={t('reportOptions.pages.previewing')}
                        >
                            <Eye className="mr-1" />
                            {t('reportOptions.pages.preview')}
                        </MyButton>
                        <span className="text-caption text-neutral-500">
                            {!assessmentId || !data?.sample_attempt_id
                                ? t('reportOptions.pages.previewHint')
                                : t('reportOptions.pages.previewReady')}
                        </span>
                    </div>
                </>
            )}

            <ReportPageEditorDialog
                open={editing != null}
                onOpenChange={(open) => !open && setEditing(null)}
                page={editingPage}
                values={values}
                onSave={(page) => {
                    if (!editing) return;
                    const pages = pagesOf(editing.side);
                    if (editing.index < 0 && pageCount(value.config) >= MAX_REPORT_PAGES) {
                        toast.error(t('reportOptions.pages.tooManyPages', { count: MAX_REPORT_PAGES }));
                        return;
                    }
                    setPages(
                        editing.side,
                        editing.index < 0
                            ? [...pages, page]
                            : pages.map((p, i) => (i === editing.index ? page : p))
                    );
                }}
            />
        </div>
    );
};
