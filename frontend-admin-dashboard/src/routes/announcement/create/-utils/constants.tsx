import type { Icon } from '@phosphor-icons/react';
import {
    Bell,
    Broadcast,
    ChatCircleDots,
    ClipboardText,
    DeviceMobile,
    EnvelopeSimple,
    FolderSimple,
    Megaphone,
    PushPin,
    UsersThree,
    WhatsappLogo,
} from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import type { MediumType, ModeType } from '@/services/announcement';
import type { ModeSettings, SectionDefinition } from '../-types';

/**
 * Namespace for this module's translated display strings — see
 * public/locales/en/announcementCreateConstants.json. Every consumer
 * resolves keys against this namespace explicitly (fully-qualified
 * `${NS}:key` lookups), since each is normally bound to its OWN component
 * namespace via its own `useTranslation` call.
 */
const NS = 'announcementCreateConstants';

export const FORM_SECTIONS: SectionDefinition[] = [
    { id: 'basics', title: 'Basic Information', caption: 'Title and message' },
    { id: 'recipients', title: 'Recipients', caption: 'Who receives it' },
    { id: 'placements', title: 'Display Locations', caption: 'Where it appears' },
    { id: 'delivery', title: 'Delivery', caption: 'Channels and timing' },
    { id: 'review', title: 'Review & Confirm', caption: 'Final check' },
];

export interface ModeMeta {
    type: ModeType;
    label: string;
    description: string;
    Icon: Icon;
}

/**
 * Display locations, ordered so the two everyday choices lead. `getModeMeta` in the old form
 * rebuilt this array on every render just to inline a preview; previews now live in the
 * preview rail, so this is a plain constant.
 */
export const MODE_META: ModeMeta[] = [
    {
        type: 'SYSTEM_ALERT',
        label: 'System Alert',
        description: 'Appears in the notification centre with a priority and optional expiry.',
        Icon: Bell,
    },
    {
        type: 'DASHBOARD_PIN',
        label: 'Dashboard Pin',
        description: 'Pinned to the dashboard for a defined time window.',
        Icon: PushPin,
    },
    {
        type: 'APP_OVERLAY',
        label: 'App Overlay',
        description: 'Full-screen message shown the next time the app is opened.',
        Icon: DeviceMobile,
    },
    {
        type: 'DM',
        label: 'Direct Message',
        description: 'Lands in the inbox as a message. Replies can be allowed.',
        Icon: ChatCircleDots,
    },
    {
        type: 'STREAM',
        label: 'Stream',
        description: 'Posts to a batch or class discussion stream.',
        Icon: Broadcast,
    },
    {
        type: 'RESOURCES',
        label: 'Resources',
        description: 'Files the announcement into a resources folder.',
        Icon: FolderSimple,
    },
    {
        type: 'COMMUNITY',
        label: 'Community',
        description: 'Posts to a community feed.',
        Icon: UsersThree,
    },
    {
        type: 'TASKS',
        label: 'Tasks',
        description: 'Creates a task with a go-live time and deadline.',
        Icon: ClipboardText,
    },
];

/** Translated equivalent of {@link MODE_META}, for components rendering these labels to users. */
export function buildModeMeta(t: TFunction): ModeMeta[] {
    return MODE_META.map((meta) => ({
        ...meta,
        label: t(`${NS}:modes.${meta.type}.label`),
        description: t(`${NS}:modes.${meta.type}.description`),
    }));
}

export interface MediumMeta {
    type: MediumType;
    label: string;
    description: string;
    Icon: Icon;
}

export const MEDIUM_META: MediumMeta[] = [
    {
        type: 'PUSH_NOTIFICATION',
        label: 'Push notification',
        description: 'Mobile and web push. Free, instant, best for short nudges.',
        Icon: Megaphone,
    },
    {
        type: 'EMAIL',
        label: 'Email',
        description: 'Rich HTML email from one of your verified sender addresses.',
        Icon: EnvelopeSimple,
    },
    {
        type: 'WHATSAPP',
        label: 'WhatsApp',
        description: 'Sent through an approved WhatsApp Business template.',
        Icon: WhatsappLogo,
    },
];

/** Translated equivalent of {@link MEDIUM_META}, for components rendering these labels to users. */
export function buildMediumMeta(t: TFunction): MediumMeta[] {
    return MEDIUM_META.map((meta) => ({
        ...meta,
        label: t(`${NS}:mediums.${meta.type}.label`),
        description: t(`${NS}:mediums.${meta.type}.description`),
    }));
}

/** Announcement presets — the two shapes almost every announcement takes. */
export const ANNOUNCEMENT_PRESETS = [
    {
        id: 'GENERAL' as const,
        label: 'General Announcement',
        description: 'General updates and information',
        modes: ['SYSTEM_ALERT'] as ModeType[],
        mediums: ['PUSH_NOTIFICATION', 'EMAIL'] as MediumType[],
        Icon: Megaphone,
    },
    {
        id: 'PINNED' as const,
        label: 'Pinned Update',
        description: 'Important updates pinned on top',
        modes: ['DASHBOARD_PIN'] as ModeType[],
        mediums: ['PUSH_NOTIFICATION'] as MediumType[],
        Icon: PushPin,
    },
];

