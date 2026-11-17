/**
 * Notifications settings (contract §5.12): the wire shapes and the pure rules
 * the screens use. Every trigger write sends the `version` it read plus only
 * the keys that changed; a 409 SETTING_VERSION_CONFLICT keeps what was typed.
 */

export const NOTIFICATION_LOCALES = ['hi', 'en'] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];

/** `CommerceNotificationTrigger`, in the server's order. */
export const NOTIFICATION_TRIGGERS = [
    'ORDER_CONFIRMED',
    'COD_CONFIRMATION_NEEDED',
    'ORDER_SHIPPED',
    'ORDER_DELIVERED',
    'ORDER_CANCELLED',
    'ORDER_RTO',
    'RETURN_APPROVED',
    'REFUND_PROCESSED',
    'POS_BILL_ISSUED',
] as const;

/** Result codes of `POST /notification-settings/test-send` (CommerceNotificationTestSendService). */
export const TEST_SEND_CODES = [
    'NO_EMAIL',
    'NO_PHONE',
    'TEMPLATE_NOT_APPROVED',
    'TEMPLATE_NOT_UTILITY',
    'NO_SHOP_URL',
    'PLATFORM_ERROR',
    'ANSWER_UNREADABLE',
    'QUEUED_BY_PLATFORM',
    'UNSUBSCRIBED',
    'ADDRESS_BLOCKED',
    'NO_CREDITS',
    'PROVIDER_REJECTED',
] as const;

/**
 * `error_code` values a delivery row can carry (CommerceNotificationDispatcher
 * `finish`/`retry`/`releaseClaim`, CommerceNotificationStore expire and claim-lost).
 */
export const DELIVERY_CODES = [
    'COMMERCE_OFF',
    'FEATURE_UNKNOWN',
    'STALE',
    'NOT_APPLICABLE',
    'OUTCOME_UNKNOWN',
    'NO_PHONE',
    'NO_EMAIL',
    'PHONE_NOT_VERIFIED',
    'TEMPLATE_NOT_APPROVED',
    'TEMPLATE_NOT_UTILITY',
    'NO_SHOP_URL',
    'WORKFLOW_ERROR',
    'PLATFORM_UNREACHABLE',
    'PLATFORM_UNAVAILABLE',
    'REQUEST_REFUSED',
    'ANSWER_UNREADABLE',
    'QUEUED_BY_PLATFORM',
    'UNSUBSCRIBED',
    'ADDRESS_BLOCKED',
    'NO_CREDITS',
    'PROVIDER_REJECTED',
    'RETRIES_EXHAUSTED',
    'EXPIRED',
    'CLAIM_LOST',
] as const;

/** Codes of a WhatsApp template request (CommerceNotificationTemplateSubmitService). */
export const TEMPLATE_SUBMIT_CODES = ['CREATED_AND_SUBMITTED', 'EXISTS', 'PROVIDER_NOT_SUPPORTED', 'PROVIDER_ERROR'] as const;

export const TEST_CHANNELS = ['EMAIL', 'WHATSAPP'] as const;
export type TestChannel = (typeof TEST_CHANNELS)[number];

export const MIN_LINK_DAYS = 1;
export const MAX_LINK_DAYS = 30;
export const MAX_SHOP_NAME = 60;
export const MAX_EMAIL_SUBJECT = 150;
export const MAX_EMAIL_BODY = 2000;
export const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,100}$/;

export type LocaleText = Partial<Record<NotificationLocale, string>>;

export interface NotificationShop {
    link_base_url: string | null;
    link_base_candidates: string[];
    link_days: number | null;
    shop_name: LocaleText;
    shop_name_default: string | null;
    base_locale: string | null;
    link_secret_configured: boolean;
    sending_enabled: boolean;
}

