import { MapPin, Prohibit } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import type { ModeType } from '@/services/announcement';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { buildModeMeta } from '../../-utils/constants';
import { ModeSettingsForm } from '../ModeSettingsForm';
import { FieldError, SectionCard } from '../primitives';
import type { FieldErrors, ModeSettings } from '../../-types';

interface DisplayLocationsStepProps {
    modes: ModeType[];
    modeSettings: Partial<Record<ModeType, ModeSettings>>;
    allowedModes: Partial<Record<ModeType, boolean>>;
    loading: boolean;
    onToggle: (mode: ModeType) => void;
    onSettingsChange: (mode: ModeType, settings: ModeSettings) => void;
    errors: FieldErrors;
    showErrors: boolean;
}

export function DisplayLocationsStep({
    modes,
    modeSettings,
    allowedModes,
    loading,
    onToggle,
    onSettingsChange,
    errors,
    showErrors,
}: DisplayLocationsStepProps) {
    const { t } = useTranslation('announcementCreateDisplayLocationsStep');
    const modeMeta = buildModeMeta(t);

    return (
        <div className="space-y-6">
            <SectionCard
                title={t('title')}
                description={t('description')}
                Icon={MapPin}
                invalid={showErrors && Boolean(errors.modes)}
            >
                {loading ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {[0, 1, 2, 3, 4, 5].map((key) => (
                            <Skeleton key={key} className="h-24 rounded-lg" />
                        ))}
                    </div>
                ) : (
                    <TooltipProvider delayDuration={200}>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {modeMeta.map((meta) => {
                                const selected = modes.includes(meta.type);
                                const blocked = allowedModes[meta.type] === false;
                                const card = (
                                    <button
                                        type="button"
                                        disabled={blocked}
                                        aria-pressed={selected}
                                        onClick={() => onToggle(meta.type)}
                                        className={cn(
                                            'flex h-full w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                            blocked
                                                ? 'cursor-not-allowed border-border bg-muted/40 opacity-60'
                                                : 'hover:border-primary-300 hover:bg-primary-50/40',
                                            selected
                                                ? 'border-primary-500 bg-primary-50/60'
                                                : 'border-border bg-card'
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'flex size-9 shrink-0 items-center justify-center rounded-md',
                                                selected
                                                    ? 'bg-primary-100 text-primary-600'
                                                    : 'bg-muted text-muted-foreground'
                                            )}
                                        >
                                            {blocked ? (
                                                <Prohibit className="size-5" />
                                            ) : (
                                                <meta.Icon className="size-5" weight="duotone" />
                                            )}
                                        </span>
                                        <span className="min-w-0">
                                            <span className="block text-body font-semibold text-foreground">
                                                {meta.label}
                                            </span>
                                            <span className="block text-caption text-muted-foreground">
                                                {meta.description}
                                            </span>
                                        </span>
                                    </button>
                                );

                                return (
                                    <div key={meta.type}>
                                        {blocked ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="block">{card}</span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    {t('blockedTooltip', { label: meta.label })}
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            card
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </TooltipProvider>
                )}
                <FieldError message={showErrors ? errors.modes : undefined} />
            </SectionCard>

            {modes.map((mode) => {
                const meta = modeMeta.find((m) => m.type === mode);
                if (!meta) return null;
                const hasError =
                    showErrors &&
                    Object.keys(errors).some((key) => key.startsWith(`modes.${mode}.`));
                return (
                    <SectionCard
                        key={mode}
                        title={t('settingsTitle', { label: meta.label })}
                        description={meta.description}
                        Icon={meta.Icon}
                        invalid={hasError}
                    >
                        <ModeSettingsForm
                            mode={mode}
                            settings={modeSettings[mode] ?? {}}
                            onChange={(settings) => onSettingsChange(mode, settings)}
                            errors={errors}
                            showErrors={showErrors}
                        />
                    </SectionCard>
                );
            })}
        </div>
    );
}
