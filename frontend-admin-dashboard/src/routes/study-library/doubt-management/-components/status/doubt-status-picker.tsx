import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CaretDown, Check, Plus } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { Doubt } from '@/routes/study-library/courses/course-details/subjects/modules/chapters/slides/-types/get-doubts-type';
import { effectiveStatusKey, useDoubtStatuses } from '../../-services/use-doubt-statuses';
import { useUpdateDoubt } from '../../-services/use-update-doubt';
import { DoubtStatusChip } from '../doubt-status-chip';
import { AddStatusDialog } from './add-status-dialog';
import { isUserAdmin } from '@/utils/userDetails';

/**
 * Status control for staff: the current status as a chip that opens a popover listing the
 * institute's configurable statuses, plus an optional remark that is recorded on the change.
 * Replaces the old Resolved on/off switch in the conversation header — "Resolved" is just the
 * last status in the list.
 */
export const DoubtStatusPicker = ({
    doubt,
    refetch,
    canChange,
}: {
    doubt: Doubt;
    refetch?: () => void;
    canChange: boolean;
}) => {
    const { t } = useTranslation('studyLibraryDoubtStatus');
    const { enabledStatuses, byKey } = useDoubtStatuses();
    const update = useUpdateDoubt();
    const currentKey = effectiveStatusKey(doubt);

    const [open, setOpen] = useState(false);
    const [picked, setPicked] = useState(currentKey);
    const [remark, setRemark] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const isAdmin = isUserAdmin();
    // A status created from inside the picker: the popover closes behind the dialog, so we
    // re-open it afterwards with the new status pre-selected instead of the current one.
    const pendingPickRef = useRef<string | null>(null);

    // Re-sync the draft whenever the popover opens on a (possibly refetched) doubt.
    useEffect(() => {
        if (open) {
            setPicked(pendingPickRef.current ?? currentKey);
            pendingPickRef.current = null;
            setRemark('');
        }
    }, [open, currentKey]);

    if (!canChange) return <DoubtStatusChip doubt={doubt} />;

    const changed = picked !== currentKey;
    const canSubmit = changed || remark.trim().length > 0;

    const submit = async () => {
        const target = byKey(picked);
        try {
            await update.mutateAsync({
                doubt,
                patch: {
                    workflowStatus: changed ? picked : undefined,
                    // Kind-derived coarse status so the optimistic/board views agree immediately.
                    status:
                        changed && target
                            ? target.kind === 'RESOLVED'
                                ? 'RESOLVED'
                                : 'ACTIVE'
                            : undefined,
                    remark: remark.trim() || undefined,
                },
            });
            toast.success(
                changed
                    ? t('toast.moved', { label: target?.label ?? picked })
                    : t('toast.remarkAdded')
            );
            setOpen(false);
            refetch?.();
        } catch {
            toast.error(t('toast.updateFailed'));
        }
    };

    return (
        <>
            <AddStatusDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                onCreated={(created) => {
                    pendingPickRef.current = created.key;
                    setOpen(true);
                }}
            />
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        aria-label={t('changeStatus')}
                        className="inline-flex items-center gap-1 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                    >
                        <DoubtStatusChip doubt={doubt} />
                        <CaretDown size={12} className="text-neutral-500" aria-hidden />
                    </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {t('changeStatus')}
                    </p>
                    <div role="radiogroup" aria-label={t('changeStatus')} className="space-y-0.5">
                        {enabledStatuses.map((s) => {
                            const active = s.key === picked;
                            return (
                                <button
                                    key={s.key}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    onClick={() => setPicked(s.key)}
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                                        active
                                            ? 'bg-primary-50 text-primary-700'
                                            : 'text-neutral-700 hover:bg-neutral-50'
                                    )}
                                >
                                    <span
                                        aria-hidden
                                        className={cn(
                                            'size-2 shrink-0 rounded-full',
                                            !s.color &&
                                                (s.kind === 'RESOLVED'
                                                    ? 'bg-success-500'
                                                    : s.kind === 'IN_PROGRESS'
                                                      ? 'bg-info-500'
                                                      : 'bg-warning-500')
                                        )}
                                        style={s.color ? { backgroundColor: s.color } : undefined} // design-lint-ignore: admin-picked status colour has no token
                                    />
                                    <span className="min-w-0 flex-1 truncate">{s.label}</span>
                                    {s.key === currentKey && (
                                        <span className="shrink-0 text-caption text-neutral-400">
                                            {t('current')}
                                        </span>
                                    )}
                                    {active && <Check size={14} weight="bold" aria-hidden />}
                                </button>
                            );
                        })}
                    </div>
                    {isAdmin && (
                        <button
                            type="button"
                            onClick={() => setAddOpen(true)}
                            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-primary-600 hover:bg-primary-50"
                        >
                            <Plus size={14} weight="bold" aria-hidden />
                            {t('addStatus.newStatus')}
                        </button>
                    )}
                    <label className="mt-3 block">
                        <span className="mb-1 block text-xs font-medium text-neutral-600">
                            {t('remarkLabel')}
                        </span>
                        <Textarea
                            value={remark}
                            onChange={(e) => setRemark(e.target.value)}
                            placeholder={t('remarkPlaceholder')}
                            rows={2}
                            className="min-h-0 text-sm"
                        />
                    </label>
                    <div className="mt-3 flex justify-end gap-2">
                        <MyButton buttonType="text" scale="small" onClick={() => setOpen(false)}>
                            {t('cancel')}
                        </MyButton>
                        <MyButton
                            buttonType="primary"
                            scale="small"
                            disable={!canSubmit || update.isPending}
                            onAsyncClick={submit}
                            loadingText={t('saving')}
                        >
                            {changed
                                ? t('moveTo', { label: byKey(picked)?.label ?? picked })
                                : t('addRemark')}
                        </MyButton>
                    </div>
                </PopoverContent>
            </Popover>
        </>
    );
};
