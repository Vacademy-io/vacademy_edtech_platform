import i18n from '@/i18n';

const NAMESPACE = 'mentorshipChatAvailability';

/**
 * Wording for the Message action when in-app chat is off.
 *
 * In-App Messages is OFF until an institute switches it on (Settings → Notifications),
 * and until then every conversation call is refused with 403 CHAT_DISABLED.
 *
 * Staff see the action DISABLED with this explanation rather than hidden: an admin or
 * mentor is exactly who can turn the setting on, so a missing button is a dead end —
 * they'd conclude mentorship messaging doesn't exist. Learners get it hidden instead,
 * because nothing in the answer is actionable for them.
 *
 * Exported as a function (not an eagerly-evaluated constant) so the string is
 * read from i18n's initialized resources at call time, not at module-import
 * time — this file is consumed by components outside this batch (see
 * MenteeDetailSheet.tsx), so it uses the i18n singleton rather than a
 * threaded `t`.
 */
export function chatOffReason(): string {
    return i18n.t('chatOffReason', { ns: NAMESPACE });
}

/** Tooltip for the Message action, naming the blocker when there is one. */
export function messageActionTitle(chatEnabled: boolean): string {
    return chatEnabled ? i18n.t('sendMessageTitle', { ns: NAMESPACE }) : chatOffReason();
}

/** Where an admin goes to switch In-App Messages on. */
export const CHAT_SETTINGS_LINK = {
    to: '/settings',
    search: { selectedTab: 'notification' },
} as const;
