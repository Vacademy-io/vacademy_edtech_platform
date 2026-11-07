import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
// Lazy-load heavy libs at call site when exporting
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { CircleNotch, DownloadSimple, X } from '@phosphor-icons/react';
import { ExportSettings } from '@/components/common/export-offline/contexts/export-settings-context';
import { Question } from '@/components/common/export-offline/types/question';
import { PaperSetQuestionsAI } from './PaperSetQuestionsAI';

interface ExportHandlerProps {
    questionsData: Question[];
    settings: ExportSettings;
    setNumber?: number;
}

export function ExportHandlerQuestionPaperAI({
    questionsData,
    settings,
    setNumber,
}: ExportHandlerProps) {
    const { t } = useTranslation('aiCenterExportHandlerQuestionPaperAI');
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(34);
    const pagesRef = useRef<HTMLDivElement>(null);
    const cancelTokenRef = useRef<{ cancel: boolean }>({ cancel: false });

    const optimizeImage = (canvas: HTMLCanvasElement): string => {
        // Create a new canvas with optimal dimensions
        const optimizedCanvas = document.createElement('canvas');
        const ctx = optimizedCanvas.getContext('2d');

        // Set dimensions to A4 at 200 DPI (still good quality but smaller than before)
        // A4 at 200 DPI: 1654 x 2339 pixels
        optimizedCanvas.width = 1654;
        optimizedCanvas.height = 2339;

        if (ctx) {
            // Enable image smoothing for better quality
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // Draw original canvas onto optimized canvas
            ctx.drawImage(
                canvas,
                0,
                0,
                canvas.width,
                canvas.height,
                0,
                0,
                optimizedCanvas.width,
                optimizedCanvas.height
            );
        }

        // Convert to compressed JPEG instead of PNG
        // Quality 0.8 gives good balance between quality and file size
        return optimizedCanvas.toDataURL('image/jpeg', 0.8);
    };

    const handleExport = async () => {
        setIsExporting(true);
        setExportProgress(0);
        cancelTokenRef.current.cancel = false;

        if (!pagesRef.current) return;

        try {
            // Initialize PDF with compression
            const { default: jsPDF } = await import('jspdf');
            const pdf = new jsPDF({
                orientation: 'portrait',
                unit: 'mm',
                format: 'a4',
                compress: true,
            });

            const pageElements = pagesRef.current.querySelectorAll('.page');
            const totalPages = pageElements.length;

            for (let i = 0; i < pageElements.length; i++) {
                // Check if cancel was requested
                if (cancelTokenRef.current.cancel) {
                    throw new Error('PDF generation cancelled');
                }

                // Update progress
                const progress = Math.round(((i + 1) / totalPages) * 100);
                setExportProgress(progress);

                const pageElement = pageElements[i] as HTMLElement;

                // Ensure the page element is visible during capture
                pageElement.style.position = 'fixed';
                pageElement.style.top = '0';
                pageElement.style.left = '0';
                pageElement.style.padding = '40px';
                pageElement.style.visibility = 'visible';
                pageElement.style.width = '210mm';
                pageElement.style.height = '297mm';
                pageElement.style.backgroundColor = 'white';

                // Wait for any potential reflows
                await new Promise((resolve) => setTimeout(resolve, 100));

                // Capture at slightly lower scale but still maintaining quality
                const { default: html2canvas } = await import('html2canvas');
                const canvas = await html2canvas(pageElement, {
                    scale: 1.5,
                    allowTaint: true,
                    useCORS: true,
                    logging: true,
                    backgroundColor: '#ffffff', // design-lint-ignore: html2canvas requires a literal color string, not a Tailwind class
                    width: pageElement.offsetWidth,
                    height: pageElement.offsetHeight,
                    windowWidth: pageElement.offsetWidth,
                    windowHeight: pageElement.offsetHeight,
                });

                // Optimize the captured image
                const imgData = optimizeImage(canvas);

                if (i > 0) {
                    pdf.addPage();
                }

                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = pdf.internal.pageSize.getHeight();

                // Add image with compression
                pdf.addImage({
                    imageData: imgData,
                    format: 'JPEG',
                    x: 0,
                    y: 0,
                    width: pdfWidth,
                    height: pdfHeight,
                    compression: 'FAST',
                    rotation: 0,
                });

                // Reset the page element styles
                pageElement.style.position = '';
                pageElement.style.top = '';
                pageElement.style.left = '';
                pageElement.style.visibility = '';
                pageElement.style.width = '';
                pageElement.style.height = '';
                pageElement.style.backgroundColor = '';
            }

            // Final progress update
            setExportProgress(100);

            // Save with additional optimization
            const pdfOutput = pdf.output('datauristring');
            const pdfBlob = await fetch(pdfOutput).then((res) => res.blob());
            const optimizedPdfBlob = new Blob([pdfBlob], { type: 'application/pdf' });

            // Use URL.createObjectURL for more efficient saving
            const url = URL.createObjectURL(optimizedPdfBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Paper${
                setNumber ? ` ${String.fromCharCode(65 + setNumber)}` : ''
            }.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        } catch (error) {
            if ((error as Error).message !== 'PDF generation cancelled') {
                console.error('PDF export failed:', error);
            }
            setExportProgress(0);
        } finally {
            setIsExporting(false);
            // Reset progress after a short delay
            setTimeout(() => setExportProgress(0), 1000);
        }
    };

    const handleCancelExport = () => {
        cancelTokenRef.current.cancel = true;
        setIsExporting(false);
        setExportProgress(0);
    };

    return (
        <>
            <div className="flex flex-col">
                <div className="flex w-full items-center gap-4">
                    <MyButton onClick={handleExport} disabled={isExporting} className="gap-2">
                        <DownloadSimple className="size-4" />
                        {isExporting
                            ? t('button.exporting')
                            : t('button.export', { format: settings.exportFormat.toUpperCase() })}
                        {setNumber !== undefined &&
                            t('button.setSuffix', {
                                letter: String.fromCharCode(65 + setNumber),
                            })}
                    </MyButton>
                </div>

                {/* Hidden render area */}
                <div
                    ref={pagesRef}
                    style={{
                        position: 'absolute',
                        left: '-9999px',
                        opacity: 0,
                        pointerEvents: 'none',
                        width: '210mm',
                    }}
                >
                    <PaperSetQuestionsAI questionsData={questionsData} settings={settings} />
                </div>
            </div>
            {isExporting && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg bg-white p-4 shadow-xl">
                        <div className="flex w-full items-start justify-between">
                            <p>
                                <h3 className="flex items-center gap-x-2 text-base font-semibold text-gray-800">
                                    {t('dialog.generatingPdf')}{' '}
                                    <CircleNotch className="size-4 animate-spin text-primary-300" />
                                    {setNumber !== undefined &&
                                        t('button.setSuffix', {
                                            letter: String.fromCharCode(65 + setNumber),
                                        })}
                                </h3>
                                <h6 className="text-xs text-gray-500">{t('dialog.pleaseWait')}</h6>
                            </p>
                            <Button
                                onClick={handleCancelExport}
                                variant="ghost"
                                size="icon"
                                aria-label={t('dialog.cancelAriaLabel')}
                            >
                                <X />
                            </Button>
                        </div>
                        <div className="w-full">
                            <Progress
                                value={exportProgress}
                                className="h-1.5 w-full bg-slate-600"
                            />
                        </div>
                        <span className="text-sm text-gray-600">
                            {t('dialog.progressComplete', { progress: exportProgress })}
                        </span>
                    </div>
                </div>
            )}
        </>
    );
}
