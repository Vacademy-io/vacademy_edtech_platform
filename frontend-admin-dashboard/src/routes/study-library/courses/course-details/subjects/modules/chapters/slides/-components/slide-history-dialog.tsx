import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CircleNotch,
    ClockCounterClockwise,
    FileText,
    Globe,
    Warning,
} from '@phosphor-icons/react';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import {
    GET_SLIDE_CONTENT_HISTORY,
    GET_SLIDE_CONTENT_HISTORY_DETAIL,
    RESTORE_SLIDE_CONTENT_HISTORY,
} from '@/constants/urls';
import { MyDialog } from '@/components/design-system/dialog';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { Slide } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-hooks/use-slides';

/* API payloads use snake_case (backend convention). */
interface SlideContentHistoryItem {
    id: number;
    source_table: string;
    changed_at: string;
    changed_by: string | null;
    draft_length: number;
    published_length: number;
    draft_value?: string | null;
    published_value?: string | null;
}

interface RestoreResponse {
    restored_value: string;
    slide_status: string;
}

type SnapshotSource = 'DRAFT' | 'PUBLISHED';

const formatChangedAt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatSize = (t: TFunction, chars: number): string => {
    if (!chars) return t('size.empty');
    if (chars < 1000) return t('size.chars', { count: chars });
    return t('size.kChars', { value: (chars / 1000).toFixed(1) });
};

/**
 * Version history for a slide's content, read from the trigger-written
 * slide_content_history audit table. Each entry is the BEFORE image of the
 * slide's draft + published content at the moment it was overwritten.
 * Restoring copies the selected snapshot into the slide's DRAFT — published
 * content stays untouched until the author re-publishes explicitly.
 */
