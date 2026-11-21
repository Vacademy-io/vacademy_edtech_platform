import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle, FilePdf } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { Form } from '@/components/ui/form';
import { Progress } from '@/components/ui/progress';
import type { FileType } from '@/types/common/file-upload';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { useSlidesMutations, type Slide } from '../../-hooks/use-slides';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import { convertPptToPdf } from '../slides-sidebar/add-ppt-dialog';
import { createQuizSlidePayload } from '../yoopta-editor-customizations/createAssignmentSlidePayload';
import { serializeDocumentQuizRef, type DocumentQuizSource } from './document-quiz-ref';

const PDF_TYPE: FileType = 'application/pdf';
const PPT_TYPES: FileType[] = [
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

/** 'PDF' or 'PPT' from the file name / type, or null when it is neither. */
export function documentKindOf(file: { name: string; type?: string }): DocumentQuizSource | null {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'pdf' || file.type === PDF_TYPE) return 'PDF';
    if (ext === 'ppt' || ext === 'pptx' || (PPT_TYPES as string[]).includes(file.type ?? ''))
        return 'PPT';
    return null;
}

interface FormData {
    documentFile: FileList | null;
}

interface AddDocumentQuizDialogProps {
    /** 'create' adds a new Document + Quiz slide; 'replace' swaps the document of the active one. */
    mode: 'create' | 'replace';
    onDone: () => void;
}

/**
 * Upload a PDF (or a PowerPoint, converted to PDF exactly as the PPT slide does)
 * and either create a Document + Quiz slide or replace the active slide's document.
 */
export const AddDocumentQuizDialog = ({ mode, onDone }: AddDocumentQuizDialogProps) => {
    const { t } = useTranslation('studyLibraryDocumentQuiz');
    const route = useRouter();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } =
        route.state.location.search;
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { addUpdateQuizSlide } = useSlidesMutations(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );
    const { items, activeItem, setActiveItem } = useContentStore();
    const { uploadFile } = useFileUpload();

    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState('');
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const form = useForm<FormData>({ defaultValues: { documentFile: null } });

    const handleFileSubmit = (selected: File) => {
        if (!documentKindOf(selected)) {
            setError(t('errors.unsupportedType'));
            return;
        }
        setError(null);
        setFile(selected);
        form.setValue('documentFile', [selected] as unknown as FileList);
    };

    /** Converts a PowerPoint first, then uploads the PDF; returns its file id. */
    const uploadDocument = async (selected: File, kind: DocumentQuizSource): Promise<string> => {
        let pdf = selected;
        if (kind === 'PPT') {
            setStatus(t('status.converting'));
            setProgress(25);
            pdf = await convertPptToPdf(selected);
        }
        setStatus(t('status.uploading'));
        setProgress(60);
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const tokenData = getTokenDecodedData(accessToken);
        const instituteId = tokenData && Object.keys(tokenData.authorities)[0];
        const fileId = await uploadFile({
            file: pdf,
            setIsUploading,
            userId: 'your-user-id',
            source: instituteId,
            sourceId: 'PDF_DOCUMENTS',
        });
        if (!fileId) throw new Error(t('errors.uploadFailed'));
        return fileId;
    };

    const createSlide = async (marker: string, baseName: string) => {
        const payload = createQuizSlidePayload(items || [], baseName);
        payload.quiz_slide = { ...payload.quiz_slide, title: marker };
        const response = await addUpdateQuizSlide(payload);
        if (!response) throw new Error(t('errors.createFailed'));
        const newSlide: Slide = {
            id: payload.id || '',
            source_id: payload.source_id || '',
            source_type: 'QUIZ',
            title: payload.title,
            image_file_id: payload.image_file_id || '',
            description: payload.description,
            status: payload.status,
            slide_order: payload.slide_order ?? 0,
            video_slide: null,
            document_slide: null,
            question_slide: null,
            assignment_slide: null,
            quiz_slide: payload.quiz_slide,
            is_loaded: true,
            new_slide: true,
        };
        setActiveItem(newSlide);
        toast.success(t('toast.created'));
    };

    // Replacing only changes the slide in the editor; the usual Save / Publish
    // sends quiz_slide.title with the rest of the quiz, like any other quiz edit.
    const replaceDocument = (marker: string) => {
        if (!activeItem?.quiz_slide) throw new Error(t('errors.createFailed'));
        setActiveItem({
            ...activeItem,
            quiz_slide: { ...activeItem.quiz_slide, title: marker },
        });
        toast.success(t('toast.replaced'));
    };

    const handleSubmit = async () => {
        const kind = file ? documentKindOf(file) : null;
        if (!file || !kind) {
            setError(t('errors.unsupportedType'));
            return;
        }
        setIsUploading(true);
        setError(null);
        setProgress(5);
        try {
            const fileId = await uploadDocument(file, kind);
            const baseName = file.name.replace(/\.[^/.]+$/, '');
            const marker = serializeDocumentQuizRef({
                fileId,
                fileName: kind === 'PPT' ? `${baseName}.pdf` : file.name,
                source: kind,
            });
            setStatus(t('status.creating'));
            setProgress(90);
            if (mode === 'replace') {
                replaceDocument(marker);
            } else {
                await createSlide(marker, baseName);
            }
            setProgress(100);
            onDone();
        } catch (err) {
            const message =
                err instanceof Error && err.message ? err.message : t('errors.uploadFailed');
            setError(message);
            toast.error(message);
        } finally {
            setIsUploading(false);
            setStatus('');
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col gap-6 p-6">
                <p className="text-sm text-neutral-600">{t('dialog.intro')}</p>
                <FileUploadComponent
                    fileInputRef={fileInputRef}
                    onFileSubmit={handleFileSubmit}
                    control={form.control}
                    name="documentFile"
                    acceptedFileTypes={[PDF_TYPE, ...PPT_TYPES]}
                    isUploading={isUploading}
                    error={error}
                    disableClick={false}
                    className={`flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 transition-colors ${
                        file
                            ? 'border-success-300 bg-success-50'
                            : 'border-primary-300 bg-primary-50 hover:border-primary-400'
                    }`}
                >
                    <div className="pointer-events-none flex flex-col items-center gap-3 text-center">
                        {file ? (
                            <div className="flex items-center gap-3">
                                <CheckCircle className="size-6 text-success-600" />
                                <div className="text-start">
                                    <p className="break-all font-medium text-neutral-700">
                                        {file.name}
                                    </p>
                                    <p className="text-sm text-neutral-500">
                                        {t('dialog.fileSize', {
                                            size: (file.size / (1024 * 1024)).toFixed(2),
                                        })}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="rounded-full bg-primary-100 p-4">
                                    <FilePdf className="size-8 text-primary-500" />
                                </div>
                                <p className="font-medium text-neutral-700">
                                    {t('dropzone.title')}
                                </p>
                                <p className="text-sm text-neutral-500">{t('dropzone.subtitle')}</p>
                            </>
                        )}
                    </div>
                </FileUploadComponent>

                {error && (
                    <p className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-600">
                        {error}
                    </p>
                )}

                {isUploading && (
                    <div className="flex flex-col gap-2">
                        <Progress value={progress} className="h-2" />
                        <span className="text-sm text-neutral-600">
                            {status || t('status.working')}
                        </span>
                    </div>
                )}

                <MyButton
                    buttonType="primary"
                    scale="large"
                    layoutVariant="default"
                    type="submit"
                    disabled={!file || isUploading}
                    className="w-full"
                >
                    {mode === 'replace' ? t('actions.replace') : t('actions.create')}
                </MyButton>
            </form>
        </Form>
    );
};
