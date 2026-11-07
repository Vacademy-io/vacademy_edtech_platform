import { describe, expect, it } from 'vitest';
import type { EngagementAction } from '../../../-types';
import { approveInTurn, canApproveTask } from '../bulk-approve';

const task = (over: Partial<EngagementAction>) =>
    ({ kind: 'TASK', status: 'OPEN', actionType: 'SCHEDULE_AI_CALL', ...over }) as EngagementAction;

describe('canApproveTask', () => {
    it('takes a CRM action waiting for a person', () => {
        expect(canApproveTask(task({}))).toBe(true);
        expect(canApproveTask(task({ status: 'ACKED', actionType: 'ADD_NOTE' }))).toBe(true);
    });

    it('leaves out messages, replies, held calls and anything already handled', () => {
        expect(canApproveTask(task({ actionType: 'SEND_MESSAGE' }))).toBe(false);
        expect(canApproveTask(task({ actionType: undefined }))).toBe(false);
        expect(canApproveTask(task({ kind: 'REPLY' }))).toBe(false);
        expect(canApproveTask(task({ kind: 'SEND' }))).toBe(false);
        expect(canApproveTask(task({ status: 'DONE' }))).toBe(false);
    });
});

describe('approveInTurn', () => {
    it('runs one approval at a time, in order', async () => {
        let running = 0;
        let most = 0;
        const order: string[] = [];
        await approveInTurn(
            ['a', 'b', 'c'],
            async (id) => {
                running += 1;
                most = Math.max(most, running);
                await Promise.resolve();
                order.push(id);
                running -= 1;
            },
            () => undefined
        );
        expect(most).toBe(1);
        expect(order).toEqual(['a', 'b', 'c']);
    });

    it('carries on past a refusal and counts every task as progress', async () => {
        const progress: number[] = [];
        const refusal = new Error('weekly limit');
        const result = await approveInTurn(
            ['a', 'b', 'c'],
            (id) => (id === 'b' ? Promise.reject(refusal) : Promise.resolve()),
            (done) => progress.push(done)
        );
        expect(result).toEqual({ approved: 2, failures: [refusal] });
        expect(progress).toEqual([1, 2, 3]);
    });
});
