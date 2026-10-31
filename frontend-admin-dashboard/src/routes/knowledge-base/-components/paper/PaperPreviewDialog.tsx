import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    DownloadSimple,
    Key,
    LinkSimple,
    Spinner,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { SpecialZoomLevel, Viewer, Worker } from '@react-pdf-viewer/core';
import { PDF_WORKER_URL } from '@/constants/urls';
import { cn } from '@/lib/utils';
import '@react-pdf-viewer/core/lib/styles/index.css';
import { PAPER_THEMES, saveBlob } from '../../-services/paper-service';
import type { PaperPdfOptions, PaperTheme, PdfFile } from '../../-services/paper-service';
import type { PublishedPaperLink } from '../../-types/paper';
import { PaperShareDialog } from './PaperShareDialog';

type Variant = PublishedPaperLink['variant'];

interface PaperPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** Renders one variant; the same bytes are shown and downloaded. */
    fetchPdf: (options: PaperPdfOptions) => Promise<PdfFile>;
    onPublish?: (options: PaperPdfOptions) => Promise<PublishedPaperLink>;
    published?: Partial<Record<Variant, PublishedPaperLink>>;
    /** Print layout, shared with the download menu so both stay in step. */
    theme: PaperTheme;
    onThemeChange: (theme: PaperTheme) => void;
}

/**
 * The paper as it will print, before anyone prints it.
 *
 * Shows the server-rendered PDF itself (through pdf.js, which every browser
 * runs — the built-in <iframe> viewer is missing on Android Chrome) rather
 * than an HTML approximation, so the preview cannot disagree with the file
 * that gets downloaded or shared. Each variant is rendered once per opening
 * and kept, so flipping between "questions only" and "with answer key" is
 * instant after the first look.
 */
export const PaperPreviewDialog = ({
    open,
    onOpenChange,
    title,
    fetchPdf,
    onPublish,
    published,
    theme,
    onThemeChange,
}: PaperPreviewDialogProps) => {
    const { t } = useTranslation('knowledgeBasePaperDownload');
    const [variant, setVariant] = useState<Variant>('question_paper');
    // Cached per variant AND layout: switching layouts re-renders, switching
    // back is instant.
    const [files, setFiles] = useState<Record<string, PdfFile>>({});
    const cacheKey = `${variant}:${theme}`;
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    // Bumped to force a re-render of the current variant after a failure.
    const [attempt, setAttempt] = useState(0);
    const requestRef = useRef(0);

    // Fresh renders every time the dialog opens: the questions may have been
    // rewritten since the last look.
    useEffect(() => {
        if (!open) return;
        setFiles({});
        setFailed(false);
        setVariant('question_paper');
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const cached = files[cacheKey];
        if (cached) return;
        const request = ++requestRef.current;
        setLoading(true);
        setFailed(false);
        fetchPdf({ includeAnswerKey: variant === 'with_answer_key', theme })
            .then((file) => {
                if (request !== requestRef.current) return;
                setFiles((prev) => ({ ...prev, [cacheKey]: file }));
            })
            .catch(() => {
                if (request === requestRef.current) setFailed(true);
            })
            .finally(() => {
                if (request === requestRef.current) setLoading(false);
            });
        // `files` is read, not depended on: a cache hit must not re-trigger.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, variant, theme, attempt, fetchPdf]);

    // One object URL per shown blob; revoke the previous one so a long review
    // session does not pin every render in memory.
    const current = files[cacheKey];
    useEffect(() => {
        if (!current) {
            setObjectUrl(null);
            return;
        }
        const url = URL.createObjectURL(current.blob);
        setObjectUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [current]);

    const download = () => {
        if (current) saveBlob(current.blob, current.fileName);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!m-0 flex h-full !w-full !max-w-full flex-col !gap-0 !rounded-none !p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white py-3 pl-4 pr-12">
                    <div className="min-w-0">
                        <DialogTitle className="truncate text-subtitle font-semibold text-neutral-700">
                            {t('preview.heading')}
                        </DialogTitle>
                        <p className="truncate text-caption text-neutral-500">{title}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Select value={theme} onValueChange={(v) => onThemeChange(v as PaperTheme)}>
                            <SelectTrigger className="w-48" aria-label={t('theme.label')}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {PAPER_THEMES.map((key) => (
                                    <SelectItem key={key} value={key}>
                                        {t(`theme.${key}`)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Tabs value={variant} onValueChange={(v) => setVariant(v as Variant)}>
                            <TabsList>
                                <TabsTrigger value="question_paper">
                                    {t('questionPaper')}
                                </TabsTrigger>
                                <TabsTrigger value="with_answer_key" className="gap-1">
                                    <Key className="size-3.5" />
                                    {t('preview.answerKeyTab')}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                        {onPublish && (
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => setShareOpen(true)}
                            >
                                <LinkSimple className="mr-1 size-4" />
                                {t('preview.share')}
                            </MyButton>
                        )}
                        <MyButton
                            type="button"
                            buttonType="primary"
                            scale="medium"
                            disable={!current}
                            onClick={download}
                        >
                            <DownloadSimple className="mr-1 size-4" />
                            {t('preview.download')}
                        </MyButton>
                    </div>
                </div>

                <div className="relative min-h-0 flex-1 bg-neutral-100">
                    {objectUrl && (
                        <div className={cn('size-full', loading && 'opacity-40')}>
                            <Worker workerUrl={PDF_WORKER_URL}>
                                <Viewer
                                    fileUrl={objectUrl}
                                    defaultScale={SpecialZoomLevel.PageWidth}
                                />
                            </Worker>
                        </div>
                    )}
                    {loading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-neutral-600">
                            <Spinner className="size-6 animate-spin text-primary-500" />
                            <p className="text-body">{t('preview.rendering')}</p>
                        </div>
                    )}
                    {!loading && failed && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
                            <WarningCircle className="size-6 text-danger-600" />
                            <p className="text-body text-neutral-600">{t('preview.failed')}</p>
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setAttempt((n) => n + 1)}
                            >
                                <ArrowClockwise className="mr-1 size-4" />
                                {t('preview.retry')}
                            </MyButton>
                        </div>
                    )}
                </div>

                {onPublish && (
                    <PaperShareDialog
                        open={shareOpen}
                        onOpenChange={setShareOpen}
                        onPublish={(options) => onPublish({ ...options, theme })}
                        existing={published}
                        shareTitle={title}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
};