export interface NotificationTrigger {
    trigger: string;
    enabled: boolean;
    email_enabled: boolean;
    whatsapp_enabled: boolean;
    handled_by_workflow: boolean;
    version: number;
    variables: string[];
    whatsapp: {
        template_name: string | null;
        default_template_name: string | null;
        status: LocaleText;
        text: LocaleText;
    };
    email: {
        subject: LocaleText;
        body: LocaleText;
        overridden: Partial<Record<NotificationLocale, boolean>>;
    };
}

export interface NotificationSettings {
    shop: NotificationShop;
    triggers: NotificationTrigger[];
}

export type EmailPatch = Partial<Record<NotificationLocale, { subject: string; body: string } | null>>;

export interface TriggerUpdate {
    version: number;
    enabled?: boolean;
    email_enabled?: boolean;
    whatsapp_enabled?: boolean;
    /** null = back to the default template. */
    whatsapp_template_name?: string | null;
    email?: EmailPatch;
}

export interface ShopUpdate {
    link_base_url?: string | null;
    link_days?: number;
    shop_name?: Partial<Record<NotificationLocale, string | null>>;
}

/** What the trigger editor holds. `reset[lang]` = the email goes back to the default text. */
export interface TriggerDraft {
    enabled: boolean;
    email_enabled: boolean;
    whatsapp_enabled: boolean;
    /** '' = the default template. */
    whatsapp_template_name: string;
    subject: LocaleText;
    body: LocaleText;
    reset: Partial<Record<NotificationLocale, boolean>>;
}

export function draftOf(trigger: NotificationTrigger): TriggerDraft {
    const custom =
        trigger.whatsapp.template_name && trigger.whatsapp.template_name !== trigger.whatsapp.default_template_name
            ? trigger.whatsapp.template_name
            : '';
    return {
        enabled: trigger.enabled,
        email_enabled: trigger.email_enabled,
        whatsapp_enabled: trigger.whatsapp_enabled,
        whatsapp_template_name: custom,
        subject: { ...trigger.email.subject },
        body: { ...trigger.email.body },
        reset: {},
    };
}

/** `{version, …}` with only the keys whose value differs from what was read. */
export function triggerUpdateBody(original: NotificationTrigger, edited: TriggerDraft): TriggerUpdate {
    const out: TriggerUpdate = { version: original.version };
    const read = draftOf(original);
    if (edited.enabled !== read.enabled) out.enabled = edited.enabled;
    if (edited.email_enabled !== read.email_enabled) out.email_enabled = edited.email_enabled;
    if (edited.whatsapp_enabled !== read.whatsapp_enabled) out.whatsapp_enabled = edited.whatsapp_enabled;
    const template = edited.whatsapp_template_name.trim();
    if (template !== read.whatsapp_template_name) out.whatsapp_template_name = template || null;
    const email: EmailPatch = {};
    NOTIFICATION_LOCALES.forEach((lang) => {
        if (edited.reset[lang]) {
            if (original.email.overridden[lang]) email[lang] = null;
            return;
        }
        const subject = edited.subject[lang] ?? '';
        const body = edited.body[lang] ?? '';
        if (subject !== (original.email.subject[lang] ?? '') || body !== (original.email.body[lang] ?? '')) {
            email[lang] = { subject, body };
        }
    });
    if (Object.keys(email).length > 0) out.email = email;
    return out;
}

/** Nothing but the version: there is nothing to save. */
export const hasChanges = (body: TriggerUpdate | ShopUpdate): boolean =>
    Object.keys(body).some((key) => key !== 'version');

/** A switch on the row: the one changed key and the version. */
export function switchBody(
    trigger: NotificationTrigger,
    key: 'enabled' | 'email_enabled' | 'whatsapp_enabled',
    value: boolean
): TriggerUpdate {
    return { version: trigger.version, [key]: value };
}

/**
 * After 409 SETTING_VERSION_CONFLICT: the row is read again; the typed text stays
 * in the editor and is now compared with the fresh row (next save uses its version).
 */
