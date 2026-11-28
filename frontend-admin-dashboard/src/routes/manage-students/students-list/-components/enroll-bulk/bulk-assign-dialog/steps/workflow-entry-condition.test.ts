import { describe, expect, it } from 'vitest';
import type { WorkflowRawNode } from '@/services/workflow-service';
import { evaluateEntryCondition, findEntryCondition } from './workflow-entry-condition';

const node = (id: string, type: string, config: object): WorkflowRawNode => ({
    mapping_id: `m-${id}`,
    node_template_id: id,
    node_name: id,
    node_type: type,
    status: 'ACTIVE',
    version: 1,
    config_json: JSON.stringify(config),
    retry_config: null,
    node_order: 0,
    is_start_node: type === 'TRIGGER',
    is_end_node: false,
});

// Shape of Shiksha Nation's live "UnlockX Registration WhatsApp" workflow.
const UNLOCKX =
    "#ctx['packageName'] != null && #ctx['packageName'].toLowerCase().contains('unlockx scholarship')";
const unlockxNodes = [
    node('t', 'TRIGGER', {
        triggerEvent: 'LEARNER_BATCH_ENROLLMENT',
        routing: [{ type: 'goto', targetNodeId: 'c' }],
    }),
    node('c', 'CONDITION', {
        condition: UNLOCKX,
        routing: [{ type: 'conditional', label: 'true', condition: UNLOCKX, trueNodeId: 'w' }],
    }),
    node('w', 'SEND_WHATSAPP', { routing: [{ type: 'end' }] }),
];

const facts = (packageName: string) => ({ packageName, packageSessionId: 'ps-1' });

describe('findEntryCondition', () => {
    it('finds a TRIGGER → CONDITION gate with no false branch', () => {
        expect(findEntryCondition(unlockxNodes)).toBe(UNLOCKX);
    });

    it('is null when the trigger goes straight to an action', () => {
        const nodes = [
            node('t', 'TRIGGER', { routing: [{ type: 'goto', targetNodeId: 'e' }] }),
            node('e', 'SEND_EMAIL', { routing: [{ type: 'end' }] }),
        ];
        expect(findEntryCondition(nodes)).toBeNull();
    });

    it('is null for an if/else condition — some branch always runs', () => {
        const cond = "#ctx['packageName'] == 'A'";
        const nodes = [
            node('t', 'TRIGGER', { routing: [{ type: 'goto', targetNodeId: 'c' }] }),
            node('c', 'CONDITION', {
                routing: [
                    { type: 'conditional', condition: cond, trueNodeId: 'a', falseNodeId: 'b' },
                ],
            }),
            node('a', 'SEND_EMAIL', {}),
            node('b', 'SEND_EMAIL', {}),
        ];
        expect(findEntryCondition(nodes)).toBeNull();
    });

    it('is null when the trigger fans out to more than one node', () => {
        const nodes = [
            node('t', 'TRIGGER', {
                routing: [
                    { type: 'goto', targetNodeId: 'c' },
                    { type: 'goto', targetNodeId: 'e' },
                ],
            }),
            ...unlockxNodes.slice(1),
            node('e', 'SEND_EMAIL', {}),
        ];
        expect(findEntryCondition(nodes)).toBeNull();
    });

    it('treats unparseable config as ungated', () => {
        const broken = { ...unlockxNodes[0]!, config_json: '{not json' };
        expect(findEntryCondition([broken, ...unlockxNodes.slice(1)])).toBeNull();
    });

    it('starts where the engine starts — an action start node runs before any gate', () => {
        const email = {
            ...node('e', 'SEND_EMAIL', { routing: [{ type: 'goto', targetNodeId: 'c' }] }),
            is_start_node: true,
        };
        const trigger = { ...unlockxNodes[0]!, is_start_node: false };
        expect(findEntryCondition([trigger, unlockxNodes[1]!, unlockxNodes[2]!, email])).toBeNull();
    });

    it('falls back to the first node by node_order when no start node is flagged', () => {
        const nodes = unlockxNodes.map((n, i) => ({ ...n, is_start_node: false, node_order: i }));
        expect(findEntryCondition([...nodes].reverse())).toBe(UNLOCKX);
    });

    it('does not trust a gate when the trigger overwrites a context key it reads', () => {
        const trigger = node('t', 'TRIGGER', {
            outputDataPoints: [{ fieldName: 'packageName', value: 'UnlockX Scholarship' }],
            routing: [{ type: 'goto', targetNodeId: 'c' }],
        });
        expect(findEntryCondition([trigger, ...unlockxNodes.slice(1)])).toBeNull();
    });

    it('still finds the gate when the trigger only adds unrelated keys', () => {
        const trigger = node('t', 'TRIGGER', {
            outputDataPoints: [{ fieldName: 'campaign', value: 'x' }],
            routing: [{ type: 'goto', targetNodeId: 'c' }],
        });
        expect(findEntryCondition([trigger, ...unlockxNodes.slice(1)])).toBe(UNLOCKX);
    });

    it('is null when a goto points at a node that does not exist', () => {
        const trigger = node('t', 'TRIGGER', { routing: [{ type: 'goto', targetNodeId: 'x' }] });
        expect(findEntryCondition([trigger, ...unlockxNodes.slice(1)])).toBeNull();
    });
});

