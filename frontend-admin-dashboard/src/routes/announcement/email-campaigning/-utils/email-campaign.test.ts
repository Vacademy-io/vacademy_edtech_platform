import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { EmailConfiguration } from '@/services/email-configuration-service';
import {
    collectBlockers,
    firstInvalidSection,
    isValidQuartzCron,
    mergeErrors,
    stripHtml,
    validateEmailCampaign,
} from './validation';
import {
    buildEmailCampaignPayload,
    hydrateCampaign,
    interpretApiError,
    rulesFromRecipients,
    sectionForFieldPath,
} from './payload';
import type { AudienceRule, BatchOption, EmailCampaignDraft } from '../-types';
import strings from '../../../../../public/locales/en/announcementEmailCampaigningIndex.json';
import validationStrings from '../../../../../public/locales/en/announcementValidation.json';

/** Resolves dotted keys against the real en catalog and interpolates `{{var}}`, with i18next's
 * `_one`/`_other` plural suffixes, so the assertions read real copy. */
const makeT = (catalog: Record<string, unknown>): TFunction =>
    ((key: string, vars?: Record<string, unknown>) => {
        const lookup = (k: string) =>
            k
                .split('.')
                .reduce<unknown>(
                    (node, segment) =>
                        node && typeof node === 'object'
                            ? (node as Record<string, unknown>)[segment]
                            : undefined,
                    catalog
                );
        let value = lookup(key);
        if (typeof value !== 'string' && typeof vars?.count === 'number') {
            value = lookup(`${key}_${vars.count === 1 ? 'one' : 'other'}`);
        }
        let text = typeof value === 'string' ? value : key;
        if (vars) {
            Object.entries(vars).forEach(([varKey, varValue]) => {
                text = text.replace(new RegExp(`{{${varKey}}}`, 'g'), String(varValue));
            });
        }
        return text;
    }) as TFunction;

const t = makeT(strings);
const tValidation = makeT(validationStrings);

const rule = (patch: Partial<AudienceRule>): AudienceRule => ({
    key: patch.key ?? 'r1',
    type: 'ROLE',
    roleId: '',
    packageSessionIds: [],
    userIds: [],
    tagIds: [],
    tagScope: 'ALL',
    campaignIds: [],
    campaignNames: {},
    fieldFilters: [],
    exclusions: [],
    ...patch,
});

const batch = (id: string, isOrgAssociated = false): BatchOption => ({
    id,
    label: `Course - Level ${id} - 2026`,
    packageName: 'Course',
    levelName: `Level ${id}`,
    sessionName: '2026',
    isOrgAssociated,
});

const sender: EmailConfiguration = {
    id: 'cfg-1',
    name: 'Support',
    email: 'support@example.com',
    type: 'UTILITY_EMAIL',
} as EmailConfiguration;

const draft = (patch: Partial<EmailCampaignDraft> = {}): EmailCampaignDraft => ({
    title: 'Spring onboarding',
    subject: 'Welcome aboard',
    previewText: 'Everything you need for week one',
    htmlContent: '<p>Hello {{name}}</p>',
    templateId: '',
    templateName: '',
    fromKey: 'support@example.com-Support',
    priority: 'MEDIUM',
    expiresAt: '',
    rules: [rule({ type: 'ROLE', roleId: 'STUDENT' })],
    scheduleType: 'IMMEDIATE',
    timezone: 'Asia/Singapore',
    oneTimeStart: '',
    cronExpression: '',
    ...patch,
});

const validate = (d: EmailCampaignDraft, senders: EmailConfiguration[] = [sender]) =>
    validateEmailCampaign(t, tValidation, {
        draft: d,
        batchById: { b1: batch('b1'), b2: batch('b2', true) },
        senders,
        sendersLoaded: true,
    });