export const SlideHistoryDialog = ({
    activeItem,
    chapterId,
    onRestored,
    open: controlledOpen,
    onOpenChange,
    hideTrigger = false,
}: {
    activeItem: Slide;
    chapterId: string;
    onRestored: (restoredValue: string, slideStatus: string) => void;
    /** Controlled mode (e.g. opened from the ⋯ menu): pass open + onOpenChange and hideTrigger. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
}) => {
    const { t } = useTranslation('studyLibrarySlideHistoryDialog');
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const setOpen = (o: boolean) => {
        if (isControlled) onOpenChange?.(o);
        else setInternalOpen(o);
    };
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [previewSource, setPreviewSource] = useState<SnapshotSource>('DRAFT');
    const [confirmingRestore, setConfirmingRestore] = useState(false);
    const queryClient = useQueryClient();

    const slideId = activeItem.id;
    // DOC (Yoopta) and HTML (Tiptap) both store HTML — preview in an iframe.
    const isDocEditor =
        activeItem.document_slide?.type === 'DOC' || activeItem.document_slide?.type === 'HTML';

    const historyQuery = useQuery({
        queryKey: ['slide-content-history', slideId],
        enabled: open,
        queryFn: async () => {
            const res = await authenticatedAxiosInstance.get<SlideContentHistoryItem[]>(
                GET_SLIDE_CONTENT_HISTORY,
                { params: { slideId, page: 0, size: 50 } }
            );
            return res.data;
        },
    });

    const detailQuery = useQuery({
        queryKey: ['slide-content-history-detail', slideId, selectedId],
        enabled: open && selectedId != null,
        queryFn: async () => {
            const res = await authenticatedAxiosInstance.get<SlideContentHistoryItem>(
                GET_SLIDE_CONTENT_HISTORY_DETAIL,
                { params: { slideId, historyId: selectedId } }
            );
            return res.data;
        },
    });

    const restoreMutation = useMutation({
        mutationFn: async ({
            historyId,
            source,
        }: {
            historyId: number;
            source: SnapshotSource;
        }) => {
            const res = await authenticatedAxiosInstance.post<RestoreResponse>(
                RESTORE_SLIDE_CONTENT_HISTORY,
                null,
                { params: { slideId, historyId, source, chapterId } }
            );
            return res.data;
        },
        onSuccess: async (data) => {
            toast.success(t('toast.restoreSuccess'));
            await queryClient.invalidateQueries({ queryKey: ['slides'] });
            queryClient.invalidateQueries({ queryKey: ['slide-content-history', slideId] });
            onRestored(data.restored_value, data.slide_status);
            setOpen(false);
        },
        onError: (err: unknown) => {
            const message =
                (err as { response?: { data?: { ex?: string; message?: string } } })?.response?.data
                    ?.ex ||
                (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
                t('toast.restoreFailed');
            toast.error(message);
        },
        onSettled: () => setConfirmingRestore(false),
    });

    const entries = historyQuery.data ?? [];
    const selected = detailQuery.data;
    const previewValue =
        previewSource === 'DRAFT' ? selected?.draft_value : selected?.published_value;

    const selectEntry = (entry: SlideContentHistoryItem) => {
        setSelectedId(entry.id);
        setConfirmingRestore(false);
        // Default the preview to whichever snapshot column actually has content.
        setPreviewSource(entry.draft_length > 0 ? 'DRAFT' : 'PUBLISHED');
    };

    return (
        <>
            {!hideTrigger && (
                <MyButton
                    buttonType="secondary"
                    scale="medium"
                    layoutVariant="default"
                    title={t('trigger.title')}
                    onClick={() => {
                        setSelectedId(null);
                        setConfirmingRestore(false);
                        setOpen(true);
                    }}
                >
                    <ClockCounterClockwise size={18} />
                    <span className="hidden md:inline">{t('trigger.label')}</span>
                </MyButton>
            )}
            <MyDialog
                heading={t('dialogHeading')}
                open={open}
                onOpenChange={(o) => {
                    setOpen(o);
                    if (!o) {
                        setSelectedId(null);
                        setConfirmingRestore(false);
                    }
                }}
                dialogWidth="w-full max-w-4xl"
            >
                <div className="flex flex-col gap-3">
                    <p className="text-caption text-neutral-500">{t('description')}</p>
                    <div className="flex min-h-80 flex-col gap-3 md:flex-row">
                        {/* Version list */}
                        <div className="flex max-h-96 shrink-0 flex-col gap-1 overflow-y-auto md:w-64">
                            {historyQuery.isLoading && (
                                <div className="flex flex-1 items-center justify-center p-6">
                                    <CircleNotch className="size-6 animate-spin text-primary-500" />
                                </div>
                            )}
                            {historyQuery.isError && (
                                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                                    <Warning size={24} className="text-danger-500" />
                                    <p className="text-caption text-neutral-500">
                                        {t('history.loadError')}
                                    </p>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => historyQuery.refetch()}
                                    >
                                        {t('retry')}
                                    </MyButton>
                                </div>
                            )}
                            {historyQuery.isSuccess && entries.length === 0 && (
                                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                                    <ClockCounterClockwise size={24} className="text-neutral-300" />
                                    <p className="text-caption text-neutral-500">
                                        {t('history.empty')}
                                    </p>
                                </div>
                            )}
                            {entries.map((entry) => (
                                <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => selectEntry(entry)}
                                    className={cn(
                                        'flex flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
                                        selectedId === entry.id
                                            ? 'border-primary-300 bg-primary-50'
                                            : 'border-neutral-200 bg-white hover:bg-neutral-50'
                                    )}
                                >
                                    <span className="text-body font-medium text-neutral-700">
                                        {formatChangedAt(entry.changed_at)}
                                    </span>
                                    <span className="text-caption text-neutral-500">
                                        {t('entry.draftSize', {
                                            size: formatSize(t, entry.draft_length),
                                        })}{' '}
                                        ·{' '}
                                        {t('entry.publishedSize', {
                                            size: formatSize(t, entry.published_length),
                                        })}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Preview + restore */}
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                            {selectedId == null ? (
                                <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-neutral-200 p-6">
                                    <p className="text-caption text-neutral-400">
                                        {t('preview.selectPrompt')}
                                    </p>
                                </div>
                            ) : detailQuery.isLoading ? (
                                <div className="flex flex-1 items-center justify-center p-6">
                                    <CircleNotch className="size-6 animate-spin text-primary-500" />
                                </div>
                            ) : detailQuery.isError ? (
                                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                                    <Warning size={24} className="text-danger-500" />
                                    <p className="text-caption text-neutral-500">
                                        {t('preview.loadError')}
                                    </p>
                                    <MyButton
                                        buttonType="secondary"
                                        scale="small"
                                        onClick={() => detailQuery.refetch()}
                                    >
                                        {t('retry')}
                                    </MyButton>
                                </div>
                            ) : (
                                <>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-1">
                                            <MyButton
                                                buttonType={
                                                    previewSource === 'DRAFT'
                                                        ? 'primary'
                                                        : 'secondary'
                                                }
                                                scale="small"
                                                onClick={() => {
                                                    setPreviewSource('DRAFT');
                                                    setConfirmingRestore(false);
                                                }}
                                            >
                                                <FileText size={14} />
                                                {t('source.draft')}
                                            </MyButton>
                                            <MyButton
                                                buttonType={
                                                    previewSource === 'PUBLISHED'
                                                        ? 'primary'
                                                        : 'secondary'
                                                }
                                                scale="small"
                                                onClick={() => {
                                                    setPreviewSource('PUBLISHED');
                                                    setConfirmingRestore(false);
                                                }}
                                            >
                                                <Globe size={14} />
                                                {t('source.published')}
                                            </MyButton>
                                        </div>
                                        <MyButton
                                            buttonType={confirmingRestore ? 'primary' : 'secondary'}
                                            scale="small"
                                            disabled={!previewValue || restoreMutation.isPending}
                                            className={cn(
                                                restoreMutation.isPending && 'pointer-events-none'
                                            )}
                                            onClick={() => {
                                                if (!confirmingRestore) {
                                                    setConfirmingRestore(true);
                                                    return;
                                                }
                                                if (selectedId != null) {
                                                    restoreMutation.mutate({
                                                        historyId: selectedId,
                                                        source: previewSource,
                                                    });
                                                }
                                            }}
                                        >
                                            {restoreMutation.isPending ? (
                                                <>
                                                    <CircleNotch className="size-4 animate-spin" />
                                                    {t('restore.restoring')}
                                                </>
                                            ) : confirmingRestore ? (
                                                t('restore.confirm')
                                            ) : (
                                                t('restore.action')
                                            )}
                                        </MyButton>
                                    </div>
                                    {!previewValue ? (
                                        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-neutral-200 p-6">
                                            <p className="text-caption text-neutral-400">
                                                {previewSource === 'DRAFT'
                                                    ? t('preview.noContent.draft')
                                                    : t('preview.noContent.published')}
                                            </p>
                                        </div>
                                    ) : isDocEditor ? (
                                        <iframe
                                            title={t('preview.iframeTitle')}
                                            sandbox=""
                                            srcDoc={previewValue}
                                            className="h-80 w-full rounded-md border border-neutral-200 bg-white"
                                        />
                                    ) : (
                                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md border border-neutral-200 bg-neutral-50 p-3 text-caption text-neutral-600">
                                            {previewValue}
                                        </pre>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </MyDialog>
        </>
    );
};
