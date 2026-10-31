import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadSimple } from '@phosphor-icons/react';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import SimplePDFViewer from '@/components/common/simple-pdf-viewer';
import { downloadFileFromUrl } from '@/lib/file-download';

type PreviewKind = 'pdf' | 'image';

interface FilePreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // Public URL of the file to preview; null while unresolved.
    fileUrl: string | null;
    heading: string;
    // Base name (no extension) for the Download button — the real extension is
    // resolved from the file bytes by downloadFileFromUrl.
    downloadName: string;
}

// In-app preview for submission / evaluated answer-sheet files. Stored files
// often carry no extension, so opening them in a new tab downloads an
// unopenable extension-less file on some devices — instead we preview inline
// (PDF viewer or image) and offer a Download that attaches the correct
// extension sniffed from the file itself.
export const FilePreviewDialog = ({
    open,
    onOpenChange,
    fileUrl,
    heading,
    downloadName,
}: FilePreviewDialogProps) => {
    const { t } = useTranslation('assessmentFilePreviewDialog');
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [kind, setKind] = useState<PreviewKind>('pdf');
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);

    useEffect(() => {
        if (!open || !fileUrl) return;
        let cancelled = false;
        let createdUrl: string | null = null;

        const load = async () => {
            setIsLoading(true);
            setIsError(false);
            setObjectUrl(null);
            try {
                const response = await fetch(fileUrl);
                if (!response.ok) throw new Error(`Failed to fetch file: ${response.status}`);
                const blob = await response.blob();

                // Magic-byte sniff first (Content-Type is often octet-stream for
                // extension-less uploads): %PDF / PNG / JPEG.
                const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
                let detected: PreviewKind;
                if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
                    detected = 'pdf';
                } else if (head[0] === 0x89 && head[1] === 0x50) {
                    detected = 'image'; // PNG
                } else if (head[0] === 0xff && head[1] === 0xd8) {
                    detected = 'image'; // JPEG
                } else if (blob.type.startsWith('image/')) {
                    detected = 'image';
                } else {
                    // Answer sheets are PDF/JPG/PNG only — default to the PDF viewer.
                    detected = 'pdf';
                }

                createdUrl = URL.createObjectURL(blob);
                if (cancelled) return;
                setKind(detected);
                setObjectUrl(createdUrl);
            } catch (error) {
                console.error('Failed to load file preview:', error);
                if (!cancelled) setIsError(true);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();

        return () => {
            cancelled = true;
            if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
    }, [open, fileUrl]);

    return (
        <MyDialog
            open={open}
            onOpenChange={onOpenChange}
            heading={heading}
            dialogWidth="max-w-4xl"
            footer={
                <MyButton
                    type="button"
                    buttonType="secondary"
                    scale="medium"
                    disable={!fileUrl}
                    onAsyncClick={async () => {
                        if (fileUrl) await downloadFileFromUrl(fileUrl, downloadName);
                    }}
                    loadingText={t('downloading')}
                >
                    <DownloadSimple size={18} />
                    {t('download')}
                </MyButton>
            }
        >
            {/* Viewport-relative viewer height — no spacing token exists for vh. */}
            <div className="flex h-[70vh] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50" /* design-lint-ignore */>
                {isLoading || !fileUrl ? (
                    <div className="flex flex-1 items-center justify-center">
                        <DashboardLoader size={28} />
                    </div>
                ) : isError || !objectUrl ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                        <p className="text-body text-neutral-600">
                            {t('previewError.title')}
                        </p>
                        <p className="text-caption text-neutral-500">
                            {t('previewError.description')}
                        </p>
                    </div>
                ) : kind === 'image' ? (
                    <div className="flex-1 overflow-auto p-4">
                        <img
                            src={objectUrl}
                            alt={heading}
                            className="mx-auto max-w-full object-contain"
                        />
                    </div>
                ) : (
                    <div className="flex-1 overflow-hidden">
                        <SimplePDFViewer pdfUrl={objectUrl} />
                    </div>
                )}
            </div>
        </MyDialog>
    );
};
