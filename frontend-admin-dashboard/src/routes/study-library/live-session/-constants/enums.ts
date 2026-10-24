export enum SessionStatus {
    LIVE = 'Live',
    UPCOMING = 'Upcoming',
    PAST = 'Past',
    DRAFTS = 'Drafts',
}
export enum RecurringType {
    ONCE = 'once',
    WEEKLY = 'weekly',
    MONTHLY = 'monthly',
}
export enum AccessType {
    PUBLIC = 'public',
    PRIVATE = 'private',
}
// Per-session waiting room behaviour during the waiting-room window.
// WAITING_ROOM = learner enters the waiting-room screen.
// PRE_JOINING = learner joins the live class directly (pre-join).
export enum WaitingRoomType {
    WAITING_ROOM = 'WAITING_ROOM',
    PRE_JOINING = 'PRE_JOINING',
}
export enum InputType {
    TEXT = 'text',
    DROPDOWN = 'dropdown',
    NUMBER = 'number',
    EMAIL = 'email',
    URL = 'url',
    PHONE = 'phone',
    DATE = 'date',
    TEXTAREA = 'textarea',
    CHECKBOX = 'checkbox',
    RADIO = 'radio',
    FILE = 'file',
}
// Maps each status to the i18n key suffix used under the consuming component's
// `sessions.tabLabels` namespace (studyLibrarySessionsListPage) — kept here as
// plain data (no hardcoded display strings) so the enum stays the single source
// of truth for status ordering while translation lives in the locale JSON.
export const sessionStatusTabLabelKeys: Record<SessionStatus, string> = {
    [SessionStatus.UPCOMING]: 'upcoming',
    [SessionStatus.PAST]: 'past',
    [SessionStatus.DRAFTS]: 'draft',
    [SessionStatus.LIVE]: 'live',
};
export enum SessionType {
    LIVE = 'live',
    PRE_RECORDED = 'pre-recorded',
}
export enum SessionPlatform {
    EMBED_IN_APP = 'embed',
    REDIRECT_TO_OTHER_PLATFORM = 'redirect',
}
export enum StreamingPlatform {
    YOUTUBE = 'youtube',
    MEET = 'google meet',
    ZOOM = 'zoom',
    ZOHO = 'zoho',
    BBB = 'bbb',
    OTHER = 'other',
}
