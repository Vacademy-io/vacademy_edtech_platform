import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    CheckCircle,
    Coins,
    FilePdf,
    Globe,
    Link as LinkIcon,
    Note,
    UploadSimple,
    WarningCircle,
    YoutubeLogo,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { MyDialog } from '@/components/design-system/dialog';
import { MyInput } from '@/components/design-system/input';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import { MAX_PAGES_PER_SOURCE } from '../-constants';
import { useAddSource } from '../-hooks';
import { countPdfPages, estimateSource } from '../-services/knowledge-base-service';
import type { IngestEstimate, SourceKind } from '../-types';

interface AddSourceDialogProps {
    kbId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const formatCount = (n: number) => new Intl.NumberFormat('en-IN').format(n);

/**
 * Shows what an ingest will cost BEFORE it runs.
 *
 * The page count is read from the PDF in the browser, so the number appears the
 * moment a file is picked — no upload wait, no surprise. The server recomputes it
 * at charge time from the pages actually parsed, so this is honest as a preview
 * and never authoritative.
 */
function CostPreview({
    estimate,
    loading,
    t,
}: {
    estimate: IngestEstimate | null;
    loading: boolean;
    t: TFunction;
}) {
    if (loading) {
        return (
            <Card className="flex items-center gap-2 border-neutral-200 bg-neutral-50 p-3">
                <Coins className="size-4 text-neutral-400" />
                <p className="text-caption text-neutral-500">{t('costPreview.loading')}</p>
            </Card>
        );
    }
    if (!estimate) return null;

    const affordable = estimate.sufficient !== false;
    return (
        <Card
            className={
                affordable
                    ? 'flex flex-col gap-1 border-primary-100 bg-primary-50 p-3'
                    : 'flex flex-col gap-1 border-danger-200 bg-danger-50 p-3'
            }
        >
            <div className="flex items-center gap-2">
                <Coins
                    className={affordable ? 'size-4 text-primary-500' : 'size-4 text-danger-500'}
                />
                <p className="text-caption font-semibold text-neutral-700">
                    {estimate.num_pages != null
                        ? `${t('costPreview.pagesCount', {
                              count: estimate.num_pages,
                              formatted: formatCount(estimate.num_pages),
                          })} ${t('costPreview.creditsApprox', {
                              count: estimate.estimated_credits,
                              formatted: formatCount(estimate.estimated_credits),
                          })}`
                        : t('costPreview.creditsAbout', {
                              count: estimate.estimated_credits,
                              formatted: formatCount(estimate.estimated_credits),
                          })}
                </p>
            </div>
            {estimate.current_balance != null && (
                <p className="pl-6 text-caption text-neutral-500">
                    {t('costPreview.balance', {
                        count: estimate.current_balance,
                        formatted: formatCount(estimate.current_balance),
                    })}
                    {affordable && estimate.balance_after != null
                        ? t('costPreview.balanceAfter', {
                              count: estimate.balance_after,
                              formatted: formatCount(estimate.balance_after),
                          })
                        : t('costPreview.balanceEnd')}
                </p>
            )}
            {!affordable && (
                <p className="pl-6 text-caption text-danger-600">{t('costPreview.notEnough')}</p>
            )}
            <p className="pl-6 text-caption text-neutral-400">{t('costPreview.chargedNote')}</p>
        </Card>
    );
}

export const AddSourceDialog = ({ kbId, open, onOpenChange }: AddSourceDialogProps) => {
    const { t } = useTranslation('knowledgeBaseAddSourceDialog');
    const [tab, setTab] = useState<SourceKind>('PDF');

    // PDF
    const [file, setFile] = useState<File | null>(null);
    const [pageCount, setPageCount] = useState<number | null>(null);
    const [fileId, setFileId] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // URL / YouTube / text
    const [url, setUrl] = useState('');
    const [title, setTitle] = useState('');
    const [text, setText] = useState('');

    const [estimate, setEstimate] = useState<IngestEstimate | null>(null);
    const [estimating, setEstimating] = useState(false);

    const addSource = useAddSource(kbId);
    const { uploadFile } = useFileUpload();

    const reset = () => {
        setFile(null);
        setPageCount(null);
        setFileId(null);
        setUrl('');
        setTitle('');
        setText('');
        setEstimate(null);
        setEstimating(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const close = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    const fetchEstimate = useCallback(
        async (kind: SourceKind, pages?: number) => {
            setEstimating(true);
            try {
                const result = await estimateSource(kbId, {
                    source_kind: kind,
                    num_pages: pages,
                });
                setEstimate(result);
            } catch {
                // A failed estimate must not block adding a source — the server
                // still pre-flights the balance and returns 402 if short.
                setEstimate(null);
            } finally {
                setEstimating(false);
            }
        },
        [kbId]
    );

    const handleFilePicked = async (picked: File) => {
        if (picked.type !== 'application/pdf') {
            toast.error(t('errors.onlyPdf'));
            return;
        }
        setFile(picked);
        setFileId(null);
        const pages = await countPdfPages(picked);
        setPageCount(pages);
        if (pages && pages > MAX_PAGES_PER_SOURCE) {
            toast.error(
                t('errors.tooManyPages', { count: pages, formatted: formatCount(pages) }) +
                    ' ' +
                    t('errors.pageLimit', {
                        count: MAX_PAGES_PER_SOURCE,
                        formatted: formatCount(MAX_PAGES_PER_SOURCE),
                    })
            );
            return;
        }
        // Estimate straight away off the local page count, then upload in the
        // background so Add is instant once the user has decided.
        if (pages) await fetchEstimate('PDF', pages);

        const userId = getUserId();
        if (!userId) {
            toast.error(t('errors.identifyAccountFailed'));
            return;
        }
        try {
            const uploaded = await uploadFile({
                file: picked,
                setIsUploading,
                userId,
                source: 'KNOWLEDGE_BASE',
                sourceId: kbId,
            });
            if (uploaded) setFileId(uploaded);
        } catch {
            toast.error(t('errors.uploadFailed'));
        }
    };

    const submit = async () => {
        try {
            if (tab === 'PDF') {
                if (!fileId) {
                    toast.error(
                        isUploading ? t('errors.stillUploading') : t('errors.choosePdfFirst')
                    );
                    return;
                }
                const result = await addSource.mutateAsync({
                    source_kind: 'PDF',
                    file_id: fileId,
                    title: (
                        title.trim() ||
                        file?.name ||
                        t('pdf.untitledDocument')
                    ).replace(/\.pdf$/i, ''),
                    expected_pages: pageCount ?? undefined,
                });
                if (result.deduplicated) {
                    toast.success(result.message ?? t('toasts.alreadyAdded'));
                } else {
                    toast.success(t('toasts.addedProcessing'));
                }
            } else if (tab === 'URL' || tab === 'YOUTUBE') {
                if (!url.trim()) {
                    toast.error(t('errors.pasteLinkFirst'));
                    return;
                }
                await addSource.mutateAsync({
                    source_kind: tab,
                    source_url: url.trim(),
                    title: title.trim() || undefined,
                });
                toast.success(t('toasts.addedProcessingShort'));
            } else {
                if (!text.trim()) {
                    toast.error(t('errors.typeSomethingFirst'));
                    return;
                }
                await addSource.mutateAsync({
                    source_kind: 'TEXT',
                    raw_text: text.trim(),
                    title: title.trim() || undefined,
                });
                toast.success(t('toasts.added'));
            }
            reset();
            onOpenChange(false);
        } catch (error) {
            const response = (
                error as { response?: { status?: number; data?: { detail?: unknown } } }
            )?.response;
            const detail = response?.data?.detail;
            if (response?.status === 402) {
                const message =
                    typeof detail === 'object' && detail !== null && 'message' in detail
                        ? String((detail as { message: unknown }).message)
                        : t('errors.notEnoughCredits');
                toast.error(message);
                return;
            }
            toast.error(typeof detail === 'string' ? detail : t('errors.addFailed'));
        }
    };

    const busy = addSource.isPending || isUploading;

    return (
        <MyDialog
            heading={t('heading')}
            open={open}
            onOpenChange={close}
            dialogWidth="max-w-xl"
            footer={
                <div className="flex w-full items-center justify-between gap-2">
                    <p className="text-caption text-neutral-400">
                        {tab === 'TEXT' ? t('typedNotesFree') : ''}
                    </p>
                    <div className="flex gap-2">
                        <MyButton
                            buttonType="secondary"
                            scale="medium"
                            onClick={() => close(false)}
                            disable={busy}
                        >
                            {t('cancelButton')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="medium"
                            onClick={submit}
                            disable={busy || (tab === 'PDF' && !fileId)}
                        >
                            {addSource.isPending
                                ? t('addingButton')
                                : isUploading
                                  ? t('uploadingButton')
                                  : t('addButton')}
                        </MyButton>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-4 p-6">
                <Tabs
                    value={tab}
                    onValueChange={(v) => {
                        setTab(v as SourceKind);
                        setEstimate(null);
                    }}
                >
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="PDF" className="flex items-center gap-1.5">
                            <FilePdf className="size-4" />
                            {t('tabs.document')}
                        </TabsTrigger>
                        <TabsTrigger value="URL" className="flex items-center gap-1.5">
                            <Globe className="size-4" />
                            {t('tabs.webPage')}
                        </TabsTrigger>
                        <TabsTrigger value="YOUTUBE" className="flex items-center gap-1.5">
                            <YoutubeLogo className="size-4" />
                            {t('tabs.youtube')}
                        </TabsTrigger>
                        <TabsTrigger value="TEXT" className="flex items-center gap-1.5">
                            <Note className="size-4" />
                            {t('tabs.note')}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="PDF" className="mt-4 flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-4 py-8 transition-colors hover:border-primary-300 hover:bg-primary-50"
                        >
                            <UploadSimple className="size-6 text-neutral-400" />
                            <span className="text-body text-neutral-600">
                                {file ? file.name : t('pdf.choosePdf')}
                            </span>
                            <span className="text-caption text-neutral-400">
                                {t('pdf.dropHint')}
                            </span>
                        </button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            onChange={(e) => {
                                const picked = e.target.files?.[0];
                                if (picked) void handleFilePicked(picked);
                            }}
                        />

                        {file && (
                            <div className="flex items-center gap-2 text-caption text-neutral-500">
                                {fileId ? (
                                    <>
                                        <CheckCircle className="size-4 text-success-600" />
                                        {t('pdf.uploaded')}
                                    </>
                                ) : (
                                    <>
                                        <UploadSimple className="size-4 animate-pulse" />
                                        {t('pdf.uploading')}
                                    </>
                                )}
                                {pageCount != null && (
                                    <span>
                                        ·{' '}
                                        {t('pdf.pagesRead', {
                                            count: pageCount,
                                            formatted: formatCount(pageCount),
                                        })}
                                    </span>
                                )}
                                {pageCount == null && <span>· {t('pdf.pageCountOnServer')}</span>}
                            </div>
                        )}

                        <MyInput
                            label={t('pdf.titleLabel')}
                            inputType="text"
                            input={title}
                            onChangeFunction={(e) => setTitle(e.target.value)}
                            inputPlaceholder={
                                file?.name?.replace(/\.pdf$/i, '') || t('pdf.titlePlaceholder')
                            }
                            className="w-full"
                        />

                        <CostPreview estimate={estimate} loading={estimating} t={t} />

                        <Card className="flex items-start gap-2 border-neutral-200 bg-neutral-50 p-3">
                            <WarningCircle className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                            <p className="text-caption text-neutral-500">{t('pdf.ocrNote')}</p>
                        </Card>
                    </TabsContent>

                    <TabsContent value="URL" className="mt-4 flex flex-col gap-3">
                        <MyInput
                            label={t('url.linkLabel')}
                            required
                            inputType="text"
                            input={url}
                            onChangeFunction={(e) => setUrl(e.target.value)}
                            inputPlaceholder={t('url.linkPlaceholder')}
                            className="w-full"
                        />
                        <MyInput
                            label={t('pdf.titleLabel')}
                            inputType="text"
                            input={title}
                            onChangeFunction={(e) => setTitle(e.target.value)}
                            inputPlaceholder={t('url.titlePlaceholder')}
                            className="w-full"
                        />
                        <p className="flex items-start gap-1.5 text-caption text-neutral-500">
                            <LinkIcon className="mt-0.5 size-4 shrink-0 text-neutral-400" />
                            {t('url.hint')}
                        </p>
                        <CostPreview estimate={estimate} loading={estimating} t={t} />
                        <MyButton
                            buttonType="text"
                            scale="medium"
                            onClick={() => void fetchEstimate('URL')}
                            disable={estimating}
                        >
                            {t('url.showCostButton')}
                        </MyButton>
                    </TabsContent>

                    <TabsContent value="YOUTUBE" className="mt-4 flex flex-col gap-3">
                        <MyInput
                            label={t('youtube.linkLabel')}
                            required
                            inputType="text"
                            input={url}
                            onChangeFunction={(e) => setUrl(e.target.value)}
                            inputPlaceholder={t('youtube.linkPlaceholder')}
                            className="w-full"
                        />
                        <MyInput
                            label={t('pdf.titleLabel')}
                            inputType="text"
                            input={title}
                            onChangeFunction={(e) => setTitle(e.target.value)}
                            inputPlaceholder={t('url.titlePlaceholder')}
                            className="w-full"
                        />
                        <p className="text-caption text-neutral-500">{t('youtube.hint')}</p>
                        <CostPreview estimate={estimate} loading={estimating} t={t} />
                        <MyButton
                            buttonType="text"
                            scale="medium"
                            onClick={() => void fetchEstimate('YOUTUBE')}
                            disable={estimating}
                        >
                            {t('youtube.showCostButton')}
                        </MyButton>
                    </TabsContent>

                    <TabsContent value="TEXT" className="mt-4 flex flex-col gap-3">
                        <MyInput
                            label={t('pdf.titleLabel')}
                            inputType="text"
                            input={title}
                            onChangeFunction={(e) => setTitle(e.target.value)}
                            inputPlaceholder={t('text.titlePlaceholder')}
                            className="w-full"
                        />
                        <div className="flex flex-col gap-1">
                            <label
                                htmlFor="kb-note-text"
                                className="text-subtitle font-regular text-neutral-600"
                            >
                                {t('text.contentLabel')}{' '}
                                <span className="text-subtitle text-danger-600">*</span>
                            </label>
                            <textarea
                                id="kb-note-text"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                rows={8}
                                placeholder={t('text.contentPlaceholder')}
                                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-body focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-100"
                            />
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </MyDialog>
    );
};
