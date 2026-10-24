import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
    ArrowRight,
    BookOpenText,
    ChalkboardTeacher,
    ClipboardText,
    Exam,
    IdentificationBadge,
    Info,
    ShieldCheck,
    UserCircle,
    type Icon,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
    builtInRoleDescriptionKey,
    roleTone,
    sortRoleNames,
    type TeamRoleOption,
} from '../-utils/team-helpers';
import { CheckMark, TONE_TILE } from './team-ui';

const ROLE_ICONS: Record<string, Icon> = {
    ADMIN: ShieldCheck,
    TEACHER: ChalkboardTeacher,
    'CONTENT CREATOR': BookOpenText,
    'ASSESSMENT CREATOR': Exam,
    EVALUATOR: ClipboardText,
};

const iconFor = (option: TeamRoleOption): Icon =>
    option.custom ? IdentificationBadge : ROLE_ICONS[option.name] ?? UserCircle;

interface RolePickerProps {
    options: TeamRoleOption[];
    /** Selected backend role names. */
    value: string[];
    onChange: (next: string[]) => void;
    /** `cards` for the invite dialog, compact `chips` for the member drawer. */
    variant: 'cards' | 'chips';
    /** Used in the "gets everything these roles allow" summary. */
    personName?: string;
    disabled?: boolean;
}

/**
 * Multi-select role picker. A member can hold any mix of built-in and custom roles —
 * the invite, update and invitation-update APIs all take a list. Custom roles are only
 * the ones this institute created (see buildRoleOptions), in their own group.
 */
export function RolePicker({
    options,
    value,
    onChange,
    variant,
    personName,
    disabled = false,
}: RolePickerProps) {
    const { t } = useTranslation('manageInstituteTeamsIndexLazy');
    const navigate = useNavigate();
    const builtIn = options.filter((option) => !option.custom);
    const custom = options.filter((option) => option.custom);
    const labelOf = (name: string) => options.find((option) => option.name === name)?.label ?? name;

    const toggle = (name: string) => {
        if (disabled) return;
        const next = value.includes(name) ? value.filter((v) => v !== name) : [...value, name];
        onChange(sortRoleNames(next, options));
    };

    const manageLink = (
        <button
            type="button"
            className="inline-flex items-center gap-1 text-caption font-semibold text-primary-500 hover:underline"
            onClick={() => navigate({ to: '/settings', search: { selectedTab: 'roleDisplay' } })}
        >
            {custom.length > 0 ? t('roles.manageCustom') : t('roles.createCustom')}
            <ArrowRight size={12} weight="bold" />
        </button>
    );

    const describe = (option: TeamRoleOption) => {
        if (option.custom) return t('roles.customDescription');
        const key = builtInRoleDescriptionKey(option.name);
        return key ? t(`roles.descriptions.${key}`) : t('roles.builtInDescription');
    };

    const renderOption = (option: TeamRoleOption) => {
        const selected = value.includes(option.name);
        const RoleIcon = iconFor(option);
        if (variant === 'chips') {
            return (
                <button
                    key={option.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    title={describe(option)}
                    onClick={() => toggle(option.name)}
                    className={`text-body ${cn(
                        'inline-flex h-9 items-center gap-2 rounded-full border px-3 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        selected
                            ? 'border-primary-400 bg-primary-50 text-primary-600'
                            : 'border-neutral-300 bg-white text-neutral-700 hover:border-neutral-400'
                    )}`}
                >
                    <CheckMark checked={selected} round />
                    {option.label}
                </button>
            );
        }
        return (
            <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => toggle(option.name)}
                className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    selected
                        ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-400'
                        : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50'
                )}
            >
                <span
                    className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-md',
                        TONE_TILE[roleTone(option)]
                    )}
                >
                    <RoleIcon size={18} />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-neutral-900">
                        {option.label}
                    </span>
                    <span className="mt-0.5 block text-caption text-neutral-500">
                        {describe(option)}
                    </span>
                </span>
                <CheckMark checked={selected} />
            </button>
        );
    };

    const groupClass = variant === 'cards' ? 'grid gap-2.5 sm:grid-cols-2' : 'flex flex-wrap gap-2';

    return (
        <div className="flex flex-col gap-4">
            <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                        {t('roles.builtInGroup')}
                    </span>
                    {value.length > 0 && (
                        <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-caption font-semibold text-primary-600">
                            {t('roles.selectedCount', { count: value.length })}
                        </span>
                    )}
                </div>
                <div className={groupClass}>{builtIn.map(renderOption)}</div>
            </div>

            <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-caption font-semibold uppercase tracking-wide text-neutral-500">
                        {t('roles.customGroup')}
                        <span className="ms-1 font-normal normal-case tracking-normal text-neutral-400">
                            {t('roles.customGroupHint')}
                        </span>
                    </span>
                    {manageLink}
                </div>
                {custom.length > 0 ? (
                    <div className={groupClass}>{custom.map(renderOption)}</div>
                ) : (
                    <p className="rounded-lg border border-dashed border-neutral-200 px-3 py-2.5 text-caption text-neutral-500">
                        {t('roles.noCustomRoles')}
                    </p>
                )}
            </div>

            {value.length > 1 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-caption text-neutral-600">
                    <Info size={16} className="mt-0.5 shrink-0" />
                    <span>
                        {t('roles.multiSummary', {
                            name: personName?.trim().split(/\s+/)[0] || t('roles.theyFallback'),
                            count: value.length,
                            roles: value.map(labelOf).join(' + '),
                        })}
                    </span>
                </div>
            )}
        </div>
    );
}