describe('evaluateEntryCondition', () => {
    it('matches UnlockX courses and skips everything else', () => {
        expect(evaluateEntryCondition(UNLOCKX, facts('UnlockX Scholarship Test - Class 6'))).toBe(
            'runs'
        );
        expect(evaluateEntryCondition(UNLOCKX, facts('AI Revolution: 3 Hours to Success-55'))).toBe(
            'skips'
        );
    });

    it('handles builder output: ==, !=, contains, isEmpty, OR', () => {
        const f = facts('Class 10');
        expect(evaluateEntryCondition("#ctx['packageName'] == 'Class 10'", f)).toBe('runs');
        expect(evaluateEntryCondition("#ctx['packageName'] != 'Class 10'", f)).toBe('skips');
        expect(evaluateEntryCondition("#ctx['packageName'].contains('Class')", f)).toBe('runs');
        expect(evaluateEntryCondition("!#ctx['packageName'].isEmpty()", f)).toBe('runs');
        expect(
            evaluateEntryCondition(
                "#ctx['packageName'] == 'Class 9' || #ctx['packageName'] == 'Class 10'",
                f
            )
        ).toBe('runs');
    });

    it('matches on the batch id', () => {
        expect(evaluateEntryCondition("#ctx['packageSessionIds'] == 'ps-1'", facts('x'))).toBe(
            'runs'
        );
        expect(evaluateEntryCondition("#ctx['eventId'] == 'ps-2'", facts('x'))).toBe('skips');
    });

    it('does not split on operators inside string literals', () => {
        expect(
            evaluateEntryCondition(
                "#ctx['packageName'] == 'Maths && Science'",
                facts('Maths && Science')
            )
        ).toBe('runs');
    });

    it('is unknown for learner-dependent or unrecognised expressions', () => {
        const f = facts('Class 10');
        expect(evaluateEntryCondition("#ctx['user']['email'].endsWith('@x.com')", f)).toBe(
            'unknown'
        );
        expect(
            evaluateEntryCondition(
                "#ctx['packageName'] == 'Class 10' && #ctx['lmsEditExistingUser'] == true",
                f
            )
        ).toBe('unknown');
        expect(evaluateEntryCondition("!#ctx['packageName'] == 'x'", f)).toBe('unknown');
    });

    it('a false conjunct decides the verdict even next to an unknown one', () => {
        expect(
            evaluateEntryCondition(
                "#ctx['packageName'] == 'Other' && #ctx['lmsEditExistingUser'] == true",
                facts('Class 10')
            )
        ).toBe('skips');
    });
});
