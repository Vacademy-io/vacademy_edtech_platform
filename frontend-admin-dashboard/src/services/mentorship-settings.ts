import { GET_INSTITUTE_SETTING_DATA, SAVE_INSTITUTE_SETTING } from '@/constants/urls';
import authenticatedAxiosInstance from '@/lib/auth/axiosInstance';
import { getCurrentInstituteId } from '@/lib/auth/instituteUtils';

/**
 * Institute-setting key for the mentorship notification configuration. The blob
 * mirrors what {@code MentorshipNotificationService} on admin_core_service reads,
 * so field names here are the exact snake_case keys the backend looks up. When the
 * setting is absent the backend falls back to code defaults, which these defaults
 * mirror — so what the admin sees is what actually gets sent.
 */
export const SETTING_KEY_MENTORSHIP = 'MENTORSHIP_SETTING';

/** Placeholders admins can drop into any template field. Kept in sync with the backend. */
export const MENTORSHIP_PLACEHOLDERS = [
    { token: '{{name}}', label: "Recipient's name" },
    { token: '{{mentor_name}}', label: "Mentor's name" },
    { token: '{{student_name}}', label: "Student's name" },
    { token: '{{session_title}}', label: 'Session title (booking/cancellation)' },
    { token: '{{session_datetime}}', label: 'Session date & time (booking/cancellation)' },
    { token: '{{decision_note}}', label: 'Your decline reason (mentor request)' },
] as const;

/** Email channel: on/off + editable subject + HTML body (with {{placeholders}}). */
export interface MentorshipEmailTemplate {
    enabled: boolean;
    subject: string;
    body: string;
}

/** In-app alert / push channel: on/off + editable title + body (with {{placeholders}}). */
export interface MentorshipTextTemplate {
    enabled: boolean;
    title: string;
    body: string;
}

/**
 * WhatsApp channel: on/off + an APPROVED Meta template name + language, plus an
 * optional variable mapping (template variable → mentorship field, or `static:<literal>`).
 * When the mapping is empty the backend name-matches the template's variables to the
 * mentorship fields automatically.
 */
export interface MentorshipWhatsappTemplate {
    enabled: boolean;
    template_name: string;
    language_code: string;
    variable_mapping: Record<string, string>;
}

export interface MentorshipTriggerSettings {
    email: MentorshipEmailTemplate;
    system_alert: MentorshipTextTemplate;
    push: MentorshipTextTemplate;
    whatsapp: MentorshipWhatsappTemplate;
}

export interface MentorshipAssignmentTrigger extends MentorshipTriggerSettings {
    notify_student: boolean;
    notify_mentor: boolean;
}

/**
 * A learner asked for a mentor from the Find-a-mentor directory.
 * `notify_mentor` tells the requested mentor someone asked for them (fixed text,
 * like the assignment trigger's mentor side). `notify_student` sends the learner
 * the decline notice — the editable message below is that one. Approvals send
 * nothing here: the assignment they create already fires "You have a new mentor".
 */
export interface MentorshipRequestTrigger extends MentorshipTriggerSettings {
    notify_student: boolean;
    notify_mentor: boolean;
}

/** Scheduler-driven: one reminder per booked session, `hours_before` the start. */
export interface MentorshipSessionReminderTrigger extends MentorshipTriggerSettings {
    enabled: boolean;
    hours_before: number;
}

/** Scheduler-driven: nudge after `inactivity_days` without a mentor session. Opt-in. */
export interface MentorshipCheckinReminderTrigger extends MentorshipTriggerSettings {
    enabled: boolean;
    inactivity_days: number;
}

export interface MentorshipSettings {
    /** A mentor↔student assignment was created (manual or round-robin). */
    assignment: MentorshipAssignmentTrigger;
    /** A learner booked a 1:1 mentor session. Email defaults OFF (the booking page emails). */
    booking: MentorshipTriggerSettings;
    /** A mentor session was cancelled. */
    cancellation: MentorshipTriggerSettings;
    /** Upcoming-session reminder (scheduler). */
    session_reminder: MentorshipSessionReminderTrigger;
    /** Inactivity check-in nudge (scheduler). Master flag defaults OFF. */
    checkin_reminder: MentorshipCheckinReminderTrigger;
    /** A learner requested a mentor; the editable message is the decline notice. */
    request: MentorshipRequestTrigger;
}

const whatsappDefault = (): MentorshipWhatsappTemplate => ({
    enabled: false,
    template_name: '',
    language_code: 'en',
    variable_mapping: {},
});

