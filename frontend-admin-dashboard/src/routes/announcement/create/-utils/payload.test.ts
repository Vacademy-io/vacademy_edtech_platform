import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { buildCreatePayload, expandRecipients, interpretApiError } from './payload';
import { validateSection } from './validation';
import type { AudienceRule, BatchOption, WhatsAppConfig } from '../-types';
import type { WhatsAppTemplateDTO } from '@/routes/communication/whatsapp-templates/-services/template-api';
import validationStrings from '../../../../../public/locales/en/announcementValidation.json';
import payloadStrings from '../../../../../public/locales/en/announcementPayload.json';

/** Minimal stand-in for i18next's `t`, resolving dotted keys against the real en catalog and
 * interpolating `{{var}}` placeholders — enough for these tests to assert on real copy. */
const makeT = (catalog: Record<string, unknown>): TFunction =>
    ((key: string, vars?: Record<string, unknown>) => {
        const value = key
            .split('.')
            .reduce<unknown>(
                (node, segment) =>
                    node && typeof node === 'object'
                        ? (node as Record<string, unknown>)[segment]
                        : undefined,
                catalog
            );
        let text = typeof value === 'string' ? value : key;
        if (vars) {
            Object.entries(vars).forEach(([varKey, varValue]) => {
                text = text.replace(new RegExp(`{{${varKey}}}`, 'g'), String(varValue));
            });
        }
        return text;
    }) as TFunction;

const tValidation = makeT(validationStrings);
const tPayload = makeT(payloadStrings);

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

const template: WhatsAppTemplateDTO = {
    instituteId: 'inst-1',
    name: 'batch_start_reminder',
    language: 'hi',
    category: 'UTILITY',
    status: 'APPROVED',
    headerType: 'IMAGE',
    bodyText: 'Hi {{name}}, {{message}}',
    bodyVariableNames: ['name', 'message'],
};

const whatsapp: WhatsAppConfig = {
    templateName: 'batch_start_reminder',
    languageCode: 'hi',
    headerUrl: 'https://cdn.example.com/banner.png',
    variables: {
        name: { source: 'RECIPIENT_NAME', customValue: '' },
        message: { source: 'CUSTOM', customValue: 'Class starts Monday' },
    },
};

const basePayloadInput = {
    title: 'New batch',
    htmlContent: '<p>Starts Monday</p>',
    previewText: 'Starts Monday',
    createdBy: 'user-1',
    createdByName: 'Admin',
    createdByRole: 'ADMIN',
    rules: [] as AudienceRule[],
    batchById: {} as Record<string, BatchOption>,
    tagNameById: {} as Record<string, string>,
    modes: ['SYSTEM_ALERT' as const],
    modeSettings: { SYSTEM_ALERT: { priority: 'HIGH' } },
    mediums: [] as never[],
    push: { title: 'New batch', body: 'Starts Monday' },
    email: { templateId: '', templateName: '', fromKey: '', subjectOverride: '' },
    emailSenders: [],
    whatsapp,
    selectedWaTemplate: null,
    scheduleType: 'IMMEDIATE' as const,
    timezone: 'Asia/Kolkata',
    oneTimeStart: '',
    cronExpression: '',
};

