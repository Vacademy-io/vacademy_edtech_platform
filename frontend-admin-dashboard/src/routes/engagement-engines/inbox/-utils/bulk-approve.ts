import { isCrmAction } from '../../-types/actions';
import type { EngagementAction } from '../../-types';

/** Only a CRM action waiting for a person is approved; a message is reviewed and sent on its own. */
export function canApproveTask(task: EngagementAction): boolean {
    return (
        task.kind === 'TASK' &&
        (task.status === 'OPEN' || task.status === 'ACKED') &&
        isCrmAction(task.actionType)
    );
}

export interface ApproveInTurnResult {
    approved: number;
    /** What each refused approval threw, in the order they ran. */
    failures: unknown[];
}

/**
 * Approve one task at a time. Never in parallel: the engine's AI call pool picks the next agent by
 * counting its done calls, so approvals running together would all land on the same agent. A refusal
 * does not stop the rest; that task is back in the inbox with its reason.
 */
export async function approveInTurn(
    ids: string[],
    approve: (id: string) => Promise<unknown>,
    onProgress: (done: number) => void
): Promise<ApproveInTurnResult> {
    const failures: unknown[] = [];
    let approved = 0;
    for (const [i, id] of ids.entries()) {
        try {
            await approve(id);
            approved += 1;
        } catch (e) {
            failures.push(e);
        }
        onProgress(i + 1);
    }
    return { approved, failures };
}
