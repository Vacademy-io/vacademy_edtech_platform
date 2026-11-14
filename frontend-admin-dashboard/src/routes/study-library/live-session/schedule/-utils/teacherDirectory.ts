// Matching the bulk grid's teacher entries against the institute's staff.
//
// A row's `instructorIdentifiers` holds whatever identifies each teacher: a
// user id when the admin picked someone in the grid, or the raw text from the
// CSV's teacher column (email, username or user id). Entries are resolved
// lazily against the staff directory, so the order in which the CSV import
// and the directory fetch finish never matters.
//
// Email is the recommended identifier: admins know it and the Teams page
// shows it, while usernames are often generated. Matching is case-insensitive,
// and is tried as user id, then email, then username.

export interface TeacherDirectoryUser {
    id: string;
    full_name: string;
    email: string | null;
    username?: string | null;
}

export interface TeacherIndex {
    byId: Map<string, TeacherDirectoryUser>;
    byEmail: Map<string, TeacherDirectoryUser[]>;
    byUsername: Map<string, TeacherDirectoryUser[]>;
}

export type TeacherMatch =
    | { kind: 'user'; user: TeacherDirectoryUser }
    /** Two or more staff share this email / username, so no one is picked. */
    | { kind: 'ambiguous'; matches: TeacherDirectoryUser[] }
    | { kind: 'unmatched' };

const pushTo = (
    map: Map<string, TeacherDirectoryUser[]>,
    key: string | null | undefined,
    user: TeacherDirectoryUser
) => {
    const k = key?.trim().toLowerCase();
    if (!k) return;
    const list = map.get(k);
    if (!list) map.set(k, [user]);
    else if (!list.some((u) => u.id === user.id)) list.push(user);
};

export const buildTeacherIndex = (users: TeacherDirectoryUser[]): TeacherIndex => {
    const index: TeacherIndex = { byId: new Map(), byEmail: new Map(), byUsername: new Map() };
    for (const user of users) {
        if (!user?.id) continue;
        index.byId.set(user.id, user);
        pushTo(index.byEmail, user.email, user);
        pushTo(index.byUsername, user.username, user);
    }
    return index;
};

const fromList = (list: TeacherDirectoryUser[] | undefined): TeacherMatch | null => {
    if (!list || list.length === 0) return null;
    if (list.length === 1) return { kind: 'user', user: list[0]! };
    return { kind: 'ambiguous', matches: list };
};

export const resolveTeacherEntry = (index: TeacherIndex, entry: string): TeacherMatch => {
    const raw = entry.trim();
    if (!raw) return { kind: 'unmatched' };
    const byId = index.byId.get(raw);
    if (byId) return { kind: 'user', user: byId };
    const key = raw.toLowerCase();
    return (
        fromList(index.byEmail.get(key)) ??
        fromList(index.byUsername.get(key)) ?? { kind: 'unmatched' }
    );
};

/** The user ids a row's entries currently point at, in order, without duplicates. */
export const resolvedTeacherIds = (index: TeacherIndex, entries: string[]): string[] => {
    const ids: string[] = [];
    for (const entry of entries) {
        const match = resolveTeacherEntry(index, entry);
        if (match.kind === 'user' && !ids.includes(match.user.id)) ids.push(match.user.id);
    }
    return ids;
};

/** Entries that don't point at exactly one staff member (not found, or shared). */
export const problemTeacherEntries = (index: TeacherIndex, entries: string[]): string[] =>
    entries.filter((entry) => resolveTeacherEntry(index, entry).kind !== 'user');

/**
 * Size of the one page `fetchEligibleOrgUsers` reads. A directory that comes
 * back this full may be cut off, so a miss against it is not proof that the
 * teacher doesn't exist.
 */
export const STAFF_DIRECTORY_PAGE_SIZE = 500;

/** A row's entries sorted by outcome, for building the create request. */
export const splitTeacherEntries = (index: TeacherIndex, entries: string[]) => {
    const userIds: string[] = [];
    const unmatched: string[] = [];
    const ambiguous: string[] = [];
    for (const entry of entries) {
        const match = resolveTeacherEntry(index, entry);
        if (match.kind === 'user') {
            if (!userIds.includes(match.user.id)) userIds.push(match.user.id);
        } else if (match.kind === 'ambiguous') ambiguous.push(entry);
        else unmatched.push(entry);
    }
    return { userIds, unmatched, ambiguous };
};
