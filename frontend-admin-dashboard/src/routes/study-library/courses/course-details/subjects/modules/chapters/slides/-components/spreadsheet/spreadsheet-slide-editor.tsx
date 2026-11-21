import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    ArrowsClockwise,
    CircleNotch,
    DownloadSimple,
    FileXls,
    WarningCircle,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Switch } from '@/components/ui/switch';
import { SheetView } from '@/components/cbe/SheetView';
import type { CbeSheet } from '@/components/cbe/types';
import { cn } from '@/lib/utils';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getPublicUrl } from '@/services/upload_file';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import type { Slide } from '../../-hooks/use-slides';
import { useContentStore } from '../../-stores/chapter-sidebar-store';
import {
    convertSpreadsheetFile,
    SpreadsheetUploadError,
    uploadConvertedSpreadsheet,
} from './spreadsheet-import';
import { spreadsheetErrorMessage } from './spreadsheet-errors';
import {
    parseSpreadsheetData,
    parseSpreadsheetGrid,
    serializeSpreadsheetData,
    SPREADSHEET_ACCEPTED_EXTENSIONS,
    SPREADSHEET_MAX_JSON_CHARS,
    type SpreadsheetSlideData,
} from './spreadsheet-slide-data';

const gridQueryKey = (gridFileId: string | null) => ['spreadsheet-slide-grid', gridFileId];

/** Downloads and reads the grid JSON file (bounded; the file id never changes content). */
async function fetchSpreadsheetGrid(gridFileId: string, signal?: AbortSignal): Promise<CbeSheet> {
    const url = await getPublicUrl(gridFileId);
    if (!url) throw new Error('no url');
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    // The import caps the file at SPREADSHEET_MAX_JSON_CHARS; refuse anything far bigger.
    if (text.length > SPREADSHEET_MAX_JSON_CHARS * 2) throw new Error('too large');
    const sheet = parseSpreadsheetGrid(text);
    if (!sheet) throw new Error('unreadable');
    return sheet;
}

/** Draft JSON: the draft column, falling back to the live copy. */
function storedJson(slide: Slide | null | undefined): string {
    return slide?.document_slide?.data || slide?.document_slide?.published_data || '';
}

/**
 * Keeps the editor's latest JSON in `activeItem.document_slide.data`, which the
 * slide header's Save Draft and Publish send to the server (same contract as
 * the discussion editor). A refetch that brings back a value this editor wrote
 * or started from gets the local edit put back; anything else (a version
 * restore) is left alone — the restore remounts this editor.
 */
function useSyncDraftToActiveSlide(
    slideId: string,
    json: string,
    userEdited: boolean,
    initial: string
) {
    const storeActive = useContentStore((s) => s.activeItem);
    const setActiveItem = useContentStore((s) => s.setActiveItem);
    const ownValues = useRef<Set<string>>(new Set([initial]));

    useEffect(() => {
        if (!userEdited) return;
        if (!storeActive || storeActive.id !== slideId || !storeActive.document_slide) return;
        const current = storeActive.document_slide.data ?? '';
        if (current === json) return;
        if (!ownValues.current.has(current) && current !== '') return;
        ownValues.current.add(json);
        setActiveItem({
            ...storeActive,
            document_slide: { ...storeActive.document_slide, data: json },
        });
    }, [json, userEdited, slideId, storeActive, setActiveItem]);
}

const saveUrlAs = async (url: string, name: string) => {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
};

