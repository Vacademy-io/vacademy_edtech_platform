import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ManagerPinDialog } from '@/routes/commerce/-components/ManagerPinDialog';
import type { ManagerApproval } from '@/routes/commerce/-shared/commerce-types';
import { useAttemptStore } from '@/routes/commerce/pos/-shared/pos-session-store';
import { probablySaved, readInventoryError } from '../-shared/inventory-errors';
import { useStockApprovers } from '../-shared/inventory-hooks';

interface PendingPin {
    locationId: string;
    description: string | null;
    resend: (approval: ManagerApproval) => Promise<void>;
}

export interface InventoryWrite<R> {
    /** Which write this is ("receipt", "dispatch:<id>"): one request id per scope. */
    scope: string;
    /** The body WITHOUT `client_request_id` and approval: the id follows it. */
    body: unknown;
    /** Sends the request with the id (and, after a PIN, the approval). */
    send: (clientRequestId: string, approval?: ManagerApproval) => Promise<R>;
    /** Runs with the server's answer (straight away, or after the manager's PIN). */
    onDone: (answer: R) => void;
    /** Where the PIN is asked for: the managers of this place are listed. */
    approvalAt?: string | null;
    /** What the manager approves, in the screen's words. */
    approvalText?: string;
}

/**
 * Every inventory write goes through here (the counter's pattern, contract
 * §3.7 "Idempotency"):
 *  - one `client_request_id` per scope, kept while the body is the same AND
 *    while an earlier send of that scope has no definite answer (timeout,
 *    5xx, offline), whatever the body is now: a double tap or a retry can
 *    never save twice;
 *  - `403 APPROVAL_REQUIRED` opens the manager PIN dialog with the approvers
 *    of the place, and the same body goes again with the same id and the
 *    approval; a wrong PIN keeps the dialog open;
 *  - when an unanswered id turns out to be saved under another body
 *    (`IDEMPOTENCY_MISMATCH` after a carried id), the person is told it was
 *    probably saved instead of being asked to send again.
 * Failures other than the PIN step are thrown as an `InventoryError`; a
 * failed resend from the PIN dialog throws the server's error to the dialog,
 * which shows its sentence and stays open.
 */
export function useInventoryWrite(prefix = 'inv') {
    const { t } = useTranslation('commerce');
    const store = useAttemptStore('', null, prefix);
    const [pin, setPin] = useState<PendingPin | null>(null);
    const approvers = useStockApprovers(pin?.locationId ?? null, !!pin);

    const run = useCallback(
        async <R,>(write: InventoryWrite<R>): Promise<void> => {
            const once = async (approval?: ManagerApproval): Promise<void> => {
                const { id, carried } = store.begin(write.scope, write.body);
                try {
                    const answer = await write.send(id, approval);
                    store.settle(write.scope, null, carried);
                    write.onDone(answer);
                } catch (raw) {
                    const read = readInventoryError(raw);
                    if (store.settle(write.scope, read, carried)) throw probablySaved(read);
                    // The raw error: the PIN dialog reads the server's sentence from it.
                    throw raw;
                }
            };
            try {
                await once();
            } catch (raw) {
                const read = readInventoryError(raw);
                if (read.code === 'APPROVAL_REQUIRED' && write.approvalAt) {
                    setPin({
                        locationId: write.approvalAt,
                        description: write.approvalText ?? null,
                        resend: (approval) => once(approval),
                    });
                    return;
                }
                throw read;
            }
        },
        [store]
    );

    const dialog = (
        <ManagerPinDialog
            open={!!pin && !approvers.isLoading}
            onOpenChange={(open) => {
                if (!open) setPin(null);
            }}
            heading={t('inventory.approval.title')}
            description={
                approvers.isError ? t('inventory.approval.managersFailed') : (pin?.description ?? t('inventory.approval.generic'))
            }
            managers={approvers.data ?? []}
            onApprove={async (approval) => {
                if (pin) await pin.resend(approval);
            }}
        />
    );

    return { run, dialog, pinOpen: !!pin, attempts: store };
}