export const DEFAULT_MENTORSHIP_SETTINGS: MentorshipSettings = {
    assignment: {
        notify_student: true,
        notify_mentor: true,
        email: {
            enabled: true,
            subject: 'You have a new mentor',
            body: '<p>Hi {{name}},</p><p><b>{{mentor_name}}</b> is now your mentor. Open <b>My Mentors</b> in your dashboard sidebar to message them directly or book a 1:1 session.</p>',
        },
        system_alert: {
            enabled: true,
            title: 'You have a new mentor',
            body: '{{mentor_name}} is now your mentor. Open My Mentors in the sidebar to message them or book a session.',
        },
        push: {
            enabled: true,
            title: 'You have a new mentor',
            body: '{{mentor_name}} is now your mentor. Open My Mentors to message them or book a session.',
        },
        whatsapp: whatsappDefault(),
    },
    booking: {
        email: {
            enabled: false,
            subject: 'Mentor session booked',
            body: '<p>Hi {{name}},</p><p>Your session <b>{{session_title}}</b> is confirmed for <b>{{session_datetime}}</b>.</p>',
        },
        system_alert: {
            enabled: true,
            title: 'Mentor session booked',
            body: 'Your session "{{session_title}}" is confirmed for {{session_datetime}}.',
        },
        push: {
            enabled: true,
            title: 'Mentor session booked',
            body: 'Your session "{{session_title}}" is confirmed for {{session_datetime}}.',
        },
        whatsapp: whatsappDefault(),
    },
    cancellation: {
        email: {
            enabled: true,
            subject: 'Mentor session cancelled',
            body: '<p>Hi {{name}},</p><p>Your session <b>{{session_title}}</b> for {{session_datetime}} was cancelled.</p>',
        },
        system_alert: {
            enabled: true,
            title: 'Mentor session cancelled',
            body: 'Your session "{{session_title}}" was cancelled.',
        },
        push: {
            enabled: true,
            title: 'Mentor session cancelled',
            body: 'Your session "{{session_title}}" was cancelled.',
        },
        whatsapp: whatsappDefault(),
    },
    session_reminder: {
        enabled: true,
        hours_before: 24,
        email: {
            enabled: true,
            subject: 'Reminder: your mentor session is coming up',
            body: '<p>Hi {{name}},</p><p>Your session <b>{{session_title}}</b> with <b>{{mentor_name}}</b> starts at <b>{{session_datetime}}</b>. Open <b>My Mentors</b> if you need the joining link.</p>',
        },
        system_alert: {
            enabled: true,
            title: 'Upcoming mentor session',
            body: '"{{session_title}}" with {{mentor_name}} starts at {{session_datetime}}.',
        },
        push: {
            enabled: true,
            title: 'Upcoming mentor session',
            body: '"{{session_title}}" with {{mentor_name}} starts at {{session_datetime}}.',
        },
        whatsapp: whatsappDefault(),
    },
    checkin_reminder: {
        // Opt-in: unlike the other triggers this one emails out of the blue,
        // so it stays off until an institute turns it on. Mirrors the backend default.
        enabled: false,
        inactivity_days: 14,
        email: {
            enabled: true,
            subject: 'Time to catch up with your mentor?',
            body: "<p>Hi {{name}},</p><p>It's been a while since your last session with <b>{{mentor_name}}</b>. Open <b>My Mentors</b> to book a 1:1 or send them a message.</p>",
        },
        system_alert: {
            enabled: true,
            title: 'Catch up with your mentor',
            body: "It's been a while since you connected with {{mentor_name}}. Book a session or send them a message.",
        },
        push: {
            enabled: true,
            title: 'Catch up with your mentor',
            body: "It's been a while since you connected with {{mentor_name}}. Book a session or message them.",
        },
        whatsapp: whatsappDefault(),
    },
    request: {
        notify_student: true,
        notify_mentor: true,
        email: {
            enabled: true,
            subject: 'About your mentor request',
            body: "<p>Hi {{name}},</p><p>Your request for a mentor wasn't taken forward this time.{{decision_note_html}}</p><p>You can browse other mentors and request again from <b>Find a mentor</b> in your dashboard.</p>",
        },
        system_alert: {
            enabled: true,
            title: 'Mentor request update',
            body: "Your mentor request wasn't approved this time. Browse other mentors in Find a mentor.",
        },
        push: {
            enabled: true,
            title: 'Mentor request update',
            body: "Your mentor request wasn't approved this time. Browse other mentors in Find a mentor.",
        },
        whatsapp: whatsappDefault(),
    },
};

