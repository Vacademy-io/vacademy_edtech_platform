import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { DotsThreeVertical, SignOut, SquaresFour } from '@phosphor-icons/react';
import { MyDropdown } from '@/components/design-system/dropdown';
import { removeCookiesAndLogout } from '@/lib/auth/sessionUtility';
import { isEvalezyMode } from '@/lib/evalezy-mode';

/**
 * The Evalezy top bar: the Evalezy mark (home), the institute the admin is
 * signed into, and a menu with sign out. Opened from the full portal (sidebar
 * entry), the menu also leads back to the portal.
 */
export const EvalezyHeader = ({ instituteName }: { instituteName?: string | null }) => {
    const { t } = useTranslation('evalezy');
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const inPortal = !isEvalezyMode();

    const menu = [
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
                    {instituteName && (
                        <span className="truncate text-caption text-neutral-500">
                            {instituteName}
                        </span>
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
