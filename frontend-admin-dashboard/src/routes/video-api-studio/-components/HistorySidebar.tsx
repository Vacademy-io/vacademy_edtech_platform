import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
    Video,
    Trash,
    Clock,
    CheckCircle,
    CircleNotch,
    WarningCircle,
    ClockCounterClockwise as HistoryIcon,
    CaretRight,
    CaretLeft,
    Plus,
    ArrowsClockwise,
} from '@phosphor-icons/react';
import { HistoryItem } from '../-services/video-generation';
import { useEffectiveCreditRatio } from '@/services/ai-credits/use-credit-rate';
import { formatCredits, usdToCredits } from '../-utils/credits';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface HistorySidebarProps {
    history: HistoryItem[];
    selectedId: string | null;
    onSelect: (item: HistoryItem) => void;
    onDelete: (videoId: string) => void;
    onRetry?: (videoId: string) => void;
    onNewVideo: () => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    currentPage?: number;
    totalPages?: number;
    onPageChange?: (page: number) => void;
    isLoadingHistory?: boolean;
}

export function HistorySidebar({
    history,
    selectedId,
    onSelect,
    onDelete,
    onRetry,
    onNewVideo,
    isCollapsed,
    onToggleCollapse,
    currentPage = 0,
    totalPages = 1,
    onPageChange,
    isLoadingHistory,
}: HistorySidebarProps) {
    const { t } = useTranslation(['videoApiStudioHistorySidebar', 'videoApiStudioCredits']);
    // History badges show the run's USD cost in credit form using the
    // live USD→credits rate. Falls back to the seed 150× when offline.
    const ratio = useEffectiveCreditRatio();
    const getStatusIcon = (status: HistoryItem['status']) => {
        switch (status) {
            case 'pending':
                return <Clock className="size-4 text-muted-foreground" />;
            case 'generating':
                return <CircleNotch className="size-4 animate-spin text-blue-500" />;
            case 'completed':
                return <CheckCircle className="size-4 text-green-500" />;
            case 'failed':
                return <WarningCircle className="size-4 text-red-500" />;
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return t('relativeTime.justNow');
        if (diffMins < 60) return t('relativeTime.minutesAgo', { count: diffMins });
        if (diffHours < 24) return t('relativeTime.hoursAgo', { count: diffHours });
        if (diffDays < 7) return t('relativeTime.daysAgo', { count: diffDays });
        return date.toLocaleDateString();
    };

    /* ── Collapsed icon strip ── */
    if (isCollapsed) {
        return (
            <div className="flex size-full flex-col items-center gap-1 py-2">
                {/* Expand toggle */}
                <button
                    onClick={onToggleCollapse}
                    title={t('collapsed.expandHistory')}
                    className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                    <CaretRight className="size-4" />
                </button>

                {/* New video */}
                <button
                    onClick={onNewVideo}
                    title={t('collapsed.newVideo')}
                    className="flex size-9 items-center justify-center rounded-md text-violet-600 transition-colors hover:bg-violet-50"
                >
                    <Plus className="size-4" />
                </button>

                {/* Divider */}
                <div className="my-1 w-6 border-t" />

                {/* Recent item status dots */}
                {history.slice(0, 8).map((item) => (
                    <button
                        key={item.video_id}
                        onClick={() => onSelect(item)}
                        title={item.prompt}
                        className={`flex size-9 items-center justify-center rounded-md transition-colors hover:bg-muted ${
                            selectedId === item.video_id
                                ? 'bg-violet-50 ring-1 ring-violet-200'
                                : ''
                        }`}
                    >
                        {getStatusIcon(item.status)}
                    </button>
                ))}
            </div>
        );
    }

    /* ── Expanded full sidebar ── */
    return (
        <div className="flex size-full flex-col backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-primary-100 p-4">
                <div className="flex items-center gap-2">
                    <HistoryIcon className="size-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">{t('header.title')}</h2>
                </div>
                {/* Collapse toggle */}
                <button
                    onClick={onToggleCollapse}
                    title={t('header.collapseHistory')}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                    <CaretLeft className="size-4" />
                </button>
            </div>

            <div className="p-3">
                <Button
                    onClick={onNewVideo}
                    className="w-full gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/10 transition-all duration-300 hover:scale-[1.02] hover:from-violet-700 hover:to-indigo-700"
                    size="sm"
                >
                    <Video className="size-4" />
                    {t('newVideoButton')}
                </Button>
            </div>

            <ScrollArea className="flex-1">
                <div className="space-y-1 p-2">
                    {isLoadingHistory ? (
                        <div className="flex items-center justify-center py-12">
                            <CircleNotch className="size-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : history.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                            <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted/50">
                                <Video className="size-5 text-muted-foreground/50" />
                            </div>
                            <p className="text-sm font-medium text-foreground">
                                {t('empty.title')}
                            </p>
                            <p className="mt-1 max-w-36 text-xs text-muted-foreground">
                                {t('empty.subtitle')}
                            </p>
                        </div>
                    ) : (
                        history.map((item) => (
                            <div
                                key={item.video_id}
                                className={`group relative cursor-pointer rounded-lg border p-3 transition-all duration-200 ${
                                    selectedId === item.video_id
                                        ? 'border-violet-200 bg-violet-50 shadow-sm dark:border-violet-800/30 dark:bg-violet-950/20'
                                        : 'border-transparent bg-transparent hover:border-border/50 hover:bg-muted/50'
                                }`}
                                onClick={() => onSelect(item)}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="mt-0.5 shrink-0">
                                        {getStatusIcon(item.status)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p
                                            className={`line-clamp-2 pr-7 text-sm font-medium leading-tight ${
                                                selectedId === item.video_id
                                                    ? 'text-violet-900 dark:text-violet-100'
                                                    : 'text-foreground'
                                            }`}
                                        >
                                            {item.prompt}
                                        </p>
                                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                            <span className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                                                <Clock className="size-3" />
                                                {formatDate(item.created_at)}
                                            </span>
                                            {item.options?.model && (
                                                <span className="rounded-sm border px-1.5 py-0.5 text-2xs text-muted-foreground">
                                                    {item.options.model.split('-')[0]}
                                                </span>
                                            )}
                                            {item.status === 'completed' &&
                                                item.token_usage?.estimated_cost_usd != null && (
                                                    <span className="rounded-sm bg-emerald-50 px-1.5 py-0.5 text-2xs text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                                                        {formatCredits(
                                                            usdToCredits(
                                                                item.token_usage.estimated_cost_usd,
                                                                ratio
                                                            ),
                                                            { t }
                                                        )}
                                                    </span>
                                                )}
                                        </div>
                                        {item.status === 'failed' && onRetry && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="mt-2 h-6 gap-1 px-2 text-2xs text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRetry(item.video_id);
                                                }}
                                            >
                                                <ArrowsClockwise className="size-3" />
                                                {t('item.retry')}
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-2 top-2 size-6 opacity-0 transition-all duration-200 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <Trash className="size-3.5" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>
                                                {t('deleteDialog.title')}
                                            </AlertDialogTitle>
                                            <AlertDialogDescription>
                                                {t('deleteDialog.description', {
                                                    name:
                                                        item.prompt.length > 30
                                                            ? item.prompt.substring(0, 30) + '...'
                                                            : item.prompt,
                                                })}
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>
                                                {t('deleteDialog.cancel')}
                                            </AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() => {
                                                    onDelete(item.video_id);
                                                }}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                {t('deleteDialog.confirm')}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        ))
                    )}
                </div>
            </ScrollArea>

            {/* Pagination buttons */}
            {onPageChange && totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-3 py-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={currentPage === 0 || isLoadingHistory}
                        onClick={() => onPageChange(currentPage - 1)}
                    >
                        <CaretLeft className="size-3.5" />
                        {t('pagination.prev')}
                    </Button>
                    <span className="text-2xs text-muted-foreground">
                        {t('pagination.pageIndicator', {
                            current: currentPage + 1,
                            total: totalPages,
                        })}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 px-2 text-xs"
                        disabled={currentPage >= totalPages - 1 || isLoadingHistory}
                        onClick={() => onPageChange(currentPage + 1)}
                    >
                        {t('pagination.next')}
                        <CaretRight className="size-3.5" />
                    </Button>
                </div>
            )}
        </div>
    );
}
