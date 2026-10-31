import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { toast } from 'sonner';
import { Plus, DotsSixVertical, Trash, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import {
    useLeadTiers,
    saveLeadTiers,
    deleteLeadTier,
    LEAD_TIERS_QUERY_KEY,
    tierChipStyle,
    type LeadTierDraft,
} from '@/hooks/use-lead-tiers';
import { useLeadTerminology } from '@/hooks/use-lead-terminology';

const DEFAULT_TIER_COLOR = '#6366f1';

/**
 * Table-backed Lead Tiers editor. Loads the institute's tiers (Hot / Warm / Cold seeded),
 * lets the admin add / rename / recolour / reorder / band / delete, and persists in one Save via
 * the lead-tier CRUD endpoints.
 *
 * A tier with a "from score" is auto-derived from the lead score (highest band <= score wins);
 * leave it blank for a manual-only tier that counsellors pick by hand. Seeded defaults can be
 * renamed and re-banded but not deleted, so leads that already carry HOT/WARM/COLD still resolve.
 */
export default function LeadTiersManager() {
    const { t } = useTranslation('settingsLeadTiersManager');
    const queryClient = useQueryClient();
    const { tiers, isLoading } = useLeadTiers();
    const terminology = useLeadTerminology();

    const [rows, setRows] = useState<LeadTierDraft[]>([]);
    const [hasChanges, setHasChanges] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        setRows(
            tiers.map((tier) => ({
                id: tier.id,
                tier_key: tier.tier_key,
                label: tier.label,
                color: tier.color,
                display_order: tier.display_order,
                min_score: tier.min_score,
                is_system: tier.is_system,
            }))
        );
        setHasChanges(false);
    }, [tiers]);

    const update = (i: number, patch: Partial<LeadTierDraft>) => {
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
        setHasChanges(true);
    };
    const add = () => {
        setRows((prev) => [
            ...prev,
            {
                label: '',
                color: DEFAULT_TIER_COLOR,
                display_order: prev.length + 1,
                min_score: null,
            },
        ]);
        setHasChanges(true);
    };
    const move = (i: number, dir: -1 | 1) => {
        setRows((prev) => {
            const j = i + dir;
            if (j < 0 || j >= prev.length) return prev;
            const next = prev.slice();
            [next[i], next[j]] = [next[j]!, next[i]!];
            return next;
        });
        setHasChanges(true);
    };
    // Unsaved rows just drop out of the list; persisted custom tiers are soft-deleted on the
    // server so leads that carry the key keep resolving to its (now inactive) label.
    const remove = async (i: number) => {
        const row = rows[i];
        if (!row) return;
        if (!row.id) {
            setRows((prev) => prev.filter((_, idx) => idx !== i));
            setHasChanges(true);
            return;
        }
        setDeletingId(row.id);
        try {
            await deleteLeadTier(row.id);
            await queryClient.invalidateQueries({ queryKey: LEAD_TIERS_QUERY_KEY });
            toast.success(t('toasts.deleteSuccess', { name: row.label }));
        } catch {
            toast.error(t('toasts.deleteError'));
        } finally {
            setDeletingId(null);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveLeadTiers(rows);
            await queryClient.invalidateQueries({ queryKey: LEAD_TIERS_QUERY_KEY });
            toast.success(t('toasts.saveSuccess'));
            setHasChanges(false);
        } catch {
            toast.error(t('toasts.saveError'));
        } finally {
            setSaving(false);
        }
    };

    const bandedCount = rows.filter((r) => r.min_score != null).length;

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t('title', { tier: terminology.tier })}</CardTitle>
                <CardDescription>{t('description', { tier: terminology.tier })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading ? (
                    <p className="text-sm text-muted-foreground">{t('loading')}</p>
                ) : (
                    <>
                        {/* Live preview */}
                        {rows.some((r) => r.label.trim()) && (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
                                {rows
                                    .filter((r) => r.label.trim())
                                    .map((r, i) => (
                                        <span
                                            key={i}
                                            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                                            // Inline style: tier colour is arbitrary user-picked hex.
                                            style={tierChipStyle(r.color || DEFAULT_TIER_COLOR)}
                                        >
                                            <span
                                                className="size-1.5 rounded-full"
                                                style={{ backgroundColor: r.color }}
                                            />
                                            {r.label}
                                            <span className="opacity-60">
                                                {r.min_score != null
                                                    ? t('preview.fromScore', { score: r.min_score })
                                                    : t('preview.manual')}
                                            </span>
                                        </span>
                                    ))}
                            </div>
                        )}

                        {/* Editable rows */}
                        <div className="divide-y divide-neutral-100 overflow-hidden rounded-lg border border-neutral-200">
                            {rows.length === 0 && (
                                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                                    {t('empty')}
                                </p>
                            )}
                            {rows.map((r, i) => (
                                <div
                                    key={r.id ?? `new-${i}`}
                                    className="flex items-center gap-3 bg-white px-3 py-2.5 transition-colors hover:bg-neutral-50"
                                >
                                    <DotsSixVertical className="size-4 shrink-0 text-neutral-300" />

                                    {/* Colour swatch */}
                                    <label
                                        className="relative size-7 shrink-0 cursor-pointer rounded-md border border-neutral-200 shadow-sm transition-transform hover:scale-105"
                                        // Inline style: arbitrary user-picked tier colour.
                                        style={{ backgroundColor: r.color || DEFAULT_TIER_COLOR }}
                                        title={t('row.changeColorTitle')}
                                    >
                                        <input
                                            type="color"
                                            value={r.color || DEFAULT_TIER_COLOR}
                                            onChange={(e) => update(i, { color: e.target.value })}
                                            className="absolute inset-0 size-full cursor-pointer opacity-0"
                                            aria-label={t('row.colorAriaLabel', {
                                                name: r.label || t('row.tierFallback'),
                                            })}
                                        />
                                    </label>

                                    <Input
                                        placeholder={t('row.namePlaceholder')}
                                        value={r.label}
                                        onChange={(e) => update(i, { label: e.target.value })}
                                        className="h-9 flex-1 border-transparent bg-transparent shadow-none focus-visible:border-input focus-visible:bg-white"
                                    />

                                    {/* Score band lower bound; blank = manual-only tier */}
                                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500">
                                        {t('row.fromScore')}
                                        <Input
                                            type="number"
                                            min={0}
                                            max={100}
                                            inputMode="numeric"
                                            placeholder={t('row.manualPlaceholder')}
                                            value={r.min_score ?? ''}
                                            onChange={(e) => {
                                                const v = e.target.value.trim();
                                                if (v === '') {
                                                    update(i, { min_score: null });
                                                    return;
                                                }
                                                const n = Math.max(0, Math.min(100, Number(v)));
                                                update(i, {
                                                    min_score: Number.isFinite(n) ? n : null,
                                                });
                                            }}
                                            className="h-8 w-20 text-xs"
                                            aria-label={t('row.fromScoreAriaLabel', {
                                                name: r.label || t('row.tierFallback'),
                                            })}
                                        />
                                    </label>

                                    <div className="flex shrink-0 items-center">
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            aria-label={t('row.moveUp')}
                                            onClick={() => move(i, -1)}
                                            disable={i === 0}
                                            className="!text-neutral-400"
                                        >
                                            <ArrowUp className="size-4" />
                                        </MyButton>
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            aria-label={t('row.moveDown')}
                                            onClick={() => move(i, 1)}
                                            disable={i === rows.length - 1}
                                            className="!text-neutral-400"
                                        >
                                            <ArrowDown className="size-4" />
                                        </MyButton>
                                    </div>

                                    {r.is_system ? (
                                        <span
                                            className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500"
                                            title={t('row.systemDefaultTitle')}
                                        >
                                            {t('row.systemDefaultBadge')}
                                        </span>
                                    ) : (
                                        <MyButton
                                            buttonType="text"
                                            layoutVariant="icon"
                                            scale="small"
                                            aria-label={t('row.deleteAriaLabel', {
                                                name: r.label || t('row.tierFallback'),
                                            })}
                                            onClick={() => void remove(i)}
                                            // Deleting a saved row refetches the catalog, which
                                            // would overwrite unsaved edits on the other rows.
                                            disable={deletingId === r.id || (hasChanges && !!r.id)}
                                            title={
                                                hasChanges && r.id
                                                    ? t('row.saveBeforeDelete')
                                                    : t('row.deleteAriaLabel', {
                                                          name: r.label || t('row.tierFallback'),
                                                      })
                                            }
                                            className="shrink-0 !text-neutral-300 hover:!text-danger-500"
                                        >
                                            <Trash className="size-4" />
                                        </MyButton>
                                    )}
                                </div>
                            ))}
                        </div>

                        <MyButton
                            buttonType="secondary"
                            onClick={add}
                            className="w-full border-dashed"
                        >
                            <span className="flex items-center gap-2">
                                <Plus className="size-4" />
                                {t('addTier', { tier: terminology.tier })}
                            </span>
                        </MyButton>

                        <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
                            <span className="text-xs text-muted-foreground">
                                {bandedCount > 0 ? t('footer.hintBanded') : t('footer.hintManual')}
                            </span>
                            <MyButton
                                buttonType="primary"
                                scale="medium"
                                onClick={handleSave}
                                disable={saving || !hasChanges}
                            >
                                {saving ? t('footer.saving') : t('footer.save')}
                            </MyButton>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
