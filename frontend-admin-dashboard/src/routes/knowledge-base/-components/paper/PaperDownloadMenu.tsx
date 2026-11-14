import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { CaretDown, DownloadSimple, Eye, Key, LinkSimple, Spinner } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    PAPER_THEMES,
    loadPaperTheme,
    savePaperTheme,
    saveBlob,
} from '../../-services/paper-service';
import type { PaperPdfOptions, PaperTheme, PdfFile } from '../../-services/paper-service';
import type { PublishedPaperLink } from '../../-types/paper';
import { PaperPreviewDialog } from './PaperPreviewDialog';
import { PaperShareDialog } from './PaperShareDialog';

interface PaperDownloadMenuProps {
    /** Renders one variant of the paper; the menu decides which and what to do with it. */
    fetchPdf: (options: PaperPdfOptions) => Promise<PdfFile>;
    /** Shown in the preview header and the WhatsApp message. */
    title: string;
    /** When given, adds "Share link…": publish a variant behind a public URL. */
    onPublish?: (options: PaperPdfOptions) => Promise<PublishedPaperLink>;
    /** Links already published for this paper (shown in the share dialog). */
    published?: Partial<Record<PublishedPaperLink['variant'], PublishedPaperLink>>;
    disabled?: boolean;
    scale?: 'small' | 'medium';
    buttonType?: 'secondary' | 'text';
    className?: string;
}

/**
 * Everything a teacher does with a finished paper as a sheet: look at it,
 * download it (with or without the answer key), send a link. One button so
 * the row of actions stays short; the preview carries the same download and
 * share actions, so a teacher who looks first never has to come back here.
 *
 * Direct downloads lock the button while the server lays the paper out — a
 * second click mid-render would otherwise queue a second browser.
 */
export const PaperDownloadMenu = ({
    fetchPdf,
    title,
    onPublish,
    published,
    disabled = false,
    scale = 'medium',
    buttonType = 'secondary',
    className,
}: PaperDownloadMenuProps) => {
    const { t } = useTranslation('knowledgeBasePaperDownload');
    const [busy, setBusy] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    // The institute's house layout, remembered per browser.
    const [theme, setThemeState] = useState<PaperTheme>(() => loadPaperTheme());
    const setTheme = (next: PaperTheme) => {
        setThemeState(next);
        savePaperTheme(next);
    };

    const download = async (options: PaperPdfOptions) => {
        setBusy(true);
        try {
            const file = await fetchPdf({ ...options, theme });
            saveBlob(file.blob, file.fileName);
        } catch {
            toast.error(t('failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <MyButton
                        type="button"
                        buttonType={buttonType}
                        scale={scale}
                        disable={disabled || busy}
                        className={className}
                        aria-label={t('button')}
                    >
                        {busy ? (
                            <Spinner className="mr-1 size-4 animate-spin" />
                        ) : (
                            <DownloadSimple className="mr-1 size-4" />
                        )}
                        {busy ? t('preparing') : t('button')}
                        {!busy && <CaretDown className="ml-1 size-3.5" />}
                    </MyButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={busy} onClick={() => setPreviewOpen(true)}>
                        <Eye className="me-2 size-4" />
                        {t('preview.menuItem')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        disabled={busy}
                        onClick={() => download({ includeAnswerKey: false })}
                    >
                        <DownloadSimple className="me-2 size-4" />
                        {t('questionPaper')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={busy}
                        onClick={() => download({ includeAnswerKey: true })}
                    >
                        <Key className="me-2 size-4" />
                        {t('withAnswerKey')}
                    </DropdownMenuItem>
                    {onPublish && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={busy} onClick={() => setShareOpen(true)}>
                                <LinkSimple className="me-2 size-4" />
                                {t('shareLink')}
                            </DropdownMenuItem>
                        </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-caption font-normal text-neutral-500">
                        {t('theme.label')}
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={theme}
                        onValueChange={(v) => setTheme(v as PaperTheme)}
                    >
                        {PAPER_THEMES.map((key) => (
                            <DropdownMenuRadioItem key={key} value={key} disabled={busy}>
                                {t(`theme.${key}`)}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
            <PaperPreviewDialog
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                title={title}
                fetchPdf={fetchPdf}
                onPublish={onPublish}
                published={published}
                theme={theme}
                onThemeChange={setTheme}
            />
            {onPublish && (
                <PaperShareDialog
                    open={shareOpen}
                    onOpenChange={setShareOpen}
                    onPublish={(options) => onPublish({ ...options, theme })}
                    existing={published}
                    shareTitle={title}
                />
            )}
        </>
    );
};