describe('validateEmailCampaign', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-12T10:00:00'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('passes a complete immediate campaign with only advisory notes', () => {
        const result = validate(draft());
        expect(collectBlockers(result)).toEqual([]);
        expect(firstInvalidSection(result)).toBeNull();
    });

    it('blocks the four required fields and reports them in page order', () => {
        const result = validate(
            draft({
                title: '  ',
                subject: '',
                htmlContent: '<p>&nbsp;</p>',
                rules: [],
                fromKey: '',
            })
        );
        expect(firstInvalidSection(result)).toBe('details');
        expect(collectBlockers(result)).toEqual([
            'Give the campaign a name.',
            'Write an email subject — recipients see it in their inbox.',
            'Write the email content.',
            'Add at least one audience — nobody receives this yet.',
            'Choose which address to send from.',
        ]);
        expect(Object.keys(mergeErrors(result)).sort()).toEqual(
            ['content', 'fromKey', 'recipients', 'subject', 'title'].sort()
        );
    });

    it('accepts an image-only email as content', () => {
        const result = validate(draft({ htmlContent: '<img src="poster.png" alt="" />' }));
        expect(result.content.blockers).toEqual([]);
    });

    it('mirrors the backend title limit and warns on inbox truncation', () => {
        const result = validate(draft({ title: 'x'.repeat(501), subject: 'y'.repeat(90) }));
        expect(result.details.errors.title).toBe('Keep the campaign name under 500 characters.');
        expect(result.details.warnings).toContain(
            'Subjects longer than ~78 characters get cut off in most inboxes.'
        );
    });

    it('tells the admin when no sender exists vs. when a stale sender was hydrated', () => {
        expect(validate(draft(), []).settings.errors.fromKey).toMatch(/No sender address/);
        expect(
            validate(draft({ fromKey: 'gone@example.com-Old' })).settings.errors.fromKey
        ).toMatch(/no longer configured/);
    });

    it('does not judge the sender before the sender list has loaded', () => {
        const result = validateEmailCampaign(t, tValidation, {
            draft: draft({ fromKey: 'anything' }),
            batchById: {},
            senders: [],
            sendersLoaded: false,
        });
        expect(result.settings.errors.fromKey).toBeUndefined();
    });

    it('rejects one-time sends in the past and blank/invalid cron schedules', () => {
        const past = validate(
            draft({ scheduleType: 'ONE_TIME', oneTimeStart: '2026-09-12T09:59' })
        );
        expect(past.settings.errors['schedule.startDate']).toMatch(/already passed/);

        const future = validate(
            draft({ scheduleType: 'ONE_TIME', oneTimeStart: '2026-09-12T10:01' })
        );
        expect(future.settings.errors['schedule.startDate']).toBeUndefined();

        const blank = validate(draft({ scheduleType: 'RECURRING', cronExpression: '' }));
        expect(blank.settings.errors['schedule.cronExpression']).toMatch(/Enter a cron/);

        const bad = validate(draft({ scheduleType: 'RECURRING', cronExpression: '0 9 * * *' }));
        expect(bad.settings.errors['schedule.cronExpression']).toMatch(/isn't a valid schedule/);

        const good = validate(
            draft({ scheduleType: 'RECURRING', cronExpression: '0 0 9 ? * MON' })
        );
        expect(good.settings.errors['schedule.cronExpression']).toBeUndefined();
    });

    it('requires expiry to be in the future and after the scheduled send', () => {
        expect(
            validate(draft({ expiresAt: '2026-09-11T10:00' })).settings.errors.expiresAt
        ).toMatch(/must be in the future/);
        expect(
            validate(
                draft({
                    scheduleType: 'ONE_TIME',
                    oneTimeStart: '2026-09-20T10:00',
                    expiresAt: '2026-09-15T10:00',
                })
            ).settings.errors.expiresAt
        ).toMatch(/after the scheduled send/);
    });

    it('reuses the shared audience rules but only advises on a missing sub-org role', () => {
        // The old page could send a sub-org batch without a role (everyone in it); keep that.
        const result = validate(
            draft({ rules: [rule({ type: 'PACKAGE_SESSION', packageSessionIds: ['b2'] })] })
        );
        expect(result.audience.errors['rule.r1.orgRole']).toBeUndefined();
        expect(result.audience.blockers).toEqual([]);
        expect(result.audience.warnings).toEqual([expect.stringMatching(/pick Admin or Learner/)]);

        const noBatch = validate(
            draft({ rules: [rule({ type: 'PACKAGE_SESSION', packageSessionIds: [] })] })
        );
        expect(noBatch.audience.errors['rule.r1.batches']).toBeDefined();
    });
});

