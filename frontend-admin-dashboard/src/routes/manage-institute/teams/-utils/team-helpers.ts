import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import type { CustomRole } from '@/routes/manage-custom-teams/-services/custom-team-services';

export interface TeamMemberRole {
    id: string;
    institute_id: string;
    role_name: string;
    status: string;
    role_id: string;
}

export interface TeamMember {
    id: string;
    username: string;
    email: string;
    full_name: string;
    mobile_number: string | null;
    profile_pic_file_id: string | null;
    author_subtitle?: string | null;
    author_description?: string | null;
    roles: TeamMemberRole[];
    status: string | null;
    root_user: boolean;
    // Present only on the authenticated users-of-status response and only when the
    // institute has opted in; used by the gated Login column.
    password?: string | null;
    // Last sign-in (users.last_login_time) on the Teams listing: null = never signed in,
    // absent = an older backend that doesn't send it.
    last_login_time?: string | number | null;
}

export interface PaginatedTeamResponse {
    content: TeamMember[];
    page_number: number;
    page_size: number;
    total_elements: number;
    total_pages: number;
    last: boolean;
    first: boolean;
}

/** Built-in roles, in the order every Teams picker lists them. */
export const BUILT_IN_ROLE_ORDER = [
    'ADMIN',
    'TEACHER',
    'CONTENT CREATOR',
    'ASSESSMENT CREATOR',
    'EVALUATOR',
] as const;

export type RoleTone = 'primary' | 'info' | 'success' | 'warning' | 'neutral' | 'custom';

export interface TeamRoleOption {
    id: string;
    /** Backend role name — what every role API takes. */
    name: string;
    /** Display name; built-in roles follow the institute's naming settings. */
    label: string;
    /** Created by this institute (Settings → Role Display), not a platform role. */
    custom: boolean;
}

const BUILT_IN_TONES: Record<string, RoleTone> = {
    ADMIN: 'primary',
    TEACHER: 'info',
    'CONTENT CREATOR': 'success',
    'ASSESSMENT CREATOR': 'warning',
    EVALUATOR: 'neutral',
};

export const roleTone = (option: Pick<TeamRoleOption, 'name' | 'custom'>): RoleTone =>
    option.custom ? 'custom' : BUILT_IN_TONES[option.name] ?? 'neutral';

/**
 * The roles a Teams picker may offer, split into built-in and custom.
 *
 * GET /institute/{id}/roles returns platform roles (institute_id null) plus the roles
 * THIS institute created. Anything carrying another institute's id is dropped
 * defensively so a picker can never offer a foreign custom role. STUDENT and roles the
 * viewer's display settings hide are excluded, matching the rest of the page.
 */
export function buildRoleOptions(
    roles: CustomRole[],
    instituteId: string | undefined,
    isVisibleToViewer: (roleName: string) => boolean
): TeamRoleOption[] {
    const options: TeamRoleOption[] = [];
    roles.forEach((role) => {
        if (!role?.name || role.name === 'STUDENT') return;
        const owner = role.instituteId ?? role.institute_id ?? null;
        if (owner && owner !== instituteId) return;
        if (!isVisibleToViewer(role.name)) return;
        const custom = owner !== null;
        options.push({
            id: role.id,
            name: role.name,
            label: custom ? role.name : mapRoleToCustomName(role.name),
            custom,
        });
    });
    const builtInRank = (name: string) => {
        const index = (BUILT_IN_ROLE_ORDER as readonly string[]).indexOf(name);
        return index === -1 ? BUILT_IN_ROLE_ORDER.length : index;
    };
    return options.sort((a, b) => {
        if (a.custom !== b.custom) return a.custom ? 1 : -1;
        if (!a.custom) {
            const rank = builtInRank(a.name) - builtInRank(b.name);
            if (rank !== 0) return rank;
        }
        return a.label.localeCompare(b.label);
    });
}

