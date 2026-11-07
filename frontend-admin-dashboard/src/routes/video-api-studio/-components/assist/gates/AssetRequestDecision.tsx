import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useFileUpload } from '@/hooks/use-file-upload';
import { getUserId } from '@/utils/userDetails';
import {
    Check,
    ChartBar,
    DeviceMobile,
    Image as ImageIcon,
    Lightbulb,
    UploadSimple,
    X,
} from '@phosphor-icons/react';
import type {
    AssetRequestItem,
    DecisionAnswer,
    DecisionRequest,
} from '../../../-services/video-generation';

interface AssetRequestDecisionProps {
    decision: DecisionRequest;
    isSubmitting?: boolean;
    onSubmit: (answer: DecisionAnswer) => void;
}

const KIND_ICON: Record<string, typeof ImageIcon> = {
    screenshot: DeviceMobile,
    photo: ImageIcon,
    data: ChartBar,
    inspiration: Lightbulb,
};

interface ResponseState {
    url?: string;
    text?: string;
    choice?: string;
    skipped?: boolean;
}

/**
 * Agent-initiated asks — the planner requested real assets ("upload your app's
 * actual screenshot", "confirm your real number", "pick a direction"). Every
 * item is individually answerable or skippable; skipped items fall back to
 * generation. Real assets are embedded verbatim downstream (a screenshot
 * becomes the mockup's screen; a figure appears word-for-word in narration).
 */
export function AssetRequestDecision({ decision, isSubmitting, onSubmit }: AssetRequestDecisionProps) {
    const { t } = useTranslation('videoApiStudioAssetRequestDecision');
    const requests = useMemo<AssetRequestItem[]>(() => {
        const raw = (decision.payload?.requests as AssetRequestItem[]) ?? [];
        return Array.isArray(raw) ? raw.filter((r) => r && r.ask) : [];
    }, [decision.payload]);

    const [responses, setResponses] = useState<Record<number, ResponseState>>({});
    const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const pendingUploadIdx = useRef<number | null>(null);
    const { uploadFile, getPublicUrl } = useFileUpload();

    const patch = (idx: number, p: ResponseState) =>
        setResponses((prev) => ({ ...prev, [idx]: { ...prev[idx], ...p } }));

    const startUpload = (idx: number) => {
        pendingUploadIdx.current = idx;
        fileInputRef.current?.click();
    };

    const onFilePicked = async (file: File | null) => {
        const idx = pendingUploadIdx.current;
        pendingUploadIdx.current = null;
        if (!file || idx == null) return;
        setUploadingIdx(idx);
        try {
            const fileId = await uploadFile({
                file,
                setIsUploading: () => {},
                userId: getUserId(),
                source: 'AI_INPUT_IMAGE',
                sourceId: 'ADMIN',
                publicUrl: true,
            });
            const url = fileId ? await getPublicUrl(fileId) : null;
            if (!url) throw new Error('Upload failed');
            patch(idx, { url, skipped: false });
        } catch {
            toast.error(t('upload.failed'));
        } finally {
            setUploadingIdx(null);
        }
    };

    const answeredCount = requests.filter((r) => {
        const resp = responses[r.index];
        return resp && !resp.skipped && (resp.url || resp.text?.trim() || resp.choice);
    }).length;

    const submit = () => {
        onSubmit({
            kind: 'edit',
            gate_type: 'asset_request',
            responses: requests.map((r) => {
                const resp = responses[r.index] ?? {};
                const answered = !resp.skipped && (resp.url || resp.text?.trim() || resp.choice);
                return {
                    index: r.index,
                    url: answered ? resp.url : undefined,
                    text: answered ? resp.text?.trim() : undefined,
                    choice: answered ? resp.choice : undefined,
                    skipped: !answered,
                };
            }),
        });
    };

    return (
        <div className="rounded-xl border bg-white shadow-sm dark:bg-card">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold text-foreground">
                <span className="flex size-7 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/30">
                    <UploadSimple className="size-4 text-violet-600" />
                </span>
                {t('header.title')}
            </div>

            <div className="divide-y">
                {requests.map((r) => {
                    const resp = responses[r.index] ?? {};
                    const Icon = KIND_ICON[r.kind] ?? ImageIcon;
                    const answered = !resp.skipped && (resp.url || resp.text?.trim() || resp.choice);
                    return (
                        <div key={r.index} className={cn('space-y-2 px-4 py-3', resp.skipped && 'opacity-50')}>
                            <div className="flex items-start gap-2.5">
                                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
                                    <Icon className="size-3.5 text-muted-foreground" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm text-foreground">
                                        {r.ask}
                                        {typeof r.shot_index === 'number' && (
                                            <span className="ml-1 text-xs text-muted-foreground">
                                                {t('item.shotLabel', { number: r.shot_index + 1 })}
                                            </span>
                                        )}
                                    </p>
                                    {r.why ? (
                                        <p className="text-xs text-muted-foreground">{r.why}</p>
                                    ) : null}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={isSubmitting}
                                    onClick={() => patch(r.index, { skipped: !resp.skipped })}
                                    className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
                                >
                                    <X className="size-3" />
                                    {resp.skipped ? t('item.undo') : t('item.skip')}
                                </Button>
                            </div>

                            {!resp.skipped && (r.kind === 'screenshot' || r.kind === 'photo') && (
                                <div className="flex items-center gap-2 pl-8">
                                    {resp.url ? (
                                        <img
                                            src={resp.url}
                                            alt={t('upload.altText')}
                                            className="h-14 rounded-md border object-cover"
                                        />
                                    ) : null}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={isSubmitting || uploadingIdx === r.index}
                                        onClick={() => startUpload(r.index)}
                                        className="gap-1.5"
                                    >
                                        <UploadSimple className="size-3.5" />
                                        {uploadingIdx === r.index
                                            ? t('upload.uploading')
                                            : resp.url
                                              ? t('upload.replace')
                                              : t('upload.upload')}
                                    </Button>
                                </div>
                            )}

                            {!resp.skipped && r.kind === 'data' && (
                                <div className="pl-8">
                                    <Input
                                        value={resp.text ?? ''}
                                        disabled={isSubmitting}
                                        onChange={(e) => patch(r.index, { text: e.target.value })}
                                        placeholder={t('data.placeholder')}
                                        className="h-8 text-sm"
                                    />
                                </div>
                            )}

                            {!resp.skipped && r.kind === 'inspiration' && (
                                <div className="flex flex-wrap gap-1.5 pl-8">
                                    {(r.options ?? []).map((opt) => (
                                        <button
                                            key={opt}
                                            type="button"
                                            disabled={isSubmitting}
                                            onClick={() =>
                                                patch(r.index, {
                                                    choice: resp.choice === opt ? undefined : opt,
                                                })
                                            }
                                            className={cn(
                                                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                                                resp.choice === opt
                                                    ? 'border-violet-500 bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100'
                                                    : 'text-muted-foreground hover:text-foreground'
                                            )}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {answered ? (
                                <p className="flex items-center gap-1 pl-8 text-xs text-emerald-600">
                                    <Check className="size-3" /> {t('item.willBeUsed')}
                                </p>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
                <span className="text-xs text-muted-foreground">
                    {answeredCount > 0
                        ? t('footer.providedCount', { count: answeredCount, total: requests.length })
                        : t('footer.allOptional')}
                </span>
                <Button
                    size="sm"
                    disabled={isSubmitting || uploadingIdx !== null}
                    onClick={submit}
                    className="gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700"
                >
                    <Check className="size-4" />
                    {t('actions.continue')}
                </Button>
            </div>
        </div>
    );
}
