import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { FileArrowUp, Trash } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getPublicUrl, UploadFileInS3 } from '@/services/upload_file';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { serializeImageTemplateToHtml } from '@/routes/settings/-utils/serialize-image-template-to-html';
import {
    DEFAULT_BUILTIN_TEMPLATE,
    TEMPLATE_CANVAS_DIMENSIONS,
} from '@/routes/settings/-utils/builtin-certificate-templates';
import type { FieldMapping, ImageTemplate } from '@/types/certificate/certificate-types';

interface CourseCertificateTemplateUploadProps {
    /** HTML currently held by the course override, or null when inheriting. */
    templateHtml: string | null;
    onChange: (templateHtml: string | null) => void;
}

const ACCEPTED = '.png,.jpg,.jpeg,.html,.htm';

/** Read a File as a data URL. */
const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(file);
    });

const readAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsText(file);
    });

const loadImageSize = (dataUrl: string): Promise<{ width: number; height: number }> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('Could not read the image'));
        img.src = dataUrl;
    });

const dataUrlToFile = async (dataUrl: string, fileName: string): Promise<File> => {
    const blob = await (await fetch(dataUrl)).blob();
    return new File([blob], fileName, { type: blob.type || 'image/png' });
};

/**
 * Course-specific certificate design.
 *
 * <p>An uploaded image becomes the certificate background and the standard
 * placeholders are laid out on it using the default built-in positions, scaled
 * to the image. That is a starting layout, not a per-design one — an admin who
 * needs exact placement should upload finished HTML instead, which is used
 * verbatim.
 *
 * <p>The image is uploaded to S3 and referenced by URL rather than inlined as a
 * data URL: the institute-level editor learned the hard way that inlining blows
 * up the settings JSON.
 */
export const CourseCertificateTemplateUpload = ({
    templateHtml,
    onChange,
}: CourseCertificateTemplateUploadProps) => {
    const { t } = useTranslation('studyLibraryCourseCertificateTemplateUpload');
    const [busy, setBusy] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const { instituteDetails } = useInstituteDetailsStore();
    const instituteThemeCode = instituteDetails?.institute_theme_code;

    const handleFile = async (file: File) => {
        setBusy(true);
        try {
            const isHtml = /\.html?$/i.test(file.name);
            if (isHtml) {
                const html = await readAsText(file);
                if (!html.trim()) {
                    toast.error(t('emptyHtmlFile'));
                    return;
                }
                onChange(html);
                toast.success(t('templateUploaded'), {
                    description: t('templateUploadedDescription'),
                });
                return;
            }

            const dataUrl = await readAsDataUrl(file);
            const { width, height } = await loadImageSize(dataUrl);

            const token = getTokenFromCookie(TokenKey.accessToken);
            const userId = (token ? getTokenDecodedData(token) : null)?.user || '';
            const baseName = file.name.replace(/\.[^.]+$/, '') || `course-certificate-${Date.now()}`;
            const uploadable = await dataUrlToFile(dataUrl, `${baseName}.png`);
            const fileId = await UploadFileInS3(
                uploadable,
                () => {},
                userId,
                'CERTIFICATE_TEMPLATE',
                'INSTITUTE',
                true
            );
            const publicUrl = fileId ? await getPublicUrl(fileId) : null;
            if (!publicUrl || typeof publicUrl !== 'string') {
                toast.error(t('imageUploadFailed'));
                return;
            }

            const template: ImageTemplate = {
                id: `course-template-${Date.now()}`,
                fileName: `${baseName}.png`,
                originalFileName: file.name,
                imageDataUrl: publicUrl,
                width,
                height,
                format: 'png',
                createdAt: new Date().toISOString(),
                sourceType: 'image',
            };

            // Default placeholder layout, scaled from the built-in canvas to
            // whatever size the admin uploaded.
            const scaleX = width / TEMPLATE_CANVAS_DIMENSIONS.width;
            const scaleY = height / TEMPLATE_CANVAS_DIMENSIONS.height;
            // Empty theme falls back to the built-in default inside
            // defaultCustomizations, so the institute's own colour wins when set.
            const fields: FieldMapping[] = DEFAULT_BUILTIN_TEMPLATE.defaultFields(
                DEFAULT_BUILTIN_TEMPLATE.defaultCustomizations(instituteThemeCode ?? '')
            ).map((f, i) => ({
                ...f,
                id: `course-field-${i}`,
                position: {
                    x: f.position.x * scaleX,
                    y: f.position.y * scaleY,
                    width: f.position.width * scaleX,
                    height: f.position.height * scaleY,
                },
            }));

            onChange(serializeImageTemplateToHtml(template, fields));
            toast.success(t('designUploaded'), {
                description: t('designUploadedDescription'),
            });
        } catch {
            toast.error(t('processFailed'));
        } finally {
            setBusy(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <div className="flex flex-col gap-3">
            <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED}
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                }}
            />

            {templateHtml ? (
                <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                        <span className="text-body text-neutral-700">
                            {t('usesOwnDesign')}
                        </span>
                        <div className="flex items-center gap-2">
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                type="button"
                                onClick={() => setPreviewOpen((v) => !v)}
                            >
                                {previewOpen ? t('hidePreview') : t('preview')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                layoutVariant="icon"
                                type="button"
                                onClick={() => {
                                    onChange(null);
                                    setPreviewOpen(false);
                                }}
                            >
                                <Trash />
                            </MyButton>
                        </div>
                    </div>
                    {previewOpen && (
                        <iframe
                            title={t('previewIframeTitle')}
                            sandbox=""
                            srcDoc={templateHtml}
                            className="h-64 w-full rounded-md border border-neutral-200 bg-white"
                        />
                    )}
                </div>
            ) : (
                <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-neutral-300 p-4">
                    <span className="text-body text-neutral-600">
                        {t('inheritingTemplate')}
                    </span>
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        type="button"
                        disable={busy}
                        onClick={() => inputRef.current?.click()}
                    >
                        <FileArrowUp className="mr-2" />
                        {busy ? t('uploading') : t('uploadCustomCertificate')}
                    </MyButton>
                </div>
            )}

            <p className="text-caption text-neutral-500">
                {t('helperText')}
            </p>
        </div>
    );
};
