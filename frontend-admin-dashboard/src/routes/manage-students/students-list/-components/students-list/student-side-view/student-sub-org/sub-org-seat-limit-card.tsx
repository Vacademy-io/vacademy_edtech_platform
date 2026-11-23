import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Armchair } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { subOrgPermission } from '@/lib/display-settings/sub-org-module';
import {
    fetchSubOrgSeatUsage,
    SubOrgSeatUsage,
    updateSubOrgSeatLimit,
} from '@/routes/manage-students/students-list/-services/sub-org-service';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { OtherTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { ProfileSectionCard } from '../profile-ui';

/**
 * Seat limit of the sub-org for the picked batch: used / total, the same numbers
 * add-member enforces. Staff who may edit sub-org config can raise the limit here.
 * Renders nothing when seat usage can't be read (e.g. staff without sub-org access).
 */
export const SubOrgSeatLimitCard = ({
    subOrgId,
    packageSessionId,
}: {
    subOrgId: string;
    packageSessionId: string;
}) => {
    const { t } = useTranslation('manageStudentsSubOrg');
    const canEdit = subOrgPermission('canEditConfig');
    const [usage, setUsage] = useState<SubOrgSeatUsage | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!subOrgId || !packageSessionId) return;
        setLoadFailed(false);
        try {
            setUsage(await fetchSubOrgSeatUsage(subOrgId, packageSessionId));
        } catch (error) {
            console.error(error);
            setUsage(null);
            setLoadFailed(true);
        }
    }, [subOrgId, packageSessionId]);

    useEffect(() => {
        setEditing(false);
        load();
    }, [load]);

    if (loadFailed || !usage) return null;

    const used = usage.used_seats;
    const total = usage.total_seats;
    const hasLimit = total != null;
    const pct = hasLimit && total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    const isFull = hasLimit && used >= total;
    const tone = isFull ? 'danger' : pct >= 90 ? 'warning' : 'primary';

    const startEdit = () => {
        setDraft(String((total ?? 0) + 1));
        setEditing(true);
    };

    const save = async () => {
        const next = Number(draft);
        if (!Number.isInteger(next) || next <= 0) {
            toast.error(t('seats.toast.invalid'));
            return;
        }
        if (hasLimit && next <= total) {
            toast.error(t('seats.toast.mustIncrease', { current: total }));
            return;
        }
        setSaving(true);
        try {
            await updateSubOrgSeatLimit(subOrgId, next);
            toast.success(t('seats.toast.updated', { count: next }));
            setEditing(false);
            await load();
        } catch (error) {
            console.error(error);
            const err = error as { response?: { data?: { ex?: string; message?: string } } };
            toast.error(
                err?.response?.data?.ex || err?.response?.data?.message || t('seats.toast.failed')
            );
        } finally {
            setSaving(false);
        }
    };

    const action =
        canEdit && hasLimit && !editing ? (
            <MyButton buttonType="secondary" scale="small" onClick={startEdit}>
                {t('seats.increase')}
            </MyButton>
        ) : null;

    return (
        <ProfileSectionCard icon={Armchair} heading={t('seats.heading')} action={action}>
            <div className="flex flex-col gap-2 pt-1">
                <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm text-neutral-700">
                        <span
                            className={cn(
                                'text-lg font-semibold',
                                tone === 'danger'
                                    ? 'text-danger-600'
                                    : tone === 'warning'
                                      ? 'text-warning-600'
                                      : 'text-neutral-800'
                            )}
                        >
                            {used}
                        </span>
                        {hasLimit ? (
                            <span className="text-neutral-500"> / {total}</span>
                        ) : null}{' '}
                        <span className="text-xs text-neutral-500">{t('seats.used')}</span>
                    </p>
                    {hasLimit ? (
                        <span
                            className={cn(
                                'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
                                isFull
                                    ? 'bg-danger-50 text-danger-700 ring-danger-200'
                                    : 'bg-success-50 text-success-700 ring-success-200'
                            )}
                        >
                            {isFull
                                ? t('seats.full')
                                : t('seats.left', { count: Math.max(0, total - used) })}
                        </span>
                    ) : (
                        <span className="inline-flex shrink-0 items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ring-1 ring-neutral-200">
                            {t('seats.noLimit')}
                        </span>
                    )}
                </div>

                {hasLimit && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div
                            className={cn(
                                'h-full rounded-full transition-all',
                                tone === 'danger'
                                    ? 'bg-danger-500'
                                    : tone === 'warning'
                                      ? 'bg-warning-500'
                                      : 'bg-primary-500'
                            )}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                )}

                {editing && (
                    <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-100 bg-neutral-50 p-2">
                        <label className="text-xs font-medium text-neutral-600">
                            {t('seats.newLimitLabel')}
                        </label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="number"
                                min={(total ?? 0) + 1}
                                step={1}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                className="h-8 w-28"
                                disabled={saving}
                                autoFocus
                            />
                            <MyButton
                                buttonType="primary"
                                scale="small"
                                onClick={save}
                                disable={saving}
                            >
                                {saving ? t('seats.saving') : t('seats.save')}
                            </MyButton>
                            <MyButton
                                buttonType="secondary"
                                scale="small"
                                onClick={() => setEditing(false)}
                                disable={saving}
                            >
                                {t('seats.cancel')}
                            </MyButton>
                        </div>
                        <p className="text-xs text-neutral-400">{t('seats.appliesToEachBatch', {
                                term: getTerminology(
                                    OtherTerms.SubOrg,
                                    SystemTerms.SubOrg
                                ).toLowerCase(),
                            })}</p>
                    </div>
                )}
            </div>
        </ProfileSectionCard>
    );
};
