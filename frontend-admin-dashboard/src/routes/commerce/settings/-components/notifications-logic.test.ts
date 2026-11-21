/** F10: notification settings bodies, conflict handling, test-send mapping and Retry-After. */
import { describe, expect, it } from 'vitest';
import { normalizeTrigger } from './notifications-api';
import {
    draftOf,
    hasChanges,
    insertVariable,
    keepTypedOnConflict,
    mapTestResults,
    retryMinutes,
    shopDraftOf,
    shopProblems,
    shopUpdateBody,
    switchBody,
    triggerUpdateBody,
} from './notifications-logic';

const row = (version = 3, overridden = { hi: false, en: true }) =>
    normalizeTrigger({
        trigger: 'ORDER_SHIPPED',
        enabled: true,
        email_enabled: true,
        whatsapp_enabled: true,
        version,
        variables: ['customer_name', 'order_number'],
        whatsapp: {
            template_name: 'commerce_order_shipped',
            default_template_name: 'commerce_order_shipped',
            status: { hi: 'APPROVED', en: 'PENDING' },
            text: { hi: 'हिंदी पाठ', en: 'English text' },
        },
        email: {
            subject: { hi: 'आपका ऑर्डर भेजा गया', en: 'Your order is on its way' },
            body: { hi: 'नमस्ते {{customer_name}}', en: 'Hello {{customer_name}}' },
            overridden,
        },
    });

describe('trigger PUT body', () => {
    it('nothing changed: only the version', () => {
        const body = triggerUpdateBody(row(), draftOf(row()));
        expect(body).toEqual({ version: 3 });
        expect(hasChanges(body)).toBe(false);
    });

    it('version plus only the changed keys', () => {
        const draft = draftOf(row());
        draft.whatsapp_enabled = false;
        draft.subject.en = 'Shipped: {{order_number}}';
        expect(triggerUpdateBody(row(), draft)).toEqual({
            version: 3,
            whatsapp_enabled: false,
            email: { en: { subject: 'Shipped: {{order_number}}', body: 'Hello {{customer_name}}' } },
        });
    });

    it('a template name, and clearing it back to the default sends null', () => {
        const draft = draftOf(row());
        draft.whatsapp_template_name = 'shop_shipped_v2';
        expect(triggerUpdateBody(row(), draft)).toEqual({ version: 3, whatsapp_template_name: 'shop_shipped_v2' });
        const custom = normalizeTrigger({
            ...row(),
            whatsapp: { ...row().whatsapp, template_name: 'shop_shipped_v2' },
        });
        const back = draftOf(custom);
        expect(back.whatsapp_template_name).toBe('shop_shipped_v2');
        back.whatsapp_template_name = '';
        expect(triggerUpdateBody(custom, back)).toEqual({ version: 3, whatsapp_template_name: null });
    });

    it('email reset sends null, only for an overridden language', () => {
        const draft = draftOf(row());
        draft.reset = { hi: true, en: true };
        expect(triggerUpdateBody(row(), draft)).toEqual({ version: 3, email: { en: null } });
    });

    it('a switch sends the version and that key', () => {
        expect(switchBody(row(7), 'email_enabled', false)).toEqual({ version: 7, email_enabled: false });
    });
});

describe('SETTING_VERSION_CONFLICT', () => {
    it('keeps the typed text; the next save uses the fresh version', () => {
        const draft = draftOf(row(3));
        draft.body.hi = 'नया पाठ {{order_number}}';
        const fresh = row(4);
        const kept = keepTypedOnConflict(fresh, draft);
        expect(kept.draft.body.hi).toBe('नया पाठ {{order_number}}');
        expect(kept.draft).not.toBe(draft);
        const body = triggerUpdateBody(kept.original, kept.draft);
        expect(body.version).toBe(4);
        expect(body.email?.hi).toEqual({ subject: 'आपका ऑर्डर भेजा गया', body: 'नया पाठ {{order_number}}' });
    });
});

describe('shop body', () => {
    const shop = {
        link_base_url: 'https://shop.example',
        link_base_candidates: ['https://shop.example', 'https://www.shop.example'],
        link_days: 7,
        shop_name: { hi: 'दुकान' },
        shop_name_default: 'The shop',
        base_locale: 'hi',
        link_secret_configured: true,
        sending_enabled: true,
    };

    it('changed keys only; a blank name and "No link" become null', () => {
        const draft = shopDraftOf(shop);
        expect(shopUpdateBody(shop, draft)).toEqual({});
        draft.link_base_url = '';
        draft.link_days = '14';
        draft.shop_name.hi = '  ';
        expect(shopUpdateBody(shop, draft)).toEqual({ link_base_url: null, link_days: 14, shop_name: { hi: null } });
    });

    it('link days 1..30 and names of at most 60 characters', () => {
        const draft = shopDraftOf(shop);
        draft.link_days = '31';
        draft.shop_name.en = 'x'.repeat(61);
        expect(shopProblems(draft)).toEqual(['linkDays', 'shopNameEn']);
    });
});

describe('test send', () => {
    it('maps known codes to keys and keeps unknown ones as they came', () => {
        expect(
            mapTestResults([
                { channel: 'EMAIL', status: 'SENT', code: null, recipient_masked: 'a***@example.com' },
                { channel: 'WHATSAPP', status: 'SKIPPED', code: 'TEMPLATE_NOT_APPROVED', recipient_masked: '+91******01' },
                { channel: 'WHATSAPP', status: 'FAILED', code: 'SOMETHING_NEW', recipient_masked: null },
            ])
        ).toEqual([
            { channel: 'EMAIL', status: 'SENT', codeKey: null, raw: null, recipient: 'a***@example.com' },
            {
                channel: 'WHATSAPP',
                status: 'SKIPPED',
                codeKey: 'notifications.testCodes.TEMPLATE_NOT_APPROVED',
                raw: null,
                recipient: '+91******01',
            },
            { channel: 'WHATSAPP', status: 'FAILED', codeKey: null, raw: 'SOMETHING_NEW', recipient: null },
        ]);
    });

    it('Retry-After 125 s is 3 minutes; missing is 1', () => {
        expect(retryMinutes(125)).toBe(3);
        expect(retryMinutes(60)).toBe(1);
        expect(retryMinutes(null)).toBe(1);
    });
});

describe('variables', () => {
    it('inserts {{name}} at the cursor, replacing a selection', () => {
        expect(insertVariable('Hello !', 'customer_name', 6)).toEqual({ value: 'Hello {{customer_name}}!', cursor: 23 });
        expect(insertVariable('Hi XX', 'order_number', 3, 5)).toEqual({ value: 'Hi {{order_number}}', cursor: 19 });
    });
});
