import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { DotsThreeVertical, SignOut, Sparkle, SquaresFour, UserCircle } from '@phosphor-icons/react';
import { MyDropdown } from '@/components/design-system/dropdown';
import { removeCookiesAndLogout } from '@/lib/auth/sessionUtility';
import { isEvalezyMode } from '@/lib/evalezy-mode';
import { cn } from '@/lib/utils';
import { useAiCreditsQuery } from '@/services/ai-credits/get-ai-credits';
import { formatCredits, formatCreditsShort } from '../-lib/format-credits';

/**
 * The Evalezy top bar: the Evalezy mark (home), the AI credits left, and a menu with
 * the profile (the signed-in user and institute), AI credits and sign out. Opened from
 * the full portal (sidebar entry), the menu also leads back to the portal.
 */
export const EvalezyHeader = () => {
    const { t } = useTranslation('evalezy');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const inPortal = !isEvalezyMode();
    const { data: credits } = useAiCreditsQuery(true);

    const menu = [
        { label: t('profile.view'), value: 'profile', icon: <UserCircle size={16} /> },
        { label: t('credits.title'), value: 'credits', icon: <Sparkle size={16} /> },
        ...(inPortal
            ? [
                  {
                      label: t('header.backToPortal'),
                      value: 'portal',
                      icon: <SquaresFour size={16} />,
                  },
              ]
            : []),
        { label: t('header.signOut'), value: 'signout', icon: <SignOut size={16} /> },
    ];

    const onSelect = (value: string) => {
        if (value === 'profile') {
            void navigate({ to: '/evalezy/profile' });
            return;
        }
        if (value === 'credits') {
            void navigate({ to: '/evalezy/credits' });
            return;
        }
        if (value === 'portal') {
            void navigate({ to: '/dashboard' });
            return;
        }
        queryClient.clear();
        removeCookiesAndLogout();
        void navigate({ to: '/login' });
    };

    return (
        // No pt-safe: the native body already clears the status bar; top-safe-native
        // keeps the stuck header below the status-bar cover strip while scrolling.
        <header className="top-safe-native sticky top-0 z-30 border-b border-neutral-200 bg-white">
            <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
                <Link to="/evalezy" className="flex shrink-0 items-center" aria-label="Evalezy">
                    <img src="/evalezy-logo.svg" alt="Evalezy" className="h-7 w-auto" />
                </Link>
                <div className="flex min-w-0 items-center gap-1">
                    {credits && (
                        <Link
                            to="/evalezy/credits"
                            aria-label={`${t('credits.title')}: ${formatCredits(credits.current_balance)}`}
                            className={cn(
                                'flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-caption',
                                credits.is_low_balance
                                    ? 'border-warning-300 bg-warning-50 text-warning-700'
                                    : 'border-purple-200 bg-purple-50 text-purple-700'
                            )}
                        >
                            <Sparkle size={12} weight="fill" />
                            <span className="font-medium">{t('credits.chipLabel')}</span>
                            <span className="font-bold">
                                {formatCreditsShort(credits.current_balance)}
                            </span>
                        </Link>
                    )}
                    {/* MyDropdown's trigger is itself the button; the child is only its face. */}
                    <MyDropdown dropdownList={menu} onSelect={(value) => onSelect(String(value))}>
                        <span className="flex size-9 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100">
                            <DotsThreeVertical size={20} weight="bold" />
                            <span className="sr-only">{t('header.menu')}</span>
                        </span>
                    </MyDropdown>
                </div>
            </div>
        </header>
    );
};
