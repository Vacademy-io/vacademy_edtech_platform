import { useTranslation } from 'react-i18next';
import { ChartBar, Warning } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/formatters';
import type { LimitsPreview, PreviewBreakdownRow } from '../../-services/ai-limits-service';
import { prettyKey } from './limit-labels';

const TOP_N = 8;

function Stat({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: 'danger' | 'warning';
}) {
    return (
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2">
            <div className="text-caption text-neutral-500">{label}</div>
            <div
                className={cn(
                    'text-h3 font-semibold',
                    tone === 'danger' && value > 0
                        ? 'text-danger-600'
                        : tone === 'warning' && value > 0
                          ? 'text-warning-600'
                          : 'text-neutral-800'
                )}
            >
                {formatNumber(value)}
            </div>
        </div>
    );
}

function Breakdown({ title, rows }: { title: string; rows: PreviewBreakdownRow[] }) {
    const { t } = useTranslation('settingsAiLimits');
    const top = rows
        .filter((r) => r.would_block > 0 || r.would_warn > 0)
        .sort((a, b) => b.would_block - a.would_block || b.would_warn - a.would_warn)
        .slice(0, TOP_N);
    if (!top.length) return null;
    return (
        <div className="space-y-1">
            <div className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                {title}
            </div>
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white">
                {top.map((r) => (
                    <li
                        key={r.key || r.label}
                        className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm"
                    >
                        <span className="truncate text-neutral-700" title={r.label}>
                            {r.label === r.key ? prettyKey(r.label) : r.label}
                        </span>
                        <span className="flex shrink-0 items-center gap-3 text-caption">
                            <span className="text-danger-600">
                                {t('preview.blockedCount', { count: r.would_block })}
                            </span>
                            <span className="text-warning-600">
                                {t('preview.warnedCount', { count: r.would_warn })}
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

interface Props {
    preview: LimitsPreview | null;
    isLoading: boolean;
    error: string | null;
}

/** The "Preview impact" result: what the last 30 days would have looked like. */
export function LimitPreviewPanel({ preview, isLoading, error }: Props) {
    const { t } = useTranslation('settingsAiLimits');

    if (isLoading) {
        return (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
                {t('preview.loading')}
            </div>
        );
    }
    if (error) {
        return (
            <div className="flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
                <Warning className="mt-0.5 size-4 shrink-0" />
                <span>{t('preview.failed', { error })}</span>
            </div>
        );
    }
    if (!preview) return null;

    const nothing = preview.would_block === 0 && preview.would_warn === 0;

    return (
        <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                <ChartBar className="size-4 text-primary-500" />
                {t('preview.heading')}
            </div>
            <p className="text-caption text-neutral-500">
                {t('preview.explainer', { count: preview.events_considered })}
                {preview.truncated && <span className="block">{t('preview.truncated')}</span>}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label={t('preview.stats.events')} value={preview.events_considered} />
                <Stat
                    label={t('preview.stats.wouldBlock')}
                    value={preview.would_block}
                    tone="danger"
                />
                <Stat
                    label={t('preview.stats.wouldWarn')}
                    value={preview.would_warn}
                    tone="warning"
                />
                <Stat
                    label={t('preview.stats.users')}
                    value={preview.affected_users}
                    tone="danger"
                />
            </div>
            {nothing ? (
                <p className="text-sm text-success-700">{t('preview.noImpact')}</p>
            ) : (
                <div className="grid gap-3 md:grid-cols-2">
                    <Breakdown title={t('preview.byUser')} rows={preview.by_user} />
                    <Breakdown title={t('preview.byUseCase')} rows={preview.by_use_case} />
                </div>
            )}
        </div>
    );
}
