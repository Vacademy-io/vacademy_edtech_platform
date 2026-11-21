import { useCallback, useEffect, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, CircleNotch, FileXls, WarningCircle } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useSlidesMutations } from '../../-hooks/use-slides';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import { buildAppendReorderPayload, getNextSlideOrder } from '../../-helper/slide-naming-utils';
import {
    convertSpreadsheetFile,
    uploadConvertedSpreadsheet,
    type ConvertedSpreadsheet,
} from './spreadsheet-import';
import { spreadsheetErrorMessage, spreadsheetLimitHint } from './spreadsheet-errors';
import {
    SPREADSHEET_DOC_TYPE,
    serializeSpreadsheetData,
    spreadsheetTitleFromFileName,
    type SpreadsheetSlideData,
} from './spreadsheet-slide-data';

const ACCEPT = {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'application/vnd.ms-excel': ['.xls'],
    'text/csv': ['.csv'],
};

type Picked = { file: File; converted: ConvertedSpreadsheet };

/**
 * "Spreadsheet (Excel)" in the add-slide menu: pick an .xlsx / .xls / .csv,
 * convert it in the browser to the read-only grid, keep the original file for
 * download, and create a DOCUMENT slide of type SPREADSHEET.
 */
export const AddSpreadsheetDialog = ({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) => {
    const { t, i18n } = useTranslation('spreadsheetSlide');
    const { t: tMenu } = useTranslation('slideAddMenu');
    const route = useRouter();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } =
        route.state.location.search;
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { addUpdateDocumentSlide, updateSlideOrder } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );
    const { items, setActiveItem, getSlideById } = useContentStore();
    const { uploadFile } = useFileUpload();

    const [picked, setPicked] = useState<Picked | null>(null);
    const [title, setTitle] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [reading, setReading] = useState(false);
    const [saving, setSaving] = useState(false);
    // Title last filled in from a file name (so a re-pick can replace it).
    const autoTitleRef = useRef('');

    useEffect(() => {
        if (open) return;
        setPicked(null);
        setTitle('');
        autoTitleRef.current = '';
        setError(null);
        setReading(false);
        setSaving(false);
    }, [open]);

    const onDrop = useCallback(
        async (files: File[]) => {
            const file = files[0];
            if (!file) return;
            setError(null);
            setPicked(null);
            setReading(true);
            try {
                const converted = await convertSpreadsheetFile(file);
                setPicked({ file, converted });
                // Follow the new file's name unless the admin typed their own title.
                const nextAuto = spreadsheetTitleFromFileName(file.name);
                const prevAuto = autoTitleRef.current;
                autoTitleRef.current = nextAuto;
                setTitle((current) => (!current || current === prevAuto ? nextAuto : current));
            } catch (err) {
                setError(spreadsheetErrorMessage(t, i18n.language, err));
            } finally {
                setReading(false);
            }
        },
        [t, i18n.language]
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: ACCEPT,
        maxFiles: 1,
        multiple: false,
        disabled: reading || saving,
        onDropRejected: () => setError(t('errors.unsupportedType')),
    });

    const handleCreate = async () => {
        if (!picked) return;
        setSaving(true);
        try {
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            const tokenData = getTokenDecodedData(accessToken);
            const instituteId = tokenData && Object.keys(tokenData.authorities)[0];
            // The workbook (for download) and the grid JSON (what learners see)
            // are both media files; the slide keeps only their ids.
            let slideData: SpreadsheetSlideData;
            try {
                slideData = await uploadConvertedSpreadsheet({
                    original: picked.file,
                    converted: picked.converted,
                    upload: (file) =>
                        uploadFile({
                            file,
                            setIsUploading: () => undefined,
                            userId: 'your-user-id',
                            source: instituteId,
                            sourceId: 'SPREADSHEET_DOCUMENTS',
                        }),
                });
            } catch {
                toast.error(t('dialog.uploadFailed'));
                return;
            }

            const json = serializeSpreadsheetData(slideData);
            const slideTitle = title.trim() || spreadsheetTitleFromFileName(picked.file.name);
            const slideId = crypto.randomUUID();
            const slideStatus = getSlideStatusForUser();
            const response = await addUpdateDocumentSlide({
                id: slideId,
                title: slideTitle,
                image_file_id: '',
                description: null,
                slide_order: getNextSlideOrder(items || []),
                document_slide: {
                    id: crypto.randomUUID(),
                    type: SPREADSHEET_DOC_TYPE,
                    data: json,
                    title: slideTitle,
                    cover_file_id: '',
                    total_pages: 1,
                    published_data: slideStatus === 'PUBLISHED' ? json : null,
                    published_document_total_pages: 1,
                },
                status: slideStatus,
                new_slide: true,
                notify: false,
            });

            if (response) {
                try {
                    const currentSlides = useContentStore.getState().items || [];
                    if (currentSlides.some((s) => s.id === slideId)) {
                        await updateSlideOrder({
                            chapterId: chapterId || '',
                            slideOrderPayload: buildAppendReorderPayload(slideId, currentSlides),
                        });
                    }
                } catch {
                    toast.error(tMenu('toasts.reorderFailed'));
                }
                setTimeout(() => {
                    const created = getSlideById(slideId);
                    if (created) setActiveItem(created);
                }, 500);
                toast.success(t('dialog.created'));
                onOpenChange(false);
            }
        } catch (err) {
            const apiMessage = (err as { response?: { data?: { message?: string; ex?: string } } })
                ?.response?.data;
            toast.error(apiMessage?.ex || apiMessage?.message || t('dialog.createFailed'));
        } finally {
            setSaving(false);
        }
    };

    const stats = picked
        ? { tabs: picked.converted.sheetNames.length, cells: picked.converted.cellCount }
        : null;
    const hint = spreadsheetLimitHint(i18n.language);

    return (
        <MyDialog
            trigger={<></>}
            heading={tMenu('dialogs.uploadSpreadsheet')}
            // Full width on phones; the usual add-slide dialog width from sm up.
            dialogWidth="max-w-lg sm:min-w-slide-dialog-sm"
            open={open}
            onOpenChange={(next) => !saving && onOpenChange(next)}
        >
            {/* MyDialog already pads its body. */}
            <div className="flex flex-col gap-5">
                <div
                    {...getRootProps()}
                    className={cn(
                        'flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
                        picked
                            ? 'border-success-300 bg-success-50'
                            : 'border-primary-300 bg-primary-50 hover:border-primary-400',
                        isDragActive && 'border-primary-500'
                    )}
                >
                    <input {...getInputProps()} />
                    {reading ? (
                        <>
                            <CircleNotch className="size-8 animate-spin text-primary-500" />
                            <p className="text-body text-neutral-600">{t('dialog.reading')}</p>
                        </>
                    ) : picked ? (
                        <>
                            <CheckCircle className="size-8 text-success-600" weight="fill" />
                            <div className="flex flex-col gap-1">
                                <p className="break-all text-subtitle font-semibold text-neutral-700">
                                    {picked.file.name}
                                </p>
                                {stats && (
                                    <p className="text-caption text-neutral-500">
                                        {t('dialog.summary', {
                                            tabs: stats.tabs,
                                            cells: stats.cells,
                                        })}
                                    </p>
                                )}
                                <p className="text-caption text-neutral-500">
                                    {t('dialog.chooseAnother')}
                                </p>
                            </div>
                        </>
                    ) : (
                        <>
                            <FileXls className="size-8 text-success-600" />
                            <div className="flex flex-col gap-1">
                                <p className="text-body font-medium text-neutral-700">
                                    {t('dialog.dropzoneHint')}
                                </p>
                                <p className="text-caption text-neutral-500">
                                    {t('dialog.dropzoneFormats', hint)}
                                </p>
                            </div>
                        </>
                    )}
                </div>

                {error && (
                    <div
                        role="alert"
                        className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-body text-danger-600"
                    >
                        <WarningCircle className="mt-0.5 size-4 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {picked && (
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="spreadsheet-slide-title">{t('dialog.titleLabel')}</Label>
                        <Input
                            id="spreadsheet-slide-title"
                            value={title}
                            maxLength={200}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>
                )}

                <p className="text-caption text-neutral-500">{t('dialog.note')}</p>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => onOpenChange(false)}
                        disabled={saving}
                    >
                        {t('dialog.cancel')}
                    </MyButton>
                    <MyButton
                        type="button"
                        buttonType="primary"
                        scale="medium"
                        onClick={handleCreate}
                        disabled={!picked || saving || reading}
                    >
                        {saving ? t('dialog.saving') : t('dialog.create')}
                    </MyButton>
                </div>
            </div>
        </MyDialog>
    );
};
