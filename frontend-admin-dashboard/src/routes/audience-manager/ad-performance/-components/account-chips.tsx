/**
 * One chip per connected ad account (platform icon + name). A chip opens a small menu
 * with the account's details and its own actions: sync, reconnect when it needs it, and
 * disconnect (confirmed). Accounts that need a fresh sign-in are drawn in warning tones;
 * accounts still on their first sync show a spinner.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ArrowsClockwise,
    CaretDown,
    CircleNotch,
    LinkBreak,
    PlugsConnected,
    WarningCircle,
} from '@phosphor-icons/react';
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
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { PlatformIcon, adProviderFor, platformLabel } from '../../-marketing/platform-meta';
import {
    useDisconnectAdAccount,
    useStartMarketingOAuth,
    useSyncAdAccount,
} from '../../-marketing/use-marketing';
import type { AdAccount } from '../../-marketing/types';
import {
    accountFirstSyncPending,
    accountNeedsAttention,
    formatRelativeTime,
    formatTimestamp,
} from './ad-performance-utils';

/** Meta: act_123… ; Google: 123-456-7890 (how each platform shows its own ids). */
export function accountExternalLabel(account: AdAccount): string {
    const id = account.external_account_id ?? '';
    if (account.platform === 'META') return `act_${id}`;
    const digits = id.replace(/\D/g, '');
    return digits.length === 10
        ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
        : id;
}

function AccountChip({ account }: { account: AdAccount }) {
    const { t, i18n } = useTranslation('marketingAds');
    const sync = useSyncAdAccount();
    const disconnect = useDisconnectAdAccount();
    const reconnect = useStartMarketingOAuth();
    const [confirmOpen, setConfirmOpen] = useState(false);

    const attention = accountNeedsAttention(account);
    const firstSync = accountFirstSyncPending(account);
    const syncing = sync.isPending;
    const name = account.name || accountExternalLabel(account);
    const synced = formatRelativeTime(account.last_synced_at, i18n.language);
    const syncedExact = formatTimestamp(account.last_synced_at, i18n.language);

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button
                        type="button"
                        className={cn(
                            'group inline-flex h-9 max-w-full items-center gap-2 rounded-full border bg-white py-1 pe-3 ps-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                            attention
                                ? 'border-warning-300 bg-warning-50 hover:border-warning-400'
                                : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                        )}
                        aria-label={t('ads.accounts.chipAria', { name })}
                    >
                        <PlatformIcon
                            platform={account.platform}
                            size="sm"
                            className="rounded-full"
                        />
                        <span className="max-w-48 truncate text-body font-medium text-neutral-800">
                            {name}
                        </span>
                        {attention ? (
                            <span className="inline-flex items-center gap-1 text-caption font-medium text-warning-700">
                                <WarningCircle size={14} weight="fill" />
                                {t('ads.accounts.reconnectBadge')}
                            </span>
                        ) : firstSync || syncing ? (
                            <span className="inline-flex items-center gap-1 text-caption text-neutral-500">
                                <CircleNotch size={14} className="animate-spin" />
                                {firstSync ? t('ads.accounts.firstSync') : t('ads.sync.syncing')}
                            </span>
                        ) : null}
                        <CaretDown
                            size={12}
                            className="shrink-0 text-neutral-400 group-hover:text-neutral-600"
                        />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                    <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                        <span className="truncate text-body font-semibold text-neutral-800">
                            {name}
                        </span>
                        <span className="text-caption text-neutral-500">
                            {[
                                platformLabel(account.platform, t, 'ads'),
                                accountExternalLabel(account),
                                account.currency,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </span>
                        <span className="text-caption text-neutral-500" title={syncedExact ?? ''}>
                            {synced
                                ? t('ads.accounts.lastSynced', { time: synced })
                                : t('ads.accounts.neverSynced')}
                        </span>
                    </DropdownMenuLabel>
                    {attention && account.status_detail && (
                        <p className="mx-2 mb-2 rounded-md bg-warning-50 px-2 py-1.5 text-caption text-warning-700">
                            {account.status_detail}
                        </p>
                    )}
                    <DropdownMenuSeparator />
                    {attention ? (
                        <DropdownMenuItem
                            className="cursor-pointer gap-2"
                            disabled={reconnect.isPending}
                            onSelect={() => reconnect.mutate(adProviderFor(account.platform))}
                        >
                            <PlugsConnected size={16} className="text-warning-600" />
                            {t('ads.accounts.reconnect')}
                        </DropdownMenuItem>
                    ) : (
                        <DropdownMenuItem
                            className="cursor-pointer gap-2"
                            disabled={syncing}
                            onSelect={() => sync.mutate(account.id)}
                        >
                            <ArrowsClockwise size={16} className="text-neutral-500" />
                            {syncing ? t('ads.sync.syncing') : t('ads.accounts.syncThis')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                        className="cursor-pointer gap-2 text-danger-600 focus:text-danger-700"
                        onSelect={() => setConfirmOpen(true)}
                    >
                        <LinkBreak size={16} />
                        {t('ads.accounts.disconnect')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('ads.accounts.disconnectTitle', { name })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('ads.accounts.disconnectBody')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('ads.accounts.keep')}</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-danger-600 text-white hover:bg-danger-700"
                            onClick={() => disconnect.mutate(account.id)}
                        >
                            {t('ads.accounts.disconnect')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export function AccountChips({ accounts }: { accounts: AdAccount[] }) {
    return (
        <ul className="flex flex-wrap items-center gap-2">
            {accounts.map((account) => (
                <li key={account.id} className="max-w-full">
                    <AccountChip account={account} />
                </li>
            ))}
        </ul>
    );
}
