import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
    ArrowClockwise,
    DotsThreeVertical,
    FilePdf,
    Globe,
    Note,
    Trash,
    YoutubeLogo,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { StatusChip } from '@/components/design-system/status-chips';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    buildLanguageLabel,
    buildSourceStatusFallbackLabels,
    buildSourceStatusMeta,
    buildStageLabel,
} from '../-constants';
import { useSourceActions } from '../-hooks';
import type { KnowledgeSource, SourceKind } from '../-types';

const KIND_ICON: Record<SourceKind, typeof FilePdf> = {
    PDF: FilePdf,
    URL: Globe,
    YOUTUBE: YoutubeLogo,
    TEXT: Note,
};

const formatCount = (n: number) => new Intl.NumberFormat('en-IN').format(n);

interface SourcesTableProps {
    kbId: string;
    sources: KnowledgeSource[];
    writable: boolean;
}

function SourceRow({
    source,
    kbId,
    writable,
    onDeleteRequest,
}: {
    source: KnowledgeSource;
    kbId: string;
    writable: boolean;
    onDeleteRequest: (source: KnowledgeSource) => void;
}) {
    const { t: tConstants } = useTranslation('knowledgeBaseConstants');
    const { t } = useTranslation('knowledgeBaseSourcesTable');
    const languageLabel = useMemo(() => buildLanguageLabel(tConstants), [tConstants]);
    const sourceStatusMeta = useMemo(() => buildSourceStatusMeta(tConstants), [tConstants]);
    const stageLabel = useMemo(() => buildStageLabel(tConstants), [tConstants]);
    const stageFallback = useMemo(
        () => buildSourceStatusFallbackLabels(tConstants),
        [tConstants]
    );
    const { toggleActive, reindex } = useSourceActions(kbId);
    const Icon = KIND_ICON[source.source_kind] ?? Note;
    const meta = sourceStatusMeta[source.status];
    const busy = source.status === 'PENDING' || source.status === 'PROCESSING';

    return (
        <div className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-3 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <Icon className="mt-0.5 size-5 shrink-0 text-neutral-400" />
                    <div className="min-w-0">
                        <p className="truncate text-body font-medium text-neutral-700">
                            {source.title}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-caption text-neutral-500">
                            {source.page_count > 0 && (
                                <span>
                                    {t('counts.pages', {
                                        count: source.page_count,
                                        formatted: formatCount(source.page_count),
                                    })}
                                </span>
                            )}
                            {source.chunk_count > 0 && (
                                <span>
                                    {t('counts.passages', {
                                        count: source.chunk_count,
                                        formatted: formatCount(source.chunk_count),
                                    })}
                                </span>
                            )}
                            {source.figure_count > 0 && (
                                <span>
                                    {t('counts.figures', {
                                        count: source.figure_count,
                                        formatted: formatCount(source.figure_count),
                                    })}
                                </span>
                            )}
                            {source.detected_languages.length > 0 && (
                                <span>
                                    {source.detected_languages
                                        .map((l) => languageLabel[l] ?? l)
                                        .join(', ')}
                                </span>
                            )}
                            {/* Cost transparency per source: what was actually charged, and
                                how many pages needed the paid OCR path. */}
                            {source.credits_charged > 0 && (
                                <span>
                                    {t('counts.credits', {
                                        count: source.credits_charged,
                                        formatted: formatCount(source.credits_charged),
                                    })}
                                </span>
                            )}
                            {source.ocr_pages > 0 && (
                                <span>
                                    {t('counts.ocrPages', {
                                        count: source.ocr_pages,
                                        formatted: formatCount(source.ocr_pages),
                                    })}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                    <StatusChip
                        status={meta.tone}
                        text={meta.label}
                        textSize="text-caption"
                        showIcon={false}
                    />
                    {writable && (
                        <>
                            <Switch
                                checked={source.is_active}
                                disabled={busy || toggleActive.isPending}
                                aria-label={
                                    source.is_active
                                        ? t('aria.stopUsing', { title: source.title })
                                        : t('aria.startUsing', { title: source.title })
                                }
                                onCheckedChange={(next) =>
                                    toggleActive.mutate(
                                        { sourceId: source.id, isActive: next },
                                        {
                                            onSuccess: () =>
                                                toast.success(
                                                    next
                                                        ? t('toast.nowUsed')
                                                        : t('toast.noLongerUsed')
                                                ),
                                            onError: () => toast.error(t('toast.updateFailed')),
                                        }
                                    )
                                }
                            />
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <MyButton
                                        buttonType="secondary"
                                        layoutVariant="icon"
                                        scale="small"
                                        aria-label={t('aria.actionsFor', { title: source.title })}
                                    >
                                        <DotsThreeVertical className="size-4" />
                                    </MyButton>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                        disabled={busy || reindex.isPending}
                                        onClick={() =>
                                            reindex.mutate(source.id, {
                                                onSuccess: () =>
                                                    toast.success(t('toast.reindexing')),
                                                onError: () =>
                                                    toast.error(t('toast.reindexFailed')),
                                            })
                                        }
                                    >
                                        <ArrowClockwise className="me-2 size-4" />
                                        {t('readAgain')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="text-danger-600"
                                        onClick={() => onDeleteRequest(source)}
                                    >
                                        <Trash className="me-2 size-4" />
                                        {t('remove')}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </>
                    )}
                </div>
            </div>

            {busy && (
                <div className="flex flex-col gap-1 ps-8">
                    <Progress value={source.progress} className="h-1.5" />
                    <p className="text-caption text-neutral-500">
                        {source.stage
                            ? stageLabel[source.stage] ?? stageFallback.working
                            : stageFallback.gettingStarted}
                        {' · '}
                        {source.progress}%
                    </p>
                </div>
            )}

            {/* An honest, actionable message beats a green tick over bad text. */}
            {source.status === 'PARTIAL' && source.pages_low_confidence > 0 && (
                <p className="ps-8 text-caption text-warning-600">
                    {t('partialWarning', {
                        lowConfidence: formatCount(source.pages_low_confidence),
                        total: formatCount(source.page_count),
                    })}
                </p>
            )}
            {source.status === 'FAILED' && source.error_message && (
                <p className="ps-8 text-caption text-danger-600">{source.error_message}</p>
            )}
            {!source.is_active && source.status !== 'FAILED' && (
                <p className="ps-8 text-caption text-neutral-400">{t('notActive')}</p>
            )}
        </div>
    );
}

export const SourcesTable = ({ kbId, sources, writable }: SourcesTableProps) => {
    const { t } = useTranslation('knowledgeBaseSourcesTable');
    const [pendingDelete, setPendingDelete] = useState<KnowledgeSource | null>(null);
    const { remove } = useSourceActions(kbId);

    if (sources.length === 0) {
        return (
            <Card className="flex flex-col items-center gap-2 p-8 text-center">
                <FilePdf className="size-6 text-neutral-300" />
                <p className="text-body text-neutral-500">{t('emptyState')}</p>
            </Card>
        );
    }

    return (
        <>
            <Card className="overflow-hidden">
                {sources.map((source) => (
                    <SourceRow
                        key={source.id}
                        source={source}
                        kbId={kbId}
                        writable={writable}
                        onDeleteRequest={setPendingDelete}
                    />
                ))}
            </Card>

            <AlertDialog
                open={Boolean(pendingDelete)}
                onOpenChange={(open) => !open && setPendingDelete(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('deleteDialog.description', {
                                title: pendingDelete?.title ?? '',
                            })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={remove.isPending}>
                            {t('deleteDialog.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={remove.isPending}
                            className="bg-danger-600 text-white hover:bg-danger-700"
                            onClick={() => {
                                if (!pendingDelete) return;
                                remove.mutate(pendingDelete.id, {
                                    onSuccess: () => {
                                        toast.success(t('toast.removeSuccess'));
                                        setPendingDelete(null);
                                    },
                                    onError: () => toast.error(t('toast.removeFailed')),
                                });
                            }}
                        >
                            {remove.isPending
                                ? t('deleteDialog.removing')
                                : t('deleteDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