describe('isValidQuartzCron', () => {
    it.each([
        ['0 0 9 * * ?', true],
        ['0 0 9 ? * MON', true],
        ['0 0 * * * ?', true],
        ['0 0 9 * * ? 2026', true],
        ['0 9 * * *', false], // 5-field unix cron
        ['0 0 9 * * *', false], // no ? at all
        ['0 0 9 ? * ?', false], // ? in both
        ['0 0 9 * * ?; drop', false],
        ['', false],
    ])('%s → %s', (expression, expected) => {
        expect(isValidQuartzCron(expression)).toBe(expected);
    });
});

describe('stripHtml', () => {
    it('drops tags, style blocks and entities', () => {
        expect(stripHtml('<style>p{}</style><p>Hi&nbsp;<b>there</b></p>')).toBe('Hi there');
    });
});

describe('buildEmailCampaignPayload', () => {
    const build = (d: EmailCampaignDraft) =>
        buildEmailCampaignPayload({
            draft: d,
            batchById: { b1: batch('b1'), b2: batch('b2', true) },
            tagNameById: { t1: 'Toppers' },
            senders: [sender],
            createdBy: 'u1',
            createdByName: 'Admin',
            createdByRole: 'ADMIN',
        });

    it('produces the SYSTEM_ALERT + EMAIL shape the notification service expects', () => {
        const payload = build(
            draft({ title: ' Spring ', subject: ' Hi ', templateName: 'Welcome' })
        );
        expect(payload.title).toBe('Spring');
        expect(payload.modes).toEqual([
            { modeType: 'SYSTEM_ALERT', settings: { priority: 'MEDIUM' } },
        ]);
        expect(payload.mediums).toEqual([
            {
                mediumType: 'EMAIL',
                config: {
                    subject: 'Hi',
                    emailType: 'UTILITY_EMAIL',
                    fromEmail: 'support@example.com',
                    fromName: 'Support',
                    template: 'Welcome',
                    previewText: 'Everything you need for week one',
                },
            },
        ]);
        expect(payload.recipients).toEqual([{ recipientType: 'ROLE', recipientId: 'STUDENT' }]);
        expect(payload.scheduling).toEqual({
            scheduleType: 'IMMEDIATE',
            timezone: 'Asia/Singapore',
        });
    });

    it('sends wall-clock literals with seconds and omits an empty expiry', () => {
        const payload = build(
            draft({ scheduleType: 'ONE_TIME', oneTimeStart: '2026-10-01T09:30', expiresAt: '' })
        );
        expect(payload.scheduling).toEqual({
            scheduleType: 'ONE_TIME',
            timezone: 'Asia/Singapore',
            startDate: '2026-10-01T09:30:00',
        });
        expect(payload.modes[0]?.settings).not.toHaveProperty('expiresAt');

        const withExpiry = build(draft({ expiresAt: '2026-12-31T23:59' }));
        expect(withExpiry.modes[0]?.settings.expiresAt).toBe('2026-12-31T23:59:00');
    });

    it('encodes sub-org batches with their role and expands tags with names', () => {
        const payload = build(
            draft({
                rules: [
                    rule({
                        key: 'a',
                        type: 'PACKAGE_SESSION',
                        packageSessionIds: ['b1', 'b2'],
                        orgRole: 'LEARNER',
                    }),
                    rule({ key: 'b', type: 'TAG', tagIds: ['t1'] }),
                    rule({
                        key: 'c',
                        type: 'AUDIENCE',
                        campaignIds: ['c1', 'c2'],
                        campaignNames: { c1: 'Open day', c2: 'Webinar leads' },
                    }),
                ],
            })
        );
        expect(payload.recipients.map((r) => [r.recipientType, r.recipientId])).toEqual([
            ['PACKAGE_SESSION', 'b1'],
            ['PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES', 'b2:LEARNER'],
            ['TAG', 't1'],
            ['AUDIENCE', 'c1'],
            ['AUDIENCE', 'c2'],
        ]);
        expect(payload.recipients[2]?.recipientName).toBe('Toppers');
        expect(payload.recipients[4]?.recipientName).toBe('Webinar leads');
    });
});

