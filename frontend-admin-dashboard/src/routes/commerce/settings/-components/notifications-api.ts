import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { asRecord, instituteParams, num, str } from '@/routes/commerce/-shared/commerce-api';
import {
    COMMERCE_NOTIFICATION_SETTINGS,
    COMMERCE_NOTIFICATION_SHOP,
    COMMERCE_NOTIFICATION_TEST_SEND,
    COMMERCE_NOTIFICATION_TRIGGER,
    COMMERCE_NOTIFICATION_WHATSAPP_TEMPLATES,
} from '@/routes/commerce/-shared/commerce-urls';
import type {
    LocaleText,
    NotificationSettings,
    NotificationShop,
    NotificationTrigger,
    ShopUpdate,
    TestSendResult,
    TriggerUpdate,
} from './notifications-logic';

/** Notification settings services (M, Ac, ADMIN read; M, ADMIN write). No React. */

const records = (value: unknown): Record<string, unknown>[] =>
    (Array.isArray(value) ? value : []).map(asRecord).filter((r): r is Record<string, unknown> => !!r);

const localeText = (value: unknown): LocaleText => {
    const r = asRecord(value) ?? {};
    const out: LocaleText = {};
    if (typeof r.hi === 'string') out.hi = r.hi;
    if (typeof r.en === 'string') out.en = r.en;
    return out;
};

export function normalizeShop(data: unknown): NotificationShop {
    const r = asRecord(data) ?? {};
    return {
        link_base_url: str(r.link_base_url),
        link_base_candidates: Array.isArray(r.link_base_candidates)
            ? r.link_base_candidates.filter((v): v is string => typeof v === 'string')
            : [],
        link_days: num(r.link_days),
        shop_name: localeText(r.shop_name),
        shop_name_default: str(r.shop_name_default),
        base_locale: str(r.base_locale),
        link_secret_configured: r.link_secret_configured !== false,
        sending_enabled: r.sending_enabled !== false,
    };
}

export function normalizeTrigger(data: unknown): NotificationTrigger {
    const r = asRecord(data) ?? {};
    const whatsapp = asRecord(r.whatsapp) ?? {};
    const email = asRecord(r.email) ?? {};
    const overridden = asRecord(email.overridden) ?? {};
    return {
        trigger: str(r.trigger) ?? '',
        enabled: r.enabled !== false,
        email_enabled: r.email_enabled !== false,
        whatsapp_enabled: r.whatsapp_enabled !== false,
        handled_by_workflow: r.handled_by_workflow === true,
        version: num(r.version) ?? 0,
        variables: Array.isArray(r.variables) ? r.variables.filter((v): v is string => typeof v === 'string') : [],
        whatsapp: {
            template_name: str(whatsapp.template_name),
            default_template_name: str(whatsapp.default_template_name),
            status: localeText(whatsapp.status),
            text: localeText(whatsapp.text),
        },
        email: {
            subject: localeText(email.subject),
            body: localeText(email.body),
            overridden: { hi: overridden.hi === true, en: overridden.en === true },
        },
    };
}

export function normalizeSettings(data: unknown): NotificationSettings {
    const r = asRecord(data) ?? {};
    return {
        shop: normalizeShop(r.shop),
        triggers: records(r.triggers).map(normalizeTrigger).filter((t) => t.trigger),
    };
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
    const res = await authenticatedAxiosInstance.get<unknown>(COMMERCE_NOTIFICATION_SETTINGS, {
        params: instituteParams(),
    });
    return normalizeSettings(res.data);
}

export async function updateTrigger(code: string, body: TriggerUpdate): Promise<NotificationTrigger> {
    const res = await authenticatedAxiosInstance.put<unknown>(COMMERCE_NOTIFICATION_TRIGGER(code), body, {
        params: instituteParams(),
    });
    return normalizeTrigger(res.data);
}

export async function updateShop(body: ShopUpdate): Promise<NotificationShop> {
    const res = await authenticatedAxiosInstance.put<unknown>(COMMERCE_NOTIFICATION_SHOP, body, {
        params: instituteParams(),
    });
    return normalizeShop(res.data);
}

export async function testSend(body: { trigger: string; locale: string; channels: string[] }): Promise<TestSendResult[]> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_NOTIFICATION_TEST_SEND, body, {
        params: instituteParams(),
    });
    return records(asRecord(res.data)?.results).map((r) => ({
        channel: str(r.channel) ?? '',
        status: str(r.status) ?? '',
        code: str(r.code),
        recipient_masked: str(r.recipient_masked),
    }));
}

export interface TemplateSubmitItem {
    trigger: string;
    locale: string;
    template_name: string | null;
    status: string | null;
    code: string | null;
}

export async function submitWhatsappTemplates(body: {
    triggers: string[] | null;
    locales: string[];
}): Promise<TemplateSubmitItem[]> {
    const res = await authenticatedAxiosInstance.post<unknown>(COMMERCE_NOTIFICATION_WHATSAPP_TEMPLATES, body, {
        params: instituteParams(),
    });
    return records(asRecord(res.data)?.items).map((r) => ({
        trigger: str(r.trigger) ?? '',
        locale: str(r.locale) ?? '',
        template_name: str(r.template_name),
        status: str(r.status),
        code: str(r.code),
    }));
}
