import { MyButton } from '@/components/design-system/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
import { CheckCircle, FilePdf } from '@phosphor-icons/react';
import { getSlideStatusForUser } from '../../non-admin/hooks/useNonAdminSlides';
import {
    buildAppendReorderPayload,
    getNextSlideOrder,
} from '../../-helper/slide-naming-utils';

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

interface FormData {
    pdfFile: FileList | null;
    pdfTitle: string;
}

export const AddPdfDialog = ({
    openState,
}: {
    openState?: ((open: boolean) => void) | undefined;
}) => {
    const { t } = useTranslation('studyLibraryAddPdfDialog');
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const data = getTokenDecodedData(accessToken);
    const INSTITUTE_ID = data && Object.keys(data.authorities)[0];
    const [file, setFile] = useState<File | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
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

    const form = useForm<FormData>({
        defaultValues: {
            pdfFile: null,
            pdfTitle: '',
        },
    });

    const { uploadFile } = useFileUpload();

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
            toast.error(t('reorderFailed'));
        }
    };

    const handleFileSubmit = async (selectedFile: File) => {
        if (!selectedFile.type.includes('pdf')) {
            setError(t('invalidFileType'));
            return;
        }

        setError(null);
        setFile(selectedFile);
        form.setValue('pdfFile', [selectedFile] as unknown as FileList);

        const fileName = selectedFile.name.replace(/\.[^/.]+$/, '');
        form.setValue('pdfTitle', fileName); // Title from filename

        try {
            const arrayBuffer = await selectedFile.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
            setPdfPageCount(pdf.numPages);
            toast.success(t('pdfSelectedWithPages', { count: pdf.numPages }));
        } catch (err) {
            console.error('Error reading PDF:', err);
            setPdfPageCount(null);
            toast.success(t('pdfSelected'));
        }
    };

    const handleUpload = async () => {
        if (!file) {
            toast.error(t('selectFileFirst'));
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);
        setError(null);

        try {
            const progressInterval = setInterval(() => {
                setUploadProgress((prev) => Math.min(prev + 10, 90));
            }, 200);

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
            const totalPages = pdf.numPages;

            const fileId = await uploadFile({
                file,
                setIsUploading,
                userId: 'your-user-id',
                source: INSTITUTE_ID,
                sourceId: 'PDF_DOCUMENTS',
            });

            if (fileId) {
                setFile(null);
                const slideId = crypto.randomUUID();
                const slideStatus = getSlideStatusForUser();

                const response: string = await addUpdateDocumentSlide({
                    id: slideId,
                    title: form.getValues('pdfTitle'),
                    image_file_id: '',
                    description: null,
                    slide_order: getNextSlideOrder(items || []),
                    document_slide: {
                        id: crypto.randomUUID(),
                        type: 'PDF',
                        data: fileId,
                        title: form.getValues('pdfTitle'),
                        cover_file_id: '',
                        total_pages: totalPages,
                        published_data: slideStatus === 'PUBLISHED' ? fileId : null,
                        published_document_total_pages: slideStatus === 'PUBLISHED' ? totalPages : 1,
                    },
                    status: slideStatus,
                    new_slide: true,
                    notify: false,
                });

                if (response) {
                    await reorderSlidesAfterNewSlide(response);
                    openState?.(false);
                    toast.success(t('pdfUploaded'));
                }
            }

            clearInterval(progressInterval);
            setUploadProgress(100);
            openState && openState(false);
        } catch (err) {
            const apiMessage = (err as { response?: { data?: { message?: string } } })?.response
                ?.data?.message;
            const errorMessage = apiMessage || (err instanceof Error ? err.message : t('uploadFailed'));
            setError(errorMessage);
            toast.error(errorMessage);
        } finally {
            setIsUploading(false);
        }
    };

    useEffect(() => {
        setFile(null);
        setError(null);
        setUploadProgress(0);
        setPdfPageCount(null);
        form.reset();
    }, []);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleUpload)} className="flex flex-col gap-6 p-6">
                <div className="space-y-4">
                    <FileUploadComponent
                        fileInputRef={fileInputRef}
                        onFileSubmit={handleFileSubmit}
                        control={form.control}
                        name="pdfFile"
                        acceptedFileTypes={['application/pdf']}
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
                                            {pdfPageCount && (
                                                <>
                                                    <span>•</span>
                                                    <span>{t('pageCount', { count: pdfPageCount })}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3 text-center">
                                    <div className="mx-auto w-fit animate-pulse rounded-full bg-primary-100 p-4">
                                        <FilePdf className="text-primary-600 size-8" />
                                    </div>
                                    <div>
                                        <p className="mb-1 font-medium text-neutral-700">
                                            {t('dropzoneHint')}
                                        </p>
                                        <p className="text-sm text-neutral-500">{t('dropzoneFormats')}</p>
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
                            className="[&>div]:to-primary-600 h-2 bg-neutral-200 [&>div]:bg-gradient-to-r [&>div]:from-primary-500"
                        />
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-neutral-600">{t('uploadingPdf')}</span>
                            <span className="text-primary-600 font-medium">{uploadProgress}%</span>
                        </div>
                    </div>
                )}

                <DialogFooter className="flex w-full items-center justify-between border-t border-neutral-100 pt-4">
                    {/* <div className="text-xs text-neutral-500">
            {file && (
              <span className="flex items-center gap-1">
                <FilePdf className="h-3 w-3" />
                Ready to upload
              </span>
            )}
          </div> */}
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
                                {t('uploadingEllipsis')}
                            </div>
                        ) : (
                            t('uploadPdf')
                        )}
                    </MyButton>
                </DialogFooter>
            </form>
        </Form>
    );
};