// The institute being worked in (selected institute; the token's first only when none is
// selected) — not always the token's first institute. A multi-institute admin otherwise
// read and saved mentorship settings on the wrong institute, and the backend now rejects a
// setting save whose clientId isn't the target instituteId.
const getInstituteId = (): string => {
    const instituteId = getCurrentInstituteId();
    if (!instituteId) throw new Error('No institute ID found in token');
    return instituteId;
};

// Merge a persisted channel object (or legacy boolean) onto the default channel.
// Exported for unit tests only — call sites go through getMentorshipSettings.
export const mergeChannel = <T extends { enabled: boolean }>(def: T, raw: unknown): T => {
    if (typeof raw === 'boolean') return { ...def, enabled: raw };
    if (raw && typeof raw === 'object') return { ...def, ...(raw as Partial<T>) };
    return def;
};

export const mergeTrigger = <T extends MentorshipTriggerSettings>(def: T, raw: unknown): T => {
    const p = (raw ?? {}) as Partial<Record<keyof MentorshipTriggerSettings, unknown>> &
        Record<string, unknown>;
    return {
        ...def,
        ...(raw && typeof raw === 'object' ? (raw as Partial<T>) : {}),
        email: mergeChannel(def.email, p.email),
        system_alert: mergeChannel(def.system_alert, p.system_alert),
        push: mergeChannel(def.push, p.push),
        whatsapp: mergeChannel(def.whatsapp, p.whatsapp),
    };
};

export const getMentorshipSettings = async (): Promise<MentorshipSettings> => {
    try {
        const instituteId = getInstituteId();
        const response = await authenticatedAxiosInstance.get(GET_INSTITUTE_SETTING_DATA, {
            params: { instituteId, settingKey: SETTING_KEY_MENTORSHIP },
        });
        const raw = response.data;
        if (!raw || typeof raw !== 'object') return DEFAULT_MENTORSHIP_SETTINGS;
        const partial = raw as Partial<MentorshipSettings>;
        return {
            assignment: {
                ...mergeTrigger(DEFAULT_MENTORSHIP_SETTINGS.assignment, partial.assignment),
                notify_student:
                    (partial.assignment as MentorshipAssignmentTrigger | undefined)?.notify_student ??
                    DEFAULT_MENTORSHIP_SETTINGS.assignment.notify_student,
                notify_mentor:
                    (partial.assignment as MentorshipAssignmentTrigger | undefined)?.notify_mentor ??
                    DEFAULT_MENTORSHIP_SETTINGS.assignment.notify_mentor,
            },
            booking: mergeTrigger(DEFAULT_MENTORSHIP_SETTINGS.booking, partial.booking),
            cancellation: mergeTrigger(DEFAULT_MENTORSHIP_SETTINGS.cancellation, partial.cancellation),
            // mergeTrigger spreads the raw object over the defaults, so the scalar
            // fields (enabled / hours_before / inactivity_days) merge along with it.
            session_reminder: mergeTrigger(
                DEFAULT_MENTORSHIP_SETTINGS.session_reminder,
                partial.session_reminder
            ),
            checkin_reminder: mergeTrigger(
                DEFAULT_MENTORSHIP_SETTINGS.checkin_reminder,
                partial.checkin_reminder
            ),
            request: {
                ...mergeTrigger(DEFAULT_MENTORSHIP_SETTINGS.request, partial.request),
                notify_student:
                    (partial.request as MentorshipRequestTrigger | undefined)?.notify_student ??
                    DEFAULT_MENTORSHIP_SETTINGS.request.notify_student,
                notify_mentor:
                    (partial.request as MentorshipRequestTrigger | undefined)?.notify_mentor ??
                    DEFAULT_MENTORSHIP_SETTINGS.request.notify_mentor,
            },
        };
    } catch (err) {
        console.error('Failed to load mentorship settings, using defaults', err);
        return DEFAULT_MENTORSHIP_SETTINGS;
    }
};

export const saveMentorshipSettings = async (settings: MentorshipSettings): Promise<void> => {
    const instituteId = getInstituteId();
    // GenericSettingRequest uses @JsonNaming(SnakeCaseStrategy) — the wrapper keys
    // must be snake_case (setting_name / setting_data) or the save silently no-ops.
    await authenticatedAxiosInstance.post(
        SAVE_INSTITUTE_SETTING,
        {
            setting_name: 'Mentorship Settings',
            setting_data: settings,
        },
        {
            params: { instituteId, settingKey: SETTING_KEY_MENTORSHIP },
        }
    );
};