describe('hydrateCampaign', () => {
    const apiResponse = {
        id: 'a1',
        title: 'Old campaign',
        status: 'SCHEDULED',
        content: { type: 'html', content: '<p>Body</p>' },
        modes: [{ modeType: 'SYSTEM_ALERT', settings: { priority: 1 } }],
        mediums: [
            {
                mediumType: 'EMAIL',
                config: {
                    subject: 'Old subject',
                    fromEmail: 'support@example.com',
                    fromName: 'Support',
                    previewText: 'peek',
                    template: 'Welcome',
                },
            },
        ],
        scheduling: {
            scheduleType: 'ONE_TIME',
            timezone: 'Asia/Singapore',
            startDate: '2026-10-01T09:30:00',
        },
        recipients: [
            { recipientType: 'ROLE', recipientId: 'STUDENT', recipientName: null },
            {
                recipientType: 'PACKAGE_SESSION',
                recipientId: 'b1',
                recipientName: '[{"exclusionType":"USER","exclusionId":"u9"}]',
            },
            { recipientType: 'PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES', recipientId: 'b2:ADMIN' },
            {
                recipientType: 'CUSTOM_FIELD_FILTER',
                recipientId: 'CUSTOM_FIELD_FILTER',
                recipientName:
                    '[{"customFieldId":"cf1","fieldName":"City","fieldValue":"Pune","operator":"equals"},{"customFieldId":"cf2","fieldName":"Stream","fieldValue":["PCM","PCB"]}]',
            },
            { recipientType: 'AUDIENCE', recipientId: 'camp1', recipientName: 'Open day' },
            { recipientType: 'AUDIENCE', recipientId: 'camp2', recipientName: 'Webinar leads' },
            {
                recipientType: 'AUDIENCE',
                recipientId: 'camp3',
                recipientName: '[{"exclusionType":"USER","exclusionId":"u1"}]',
            },
        ],
    };

    it('maps every stored field back into the draft', () => {
        const { draft: d, status } = hydrateCampaign(apiResponse, [
            { id: 'cf2', name: 'Stream', type: 'dropdown', options: ['PCM', 'PCB'] },
        ]);
        expect(status).toBe('SCHEDULED');
        expect(d.title).toBe('Old campaign');
        expect(d.subject).toBe('Old subject');
        expect(d.previewText).toBe('peek');
        expect(d.templateName).toBe('Welcome');
        expect(d.fromKey).toBe('support@example.com-Support');
        expect(d.priority).toBe('MEDIUM'); // integer priorities from the entity fall back
        expect(d.scheduleType).toBe('ONE_TIME');
        expect(d.oneTimeStart).toBe('2026-10-01T09:30');
        expect(d.htmlContent).toBe('<p>Body</p>');
    });

    it('rebuilds audience rules, decoding exclusions, org roles and field filters', () => {
        const { draft: d } = hydrateCampaign(apiResponse, [
            { id: 'cf2', name: 'Stream', type: 'dropdown', options: ['PCM', 'PCB'] },
        ]);
        const rules = d.rules ?? [];
        expect(rules.map((r) => r.type)).toEqual([
            'ROLE',
            'PACKAGE_SESSION',
            'PACKAGE_SESSION',
            'CUSTOM_FIELD_FILTER',
            'AUDIENCE',
            'AUDIENCE',
        ]);
        expect(rules[1]?.exclusions).toEqual([
            expect.objectContaining({ exclusionType: 'USER', exclusionId: 'u9' }),
        ]);
        expect(rules[2]).toEqual(
            expect.objectContaining({ packageSessionIds: ['b2'], orgRole: 'ADMIN' })
        );
        // The stored request shape is customFieldId/fieldValue — the old page read fieldId/filterValue
        // and lost every filter on edit.
        expect(rules[3]?.fieldFilters).toEqual([
            expect.objectContaining({
                fieldId: 'cf1',
                fieldName: 'City',
                fieldType: 'text',
                filterValue: 'Pune',
                operator: 'equals',
            }),
            expect.objectContaining({
                fieldId: 'cf2',
                fieldType: 'dropdown',
                filterValue: ['PCM', 'PCB'],
            }),
        ]);
        // Exclusion-free campaign rows fold into one multi-select rule; the one with an
        // exclusion keeps its own card (its name lives in the picker, not the stored row).
        expect(rules[4]).toEqual(
            expect.objectContaining({
                campaignIds: ['camp1', 'camp2'],
                campaignNames: { camp1: 'Open day', camp2: 'Webinar leads' },
                exclusions: [],
            })
        );
        expect(rules[5]).toEqual(
            expect.objectContaining({
                campaignIds: ['camp3'],
                campaignNames: {},
                exclusions: [expect.objectContaining({ exclusionId: 'u1' })],
            })
        );
    });

    it('falls back to the title as subject for legacy rows and survives junk', () => {
        const { draft: d } = hydrateCampaign(
            { title: 'Legacy', mediums: [{ mediumType: 'EMAIL', config: {} }], recipients: null },
            []
        );
        expect(d.subject).toBe('Legacy');
        expect(d.rules).toEqual([]);
        expect(hydrateCampaign(null, []).draft.title).toBe('');
        expect(
            rulesFromRecipients(
                [{ recipientType: 'CUSTOM_FIELD_FILTER', recipientName: 'ERROR' }],
                []
            )
        ).toEqual([]);
    });
});

