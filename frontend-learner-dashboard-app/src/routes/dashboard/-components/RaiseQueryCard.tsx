import { Card, CardContent } from '@/components/ui/card';
import { Question, CaretRight, ChatsCircle } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { usePlayTheme } from '@/hooks/use-play-theme';
import { useCleanerPlayTheme } from '@/hooks/use-cleaner-play-theme';
import iconHelp from '@/assets/cleaner-play/icon-help.webp';
import { useDoubtManagementSetting } from '@/services/doubt-management-settings';
import { useMyQueries } from '@/services/my-queries';
import { useQueryDialogStore } from '@/stores/useQueryDialogStore';

/**
 * Dashboard entry point for the general query intake. Renders only when the institute enabled the
 * dashboard card under Doubt Settings. Shows the learner's open-case count when available (silent
 * degradation: loading/error → the plain card, never a broken widget). Opens the shared global
 * QueryDialog — directly on the "My queries" tab when there are open cases.
 */
export const RaiseQueryCard = () => {
    const { t } = useTranslation('dashboard');
    const isPlay = usePlayTheme();
    const isCleanerPlay = useCleanerPlayTheme();
    const { showDashboardCard } = useDoubtManagementSetting();
    const open = useQueryDialogStore((s) => s.open);
    // Only fetch when the card is actually shown; errors fall back to openCount 0.
    const { openCount, isError } = useMyQueries(showDashboardCard);

    if (!showDashboardCard) return null;

    const hasOpen = !isError && openCount > 0;

    return (
        <Card
            onClick={() => open(hasOpen ? 'my-queries' : 'raise')}
            className={cn(
                'cursor-pointer transition-shadow hover:shadow-md',
                'cp-card',
                '[.ui-play_&]:rounded-play-card-sm [.ui-play_&]:border-border [.ui-play_&]:shadow-play-soft-card'
            )}
        >
            <CardContent className="flex items-center justify-between gap-4 p-card">
                <div className="flex items-center gap-3">
                    {isPlay || isCleanerPlay ? (
                        <img
                            src={iconHelp}
                            alt=""
                            aria-hidden="true"
                            className="h-10 w-10 shrink-0 object-contain"
                        />
                    ) : (
                        <div className="flex size-10 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <Question weight="duotone" size={22} />
                        </div>
                    )}
                    <div>
                        <h3
                            className={cn(
                                'text-sm font-semibold text-neutral-800 dark:text-neutral-100',
                                'cp-heading',
                                '[.ui-play_&]:font-black [.ui-play_&]:text-play-ink'
                            )}
                        >
                            {t('raiseQuery.title')}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            {hasOpen
                                ? t('raiseQuery.openQueries', { count: openCount })
                                : t('raiseQuery.subtitle')}
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {hasOpen && (
                        <span className="flex items-center gap-1 rounded-full bg-warning-50 px-2 py-0.5 text-caption font-semibold text-warning-700">
                            <ChatsCircle size={13} weight="duotone" />
                            {openCount}
                        </span>
                    )}
                    <CaretRight size={16} className="text-muted-foreground" />
                </div>
            </CardContent>
        </Card>
    );
};
