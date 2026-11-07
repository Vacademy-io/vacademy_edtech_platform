import { useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
    ArrowSquareOut,
    CaretLeft,
    CaretRight,
    FilePdf,
    FileText,
    ImageSquare,
} from '@phosphor-icons/react';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { getPublicUrl } from '@/services/upload_file';
import { formatDateTime, formatNumber } from '../../-utils/format';
import {
    fileLabel,
    learnerName,
    statusChipFor,
    type FileDetail,
    type TrackingRow,
} from './tracking-columns';

/**
 * Side panel for reading one learner's written or uploaded answer at full width, with
 * Prev / Next to move through the class without closing it.
 *
 * Images and PDFs preview inline; anything else gets its name and an "Open" link.
 * A file whose link failed to resolve up front is resolved on click, into a window
 * opened synchronously (Safari blocks a window.open that follows an await).
 */

export interface AnswerReviewPanelProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    row: TrackingRow | null;
    /** 1-based position of `row` among the answers on this page. */
    position: number;
    /** Answers to read on this page. */
    total: number;
    hasPrev: boolean;
    hasNext: boolean;
    onPrev: () => void;
    onNext: () => void;
    /** True while the next or previous page of the table loads. */
    loading?: boolean;
    /** The question, shown above the answer for context. */
    prompt?: string;
    files: Record<string, FileDetail>;
    filesLoading?: boolean;
    /** The plan's timezone, for the completed time. */
    timeZone?: string;
}

type FileKind = 'image' | 'pdf' | 'other';

const OPEN_LINK =
    'inline-flex shrink-0 items-center gap-1 rounded-sm text-caption font-medium text-primary-500 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-default disabled:text-neutral-400 disabled:no-underline';

function fileKind(detail: FileDetail | undefined): FileKind {
    const type = detail?.fileType?.toLowerCase() ?? '';
    const name = detail?.fileName?.toLowerCase() ?? '';
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name)) return 'image';
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    return 'other';
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT', 'IFRAME'].includes(target.tagName)
    );
}