describe('interpretApiError', () => {
    const axiosError = (status: number, data: Record<string, unknown>) => ({
        response: { status, data },
        message: `Request failed with status code ${status}`,
    });

    it('maps bean-validation details onto form paths and points at the first section', () => {
        const failure = interpretApiError(
            t,
            axiosError(400, {
                message: 'Request validation failed',
                details: {
                    'scheduling.startDate': 'must be a future date',
                    title: 'Title must not exceed 500 characters',
                    'recipients[0].recipientId': 'Recipient ID is required',
                },
            })
        );
        expect(failure.fieldErrors).toEqual({
            'schedule.startDate': 'must be a future date',
            title: 'Title must not exceed 500 characters',
            recipients: 'Recipient ID is required',
        });
        expect(failure.message).toBe(
            'The server rejected 3 fields — see the highlighted sections.'
        );
        expect(failure.section).toBe('settings');
        expect(failure.locked).toBe(false);
    });

    it('surfaces the backend message when a scheduled campaign can no longer be edited', () => {
        const failure = interpretApiError(
            t,
            axiosError(400, {
                message: 'Announcement in status ACTIVE cannot be edited',
                code: 'VALIDATION_ERROR',
            })
        );
        expect(failure.locked).toBe(true);
        expect(failure.message).toBe('Announcement in status ACTIVE cannot be edited');
        expect(failure.fieldErrors).toEqual({});
    });

    it('gives status-specific copy for auth, 404, 5xx and network failures', () => {
        expect(interpretApiError(t, axiosError(403, {})).message).toMatch(/permission/);
        expect(interpretApiError(t, axiosError(404, {})).message).toMatch(/no longer exists/);
        expect(
            interpretApiError(t, axiosError(500, { message: 'An unexpected error occurred' }))
                .message
        ).toBe('An unexpected error occurred');
        expect(interpretApiError(t, axiosError(503, {})).message).toMatch(/our side/);
        expect(
            interpretApiError(t, { code: 'ERR_NETWORK', message: 'Network Error' }).message
        ).toMatch(/Check your connection/);
        expect(interpretApiError(t, new Error('Missing instituteId')).message).toBe(
            'Missing instituteId'
        );
        expect(interpretApiError(t, undefined).message).toMatch(/could not be saved/);
    });
});

describe('sectionForFieldPath', () => {
    it.each([
        ['title', 'details'],
        ['subject', 'details'],
        ['content', 'content'],
        ['recipients', 'audience'],
        ['rule.r1.tags', 'audience'],
        ['schedule.startDate', 'settings'],
        ['fromKey', 'settings'],
        ['mediums[0].config', 'settings'],
    ])('%s → %s', (path, section) => {
        expect(sectionForFieldPath(path)).toBe(section);
    });
});
