import { type ReactNode, useState } from 'react';
import { Helmet } from 'react-helmet';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
    ArrowUUpLeft,
    BookOpenText,
    CashRegister,
    DotsThreeVertical,
    Lock,
    Receipt as ReceiptIcon,
    ShoppingCart,
    SignOut,
    Stack,
    Wallet,
} from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useCommerceAccess } from '@/lib/commerce/use-commerce-access';
import { cn } from '@/lib/utils';
import { useSession } from '../-shared/pos-hooks';
import type { SessionView } from '../-shared/pos-types';
import { useOnline } from '../-shared/use-online';
import { PosCashMovementDialog } from './PosCashMovementDialog';
import { PosOfflineBanner } from './PosOfflineBanner';
import { PosErrorNotice } from './pos-ui';

export type PosScreen = 'sell' | 'bills' | 'returns' | 'billBook' | 'close';

const NAV: { id: PosScreen; to: string; labelKey: string; icon: typeof ShoppingCart }[] = [
    { id: 'sell', to: '/commerce/pos/$sessionId', labelKey: 'pos.nav.sell', icon: ShoppingCart },
    { id: 'bills', to: '/commerce/pos/$sessionId/bills', labelKey: 'pos.nav.bills', icon: ReceiptIcon },
    { id: 'returns', to: '/commerce/pos/$sessionId/returns', labelKey: 'pos.nav.returns', icon: ArrowUUpLeft },
    { id: 'billBook', to: '/commerce/pos/$sessionId/bill-book', labelKey: 'pos.nav.billBook', icon: BookOpenText },
    { id: 'close', to: '/commerce/pos/$sessionId/close', labelKey: 'pos.nav.close', icon: Lock },
];

/**
 * The till's frame (contract §7.1): full screen, no admin sidebar. The top
 * bar names the counter and the cashier, shows the connection, and moves
 * between the counter's screens. The page body gets the loaded session.
 */
export function PosShell({
    sessionId,
    active,
    onHeldBills,
    children,
}: {
    sessionId: string;
    active: PosScreen;
    /** Sell screen only: opens its held-bills sheet from the menu. */
    onHeldBills?: () => void;
    children: (session: SessionView, online: boolean) => ReactNode;
}) {
    const { t } = useTranslation('commerce');
    const access = useCommerceAccess();
    const online = useOnline();
    const query = useSession(sessionId);
    const [cashOpen, setCashOpen] = useState(false);
    const session = query.data;
    const isOpen = session?.status === 'OPEN';
    const canCash = !!session && isOpen && access.isManager && session.next_actions.includes('CASH_MOVEMENT');

    return (
        <div className="flex h-screen min-h-0 flex-col bg-neutral-50">
            <Helmet>
                <title>{t('meta.pageTitle', { title: t('pos.title') })}</title>
            </Helmet>
            <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
                <div className="flex min-w-0 shrink-0 items-center gap-2">
                    <CashRegister size={28} className="shrink-0 text-primary-500" />
                    <div className="flex min-w-0 flex-col">
                        <span className="truncate text-subtitle font-medium text-foreground">
                            {session ? `${session.register.code} · ${session.register.name}` : t('pos.title')}
                        </span>
                        {session && (
                            <span className="truncate text-caption text-muted-foreground">
                                {[session.location.name, session.cashier_name].filter(Boolean).join(' · ')}
                            </span>
                        )}
                    </div>
                </div>
                <nav aria-label={t('pos.title')} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                    {NAV.map((item) => {
                        const Icon = item.icon;
                        return (
                            <Link
                                key={item.id}
                                to={item.to as never}
                                params={{ sessionId } as never}
                                aria-current={active === item.id ? 'page' : undefined}
                                className={cn(
                                    'flex min-h-12 shrink-0 items-center gap-2 rounded-md px-3 text-body',
                                    active === item.id
                                        ? 'bg-primary-50 font-medium text-primary-500'
                                        : 'text-neutral-600 hover:bg-neutral-100'
                                )}
                            >
                                <Icon size={20} />
                                <span>{t(item.labelKey)}</span>
                            </Link>
                        );
                    })}
                </nav>
                <span
                    data-testid="pos-online"
                    className={cn(
                        'flex shrink-0 items-center gap-1.5 text-caption',
                        online ? 'text-success-600' : 'text-warning-600'
                    )}
                >
                    <span
                        aria-hidden
                        className={cn('size-2 rounded-full', online ? 'bg-success-500' : 'bg-warning-500')}
                    />
                    {online ? t('pos.online') : t('pos.offlineShort')}
                </span>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            aria-label={t('pos.nav.more')}
                            className="flex size-12 shrink-0 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100"
                        >
                            <DotsThreeVertical size={24} weight="bold" />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-56">
                        {onHeldBills && (
                            <DropdownMenuItem className="min-h-12 gap-2" onSelect={onHeldBills}>
                                <Stack size={18} />
                                {t('pos.sell.held')}
                            </DropdownMenuItem>
                        )}
                        {canCash && (
                            <DropdownMenuItem className="min-h-12 gap-2" onSelect={() => setCashOpen(true)}>
                                <Wallet size={18} />
                                {t('pos.cash.heading')}
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem asChild className="min-h-12 gap-2">
                            <Link to="/commerce/pos">
                                <CashRegister size={18} />
                                {t('pos.nav.counters')}
                            </Link>
                        </DropdownMenuItem>
                        {access.isManager && (
                            <DropdownMenuItem asChild className="min-h-12 gap-2">
                                <Link to="/commerce">
                                    <SignOut size={18} />
                                    {t('pos.nav.exit')}
                                </Link>
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </header>
            <PosOfflineBanner online={online} />
            <main className="flex min-h-0 flex-1 flex-col">
                {query.isLoading && (
                    <div className="flex flex-col gap-4 p-6" aria-busy="true">
                        <Skeleton className="h-10 w-72" />
                        <Skeleton className="h-64 w-full" />
                    </div>
                )}
                {query.isError && (
                    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
                        <PosErrorNotice error={query.error} />
                        <div className="flex gap-2">
                            <MyButton type="button" buttonType="secondary" scale="large" className="h-12" onClick={() => void query.refetch()}>
                                {t('common.retry')}
                            </MyButton>
                            <Link to="/commerce/pos">
                                <MyButton type="button" buttonType="primary" scale="large" className="h-12">
                                    {t('pos.nav.counters')}
                                </MyButton>
                            </Link>
                        </div>
                    </div>
                )}
                {session && !isOpen && active !== 'close' && active !== 'bills' && (
                    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
                        <Lock size={40} className="text-muted-foreground" />
                        <p className="text-title text-foreground">{t('pos.closed.title')}</p>
                        <p className="text-body text-muted-foreground">{t('pos.closed.description')}</p>
                        <Link to="/commerce/pos">
                            <MyButton type="button" buttonType="primary" scale="large" className="h-12">
                                {t('pos.nav.counters')}
                            </MyButton>
                        </Link>
                    </div>
                )}
                {session && (isOpen || active === 'close' || active === 'bills') && children(session, online)}
            </main>
            {session && canCash && (
                <PosCashMovementDialog sessionId={session.id} open={cashOpen} onOpenChange={setCashOpen} />
            )}
        </div>
    );
}
