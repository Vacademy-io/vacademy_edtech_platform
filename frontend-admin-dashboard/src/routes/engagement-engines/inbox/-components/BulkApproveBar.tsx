import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '../../-components/ConfirmDialog';

/**
 * Above the inbox list: tick every approval on the page, widen that to every page, and approve what
 * is selected. Approvals run for real (an AI call reaches the lead), so they are confirmed first.
 */
export function BulkApproveBar({
    selectedCount,
    allOnPageSelected,
    canTogglePage,
    selectableTotal,
    selectingAll,
    running,
    onTogglePage,
    onSelectAll,
    onClear,
    onApprove,
}: {
    selectedCount: number;
    allOnPageSelected: boolean;
    canTogglePage: boolean;
    /** Every approval across the pages, when that can be selected; undefined otherwise. */
    selectableTotal?: number;
    selectingAll: boolean;
    /** How far a run has got; null when none is going. */
    running: { done: number; total: number } | null;
    onTogglePage: (selected: boolean) => void;
    onSelectAll: () => void;
    onClear: () => void;
    onApprove: () => void;
}) {
    const { t } = useTranslation('engagementEnginesInboxIndex');
    const [confirming, setConfirming] = useState(false);
    const busy = !!running || selectingAll;
    const offerAll =
        allOnPageSelected && selectableTotal !== undefined && selectableTotal > selectedCount;

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
            <Checkbox
                checked={allOnPageSelected}
                disabled={busy || !canTogglePage}
                onCheckedChange={(v) => onTogglePage(v === true)}
                aria-label={t('bulk.selectPage')}
                title={t('bulk.selectPage')}
            />
            <span className="text-neutral-700">
                <span className="text-caption">
                    {selectedCount > 0
                        ? t('bulk.selected', { count: selectedCount })
                        : t('bulk.selectPage')}
                </span>
            </span>
            {offerAll && (
                <button
                    type="button"
                    disabled={busy}
                    onClick={onSelectAll}
                    className="font-semibold text-primary-500 hover:underline disabled:opacity-50"
                >
                    <span className="text-caption">
                        {selectingAll
                            ? t('bulk.selectingAll')
                            : t('bulk.selectAll', { count: selectableTotal })}
                    </span>
                </button>
            )}
            {selectedCount > 0 && (
                <div className="ms-auto flex items-center gap-2">
                    {!running && (
                        <MyButton
                            buttonType="text"
                            scale="small"
                            disable={selectingAll}
                            onClick={onClear}
                        >
                            {t('bulk.clear')}
                        </MyButton>
                    )}
                    <MyButton
                        buttonType="primary"
                        scale="small"
                        disable={busy}
                        onClick={() => setConfirming(true)}
                    >
                        <CheckCircle className="me-1 size-3.5" />
                        {running
                            ? t('bulk.approving', { done: running.done, total: running.total })
                            : t('bulk.approve', { count: selectedCount })}
                    </MyButton>
                </div>
            )}
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t('bulk.confirmTitle', { count: selectedCount })}
                description={t('bulk.confirmText')}
                confirmLabel={t('bulk.approve', { count: selectedCount })}
                cancelLabel={t('actions.cancel')}
                onConfirm={onApprove}
            />
        </div>
    );
}