export function keepTypedOnConflict(fresh: NotificationTrigger, typed: TriggerDraft): {
    original: NotificationTrigger;
    draft: TriggerDraft;
} {
    return { original: fresh, draft: { ...typed, subject: { ...typed.subject }, body: { ...typed.body }, reset: { ...typed.reset } } };
}

export interface ShopDraft {
    link_base_url: string;
    link_days: string;
    shop_name: Record<NotificationLocale, string>;
}

export function shopDraftOf(shop: NotificationShop): ShopDraft {
    return {
        link_base_url: shop.link_base_url ?? '',
        link_days: shop.link_days === null ? '' : String(shop.link_days),
        shop_name: { hi: shop.shop_name.hi ?? '', en: shop.shop_name.en ?? '' },
    };
}

export type ShopProblem = 'linkDays' | 'shopNameHi' | 'shopNameEn';

export function shopProblems(draft: ShopDraft): ShopProblem[] {
    const out: ShopProblem[] = [];
    const days = Number(draft.link_days);
    if (draft.link_days.trim() !== '' && (!Number.isInteger(days) || days < MIN_LINK_DAYS || days > MAX_LINK_DAYS)) {
        out.push('linkDays');
    }
    if ([...draft.shop_name.hi.trim()].length > MAX_SHOP_NAME || /[\r\n]/.test(draft.shop_name.hi)) out.push('shopNameHi');
    if ([...draft.shop_name.en.trim()].length > MAX_SHOP_NAME || /[\r\n]/.test(draft.shop_name.en)) out.push('shopNameEn');
    return out;
}

/** Only changed keys; a blank shop name goes back to the default (null). */
export function shopUpdateBody(shop: NotificationShop, draft: ShopDraft): ShopUpdate {
    const read = shopDraftOf(shop);
    const out: ShopUpdate = {};
    if (draft.link_base_url !== read.link_base_url) out.link_base_url = draft.link_base_url || null;
    if (draft.link_days.trim() !== read.link_days && draft.link_days.trim() !== '') {
        out.link_days = Number(draft.link_days);
    }
    const names: Partial<Record<NotificationLocale, string | null>> = {};
    NOTIFICATION_LOCALES.forEach((lang) => {
        const typed = draft.shop_name[lang].trim();
        if (typed !== read.shop_name[lang].trim()) names[lang] = typed || null;
    });
    if (Object.keys(names).length > 0) out.shop_name = names;
    return out;
}

export interface TestSendResult {
    channel: string;
    status: string;
    code: string | null;
    recipient_masked: string | null;
}

export interface TestSendRow {
    channel: string;
    status: string;
    /** `notifications.testCodes.<CODE>` when the code is known; else null. */
    codeKey: string | null;
    /** The code as it came, for a code the app does not know. */
    raw: string | null;
    recipient: string | null;
}

const KNOWN_TEST_CODES = new Set<string>(TEST_SEND_CODES);

export function mapTestResults(results: readonly TestSendResult[]): TestSendRow[] {
    return results.map((result) => {
        const code = result.code ? result.code.toUpperCase() : null;
        const known = !!code && KNOWN_TEST_CODES.has(code);
        return {
            channel: result.channel,
            status: result.status,
            codeKey: known ? `notifications.testCodes.${code}` : null,
            raw: known ? null : code,
            recipient: result.recipient_masked,
        };
    });
}

/** `Retry-After` seconds → whole minutes, rounded up, at least 1. */
export const retryMinutes = (seconds: number | null | undefined): number =>
    Math.max(1, Math.ceil((seconds ?? 60) / 60));

/** Insert `{{name}}` at the cursor of a text value. */
export function insertVariable(value: string, name: string, start: number, end = start): { value: string; cursor: number } {
    const token = `{{${name}}}`;
    const from = Math.max(0, Math.min(start, value.length));
    const to = Math.max(from, Math.min(end, value.length));
    return { value: value.slice(0, from) + token + value.slice(to), cursor: from + token.length };
}
