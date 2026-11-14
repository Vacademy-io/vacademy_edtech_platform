import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, SignIn } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { mapRoleToCustomName } from '@/utils/roleUtils';
import {
    avatarToneOf,
    initialsOf,
    roleTone,
    type RoleTone,
    type TeamRoleOption,
} from '../-utils/team-helpers';

const ROLE_CHIP_TONES: Record<RoleTone, string> = {
    primary: 'bg-primary-50 text-primary-600 ring-primary-200',
    info: 'bg-info-50 text-info-700 ring-info-200',
    success: 'bg-success-50 text-success-700 ring-success-200',
    warning: 'bg-warning-50 text-warning-700 ring-warning-200',
    neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
    custom: 'bg-white text-neutral-700 ring-neutral-300',
};

/** Tinted icon tile used by role cards and summary cards. */
export const TONE_TILE: Record<RoleTone, string> = {
    primary: 'bg-primary-50 text-primary-600',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    neutral: 'bg-neutral-100 text-neutral-600',
    custom: 'bg-neutral-100 text-neutral-700',
};

/**
 * A role on a member. Custom roles get a white chip with a diamond marker so they read
 * as "made by this institute" next to the tinted built-in ones.
 */
export function RoleChip({ name, option }: { name: string; option?: TeamRoleOption }) {
    const tone = option ? roleTone(option) : 'neutral';
    // Roles outside the picker (STUDENT, legacy rows) still follow the naming settings.
    const label = option?.label ?? mapRoleToCustomName(name);
    return (
        <span
            className={`text-caption ${cn(
                'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-semibold ring-1 ring-inset',
                ROLE_CHIP_TONES[tone]
            )}`}
        >
            <span
                aria-hidden
                className={cn(
                    'size-1.5 shrink-0 bg-current',
                    tone === 'custom' ? 'rotate-45 rounded-sm' : 'rounded-full'
                )}
            />
            {label}
        </span>
    );
}

const AVATAR_TONES = {
    primary: 'bg-primary-100 text-primary-600',
    info: 'bg-info-50 text-info-600',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
} as const;

export function MemberAvatar({
    name,
    photoUrl,
    size = 'md',
    dashed = false,
    muted = false,
}: {
    name: string | null | undefined;
    photoUrl?: string | null;
    size?: 'md' | 'lg' | 'xl';
    /** Pending invitees: an outlined placeholder rather than a filled tile. */
    dashed?: boolean;
    muted?: boolean;
}) {
    const boxClass = size === 'xl' ? 'size-20' : size === 'lg' ? 'size-12' : 'size-10';
    // Kept outside cn(): tailwind-merge drops the custom font-size tokens when a
    // text colour follows them.
    const textClass = size === 'xl' ? 'text-h2' : size === 'lg' ? 'text-title' : 'text-body';
    return (
        <div
            className={`${textClass} ${cn(
                'flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold',
                boxClass,
                dashed
                    ? 'border border-dashed border-neutral-300 bg-white text-neutral-500'
                    : AVATAR_TONES[avatarToneOf(name)],
                muted && 'opacity-60 grayscale'
            )}`}
        >
            {photoUrl ? (
                <img src={photoUrl} alt="" className="size-full object-cover" />
            ) : (
                initialsOf(name)
            )}
        </div>
    );
}

export function MemberStatusPill({ status }: { status: string | null | undefined }) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    if (status === 'INVITED') {
        return (
            <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-warning-50 px-2.5 text-caption font-semibold text-warning-700">
                <Clock size={13} weight="bold" />
                {t('status.invited')}
            </span>
        );
    }
    const active = status !== 'DISABLED';
    return (
        <span
            className={`text-caption ${cn(
                'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 font-semibold',
                active ? 'bg-success-50 text-success-700' : 'bg-neutral-100 text-neutral-500'
            )}`}
        >
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            {active ? t('status.active') : t('status.disabled')}
        </span>
    );
}

/**
 * Small tag for an active member who has never signed in. They already have access (members
 * are active as soon as they're added); this only tells the admin the login hasn't been used.
 */
export function NotSignedInTag() {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    return (
        <span
            title={t('status.notSignedInHint')}
            className="inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full bg-neutral-100 px-2 text-caption text-neutral-600"
        >
            <SignIn size={12} />
            {t('status.notSignedIn')}
        </span>
    );
}

/** Visual checkbox for use INSIDE a button (a real Checkbox there would nest buttons). */
export function CheckMark({ checked, round = false }: { checked: boolean; round?: boolean }) {
    return (
        <span
            aria-hidden
            className={cn(
                'flex size-4 shrink-0 items-center justify-center border transition-colors',
                round ? 'rounded-full' : 'rounded-sm',
                checked
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-neutral-300 bg-white'
            )}
        >
            {checked && <Check size={11} weight="bold" />}
        </span>
    );
}

/** Numbered step used by the invite dialog; turns into a check once the step is complete. */
export function FormStep({
    index,
    done,
    title,
    description,
    children,
}: {
    index: number;
    done: boolean;
    title: string;
    description: string;
    children: ReactNode;
}) {
    return (
        <section className="flex gap-4">
            <div
                className={`text-caption ${cn(
                    'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full font-semibold',
                    done ? 'bg-success-600 text-white' : 'bg-neutral-100 text-neutral-600'
                )}`}
            >
                {done ? <Check size={14} weight="bold" /> : index}
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="text-subtitle font-semibold text-neutral-900">{title}</h3>
                <p className="mb-4 text-caption text-neutral-500">{description}</p>
                {children}
            </div>
        </section>
    );
}