export function SpreadsheetSlideEditor({
    slide,
    isEditable,
}: {
    slide: Slide;
    isEditable: boolean;
}) {
    const { t, i18n } = useTranslation('spreadsheetSlide');
    const slideId = slide.id;
    // Learner preview shows what learners get: the published copy.
    const [initialJson] = useState(() =>
        isEditable ? storedJson(slide) : slide.document_slide?.published_data || storedJson(slide)
    );
    const [data, setData] = useState<SpreadsheetSlideData | null>(() =>
        parseSpreadsheetData(initialJson)
    );
    const [userEdited, setUserEdited] = useState(false);
    const [replacing, setReplacing] = useState(false);
    const [downloading, setDownloading] = useState(false);
    // Bumped on every replace so the grid remounts on its first tab.
    const [sheetVersion, setSheetVersion] = useState(0);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { uploadFile } = useFileUpload();
    const queryClient = useQueryClient();

    // The grid lives in its own media file; a legacy slide may still carry it inline.
    const gridFileId = data?.grid_file_id ?? null;
    const gridQuery = useQuery({
        queryKey: gridQueryKey(gridFileId),
        queryFn: ({ signal }) => fetchSpreadsheetGrid(gridFileId as string, signal),
        enabled: !!gridFileId && !data?.sheet,
        staleTime: Infinity,
        gcTime: 5 * 60 * 1000,
        retry: 1,
    });
    const sheet: CbeSheet | null = data?.sheet ?? gridQuery.data ?? null;

    const json = useMemo(
        () => (data ? serializeSpreadsheetData(data) : initialJson),
        [data, initialJson]
    );
    useSyncDraftToActiveSlide(slideId, json, userEdited, initialJson);

    const status = useContentStore((s) =>
        s.activeItem?.id === slideId ? s.activeItem.status : slide.status
    );
    const persistedJson = useContentStore((s) => storedJson(s.items.find((i) => i.id === slideId)));
    const hasUnsavedChanges = userEdited && persistedJson !== json;

    const statusHint = hasUnsavedChanges
        ? { tone: 'warning', text: t('editor.statusUnsaved') }
        : status === 'PUBLISHED'
          ? { tone: 'success', text: t('editor.statusLive') }
          : status === 'UNSYNC'
            ? { tone: 'warning', text: t('editor.statusUnsync') }
            : { tone: 'neutral', text: t('editor.statusDraft') };

    const handleReplace = async (file: File | undefined) => {
        if (!file) return;
        setReplacing(true);
        try {
            const converted = await convertSpreadsheetFile(file);
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            const tokenData = getTokenDecodedData(accessToken);
            const instituteId = tokenData && Object.keys(tokenData.authorities)[0];
            const next = await uploadConvertedSpreadsheet({
                original: file,
                converted,
                allowDownload: data?.allow_download ?? true,
                upload: (upload) =>
                    uploadFile({
                        file: upload,
                        setIsUploading: () => undefined,
                        userId: 'your-user-id',
                        source: instituteId,
                        sourceId: 'SPREADSHEET_DOCUMENTS',
                    }),
            });
            // The new grid is already in memory: seed the cache instead of downloading it.
            queryClient.setQueryData(gridQueryKey(next.grid_file_id), converted.sheet);
            setData(next);
            setSheetVersion((v) => v + 1);
            setUserEdited(true);
            toast.success(t('editor.replaced'));
        } catch (err) {
            toast.error(
                err instanceof SpreadsheetUploadError
                    ? t('dialog.uploadFailed')
                    : spreadsheetErrorMessage(t, i18n.language, err)
            );
        } finally {
            setReplacing(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDownload = async () => {
        if (!data?.file_id) return;
        setDownloading(true);
        try {
            const url = await getPublicUrl(data.file_id);
            if (!url) {
                toast.error(t('editor.downloadFailed'));
                return;
            }
            await saveUrlAs(url, data.file_name || 'spreadsheet.xlsx');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-50">
                        <FileXls className="size-5 text-success-600" weight="duotone" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate text-subtitle font-semibold text-neutral-700">
                            {data?.file_name || t('editor.heading')}
                        </span>
                        {isEditable && (
                            <span
                                className={cn(
                                    'text-caption',
                                    statusHint.tone === 'warning' && 'text-warning-600',
                                    statusHint.tone === 'success' && 'text-success-600',
                                    statusHint.tone === 'neutral' && 'text-neutral-500'
                                )}
                            >
                                {statusHint.text}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {data?.file_id && (
                        <MyButton
                            type="button"
                            buttonType="secondary"
                            scale="medium"
                            onClick={handleDownload}
                            disabled={downloading}
                        >
                            {downloading ? (
                                <CircleNotch className="size-4 animate-spin" />
                            ) : (
                                <DownloadSimple className="size-4" />
                            )}
                            {t('editor.download')}
                        </MyButton>
                    )}
                    {isEditable && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept={SPREADSHEET_ACCEPTED_EXTENSIONS.join(',')}
                                onChange={(e) => handleReplace(e.target.files?.[0])}
                            />
                            <MyButton
                                type="button"
                                buttonType="secondary"
                                scale="medium"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={replacing}
                            >
                                {replacing ? (
                                    <CircleNotch className="size-4 animate-spin" />
                                ) : (
                                    <ArrowsClockwise className="size-4" />
                                )}
                                {t('editor.replace')}
                            </MyButton>
                        </>
                    )}
                </div>
            </div>

            {isEditable && data && (
                <label className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3">
                    <Switch
                        checked={data.allow_download}
                        onCheckedChange={(checked) => {
                            setData((prev) => (prev ? { ...prev, allow_download: checked } : prev));
                            setUserEdited(true);
                        }}
                    />
                    <span className="text-body text-neutral-700">{t('editor.allowDownload')}</span>
                </label>
            )}

            {isEditable && data && !data.file_id && (
                <p className="text-caption text-neutral-500">{t('editor.noFile')}</p>
            )}

            {!data ? (
                <p className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-body text-warning-600">
                    {t('editor.invalid')}
                </p>
            ) : sheet ? (
                <SheetView
                    key={sheetVersion}
                    sheet={sheet}
                    emptyText={t('editor.emptyGrid')}
                    className="w-full"
                />
            ) : gridQuery.isError ? (
                <div
                    role="alert"
                    className="flex flex-col items-start gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                    <span className="flex items-start gap-2 text-body text-danger-600">
                        <WarningCircle className="mt-0.5 size-4 shrink-0" />
                        {t('editor.gridLoadFailed')}
                    </span>
                    <MyButton
                        type="button"
                        buttonType="secondary"
                        scale="medium"
                        onClick={() => gridQuery.refetch()}
                        disabled={gridQuery.isFetching}
                    >
                        {t('editor.retry')}
                    </MyButton>
                </div>
            ) : (
                <div
                    role="status"
                    className="flex items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white p-8 text-body text-neutral-500"
                >
                    <CircleNotch className="size-5 animate-spin text-primary-500" />
                    {t('editor.loadingGrid')}
                </div>
            )}
        </div>
    );
}
