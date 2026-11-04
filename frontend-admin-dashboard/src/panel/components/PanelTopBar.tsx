/**
 * Panel top bar: back, institute logo + name (or a screen title), custom
 * actions, clock, signed-in teacher, Home and Sign out. ≥ h-16 touch targets.
 * space-x-* only (flex `gap` needs Chrome 84).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, House, SignOut, UserCircle } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { usePanelBranding } from '../lib/branding';
import { isVoltSessionActive, usePanelSession } from '../lib/session';
import { navigate } from '../router';
import { PanelConfirmDialog } from './PanelConfirmDialog';

function useClock(): string {
    const format = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const [now, setNow] = useState(format);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(format()), 15000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}

export interface PanelTopBarProps {
    /** Screen title; when absent the institute name is shown. */
    title?: string;
    /** Shows a back button that calls this (usually goBack). */
    onBack?: () => void;
    /** Extra buttons, rendered before the clock. */
    actions?: ReactNode;
    /** Show the Home button (default: true whenever onBack is set). */
    showHome?: boolean;
    className?: string;
}

export function PanelTopBar({ title, onBack, actions, showHome, className }: PanelTopBarProps) {
    const { t } = useTranslation('panel');
    const branding = usePanelBranding();
    const { user, isSignedIn, signOut } = usePanelSession();
    const clock = useClock();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [liveSession, setLiveSession] = useState(false);
    const homeVisible = showHome ?? !!onBack;

    const askSignOut = () => {
        setLiveSession(isVoltSessionActive());
        setConfirmOpen(true);
    };

    const doSignOut = async () => {
        await signOut();
        toast.success(t('topBar.signedOut'));
        navigate('home', undefined, { replace: true });
    };

    return (
        <header
            className={cn(
                'flex min-h-20 shrink-0 items-center justify-between border-b border-border bg-card px-6 py-2',
                className
            )}
        >
            <div className="flex min-w-0 items-center space-x-4">
                {onBack && (
                    <MyButton
                        buttonType="secondary"
                        layoutVariant="icon"
                        scale="large"
                        className="size-16 shrink-0"
                        aria-label={t('common.back')}
                        onClick={onBack}
                    >
                        <ArrowLeft size={32} />
                    </MyButton>
                )}
                {branding?.logoUrl && !title && (
                    <img
                        src={branding.logoUrl}
                        alt=""
                        className="h-12 w-auto max-w-48 shrink-0 object-contain"
                    />
                )}
                <h1 className="truncate text-h2 font-semibold text-neutral-800">
                    {title ?? branding?.name ?? t('app.name')}
                </h1>
            </div>

            <div className="flex shrink-0 items-center space-x-4 pl-4">
                {actions}
                <span className="hidden text-h3 tabular-nums text-neutral-600 md:inline">
                    {clock}
                </span>
                {isSignedIn && user && (
                    <span className="hidden max-w-xs items-center space-x-2 truncate text-subtitle text-neutral-600 lg:flex">
                        <UserCircle size={32} className="shrink-0" aria-hidden />
                        <span className="truncate">{user.fullName || user.username}</span>
                    </span>
                )}
                {homeVisible && (
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-6"
                        onClick={() => navigate('home')}
                    >
                        <span className="flex items-center space-x-2">
                            <House size={28} aria-hidden />
                            <span>{t('common.home')}</span>
                        </span>
                    </MyButton>
                )}
                {isSignedIn && (
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-6"
                        onClick={askSignOut}
                    >
                        <span className="flex items-center space-x-2">
                            <SignOut size={28} aria-hidden />
                            <span>{t('topBar.signOut')}</span>
                        </span>
                    </MyButton>
                )}
            </div>

            <PanelConfirmDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                title={liveSession ? t('topBar.signOutLiveTitle') : t('topBar.signOutTitle')}
                description={liveSession ? t('topBar.signOutLiveBody') : t('topBar.signOutBody')}
                confirmLabel={t('topBar.signOut')}
                onConfirm={doSignOut}
            />
        </header>
    );
}
