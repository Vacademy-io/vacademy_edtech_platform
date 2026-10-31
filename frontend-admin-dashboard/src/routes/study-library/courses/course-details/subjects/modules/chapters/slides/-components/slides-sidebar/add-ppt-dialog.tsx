import { MyButton } from '@/components/design-system/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { FileUploadComponent } from '@/components/design-system/file-upload';
import { Form } from '@/components/ui/form';
import { useSlides } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';
import { useRouter } from '@tanstack/react-router';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useContentStore } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-stores/chapter-sidebar-store';
import * as pdfjs from 'pdfjs-dist';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { CheckCircle, PresentationChart } from '@phosphor-icons/react';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import { CONVERT_PPT_TO_PDF_BY_ID_URL, ANIMATE_PPTX_URL } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { useFileUpload } from '@/hooks/use-file-upload';
import { UploadFileInS3, getPublicUrl } from '@/services/upload_file';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface FormData {
    pptFile: FileList | null;
    pptTitle: string;
}

/**
 * Converts a PPT/PPTX file to PDF using the media-service API.
 * Returns the PDF as a File object.
 *
 * The presentation is uploaded directly to S3 via a pre-signed URL and only its
 * fileId is sent to media-service for conversion. This keeps the large upload off
 * the nginx/Spring request path, which otherwise rejects big decks with a 413.
 */
export async function convertPptToPdf(file: File): Promise<File> {
    try {
        // 1. Upload the presentation straight to S3 (bypasses the request-size limit).
        const accessToken = getTokenFromCookie(TokenKey.accessToken);
        const decoded = getTokenDecodedData(accessToken) as
            | { userId?: string; sub?: string; authorities?: Record<string, unknown> }
            | undefined;
        const userId = decoded?.userId || decoded?.sub || '';
        const instituteId = (decoded?.authorities && Object.keys(decoded.authorities)[0]) || 'STUDENTS';

        const fileId = await UploadFileInS3(file, () => {}, userId, 'PPT_TO_PDF', instituteId, false);
        if (!fileId) {
            throw new Error('Failed to upload presentation for conversion.');
        }

        // 2. Convert the uploaded file by id (tiny request body, no 413).
        const response = await authenticatedAxiosInstance.post(
            `${CONVERT_PPT_TO_PDF_BY_ID_URL}?quality=high`,
            { file_id: fileId, file_name: file.name },
            { responseType: 'blob' }
        );

        const pdfBlob = new Blob([response.data], { type: 'application/pdf' });
        const pdfFileName = file.name.replace(/\.[^/.]+$/, '') + '.pdf';
        return new File([pdfBlob], pdfFileName, { type: 'application/pdf' });
    } catch (error: unknown) {
        // If the axios interceptor already extracted the message (e.g. from blob 511 response)
        if (error instanceof Error && error.message && error.message !== 'Network Error') {
            throw error;
        }
        // Fallback: try to parse blob error response directly
        if (
            error &&
            typeof error === 'object' &&
            'response' in error &&
            (error as { response?: { data?: unknown } }).response?.data instanceof Blob
        ) {
            const blob = (error as { response: { data: Blob } }).response.data;
            try {
                const text = await blob.text();
                const json = JSON.parse(text);
                throw new Error(json.ex || json.message || 'PPT conversion failed.');
            } catch (parseError) {
                if (parseError instanceof Error && parseError.message !== 'PPT conversion failed.') {
                    throw new Error(
                        (parseError as SyntaxError).name === 'SyntaxError'
                            ? 'PPT conversion failed. Please try again.'
                            : parseError.message
                    );
                }
                throw parseError;
            }
        }
        throw error;
    }
}

