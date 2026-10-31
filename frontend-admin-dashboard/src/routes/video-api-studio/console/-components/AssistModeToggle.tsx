import { Sparkle, Lightning } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface AssistModeToggleProps {
    assistModeEnabled: boolean;
    onAssistModeChange: (enabled: boolean) => void;
    disabled?: boolean;
}

/**
 * Auto vs Assist segmented control. Assist is the default — the pipeline pauses
 * at decision gates (shot plan, narration, visuals) so you can weigh in; Auto
 * runs the whole thing autonomously (today's behaviour).
 */
export function AssistModeToggle({ assistModeEnabled, onAssistModeChange, disabled }: AssistModeToggleProps) {
    const { t } = useTranslation('videoApiStudioAssistModeToggle');
    return (
        <div className="inline-flex flex-col gap-1">
            <div
                role="radiogroup"
                aria-label={t('radiogroup.ariaLabel')}
                className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs"
            >
                <button
                    type="button"
                    role="radio"
                    aria-checked={assistModeEnabled}
                    disabled={disabled}
                    onClick={() => onAssistModeChange(true)}
                    className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50',
                        assistModeEnabled
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    <Sparkle className="size-3.5" />
                    {t('options.assist')}
                </button>
                <button
                    type="button"
                    role="radio"
                    aria-checked={!assistModeEnabled}
                    disabled={disabled}
                    onClick={() => onAssistModeChange(false)}
                    className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors disabled:opacity-50',
                        !assistModeEnabled
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                    )}
                >
                    <Lightning className="size-3.5" />
                    {t('options.auto')}
                </button>
            </div>
            <span className="text-xs text-muted-foreground">
                {assistModeEnabled ? t('description.assist') : t('description.auto')}
            </span>
        </div>
    );
}
