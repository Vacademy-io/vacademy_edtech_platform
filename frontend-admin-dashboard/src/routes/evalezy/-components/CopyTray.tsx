import { useTranslation } from 'react-i18next';
import { FilePdf, Rows, Trash, X } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import type { ScanPage } from '../-lib/scan-pdf';

/** One student's copy waiting to be sent: scanned/photographed pages, or a PDF. */
export type DraftCopy =
    | { id: string; kind: 'scan'; pages: ScanPage[] }
    | { id: string; kind: 'pdf'; file: File; pages: number | null };

export const draftPageCount = (copy: DraftCopy) =>
    copy.kind === 'scan' ? copy.pages.length : copy.pages ?? 1;

/** Thumbnails shown per copy before "+N". */
const THUMBS = 6;

/**
 * The copies about to be checked, one card each. A scanned copy shows its
 * pages (a wrong page can be dropped); a pile of photos picked together can be
 * split into one copy per photo when each photo is a different student.
 */
export const CopyTray = ({
    copies,
    disabled,
    progress,
    onRemoveCopy,
    onRemovePage,
    onSplit,
}: {
    copies: DraftCopy[];
    disabled: boolean;
    /** Copy id → what is happening to it while sending. */
    progress: Record<string, 'working' | 'done' | 'failed'>;
    onRemoveCopy: (id: string) => void;
    onRemovePage: (copyId: string, pageId: string) => void;
    onSplit: (copyId: string) => void;
}) => {
    const { t } = useTranslation('evalezy');

    return (
        <ul className="flex flex-col gap-2">
            {copies.map((copy, index) => {
                const state = progress[copy.id];
                return (
                    <li
                        key={copy.id}
                        className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3"
                    >
                        <div className="flex items-center gap-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-50 text-caption font-semibold text-primary-600">
                                {index + 1}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="flex items-center gap-1 truncate text-subtitle font-medium text-neutral-800">
                                    {copy.kind === 'pdf' && (
                                        <FilePdf size={16} className="shrink-0 text-danger-500" />
                                    )}
                                    <span className="truncate">
                                        {copy.kind === 'pdf'
                                            ? copy.file.name
                                            : t('tray.scannedCopy', { number: index + 1 })}
                                    </span>
                                </span>
                                <span className="text-caption text-neutral-500">
                                    {state === 'working'
                                        ? t('tray.sending')
                                        : state === 'done'
                                          ? t('tray.sent')
                                          : state === 'failed'
                                            ? t('tray.failed')
                                            : t('tray.pages', { count: draftPageCount(copy) })}
                                </span>
                            </span>
                            {copy.kind === 'scan' && copy.pages.length > 1 && !disabled && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    aria-label={t('tray.split')}
                                    title={t('tray.split')}
                                    onClick={() => onSplit(copy.id)}
                                >
                                    <Rows size={16} />
                                    {/* Icon-only on phones so the copy name isn't cut to "Scanned c…". */}
                                    <span className="hidden sm:inline">{t('tray.split')}</span>
                                </MyButton>
                            )}
                            {!disabled && (
                                <MyButton
                                    type="button"
                                    buttonType="text"
                                    scale="small"
                                    layoutVariant="icon"
                                    aria-label={t('tray.removeCopy', { number: index + 1 })}
                                    onClick={() => onRemoveCopy(copy.id)}
                                >
                                    <Trash size={16} />
                                </MyButton>
                            )}
                        </div>
                        {copy.kind === 'scan' && (
                            <ul className="flex gap-2 overflow-x-auto pb-1">
                                {copy.pages.slice(0, THUMBS).map((page, p) => (
                                    <li key={page.id} className="relative shrink-0">
                                        <img
                                            src={page.url}
                                            alt={t('scanner.pageAlt', { number: p + 1 })}
                                            className="h-20 w-14 rounded-sm border border-neutral-200 object-cover"
                                        />
                                        {!disabled && (
                                            <button
                                                type="button"
                                                aria-label={t('scanner.removePage', {
                                                    number: p + 1,
                                                })}
                                                onClick={() => onRemovePage(copy.id, page.id)}
                                                className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-neutral-700 text-white"
                                            >
                                                <X size={12} weight="bold" />
                                            </button>
                                        )}
                                    </li>
                                ))}
                                {copy.pages.length > THUMBS && (
                                    <li className="flex h-20 w-14 shrink-0 items-center justify-center rounded-sm border border-neutral-200 bg-neutral-50 text-caption text-neutral-500">
                                        +{copy.pages.length - THUMBS}
                                    </li>
                                )}
                            </ul>
                        )}
                    </li>
                );
            })}
        </ul>
    );
};
