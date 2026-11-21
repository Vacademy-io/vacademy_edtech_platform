/**
 * CallNumberVisibilityCard — per-role control over whether the Call Log
 * (Leads → Call Log, AI + human calls) prints verbatim phone numbers or the
 * masked form `*******1234`.
 *
 * Why it exists: masking used to be gated on a `VIEW_CALL_NUMBERS` JWT authority
 * that is provisioned nowhere, so every viewer — institute admins included — saw
 * masked numbers with no way to change it.
 *
 * Scope is the Call Log surface only, and the copy below says so: the same numbers
 * appear unmasked on Recent Leads / Lead List / Lead Board / Follow-ups and on the
 * lead's own profile, so this is a display choice for this page, not an access
 * boundary. Masked is the default for every role until someone changes it here.
 *
 * Persists into the institute setting key
 * {@code ROLE_DISPLAY_SETTINGS.callNumberVisibility}, read on the backend by
 * {@code CallNumberVisibilityService}. Auto-saves on change, matching the
 * sibling AudienceAccessCard.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CircleNotch, Check } from '@phosphor-icons/react';
import { toast } from 'sonner';
import {
    useCallNumberVisibility,
    UNCONFIGURED_MODE,
    type CallNumberVisibilityMode,
} from '@/hooks/use-call-number-visibility';

// Long enough to batch a quick double-toggle into one write, short enough to
// still feel immediate. Same window the AudienceAccessCard uses.
const AUTOSAVE_DEBOUNCE_MS = 500;

const buildModeOptions = (
    t: TFunction
): Array<{
    value: CallNumberVisibilityMode;
    title: string;
    description: string;
}> => [
    {
        value: 'FULL',
        title: t('modes.full.title'),
        description: t('modes.full.description'),
    },
    {
        value: 'MASKED',
        title: t('modes.masked.title'),
        description: t('modes.masked.description'),
    },
];

interface CallNumberVisibilityCardProps {
    /** Uppercase role name as stored in JWT authorities, e.g. "ADMIN", "TEACHER". */
    roleName: string;
    /** Friendlier label for the heading. Defaults to roleName. */
    roleLabel?: string;
}

export const CallNumberVisibilityCard = ({
    roleName,
    roleLabel,
}: CallNumberVisibilityCardProps) => {
    const { t } = useTranslation('settingsCallNumberVisibilityCard');
    const normalizedRole = roleName.toUpperCase();
    const { config, isLoading, saving, save } = useCallNumberVisibility();

    const [mode, setMode] = useState<CallNumberVisibilityMode>(UNCONFIGURED_MODE);
    // Distinguishes "the admin chose this" from "this is the unconfigured
    // fallback" so the card can say which one the role is currently on.
    const [configured, setConfigured] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [showJustSaved, setShowJustSaved] = useState(false);

    const modeOptions = buildModeOptions(t);

    useEffect(() => {
        const existing = config.roles?.[normalizedRole];
        setMode(existing?.mode ?? UNCONFIGURED_MODE);
        setConfigured(!!existing?.mode);
        setDirty(false);
    }, [config, normalizedRole]);

    const handleModeChange = (value: string) => {
        setMode(value as CallNumberVisibilityMode);
        setDirty(true);
    };

    // Capture the latest choice in a ref so the debounced flush writes what the
    // admin clicked last rather than a stale closure value.
    const latestModeRef = useRef(mode);
    useEffect(() => {
        latestModeRef.current = mode;
    }, [mode]);

    useEffect(() => {
        if (!dirty) return;
        const timer = window.setTimeout(async () => {
            const nextRoles = {
                ...(config.roles ?? {}),
                [normalizedRole]: { mode: latestModeRef.current },
            };
            try {
                await save({ roles: nextRoles });
                setConfigured(true);
                setDirty(false);
                setShowJustSaved(true);
                window.setTimeout(() => setShowJustSaved(false), 1500);
            } catch (err) {
                console.error('Failed to save call number visibility', err);
                toast.error(t('toasts.saveFailed'));
            }
        }, AUTOSAVE_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
        // Depends on the user-triggered state only — `config` / `save` are
        // stable React Query handles and must not re-arm the debounce.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dirty, mode, normalizedRole]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    {t('card.title', { role: roleLabel ?? normalizedRole })}
                </CardTitle>
                <CardDescription>
                    {t('card.description.part1')}{' '}
                    <span className="font-medium">{normalizedRole}</span>{' '}
                    {t('card.description.part2')}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
                <RadioGroup
                    value={mode}
                    onValueChange={handleModeChange}
                    className="flex flex-col gap-3"
                    aria-label={t('radioGroup.ariaLabel')}
                >
                    {modeOptions.map((opt) => (
                        <label
                            key={opt.value}
                            htmlFor={`call-numbers-${normalizedRole}-${opt.value}`}
                            className="flex cursor-pointer items-start gap-3 rounded-md border border-neutral-200 p-3 hover:border-primary-200"
                        >
                            <RadioGroupItem
                                id={`call-numbers-${normalizedRole}-${opt.value}`}
                                value={opt.value}
                                className="mt-0.5"
                            />
                            <div className="flex flex-col gap-1">
                                <span className="text-sm font-medium text-neutral-900">
                                    {opt.title}
                                </span>
                                <span className="text-xs text-neutral-600">{opt.description}</span>
                            </div>
                        </label>
                    ))}
                </RadioGroup>

                {!configured && !isLoading && (
                    <p className="text-xs text-neutral-500">{t('unconfigured.message')}</p>
                )}

                <div className="flex h-5 items-center justify-end gap-1.5 text-xs text-neutral-500">
                    {isLoading ? (
                        <span>{t('status.loading')}</span>
                    ) : saving ? (
                        <>
                            <CircleNotch className="size-3.5 animate-spin" />
                            <span>{t('status.saving')}</span>
                        </>
                    ) : showJustSaved ? (
                        <>
                            <Check className="size-3.5 text-success-600" />
                            <span className="text-success-700">{t('status.saved')}</span>
                        </>
                    ) : dirty ? (
                        <span>{t('status.unsavedChanges')}</span>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    );
};

export default CallNumberVisibilityCard;
