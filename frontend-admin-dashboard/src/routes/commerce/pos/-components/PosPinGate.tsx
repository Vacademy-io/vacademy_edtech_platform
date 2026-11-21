import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ManagerPinDialog } from '@/routes/commerce/-components/ManagerPinDialog';
import type { ManagerApproval } from '@/routes/commerce/-shared/commerce-types';
import { type PosError, readPosError } from '../-shared/pos-errors';
import { useApprovers } from '../-shared/pos-hooks';
import { type AttemptStore, useAttemptStore } from '../-shared/pos-session-store';
import { POS_APPROVAL_ACTIONS, type PosApprovalAction } from '../-shared/pos-types';

interface PendingApproval {
    action: PosApprovalAction | null;
    /** Sends the SAME request again with the approval; rejects to keep the dialog open. */
    run: (approval: ManagerApproval) => Promise<void>;
}

/**
 * The manager-PIN step of the counter (contract §3.4): the server answers
 * `APPROVAL_REQUIRED: <ACTION>`, the screen opens the PIN dialog with the
 * managers of this counter's location, and the same body goes again with
 * `approval` (and the same request id). A wrong PIN keeps the dialog open
 * with the server's sentence; the PIN is never stored.
 */
export function usePinGate(registerId: string | null) {
    const { t } = useTranslation('commerce');
    const [pending, setPending] = useState<PendingApproval | null>(null);
    const approvers = useApprovers(registerId, !!pending);

    const ask = useCallback(
        (action: PosApprovalAction | null, run: PendingApproval['run']) => setPending({ action, run }),
        []
    );

    const known = pending?.action && (POS_APPROVAL_ACTIONS as readonly string[]).includes(pending.action);
    const description = approvers.isError
        ? t('pos.approval.managersFailed')
        : known
          ? t(`pos.approval.${pending?.action}`)
          : t('pos.approval.generic');

    const dialog = (
        <ManagerPinDialog
            open={!!pending}
            onOpenChange={(open) => {
                if (!open) setPending(null);
            }}
            heading={t('pos.approval.title')}
            description={description}
            managers={approvers.data ?? []}
            onApprove={async (approval) => {
                if (pending) await pending.run(approval);
            }}
        />
    );

    return { ask, dialog, open: !!pending };
}

/**
 * A counter write that may need a manager's PIN: sends the body with a
 * request id from the attempt store; on `APPROVAL_REQUIRED` opens the PIN
 * dialog and sends the same body, same id, with the approval. Other failures
 * are thrown to the caller (shown inline). `onDone` runs with the answer.
 *
 * The id outlives the form: an attempt whose answer never came (timeout, 5xx)
 * keeps its id until the server answers for sure, even when the body changed
 * meanwhile. A store with a session id (`attempts`) keeps it across a reload
 * too. When that id turns out to be saved with another body the write was
 * most likely done already: the caller gets `PROBABLY_SAVED`.
 */
export function usePinWrite(registerId: string | null, prefix: string, attempts?: AttemptStore) {
    const gate = usePinGate(registerId);
    const local = useAttemptStore('', null, prefix);
    const store = attempts ?? local;
    const { ask } = gate;
    const run = useCallback(
        async <B extends object, R>(
            body: B,
            send: (full: B & { client_request_id: string; approval?: ManagerApproval }) => Promise<R>,
            onDone: (answer: R) => void,
            scope = 'default'
        ): Promise<void> => {
            const once = async (approval?: ManagerApproval): Promise<void> => {
                const { id, carried } = store.begin(scope, body);
                try {
                    const answer = await send({ ...body, client_request_id: id, ...(approval ? { approval } : {}) });
                    store.settle(scope, null, carried);
                    onDone(answer);
                } catch (raw) {
                    const read = readPosError(raw);
                    if (store.settle(scope, read, carried)) throw probablySaved(read);
                    throw raw;
                }
            };
            try {
                await once();
            } catch (raw) {
                const read = readPosError(raw);
                if (read.code === 'APPROVAL_REQUIRED') {
                    // A resend may be asked for one more approval (a counter return whose credit came out above
                    // the cash limit): the dialog stays open with that action and the same body goes again.
                    const resend = async (approval: ManagerApproval): Promise<void> => {
                        try {
                            await once(approval);
                        } catch (again) {
                            const next = readPosError(again);
                            if (next.code === 'APPROVAL_REQUIRED') ask(next.action, resend);
                            throw again;
                        }
                    };
                    ask(read.action, resend);
                    return;
                }
                throw raw;
            }
        },
        [ask, store]
    );
    return { run, dialog: gate.dialog, pinOpen: gate.open, attempts: store };
}

/** The error shown when an unanswered attempt turns out to be saved (with another body). */
export function probablySaved(read: PosError): PosError {
    return {
        ...read,
        code: 'PROBABLY_SAVED',
        posKey: 'pos.errors.PROBABLY_SAVED',
        message: '',
        uncertain: false,
        network: false,
        showServerSentence: false,
    };
}
