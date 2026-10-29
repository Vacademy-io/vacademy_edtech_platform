import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowsClockwise, Info, Lightning } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SectionCard } from '@/routes/study-library/live-session/-components/dashboard/dashboard-charts';
import { cn } from '@/lib/utils';
import { Chip, IconTile } from './engine-ui';
import { CRM_ACTION_ICON, CRM_ACTION_TINT } from './crm-action-ui';
import { useEngineActions, useSaveEngineActions } from '../-hooks/actions';
import type { CrmActionSetting } from '../-types/actions';

/**
 * B8: which CRM actions this engine may propose (follow-ups, notes, escalations, status changes,
 * AI calls), and which may run on their own once a person has approved enough of that type.
 * Every action starts as an inbox task; the kill switch stops all autonomous actions.
 */
export function CrmActionsPanel({ engineId, killed }: { engineId: string; killed?: boolean }) {
    const { t } = useTranslation('engagementEnginesActions');
    const { data, isLoading, isError, refetch } = useEngineActions(engineId);
    const save = useSaveEngineActions(engineId);
    const [rows, setRows] = useState<CrmActionSetting[]>([]);

    useEffect(() => {
        if (data) setRows(data);
    }, [data]);

    const update = (type: CrmActionSetting['type'], patch: Partial<CrmActionSetting>) => {
        const prev = rows;
        const next = rows.map((r) => {
            if (r.type !== type) return r;
            const merged = { ...r, ...patch };
            // Running on its own needs the action to be allowed at all.
            return merged.allowed ? merged : { ...merged, auto: false };
        });
        setRows(next);
        // On failure go back to what was shown just before this change (the hook toasts the error).
        save.mutate(next, { onError: () => setRows(prev) });
    };

    const allowedCount = rows.filter((r) => r.allowed).length;

    return (
        <SectionCard
            title={t('panel.title')}
            subtitle={t('panel.subtitle', { count: allowedCount })}
            icon={Lightning}
        >
            {isLoading && (
                <div className="flex flex-col gap-2">
                    {[0, 1, 2].map((i) => (
                        <Skeleton key={i} className="h-16 w-full rounded-lg" />
                    ))}
                </div>
            )}
            {isError && (
                <div className="flex flex-col items-center gap-3 p-4 text-center">
                    <span className="text-body text-danger-600">{t('panel.loadFailed')}</span>
                    <MyButton buttonType="secondary" scale="small" onClick={() => refetch()}>
                        <ArrowsClockwise className="me-1 size-4" /> {t('panel.retry')}
                    </MyButton>
                </div>
            )}
            {!isLoading && !isError && rows.length === 0 && (
                <p className="flex flex-col items-center gap-2 p-4 text-center text-neutral-500">
                    <Lightning className="size-8 text-neutral-300" aria-hidden />
                    <span className="text-body">{t('panel.empty')}</span>
                </p>
            )}
            {!isLoading && !isError && rows.length > 0 && (
                <div className="flex flex-col gap-3">
                    <ul className="flex flex-col divide-y divide-neutral-100">
                        {rows.map((r) => (
                            <li key={r.type} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                    <IconTile icon={CRM_ACTION_ICON[r.type]} size="sm" tint={CRM_ACTION_TINT[r.type]} />
                                    <div className="min-w-0">
                                        <p className="font-semibold text-neutral-900">
                                            <span className="text-body">{t(`types.${r.type}.label`)}</span>
                                        </p>
                                        <p className="text-neutral-500">
                                            <span className="text-caption">{t(`types.${r.type}.description`)}</span>
                                        </p>
                                        {r.allowed && r.auto && (
                                            <div className="mt-2 flex max-w-xs flex-col gap-1">
                                                <Progress
                                                    value={
                                                        r.threshold > 0
                                                            ? Math.min(100, (r.approved / r.threshold) * 100)
                                                            : 100
                                                    }
                                                    aria-label={t('panel.progress', {
                                                        approved: Math.min(r.approved, r.threshold),
                                                        threshold: r.threshold,
                                                    })}
                                                />
                                                <span className="text-caption text-neutral-500">
                                                    {r.graduated
                                                        ? t('panel.graduated')
                                                        : t('panel.progress', {
                                                              approved: r.approved,
                                                              threshold: r.threshold,
                                                          })}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-4 ps-11 sm:ps-0">
                                    <label className="flex items-center gap-2">
                                        <Switch
                                            checked={r.allowed}
                                            disabled={save.isPending}
                                            onCheckedChange={(v) => update(r.type, { allowed: v })}
                                            aria-label={t('panel.allowedFor', { action: t(`types.${r.type}.label`) })}
                                        />
                                        <span className="text-caption text-neutral-700">{t('panel.allowed')}</span>
                                    </label>
                                    <label
                                        className="flex items-center gap-2"
                                        title={r.allowed ? undefined : t('panel.autoNeedsAllowed')}
                                    >
                                        <Switch
                                            checked={r.auto}
                                            disabled={save.isPending || !r.allowed}
                                            onCheckedChange={(v) => update(r.type, { auto: v })}
                                            aria-label={t('panel.autoFor', { action: t(`types.${r.type}.label`) })}
                                            aria-describedby={r.allowed ? undefined : `auto-needs-${r.type}`}
                                        />
                                        <span
                                            className={cn(
                                                'text-caption',
                                                r.allowed ? 'text-neutral-700' : 'text-neutral-400'
                                            )}
                                        >
                                            {t('panel.auto')}
                                        </span>
                                        {!r.allowed && (
                                            <span id={`auto-needs-${r.type}`} className="sr-only">
                                                {t('panel.autoNeedsAllowed')}
                                            </span>
                                        )}
                                    </label>
                                    {r.allowed && r.auto && killed && (
                                        <Chip label={t('panel.paused')} className="bg-warning-50 text-warning-700" />
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                    <p className="flex items-start gap-2 text-neutral-500">
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                        <span className="text-caption">{t('panel.footnote')}</span>
                    </p>
                </div>
            )}
        </SectionCard>
    );
}
