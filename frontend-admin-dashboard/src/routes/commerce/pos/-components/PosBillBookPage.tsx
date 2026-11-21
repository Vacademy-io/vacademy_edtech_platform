import { PosBillingWorkspace } from './PosSellPage';
import { PosShell } from './PosShell';

/**
 * P5 (contract §7.3): a paper bill written while the till was down, keyed in
 * with its paper number and date. The same lines, customer and payment as a
 * sale; the server takes the number from the registered bill book and a
 * cashier is asked for a manager's PIN (APPROVAL_REQUIRED: POS_BILL_BOOK).
 */
export function PosBillBookPage({ sessionId }: { sessionId: string }) {
    return (
        <PosShell sessionId={sessionId} active="billBook">
            {(session, online) => <PosBillingWorkspace mode="billBook" session={session} online={online} />}
        </PosShell>
    );
}