/** i18n key suffix for a built-in role's one-line description, if we have one. */
export const builtInRoleDescriptionKey = (roleName: string): string | null => {
    switch (roleName) {
        case 'ADMIN':
            return 'admin';
        case 'TEACHER':
            return 'teacher';
        case 'CONTENT CREATOR':
            return 'contentCreator';
        case 'ASSESSMENT CREATOR':
            return 'assessmentCreator';
        case 'EVALUATOR':
            return 'evaluator';
        default:
            return null;
    }
};

/** Orders role names the way the picker lists them; unknown names keep their order at the end. */
export const sortRoleNames = (names: string[], options: TeamRoleOption[]): string[] => {
    const rank = new Map(options.map((option, index) => [option.name, index]));
    return [...names].sort(
        (a, b) =>
            (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER)
    );
};

/** This institute's roles on a member (the response carries every institute's). */
export const instituteRolesOf = (member: TeamMember, instituteId: string | undefined) =>
    member.roles.filter((role) => role.institute_id === instituteId);

/**
 * A member's status in this institute, for the Members tab.
 *
 * The users-of-status API never fills `status`, and `User.roles` is mapped with
 * `@Where(status IN ('ACTIVE','INVITED'))`, so a member whose staff roles here are all
 * disabled arrives with no staff role for this institute at all. That absence is what
 * "disabled" looks like in the response — reading `member.status` showed everyone Active
 * and offered "Disable" to people who were already disabled.
 */
export const memberStatusOf = (
    member: TeamMember,
    instituteId: string | undefined
): 'ACTIVE' | 'DISABLED' =>
    instituteRolesOf(member, instituteId).some((role) => role.role_name !== 'STUDENT')
        ? 'ACTIVE'
        : 'DISABLED';

/**
 * True only when the backend says this member has never signed in (an explicit null).
 * A missing field (older backend) is "unknown", never "not signed in".
 */
export const hasNeverSignedIn = (member: Pick<TeamMember, 'last_login_time'>): boolean =>
    member.last_login_time === null;

export const initialsOf = (name: string | null | undefined): string =>
    (name || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word.charAt(0))
        .join('')
        .toUpperCase() || '?';

const AVATAR_TONES = ['primary', 'info', 'success', 'warning'] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** Stable per-name tint so a person keeps the same avatar colour everywhere. */
export const avatarToneOf = (name: string | null | undefined): AvatarTone => {
    let hash = 7;
    for (const char of name || '') hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
};

const toCountryCode = (iso2: string | undefined): CountryCode | undefined =>
    iso2 ? (iso2.toUpperCase() as CountryCode) : undefined;

/**
 * Human-readable phone for the table. Stored numbers come in several shapes —
 * `919876543210` from the phone widget, `+91 98765 43210`, or a bare national
 * `9876543210` from older edits — so a bare 10-digit number is read in the
 * institute's default country rather than guessed from its own digits.
 */
export function formatPhoneForDisplay(
    raw: string | null | undefined,
    defaultCountry?: string
): string | null {
    const value = (raw ?? '').trim();
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    const international = value.startsWith('+') || digits.length > 10;
    const parsed = international
        ? parsePhoneNumberFromString(`+${digits}`)
        : parsePhoneNumberFromString(digits, toCountryCode(defaultCountry));
    // isPossible covers numbers whose length fits but whose range isn't known to be live.
    return parsed && (parsed.isValid() || parsed.isPossible())
        ? parsed.formatInternational()
        : value;
}

/**
 * Value for react-phone-input-2, which wants digits including the dial code. A bare
 * national number is given the default country's code first — otherwise the widget
 * reads its leading digits as a dial code (9876… renders as +98, Iran).
 */
export function toPhoneInputValue(raw: string | null | undefined, defaultCountry?: string): string {
    const value = (raw ?? '').trim();
    const digits = value.replace(/\D/g, '');
    if (!digits) return '';
    if (value.startsWith('+') || digits.length > 10) return digits;
    const parsed = parsePhoneNumberFromString(digits, toCountryCode(defaultCountry));
    return parsed?.isValid() ? parsed.number.replace(/\D/g, '') : digits;
}
