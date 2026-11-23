/**
 * Left column: the institute's connected social profiles with their health, a menu to
 * disconnect, and muted rows for the networks that are not connected yet.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ArrowClockwise, DotsThreeVertical, Gear, LinkBreak, Plugs } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusPill } from '@/components/shared/crm-enhance/screen-header';
import { cn } from '@/lib/utils';
import { ConnectProviderMenu } from '../../-marketing/connect-buttons';
import { marketingErrorMessage } from '../../-marketing/marketing-api';
import {
    PlatformIcon,
    platformLabel,
    SOCIAL_PLATFORMS,
    socialProviderFor,
} from '../../-marketing/platform-meta';
import {
    useDisconnectSocialAccount,
    useSocialAccounts,
    useStartMarketingOAuth,
} from '../../-marketing/use-marketing';
import type { SocialAccount, SocialPlatform } from '../../-marketing/types';
import { isAccountUsable } from './social-utils';
import { ErrorState } from './states';

const PANEL = 'flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-4 sm:p-5';

export function AccountsPanel({ isAdmin }: { isAdmin: boolean }) {
    const { t, i18n } = useTranslation('marketingSocial');
    const accountsQuery = useSocialAccounts();
    const disconnect = useDisconnectSocialAccount();
    const startOAuth = useStartMarketingOAuth();
    const navigate = useNavigate();
    const [confirm, setConfirm] = useState<SocialAccount | null>(null);

    const accounts = useMemo(
        () => (accountsQuery.data ?? []).filter((a) => a.status !== 'DISCONNECTED'),
        [accountsQuery.data]
    );
    const usable = accounts.filter(isAccountUsable).length;
    const attention = accounts.length - usable;
    const missing = SOCIAL_PLATFORMS.filter((p) => !accounts.some((a) => a.platform === p));
    const numberFormat = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

    const connectPlatform = (platform: SocialPlatform) => {
        const provider = socialProviderFor(platform);
        if (provider) startOAuth.mutate(provider);
        else navigate({ to: '/settings', search: { selectedTab: 'youtube' } });
    };

    const subtitle = (account: SocialAccount): string => {
        const name = account.name ?? '';
        const followers =
            account.followers_count != null
                ? t('accounts.followers', {
                      count: account.followers_count,
                      formatted: numberFormat.format(account.followers_count),
                  })
                : null;
        switch (account.platform) {
            case 'FACEBOOK':
                return t('accounts.subtitle.facebook', { name });
            case 'INSTAGRAM': {
                const handle = account.handle
                    ? account.handle.startsWith('@')
                        ? account.handle
                        : `@${account.handle}`
                    : name;
                return followers ? `${handle} · ${followers}` : handle;
            }
            case 'GOOGLE_BUSINESS':
                return t('accounts.subtitle.googleBusiness', { name });
            case 'YOUTUBE':
                return t('accounts.subtitle.youtube', { name });
            default:
                return name;
        }
    };

    return (
        <section className={PANEL} aria-labelledby="social-accounts-title">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                    <h2
                        id="social-accounts-title"
                        className="text-subtitle font-semibold text-neutral-900"
                    >
                        {t('accounts.title')}
                    </h2>
                    {accountsQuery.isSuccess && (
                        <p className="text-caption text-neutral-500">
                            {t('accounts.connectedCount', {
                                count: accounts.length,
                                connected: usable,
                                total: accounts.length,
                            })}
                        </p>
                    )}
                </div>
                {accountsQuery.isSuccess && accounts.length > 0 && (
                    <StatusPill tone={attention > 0 ? 'warning' : 'success'}>
                        {attention > 0
                            ? t('accounts.needAttention', { count: attention })
                            : t('accounts.allConnected')}
                    </StatusPill>
                )}
            </div>

            {accountsQuery.isLoading && (
                <div className="flex flex-col gap-2" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                        <div
                            key={i}
                            className="flex items-center gap-3 rounded-lg border border-neutral-100 p-3"
                        >
                            <Skeleton className="size-10 rounded-lg" />
                            <div className="flex flex-1 flex-col gap-1.5">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-3 w-40" />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {accountsQuery.isError && (
                <ErrorState
                    message={marketingErrorMessage(accountsQuery.error, t('accounts.loadFailed'))}
                    onRetry={() => accountsQuery.refetch()}
                />
            )}

            {accountsQuery.isSuccess && (
                <ul className="flex flex-col gap-2">
                    {accounts.map((account) => {
                        const ok = isAccountUsable(account);
                        return (
                            <li
                                key={account.id}
                                className={cn(
                                    'flex items-center gap-3 rounded-lg border p-3',
                                    ok
                                        ? 'border-neutral-200 bg-white'
                                        : 'border-warning-200 bg-warning-50'
                                )}
                            >
                                <PlatformIcon platform={account.platform} size="lg" />
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="truncate text-body font-medium text-neutral-800">
                                        {platformLabel(account.platform, t, 'social')}
                                    </span>
                                    <span className="truncate text-caption text-neutral-500">
                                        {subtitle(account)}
                                    </span>
                                    {!ok && account.status_detail && (
                                        <span className="text-caption text-warning-700">
                                            {account.status_detail}
                                        </span>
                                    )}
                                </div>
                                {ok ? (
                                    <StatusPill tone="success">
                                        {t('accounts.connected')}
                                    </StatusPill>
                                ) : isAdmin ? (
                                    <button
                                        type="button"
                                        onClick={() => connectPlatform(account.platform)}
                                        disabled={startOAuth.isPending}
                                        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning-300"
                                        aria-label={t('accounts.reconnectAria', {
                                            name: platformLabel(account.platform, t, 'social'),
                                        })}
                                    >
                                        <StatusPill tone="warning" className="hover:bg-warning-100">
                                            <span className="inline-flex items-center gap-1">
                                                <ArrowClockwise size={12} aria-hidden />
                                                {t('accounts.reconnect')}
                                            </span>
                                        </StatusPill>
                                    </button>
                                ) : (
                                    <StatusPill tone="warning">
                                        {t('accounts.reconnect')}
                                    </StatusPill>
                                )}
                                {isAdmin && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                type="button"
                                                className="flex size-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                                                aria-label={t('accounts.menuAria', {
                                                    name: platformLabel(
                                                        account.platform,
                                                        t,
                                                        'social'
                                                    ),
                                                })}
                                            >
                                                <DotsThreeVertical size={18} weight="bold" />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-56">
                                            {account.platform === 'YOUTUBE' ? (
                                                <DropdownMenuItem
                                                    className="cursor-pointer gap-2"
                                                    onSelect={() =>
                                                        navigate({
                                                            to: '/settings',
                                                            search: { selectedTab: 'youtube' },
                                                        })
                                                    }
                                                >
                                                    <Gear size={16} aria-hidden />
                                                    {t('accounts.manageYoutube')}
                                                </DropdownMenuItem>
                                            ) : (
                                                <DropdownMenuItem
                                                    className="cursor-pointer gap-2 text-danger-600 focus:text-danger-700"
                                                    onSelect={() => setConfirm(account)}
                                                >
                                                    <LinkBreak size={16} aria-hidden />
                                                    {t('accounts.disconnect')}
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </li>
                        );
                    })}

                    {missing.map((platform) => (
                        <li
                            key={`missing-${platform}`}
                            className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3"
                        >
                            <PlatformIcon platform={platform} size="lg" className="opacity-60" />
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-body font-medium text-neutral-600">
                                    {platformLabel(platform, t, 'social')}
                                </span>
                                <span className="truncate text-caption text-neutral-500">
                                    {t(`accounts.notConnectedHint.${platform}`)}
                                </span>
                            </div>
                            {isAdmin && (
                                <MyButton
                                    buttonType="secondary"
                                    scale="small"
                                    onClick={() => connectPlatform(platform)}
                                    disable={startOAuth.isPending}
                                    aria-label={t('accounts.connectAria', {
                                        name: platformLabel(platform, t, 'social'),
                                    })}
                                >
                                    {t('accounts.connect')}
                                </MyButton>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {accountsQuery.isSuccess && accounts.length === 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-primary-50 p-3">
                    <Plugs size={18} className="mt-0.5 shrink-0 text-primary-500" aria-hidden />
                    <p className="text-caption text-neutral-600">{t('accounts.emptyHint')}</p>
                </div>
            )}

            {isAdmin ? (
                <div className="border-t border-neutral-100 pt-4">
                    <ConnectProviderMenu
                        kind="social"
                        label={t('accounts.connectMore')}
                        className="w-full"
                    />
                </div>
            ) : (
                <p className="border-t border-neutral-100 pt-4 text-caption text-neutral-500">
                    {t('accounts.adminOnly')}
                </p>
            )}

            <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('accounts.disconnectTitle', {
                                name:
                                    confirm?.name ??
                                    (confirm ? platformLabel(confirm.platform, t, 'social') : ''),
                            })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('accounts.disconnectBody')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('actions.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 text-white hover:bg-danger-700"
                            onClick={() => {
                                if (confirm) disconnect.mutate(confirm.id);
                                setConfirm(null);
                            }}
                        >
                            {t('accounts.disconnect')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}