describe('expandRecipients', () => {
    it('turns one batch rule into one recipient per package session', () => {
        const result = expandRecipients(
            [rule({ type: 'PACKAGE_SESSION', packageSessionIds: ['a', 'b', 'c'] })],
            { a: batch('a'), b: batch('b'), c: batch('c') },
            {}
        );
        expect(result).toHaveLength(3);
        expect(result.every((r) => r.recipientType === 'PACKAGE_SESSION')).toBe(true);
    });

    it('encodes the sub-organisation role only for org-associated batches', () => {
        const result = expandRecipients(
            [
                rule({
                    type: 'PACKAGE_SESSION',
                    packageSessionIds: ['plain', 'org'],
                    orgRole: 'ADMIN',
                }),
            ],
            { plain: batch('plain'), org: batch('org', true) },
            {}
        );
        expect(result[0]).toMatchObject({ recipientType: 'PACKAGE_SESSION', recipientId: 'plain' });
        expect(result[1]).toMatchObject({
            recipientType: 'PACKAGE_SESSION_COMMA_SEPARATED_ORG_ROLES',
            recipientId: 'org:ADMIN',
        });
    });

    it('keeps each rule’s filters and exclusions with that rule only', () => {
        const result = expandRecipients(
            [
                rule({ key: 'r1', type: 'ROLE', roleId: 'STUDENT' }),
                rule({
                    key: 'r2',
                    type: 'TAG',
                    tagIds: ['t1'],
                    exclusions: [{ key: 'e1', exclusionType: 'ROLE', exclusionId: 'TEACHER' }],
                }),
            ],
            {},
            { t1: 'Toppers' }
        );
        expect(result[0]?.exclusions).toBeUndefined();
        expect(result[1]?.exclusions).toEqual([{ exclusionType: 'ROLE', exclusionId: 'TEACHER' }]);
        expect(result[1]?.recipientName).toBe('Toppers');
    });

    it('drops incomplete field filters instead of sending empty values', () => {
        const result = expandRecipients(
            [
                rule({
                    type: 'ROLE',
                    roleId: 'STUDENT',
                    fieldFilters: [
                        {
                            key: 'f1',
                            fieldId: 'city',
                            fieldName: 'City',
                            fieldType: 'text',
                            filterValue: 'Pune',
                            operator: 'equals',
                        },
                        {
                            key: 'f2',
                            fieldId: 'grade',
                            fieldName: 'Grade',
                            fieldType: 'text',
                            filterValue: '',
                        },
                    ],
                }),
            ],
            {},
            {}
        );
        expect(result[0]?.customFieldFilters).toHaveLength(1);
    });
});

describe('buildCreatePayload — WhatsApp medium', () => {
    it('sends the snake_case keys AnnouncementDeliveryService actually reads', () => {
        const payload = buildCreatePayload({
            ...basePayloadInput,
            mediums: ['WHATSAPP'],
            selectedWaTemplate: template,
        });
        const config = payload.mediums[0]?.config as Record<string, unknown>;
        expect(payload.mediums[0]?.mediumType).toBe('WHATSAPP');
        expect(config.template_name).toBe('batch_start_reminder');
        expect(config.language_code).toBe('hi');
        expect(config.header_type).toBe('image');
        expect(config.header_url).toBe('https://cdn.example.com/banner.png');
        // The old camelCase keys silently produced a no-op delivery.
        expect(config.template).toBeUndefined();
        expect(config.variables).toBeUndefined();
    });

    it('maps bound variables to the tokens the backend substitutes', () => {
        const payload = buildCreatePayload({
            ...basePayloadInput,
            mediums: ['WHATSAPP'],
            selectedWaTemplate: template,
        });
        const config = payload.mediums[0]?.config as Record<string, unknown>;
        expect(config.dynamic_values).toEqual({
            name: '{{name}}',
            message: 'Class starts Monday',
        });
    });

    it('supports the wider recipient variable set, not just the announcement fields', () => {
        const payload = buildCreatePayload({
            ...basePayloadInput,
            mediums: ['WHATSAPP'],
            selectedWaTemplate: {
                ...template,
                bodyVariableNames: ['who', 'mail', 'cell', 'day'],
            },
            whatsapp: {
                ...whatsapp,
                variables: {
                    who: { source: 'RECIPIENT_FULL_NAME', customValue: '' },
                    mail: { source: 'RECIPIENT_EMAIL', customValue: '' },
                    cell: { source: 'RECIPIENT_PHONE', customValue: '' },
                    day: { source: 'CURRENT_DATE', customValue: '' },
                },
            },
        });
        const config = payload.mediums[0]?.config as Record<string, unknown>;
        expect(config.dynamic_values).toEqual({
            who: '{{full_name}}',
            mail: '{{email}}',
            cell: '{{mobile_number}}',
            day: '{{current_date}}',
        });
    });

    it('omits header keys for a text-header template', () => {
        const payload = buildCreatePayload({
            ...basePayloadInput,
            mediums: ['WHATSAPP'],
            selectedWaTemplate: { ...template, headerType: 'TEXT' },
        });
        const config = payload.mediums[0]?.config as Record<string, unknown>;
        expect(config).not.toHaveProperty('header_type');
        expect(config).not.toHaveProperty('header_url');
    });
});

