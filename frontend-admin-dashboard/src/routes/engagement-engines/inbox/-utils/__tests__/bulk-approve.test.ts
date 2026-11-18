import { describe, expect, it } from 'vitest';
import type { EngagementAction } from '../../../-types';
import { approveInTurn, bulkVerbOf, canApproveTask, canSendTask } from '../bulk-approve';

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

describe('canSendTask', () => {
    const message = (over: Partial<EngagementAction>) =>
        task({ kind: 'SEND', actionType: undefined, channel: 'EMAIL', ...over });

    it('takes an open WhatsApp, email or in-app draft', () => {
        expect(canSendTask(message({}))).toBe(true);
        expect(canSendTask(message({ channel: 'IN_APP', status: 'ACKED' }))).toBe(true);
        expect(canSendTask(message({ channel: 'WHATSAPP', templateName: 'welcome_1' }))).toBe(true);
        expect(canSendTask(message({ kind: 'REPLY', channel: 'WHATSAPP' }))).toBe(true);
    });

    it('leaves out a WhatsApp with no template, AI calls, no channel and anything handled', () => {
        expect(canSendTask(message({ channel: 'WHATSAPP' }))).toBe(false);
        expect(canSendTask(message({ channel: 'AI_CALL' }))).toBe(false);
        expect(canSendTask(message({ channel: undefined }))).toBe(false);
        expect(canSendTask(message({ status: 'SENT' }))).toBe(false);
    });
});

describe('bulkVerbOf', () => {
    it('approves CRM actions, sends messages, and skips the rest', () => {
        expect(bulkVerbOf(task({}))).toBe('approve');
        expect(bulkVerbOf(task({ kind: 'SEND', actionType: undefined, channel: 'EMAIL' }))).toBe(
            'send'
        );
        expect(bulkVerbOf(task({ kind: 'SEND', actionType: undefined, channel: 'WHATSAPP' }))).toBe(
            null
        );
        expect(bulkVerbOf(task({ status: 'DONE' }))).toBe(null);
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