export const AddPptDialog = ({
    openState,
}: {
    openState?: ((open: boolean) => void) | undefined;
}) => {
    const { t } = useTranslation('studyLibraryAddPptDialog');
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const route = useRouter();
    const { courseId, levelId, chapterId, moduleId, subjectId, sessionId } =
        route.state.location.search;
    const { getPackageSessionId } = useInstituteDetailsStore();
    const { addUpdateDocumentSlide, updateSlideOrder } = useSlides(
        chapterId || '',
        moduleId || '',
        subjectId || '',
        getPackageSessionId({
            courseId: courseId || '',
            levelId: levelId || '',
            sessionId: sessionId || '',
        }) || ''
    );
    const { setActiveItem, getSlideById, items } = useContentStore();
    const { uploadFile } = useFileUpload();

    const form = useForm<FormData>({
        defaultValues: {
            pptFile: null,
            pptTitle: '',
        },
    });

    const reorderSlidesAfterNewSlide = async (newSlideId: string) => {
        try {
            const currentSlides = items || [];
            const newSlide = currentSlides.find((slide) => slide.id === newSlideId);
            if (!newSlide) return;

            const reorderedSlides = buildAppendReorderPayload(newSlideId, currentSlides);

            await updateSlideOrder({
                chapterId: chapterId || '',
                slideOrderPayload: reorderedSlides,
            });

            setTimeout(() => {
                setActiveItem(getSlideById(newSlideId));
            }, 500);
        } catch (error) {
            console.error('Error reordering slides:', error);
            toast.error(t('toast.reorderFailed'));
        }
    };

    const handleFileSubmit = async (selectedFile: File) => {
        const ext = selectedFile.name.split('.').pop()?.toLowerCase();
        if (!['ppt', 'pptx'].includes(ext || '')) {
            setError(t('errors.onlyPptOrPptx'));
            return;
        }

        setError(null);
        setFile(selectedFile);
        form.setValue('pptFile', [selectedFile] as unknown as FileList);

        const fileName = selectedFile.name.replace(/\.[^/.]+$/, '');
        form.setValue('pptTitle', fileName);
        toast.success(t('toast.fileSelected'));
    };

    // Create a document slide. `data` is the slide payload — a PDF fileId, or for
    // PPT_ANIM the converted deck's base URL (manifest.json sits at <base>/manifest.json).
    const createDocumentSlide = async (
        type: string,
        data: string,
        totalPages: number
    ): Promise<string> => {
        const slideStatus = getSlideStatusForUser();
        const response: string = await addUpdateDocumentSlide({
            id: crypto.randomUUID(),
            title: form.getValues('pptTitle'),
            image_file_id: '',
            description: null,
            slide_order: getNextSlideOrder(items || []),
            document_slide: {
                id: crypto.randomUUID(),
                type,
                data,
                title: form.getValues('pptTitle'),
                cover_file_id: '',
                total_pages: totalPages,
                published_data: slideStatus === 'PUBLISHED' ? data : null,
                published_document_total_pages: slideStatus === 'PUBLISHED' ? totalPages : 1,
            },
            status: slideStatus,
            new_slide: true,
            notify: false,
        });
        if (response) {
            await reorderSlidesAfterNewSlide(response);
        }
        return response;
    };

    // Primary path: convert to an interactive slideshow (build-step snapshots +
    // manifest) on the AI service, preserving entrance animations. The learner
    // plays it via <DeckPlayer> (slide type PPT_ANIM).
    const uploadAsAnimated = async (): Promise<string> => {
        const decoded = data as { userId?: string; sub?: string } | undefined;
        const userId = decoded?.userId || decoded?.sub || '';

        setStatusMessage(t('status.uploadingPresentation'));
        setUploadProgress(15);
        const pptFileId = await UploadFileInS3(
            file!,
            () => {},
            userId,
            'PPT_PRESENTATIONS',
            INSTITUTE_ID || 'STUDENTS',
            true // public — the worker fetches the source; the output is served to learners
        );
        if (!pptFileId) throw new Error(t('errors.uploadFailed'));

        const pptxUrl = await getPublicUrl(pptFileId);
        if (!pptxUrl) throw new Error(t('errors.resolveUrlFailed'));

        setStatusMessage(t('status.convertingAnimated'));
        setUploadProgress(30);
        const submit = await authenticatedAxiosInstance.post(ANIMATE_PPTX_URL, {
            pptx_url: pptxUrl,
            dpi: 110,
        });
        const jobId: string | undefined = submit.data?.job_id;
        if (!jobId) throw new Error(t('errors.conversionDidNotStart'));

        // Poll the worker job (via the AI-service proxy) until it finishes. Bail
        // fast (→ PDF fallback) if the conversion service stops responding rather
        // than spinning out the whole timeout.
        let result: { deck_base?: string; slide_count?: number } | null = null;
        let unreachable = 0;
        for (let attempt = 0; attempt < 200; attempt++) {
            await new Promise((r) => setTimeout(r, 3000));
            let job: {
                status?: string;
                progress?: number;
                result?: { deck_base?: string; slide_count?: number };
                error?: string;
            };
            try {
                const status = await authenticatedAxiosInstance.get(`${ANIMATE_PPTX_URL}/${jobId}`);
                job = status.data || {};
            } catch {
                if (++unreachable >= 3) throw new Error(t('errors.lostContact'));
                continue;
            }
            // "unknown" = the proxy couldn't reach the worker; a run of them means
            // a dead worker — fall back instead of waiting out the timeout.
            if (!job.status || job.status === 'unknown') {
                if (++unreachable >= 3) throw new Error(t('errors.serviceNotResponding'));
                continue;
            }
            unreachable = 0;
            if (typeof job.progress === 'number') {
                setUploadProgress(Math.min(90, 30 + Math.round(job.progress * 0.6)));
            }
            if (job.status === 'completed') {
                result = job.result || {};
                break;
            }
            if (job.status === 'failed') {
                throw new Error(job.error || t('errors.conversionFailed'));
            }
        }
        if (!result?.deck_base) throw new Error(t('errors.conversionTimedOut'));

        setStatusMessage(t('status.creatingSlide'));
        setUploadProgress(95);
        return createDocumentSlide('PPT_ANIM', result.deck_base, result.slide_count || 1);
    };

    // Fallback path: the original static-PDF conversion (CloudConvert via
    // media-service). Used when the animated conversion is unavailable or fails.
    const uploadAsPdf = async (): Promise<string> => {
        setStatusMessage(t('status.convertingToPdf'));
        setUploadProgress(40);
        const pdfFile = await convertPptToPdf(file!);

        setStatusMessage(t('status.analyzingPdfPages'));
        const arrayBuffer = await pdfFile.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;

        setStatusMessage(t('status.uploadingConvertedPdf'));
        setUploadProgress(70);
        const fileId = await uploadFile({
            file: pdfFile,
            setIsUploading,
            userId: 'your-user-id',
            source: INSTITUTE_ID,
            sourceId: 'PDF_DOCUMENTS',
        });
        if (!fileId) throw new Error(t('errors.uploadConvertedPdfFailed'));

        setStatusMessage(t('status.creatingSlide'));
        setUploadProgress(90);
        return createDocumentSlide('PDF', fileId, totalPages);
    };

    const handleUpload = async () => {
        if (!file) {
            toast.error(t('toast.selectFileFirst'));
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);
        setError(null);

        try {
            let response: string;
            try {
                // Prefer the interactive animated slideshow.
                response = await uploadAsAnimated();
            } catch (animErr) {
                // Resilience: any failure (worker down, unsupported deck, timeout)
                // degrades to the static PDF the product already shipped.
                console.warn('Animated conversion failed; falling back to PDF.', animErr);
                setStatusMessage(t('status.fallingBackToPdf'));
                response = await uploadAsPdf();
            }

            if (response) {
                openState?.(false);
                toast.success(t('toast.uploadSuccess'));
            }
            setUploadProgress(100);
            setStatusMessage('');
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : t('errors.uploadFailedRetry');
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setIsUploading(false);
            setStatusMessage('');
        }
    };

    useEffect(() => {
        setFile(null);
        setError(null);
        setUploadProgress(0);
        setStatusMessage('');
        form.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleUpload)} className="flex flex-col gap-6 p-6">
                <div className="space-y-4">
                    <FileUploadComponent
                        fileInputRef={fileInputRef}
                        onFileSubmit={handleFileSubmit}
                        control={form.control}
                        name="pptFile"
                        acceptedFileTypes={[
                            'application/vnd.ms-powerpoint',
                            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        ]}
                        isUploading={isUploading}
                        error={error}
                        disableClick={false}
                        className={`
              flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8
              transition-all duration-300 ease-in-out
              ${
                  file
                      ? 'border-green-300 bg-green-50/50'
                      : 'border-primary-300 bg-primary-50/30 hover:border-primary-400 hover:bg-primary-50/50'
              }
              focus:outline-none focus:ring-2 focus:ring-primary-500/20
            `}
                    >
                        <div className="pointer-events-none flex flex-col items-center gap-4">
                            {file ? (
                                <div className="flex items-center gap-3 duration-500 animate-in fade-in slide-in-from-bottom-2">
                                    <div className="rounded-full bg-green-100 p-3">
                                        <CheckCircle className="size-6 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-wrap font-medium text-green-700">
                                            {file.name}
                                        </p>
                                        <div className="flex items-center gap-2 text-sm text-green-600">
                                            <span>{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3 text-center">
                                    <div className="mx-auto w-fit animate-pulse rounded-full bg-primary-100 p-4">
                                        <PresentationChart className="size-8 text-primary-600" />
                                    </div>
                                    <div>
                                        <p className="mb-1 font-medium text-neutral-700">
                                            {t('dropzone.title')}
                                        </p>
                                        <p className="text-sm text-neutral-500">
                                            {t('dropzone.subtitle')}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </FileUploadComponent>

                    {error && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 duration-300 animate-in fade-in slide-in-from-top-2">
                            <p className="flex items-center gap-2 text-sm text-red-600">
                                <span className="size-2 rounded-full bg-red-500"></span>
                                {error}
                            </p>
                        </div>
                    )}
                </div>

                {isUploading && (
                    <div className="space-y-3 duration-300 animate-in fade-in slide-in-from-bottom-2">
                        <Progress
                            value={uploadProgress}
                            className="h-2 bg-neutral-200 [&>div]:bg-gradient-to-r [&>div]:from-primary-500 [&>div]:to-primary-600"
                        />
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-neutral-600">
                                {statusMessage || t('status.processing')}
                            </span>
                            <span className="font-medium text-primary-600">{uploadProgress}%</span>
                        </div>
                    </div>
                )}

                <DialogFooter className="flex w-full items-center justify-between border-t border-neutral-100 pt-4">
                    <MyButton
                        buttonType="primary"
                        scale="large"
                        layoutVariant="default"
                        type="submit"
                        disabled={!file || isUploading}
                        className={`
    w-full
    transition-all duration-300 ease-in-out
    ${
        !file || isUploading
            ? 'cursor-not-allowed opacity-50'
            : 'shadow-lg hover:scale-105 hover:shadow-xl active:scale-95'
    }
  `}
                    >
                        {isUploading ? (
                            <div className="flex items-center justify-center gap-2">
                                <div className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                {statusMessage || t('status.processing')}
                            </div>
                        ) : (
                            t('actions.uploadPpt')
                        )}
                    </MyButton>
                </DialogFooter>
            </form>
        </Form>
    );
};
