/**
 * Meta validates a WhatsApp template's body-parameter COUNT exactly: sending
 * six params to a template that declares none fails the whole send with
 * "(#132000) number of localizable_params (6) does not match the expected
 * number of params (0)". These cover the generator side of that contract.
 */
import { describe, expect, it } from 'vitest';
import { declaredParamsKey, getTemplatesForTrigger, isQuestionApplicable } from './use-case-templates';

/** The audience-confirmation use case, which maps six named vars for email. */
function confirmationTemplate() {
    const tmpl = getTemplatesForTrigger('AUDIENCE_LEAD_SUBMISSION', 'EVENT_DRIVEN')
        .find((t) => t.id === 'audience_lead_confirmation');
    if (!tmpl) throw new Error('audience_lead_confirmation use case not found');
    return tmpl;
}

function whatsappNodeConfig(answers: Record<string, string | number | string[]>) {
    const { nodes } = confirmationTemplate().generateWorkflow(answers, 'AUDIENCE_LEAD_SUBMISSION');
    const node = nodes.find((n) => n.data.nodeType === 'SEND_WHATSAPP');
    if (!node) throw new Error('no SEND_WHATSAPP node generated');
    return node.data.config as Record<string, unknown>;
}

describe('makeChannelSendNodes — WhatsApp templateVars', () => {
    it('sends no params for a template that declares none (the yoga_leads case)', () => {
        const config = whatsappNodeConfig({
            channel: 'WHATSAPP',
            waTemplateName: 'yoga_leads',
            [declaredParamsKey('waTemplateName')]: [],
        });
        expect(config.templateName).toBe('yoga_leads');
        expect(config.templateVars).toBeUndefined();
    });

    it('keeps only the placeholders the template declares', () => {
        const config = whatsappNodeConfig({
            channel: 'WHATSAPP',
            waTemplateName: 'named_two_var',
            [declaredParamsKey('waTemplateName')]: ['name', 'instituteName'],
        });
        expect(config.templateVars).toEqual({
            name: 'Full Name',
            instituteName: 'instituteName',
        });
    });

    it('omits positional placeholders it cannot map rather than guessing', () => {
        const config = whatsappNodeConfig({
            channel: 'WHATSAPP',
            waTemplateName: 'positional',
            [declaredParamsKey('waTemplateName')]: ['1', '2'],
        });
        // No mapping exists for {{1}}/{{2}}, so nothing is invented. The picker
        // warns the admin to map them in the builder.
        expect(config.templateVars).toBeUndefined();
    });

    it('leaves the email node untouched when WhatsApp params are trimmed', () => {
        const { nodes } = confirmationTemplate().generateWorkflow({
            channel: 'BOTH',
            templateName: 'welcome_email',
            waTemplateName: 'yoga_leads',
            [declaredParamsKey('waTemplateName')]: [],
        }, 'AUDIENCE_LEAD_SUBMISSION');
        const email = nodes.find((n) => n.data.nodeType === 'SEND_EMAIL');
        const vars = (email?.data.config as Record<string, unknown>).templateVars;
        expect(vars).toMatchObject({ name: 'Full Name', email: 'Email' });
    });

    it('falls back to the old behaviour when params were never recorded', () => {
        // A draft saved before the picker recorded declared params must not have
        // its mapping silently stripped.
        const config = whatsappNodeConfig({
            channel: 'WHATSAPP',
            waTemplateName: 'unknown',
        });
        expect(config.templateVars).toMatchObject({ name: 'Full Name' });
    });
});

/**
 * Per-enrolment triggers already carry the batch the learner joined
 * (`packageSessionIds` on the context), and the trigger's own scope decides
 * which batches fire. Asking for a batch again in the wizard was worse than
 * redundant: the hard-coded answer overrode the trigger scope — three batches
 * selected on the trigger, one batch messaged.
 */
describe('email_batch_students — batch comes from the trigger when it can', () => {
    function template(trigger: string) {
        const tmpl = getTemplatesForTrigger(trigger, 'EVENT_DRIVEN')
            .find((t) => t.id === 'email_batch_students');
        if (!tmpl) throw new Error(`email_batch_students not offered for ${trigger}`);
        return tmpl;
    }

    function queryBatchId(trigger: string, answers: Record<string, string | number | string[]>) {
        const { nodes } = template(trigger).generateWorkflow(answers, trigger);
        const query = nodes.find((n) => n.data.nodeType === 'QUERY');
        const params = (query?.data.config as { params: { batchId: string } }).params;
        return params.batchId;
    }

    const base = { channel: 'EMAIL', templateName: 'reminder' };

    it('does not ask for a batch on LEARNER_BATCH_ENROLLMENT', () => {
        const batchQ = template('LEARNER_BATCH_ENROLLMENT').questions.find((q) => q.id === 'batchId')!;
        expect(isQuestionApplicable(batchQ, base, 'LEARNER_BATCH_ENROLLMENT')).toBe(false);
        expect(isQuestionApplicable(batchQ, base, 'SUB_ORG_MEMBER_ENROLLMENT')).toBe(false);
    });

    it('reads the batch from the trigger context on enrolment events', () => {
        expect(queryBatchId('LEARNER_BATCH_ENROLLMENT', base)).toBe("#ctx['packageSessionIds']");
        expect(queryBatchId('SUB_ORG_MEMBER_ENROLLMENT', base)).toBe("#ctx['packageSessionIds']");
    });

    it('ignores a stale batch answer on enrolment events — the trigger wins', () => {
        expect(queryBatchId('LEARNER_BATCH_ENROLLMENT', { ...base, batchId: 'stale-batch' }))
            .toBe("#ctx['packageSessionIds']");
    });

    it('still asks for, and uses, the batch on triggers that do not carry one', () => {
        const batchQ = template('LIVE_SESSION_START').questions.find((q) => q.id === 'batchId')!;
        expect(isQuestionApplicable(batchQ, base, 'LIVE_SESSION_START')).toBe(true);
        expect(queryBatchId('LIVE_SESSION_START', { ...base, batchId: 'batch-42' })).toBe('batch-42');
    });
});