export function AnswerReviewPanel({
    open,
    onOpenChange,
    row,
    position,
    total,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
    loading = false,
    prompt,
    files,
    filesLoading = false,
    timeZone,
}: AnswerReviewPanelProps) {
    const { t, i18n } = useTranslation('engagement');
    const lang = i18n.language;
    const rtl = i18n.dir(lang) === 'rtl';

    function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.defaultPrevented || isEditableTarget(event.target)) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const back = rtl ? 'ArrowRight' : 'ArrowLeft';
        const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
        if (event.key === back && hasPrev && !loading) {
            event.preventDefault();
            onPrev();
        } else if (event.key === forward && hasNext && !loading) {
            event.preventDefault();
            onNext();
        }
    }

    const chip = row ? statusChipFor(row, t) : null;
    const text = row?.textAnswer?.trim() ?? '';
    const fileIds = row?.fileIds ?? [];

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side={rtl ? 'left' : 'right'}
                className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
                onKeyDown={handleKeyDown}
            >
                {/* The Sheet's close button sits at the physical right, so pad that side in both directions. */}
                <SheetHeader className="shrink-0 space-y-1 border-b border-neutral-200 px-6 py-4 pe-12 text-start sm:text-start rtl:ps-12">
                    <SheetTitle className="truncate text-subtitle font-semibold text-neutral-900">
                        {row ? learnerName(row) : t('tracking.review.title')}
                    </SheetTitle>
                    <SheetDescription asChild>
                        <div className="flex flex-wrap items-center gap-2 text-caption text-neutral-500">
                            {chip && (
                                <StatusChip
                                    text={chip.text}
                                    status={chip.status}
                                    showIcon={chip.showIcon}
                                    textSize="text-caption"
                                />
                            )}
                            {row?.email && <span className="truncate">{row.email}</span>}
                            {row?.completedAt && (
                                <span className="whitespace-nowrap">
                                    {t('tracking.review.submitted', {
                                        when: formatDateTime(row.completedAt, lang, timeZone),
                                    })}
                                </span>
                            )}
                        </div>
                    </SheetDescription>
                </SheetHeader>

                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                    {prompt && (
                        <section className="space-y-1">
                            <h3 className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                                {t('tracking.review.question')}
                            </h3>
                            <p className="whitespace-pre-wrap break-words rounded-md bg-neutral-50 px-3 py-2 text-body text-neutral-700">
                                {prompt}
                            </p>
                        </section>
                    )}

                    {loading ? (
                        <div className="space-y-2" aria-busy="true">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-11/12" />
                            <Skeleton className="h-4 w-2/3" />
                        </div>
                    ) : !row ? (
                        <p className="text-body text-neutral-500">{t('tracking.review.nothing')}</p>
                    ) : (
                        <>
                            {(text || fileIds.length === 0) && (
                                <section className="space-y-1">
                                    <h3 className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                                        {t('tracking.review.answer')}
                                    </h3>
                                    {text ? (
                                        <p className="max-w-prose whitespace-pre-wrap break-words text-body leading-relaxed text-neutral-900">
                                            {text}
                                        </p>
                                    ) : (
                                        <p className="text-body text-neutral-500">
                                            {t('tracking.review.noAnswer')}
                                        </p>
                                    )}
                                </section>
                            )}

                            {fileIds.length > 0 && (
                                <section className="space-y-3">
                                    <h3 className="text-caption font-medium uppercase tracking-wide text-neutral-500">
                                        {t('tracking.review.files', {
                                            count: fileIds.length,
                                            n: formatNumber(fileIds.length, lang),
                                        })}
                                    </h3>
                                    <ul className="space-y-4">
                                        {fileIds.map((fileId) => (
                                            <li key={fileId}>
                                                <FilePreview
                                                    fileId={fileId}
                                                    files={files}
                                                    loading={filesLoading}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            )}
                        </>
                    )}
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50 px-6 py-3">
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={!hasPrev || loading}
                        onClick={onPrev}
                        aria-keyshortcuts={rtl ? 'ArrowRight' : 'ArrowLeft'}
                    >
                        <CaretLeft size={14} className="rtl:rotate-180" aria-hidden="true" />
                        {t('tracking.review.prev')}
                    </MyButton>
                    <span className="text-caption tabular-nums text-neutral-500" aria-live="polite">
                        {total > 0 && position > 0
                            ? t('tracking.review.position', {
                                  n: formatNumber(position, lang),
                                  total: formatNumber(total, lang),
                              })
                            : ''}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="small"
                        disable={!hasNext || loading}
                        onClick={onNext}
                        aria-keyshortcuts={rtl ? 'ArrowLeft' : 'ArrowRight'}
                    >
                        {t('tracking.review.next')}
                        <CaretRight size={14} className="rtl:rotate-180" aria-hidden="true" />
                    </MyButton>
                </div>
            </SheetContent>
        </Sheet>
    );
}

function FilePreview({
    fileId,
    files,
    loading,
}: {
    fileId: string;
    files: Record<string, FileDetail>;
    loading: boolean;
}) {
    const { t } = useTranslation('engagement');
    const [opening, setOpening] = useState(false);
    const detail = files[fileId];
    const kind = fileKind(detail);
    const name = fileLabel(fileId, files);
    const KindIcon = kind === 'image' ? ImageSquare : kind === 'pdf' ? FilePdf : FileText;

    async function openUnresolved() {
        // Open first, synchronously, so Safari treats it as user-initiated.
        const win = window.open('', '_blank');
        setOpening(true);
        try {
            const url = await getPublicUrl(fileId);
            if (!url) {
                win?.close();
                toast.error(t('tracking.review.fileError'));
            } else if (win) {
                win.opener = null;
                win.location.href = url;
            } else {
                // The pre-opened window was blocked; try once more now that we have the URL.
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        } catch {
            win?.close();
            toast.error(t('tracking.review.fileError'));
        } finally {
            setOpening(false);
        }
    }

    return (
        <div className="space-y-2">
            <div className="flex min-w-0 items-center gap-2">
                <KindIcon size={18} className="shrink-0 text-neutral-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-body text-neutral-800" title={name}>
                    {name}
                </span>
                {detail?.url ? (
                    <a
                        href={detail.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={OPEN_LINK}
                    >
                        {t('tracking.review.openFile')}
                        <ArrowSquareOut size={14} aria-hidden="true" />
                    </a>
                ) : (
                    // Same look as the link: the URL is fetched on click (see openUnresolved).
                    <button
                        type="button"
                        className={OPEN_LINK}
                        disabled={opening || loading}
                        aria-busy={opening}
                        onClick={() => void openUnresolved()}
                    >
                        {t('tracking.review.openFile')}
                        <ArrowSquareOut size={14} aria-hidden="true" />
                    </button>
                )}
            </div>
            {loading && !detail ? (
                <Skeleton className="h-40 w-full rounded-md" />
            ) : detail?.url && kind === 'image' ? (
                <img
                    src={detail.url}
                    alt={name}
                    loading="lazy"
                    className="max-h-96 w-full rounded-md border border-neutral-200 bg-neutral-50 object-contain"
                />
            ) : detail?.url && kind === 'pdf' ? (
                <iframe
                    src={detail.url}
                    title={name}
                    className="h-96 w-full rounded-md border border-neutral-200 bg-neutral-50"
                />
            ) : null}
        </div>
    );
}