describe('buildCreatePayload — scheduling', () => {
    it('sends the picked wall-clock literal rather than a UTC-shifted one', () => {
        const payload = buildCreatePayload({
            ...basePayloadInput,
            scheduleType: 'ONE_TIME',
            oneTimeStart: '2026-09-01T09:00',
        });
        expect(payload.scheduling).toMatchObject({
            scheduleType: 'ONE_TIME',
            startDate: '2026-09-01T09:00:00',
            timezone: 'Asia/Kolkata',
        });
    });

    it('drops an empty APP_OVERLAY showUntil, which the backend cannot parse', () => {
        const payload = buildCreatePayload({
            ...basePayloadInput,
            modes: ['APP_OVERLAY'],
            modeSettings: { APP_OVERLAY: { priority: 1, showUntil: '' } },
        });
        expect(payload.modes[0]?.settings).not.toHaveProperty('showUntil');
    });
});

describe('validateSection', () => {
    const input = {
        title: 'Hi',
        htmlContent: '<p>Body</p>',
        contentText: 'Body',
        previewText: 'Body',
        rules: [] as AudienceRule[],
        batchById: {} as Record<string, BatchOption>,
        modes: ['SYSTEM_ALERT' as const],
        modeSettings: { SYSTEM_ALERT: { priority: 'HIGH' } },
        mediums: [] as never[],
        push: { title: '', body: '' },
        email: { templateId: '', templateName: '', fromKey: '', subjectOverride: '' },
        whatsapp,
        selectedWaTemplate: null,
        hasEmailSenders: true,
        scheduleType: 'IMMEDIATE' as const,
        oneTimeStart: '',
        cronExpression: '',
    };

    it('blocks an empty audience', () => {
        expect(validateSection('recipients', tValidation, input).blockers).toHaveLength(1);
    });

    it('blocks a batch rule with no batch selected', () => {
        const result = validateSection('recipients', tValidation, {
            ...input,
            rules: [rule({ key: 'r1', type: 'PACKAGE_SESSION' })],
        });
        expect(result.errors['rule.r1.batches']).toBeDefined();
    });

    it('requires a sub-organisation role when an org batch is selected', () => {
        const result = validateSection('recipients', tValidation, {
            ...input,
            rules: [rule({ key: 'r1', type: 'PACKAGE_SESSION', packageSessionIds: ['org'] })],
            batchById: { org: batch('org', true) },
        });
        expect(result.errors['rule.r1.orgRole']).toBeDefined();
    });

    it('requires a media URL for a media-header WhatsApp template', () => {
        const result = validateSection('delivery', tValidation, {
            ...input,
            mediums: ['WHATSAPP'] as never,
            selectedWaTemplate: template,
            whatsapp: { ...whatsapp, headerUrl: '  ' },
        });
        expect(result.errors['whatsapp.headerUrl']).toBeDefined();
    });

    it('requires custom text when a variable is bound to “Custom”', () => {
        const result = validateSection('delivery', tValidation, {
            ...input,
            mediums: ['WHATSAPP'] as never,
            selectedWaTemplate: template,
            whatsapp: {
                ...whatsapp,
                variables: {
                    ...whatsapp.variables,
                    message: { source: 'CUSTOM', customValue: '' },
                },
            },
        });
        expect(result.errors['whatsapp.var.message']).toBeDefined();
    });
});

describe('interpretApiError', () => {
    it('maps a scheduling field error onto the delivery section', () => {
        const failure = interpretApiError(tPayload, {
            response: {
                status: 400,
                data: { details: { 'scheduling.startDate': 'Must be future' } },
            },
        });
        expect(failure.fieldErrors['schedule.startDate']).toBe('Must be future');
        expect(failure.section).toBe('delivery');
    });

    it('explains a permission failure rather than showing a bare status', () => {
        const failure = interpretApiError(tPayload, { response: { status: 403, data: {} } });
        expect(failure.message).toMatch(/permission/i);
    });
});
