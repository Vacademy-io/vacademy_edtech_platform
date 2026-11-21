import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '../../-components/ConfirmDialog';

/**
 * Above the inbox list: tick every approval and ready message on the page, widen that to every page,
 * and run what is selected. CRM actions are approved (an AI call reaches the lead) and messages are
 * sent as drafted, so the run is confirmed first.
 */
export function BulkApproveBar({
    selectedCount,
    allOnPageSelected,
    canTogglePage,
    canSelectAllPages,
    selectableTotal,
    hasApprovals,
    hasSends,
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
    /** The list runs past this page and everything on it can be fetched. */
    canSelectAllPages: boolean;
    /** How many tasks every page holds, when that is known exactly; undefined otherwise. */
    selectableTotal?: number;
    /** The selection holds CRM actions to approve. */
    hasApprovals: boolean;
    /** The selection holds messages to send. */
    hasSends: boolean;
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
        allOnPageSelected &&
        canSelectAllPages &&
        (selectableTotal === undefined || selectableTotal > selectedCount);
    // Only approvals keep the original wording; any message in the selection means sending.
    const mode = !hasSends ? 'approve' : hasApprovals ? 'mixed' : 'send';
    const actLabel = t(
        mode === 'approve' ? 'bulk.approve' : mode === 'send' ? 'bulk.send' : 'bulk.approveAndSend',
        { count: selectedCount }
    );
    const confirmTitle = t(
        mode === 'approve'
            ? 'bulk.confirmTitle'
            : mode === 'send'
              ? 'bulk.confirmTitleSend'
              : 'bulk.confirmTitleMixed',
        { count: selectedCount }
    );
    const confirmText = [
        hasApprovals || !hasSends ? t('bulk.confirmText') : null,
        hasSends ? t('bulk.confirmTextSend') : null,
    ]
        .filter(Boolean)
        .join(' ');

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
                            : selectableTotal !== undefined
                              ? t('bulk.selectAll', { count: selectableTotal })
                              : t('bulk.selectAllPages')}
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
                            ? t(mode === 'approve' ? 'bulk.approving' : 'bulk.working', {
                                  done: running.done,
                                  total: running.total,
                              })
                            : actLabel}
                    </MyButton>
                </div>
            )}
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={confirmTitle}
                description={confirmText}
                confirmLabel={actLabel}
                cancelLabel={t('actions.cancel')}
                onConfirm={onApprove}
            />
        </div>
    );
}
