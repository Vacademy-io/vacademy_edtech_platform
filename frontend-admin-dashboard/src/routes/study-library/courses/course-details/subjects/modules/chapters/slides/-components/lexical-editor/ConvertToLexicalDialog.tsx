import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { CheckCircle, Warning, WarningCircle, Info, CircleNotch } from '@phosphor-icons/react';
import { analyzeConversion, type ConversionAnalysis } from './convert-yoopta';

interface ConvertToLexicalDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Current document HTML (live editor serialization) to convert. */
    sourceHtml: string | null;
    /** Called with the round-tripped HTML + whether the pre-flight was clean.
     *  `forced` is true when the user overrode a detected data-loss warning. */
    onConfirm: (convertedHtml: string, forced: boolean) => void;
    converting?: boolean;
}

export function ConvertToLexicalDialog({
    open,
    onOpenChange,
    sourceHtml,
    onConfirm,
    converting = false,
}: ConvertToLexicalDialogProps) {
    const { t } = useTranslation('studyLibraryConvertToLexicalDialog');
    const [analysis, setAnalysis] = useState<ConversionAnalysis | null>(null);

    // Run the pre-flight when the dialog opens for a document.
    useEffect(() => {
        if (!open || !sourceHtml) {
            setAnalysis(null);
            return;
        }
        setAnalysis(null);
        // Defer so the dialog paints its loading state before the (synchronous)
        // round-trip runs.
        const id = window.setTimeout(() => {
            setAnalysis(analyzeConversion(sourceHtml));
        }, 0);
        return () => window.clearTimeout(id);
    }, [open, sourceHtml]);

    const loading = !analysis;
    const hasHardLoss =
        !!analysis &&
        (analysis.lostBlocks.length > 0 || analysis.lostMedia.length > 0 || analysis.textChanged);

    const blockLabels = buildBlockLabels(t);
    const humanBlock = (key: string): string => blockLabels[key] ?? key;

    return (
        <MyDialog
            heading={t('convertToNewEditor')}
            open={open}
            onOpenChange={onOpenChange}
            dialogWidth="w-full max-w-lg"
            footer={
                <div className="flex w-full flex-wrap items-center justify-end gap-2">
                    <MyButton
                        buttonType="secondary"
                        scale="medium"
                        disable={converting}
                        onClick={() => onOpenChange(false)}
                    >
                        {t('cancel')}
                    </MyButton>
                    {analysis && analysis.convertedHtml && !hasHardLoss && (
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            disable={converting}
                            onClick={() => onConfirm(analysis.convertedHtml, false)}
                        >
                            {converting ? t('convertingEllipsis') : t('convert')}
                        </MyButton>
                    )}
                    {analysis && analysis.convertedHtml && hasHardLoss && (
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            disable={converting}
                            className="border-danger-400 text-danger-600 hover:bg-danger-50"
                            onClick={() => onConfirm(analysis.convertedHtml, true)}
                        >
                            {converting ? t('convertingEllipsis') : t('convertAnyway')}
                        </MyButton>
                    )}
                </div>
            }
        >
            <div className="flex flex-col gap-3 text-subtitle text-neutral-600">
                <p>{t('intro')}</p>

                {loading && (
                    <div className="flex items-center gap-2 rounded-md bg-neutral-50 p-3 text-neutral-500">
                        <CircleNotch className="size-4 animate-spin" />
                        {t('checkingDocument')}
                    </div>
                )}

                {analysis && !analysis.convertedHtml && (
                    <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700">
                        <WarningCircle className="mt-0.5 size-5 shrink-0" />
                        <div>
                            <p className="font-medium">{t('cannotConvertTitle')}</p>
                            <p className="text-caption">{t('cannotConvertDescription')}</p>
                        </div>
                    </div>
                )}

                {analysis && analysis.convertedHtml && !hasHardLoss && (
                    <div className="flex items-start gap-2 rounded-md border border-success-200 bg-success-50 p-3 text-success-700">
                        <CheckCircle className="mt-0.5 size-5 shrink-0" />
                        <div>
                            <p className="font-medium">{t('safeToConvertTitle')}</p>
                            <p className="text-caption">{t('safeToConvertDescription')}</p>
                        </div>
                    </div>
                )}

                {analysis && analysis.convertedHtml && hasHardLoss && (
                    <div className="flex items-start gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-danger-700">
                        <Warning className="mt-0.5 size-5 shrink-0" />
                        <div className="flex flex-col gap-1">
                            <p className="font-medium">{t('wouldLoseContentTitle')}</p>
                            <ul className="ml-4 list-disc text-caption">
                                {analysis.textChanged && <li>{t('textWouldNotCarryOver')}</li>}
                                {analysis.lostBlocks.length > 0 && (
                                    <li>
                                        {t('blocksPrefix')}{' '}
                                        {analysis.lostBlocks.map((b) => humanBlock(b)).join(', ')}
                                    </li>
                                )}
                                {analysis.lostMedia.length > 0 && (
                                    <li>
                                        {t('mediaItemsDropped', {
                                            count: analysis.lostMedia.length,
                                        })}
                                    </li>
                                )}
                            </ul>
                            <p className="text-caption">{t('keepOnCurrentEditorRecommended')}</p>
                        </div>
                    </div>
                )}

                {analysis && analysis.convertedHtml && analysis.formattingWarnings.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-warning-200 bg-warning-50 p-3 text-warning-700">
                        <Info className="mt-0.5 size-5 shrink-0" />
                        <div>
                            <p className="font-medium">{t('minorStylingTitle')}</p>
                            <p className="text-caption">
                                {t('minorStylingDescription', {
                                    warnings: analysis.formattingWarnings.join(', '),
                                })}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </MyDialog>
    );
}

function buildBlockLabels(t: TFunction): Record<string, string> {
    return {
        flashcard: t('blocks.flashcard'),
        tabbedContent: t('blocks.tabbedContent'),
        quizBlock: t('blocks.quizBlock'),
        timeline: t('blocks.timeline'),
        columnsLayout: t('blocks.columnsLayout'),
        accordion: t('blocks.accordion'),
        mermaid: t('blocks.mermaid'),
        mathBlock: t('blocks.mathBlock'),
        audioPlayer: t('blocks.audioPlayer'),
        pdfViewer: t('blocks.pdfViewer'),
        fillBlanks: t('blocks.fillBlanks'),
        jupyterNotebook: t('blocks.jupyterNotebook'),
        scratchProject: t('blocks.scratchProject'),
        tableOfContents: t('blocks.tableOfContents'),
        codeBlock: t('blocks.codeBlock'),
        table: t('blocks.table'),
        img: t('blocks.img'),
        'media-embed': t('blocks.mediaEmbed'),
    };
}