/** Translated equivalent of {@link ANNOUNCEMENT_PRESETS}, for components rendering these labels to users. */
export function buildAnnouncementPresets(t: TFunction) {
    return ANNOUNCEMENT_PRESETS.map((preset) => ({
        ...preset,
        label: t(`${NS}:presets.${preset.id}.label`),
        description: t(`${NS}:presets.${preset.id}.description`),
    }));
}

export function defaultModeSettings(mode: ModeType): ModeSettings {
    switch (mode) {
        case 'SYSTEM_ALERT':
            return { priority: 'HIGH', expiresAt: '' };
        case 'DASHBOARD_PIN':
            return { priority: 10, pinStartTime: '', pinEndTime: '', position: 'TOP' };
        case 'APP_OVERLAY':
            return { priority: 1, showUntil: '', isDismissible: true };
        case 'DM':
            return { messagePriority: 5, allowReplies: true };
        case 'STREAM':
            return { packageSessionId: '', streamType: 'LIVE' };
        case 'RESOURCES':
            return { folderName: '', category: '', accessLevel: 'STUDENTS' };
        case 'COMMUNITY':
            return { communityType: 'SCHOOL', tags: [] };
        case 'TASKS':
            return {
                slideIds: [],
                goLiveDateTime: '',
                deadlineDateTime: '',
                status: 'SCHEDULED',
                taskTitle: '',
                taskDescription: '',
                estimatedDurationMinutes: 0,
                maxAttempts: 1,
                isMandatory: false,
                autoStatusUpdate: true,
                reminderBeforeMinutes: 0,
            };
        default:
            return {};
    }
}

/**
 * What a WhatsApp template variable can be filled with.
 *
 * Each entry is a token `AnnouncementDeliveryService#prepareDynamicValues` substitutes per
 * recipient at send time — the same names the announcement email path understands, so a template
 * built for one channel works on the other. Keep this list and that method in step.
 */
export const WHATSAPP_VALUE_SOURCES = [
    // Recipient
    { value: 'RECIPIENT_NAME', label: "Recipient's name", token: '{{name}}', group: 'Recipient' },
    {
        value: 'RECIPIENT_FULL_NAME',
        label: 'Full name',
        token: '{{full_name}}',
        group: 'Recipient',
    },
    { value: 'RECIPIENT_USERNAME', label: 'Username', token: '{{username}}', group: 'Recipient' },
    { value: 'RECIPIENT_EMAIL', label: 'Email address', token: '{{email}}', group: 'Recipient' },
    {
        value: 'RECIPIENT_PHONE',
        label: 'Mobile number',
        token: '{{mobile_number}}',
        group: 'Recipient',
    },
    { value: 'RECIPIENT_ID', label: 'User id', token: '{{student_id}}', group: 'Recipient' },
    // Announcement
    {
        value: 'ANNOUNCEMENT_TITLE',
        label: 'Announcement title',
        token: '{{title}}',
        group: 'Announcement',
    },
    {
        value: 'ANNOUNCEMENT_CONTENT',
        label: 'Announcement content',
        token: '{{content}}',
        group: 'Announcement',
    },
    { value: 'SENDER_NAME', label: 'Sender name', token: '{{created_by}}', group: 'Announcement' },
    // General
    { value: 'CURRENT_DATE', label: "Today's date", token: '{{current_date}}', group: 'General' },
    { value: 'CURRENT_TIME', label: 'Current time', token: '{{current_time}}', group: 'General' },
    { value: 'CUSTOM', label: 'Custom text…', token: '', group: 'General' },
] as const;

/** Translated equivalent of {@link WHATSAPP_VALUE_SOURCES}, for components rendering these labels to users. */
export function buildWhatsAppValueSources(t: TFunction) {
    return WHATSAPP_VALUE_SOURCES.map((source) => ({
        ...source,
        label: t(`${NS}:whatsappValues.${source.value}`),
    }));
}

export const WHATSAPP_VALUE_GROUPS = ['Recipient', 'Announcement', 'General'] as const;

export const CRON_PRESETS = [
    { id: 'DAILY_9', label: 'Every day, 9:00 AM', expression: '0 0 9 * * ?' },
    { id: 'MON_9', label: 'Every Monday, 9:00 AM', expression: '0 0 9 ? * MON' },
    { id: 'HOURLY', label: 'Every hour', expression: '0 0 * * * ?' },
];

/** Translated equivalent of {@link CRON_PRESETS}, for components rendering these labels to users. */
export function buildCronPresets(t: TFunction) {
    return CRON_PRESETS.map((preset) => ({
        ...preset,
        label: t(`${NS}:cronPresets.${preset.id}`),
    }));
}

export const DEVICE_PRESETS = {
    mobile: { label: 'Mobile', width: 390 },
    tablet: { label: 'Tablet', width: 768 },
    laptop: { label: 'Laptop', width: 1280 },
} as const;

export type PreviewDevice = keyof typeof DEVICE_PRESETS;
