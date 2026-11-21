/**
 * #/signin: the card full-screen. An auth-required screen redirects here, and it is
 * what Switch teacher, rescan and Connect phone open. Signed in, it has Cancel and
 * sits over the current screen, whose session keeps running until the new approval.
 *
 *   #/signin                  sign in
 *   #/signin?purpose=attach   ATTACH_REMOTE, "Connect your phone"
 *   #/signin?mode=password    the password form, where an admin has allowed it
 */
import { Suspense, lazy, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MyButton } from '@/components/design-system/button';
import { cn } from '@/lib/utils';
import { PanelLoading } from '../components/PanelScreenState';
import { PanelStage, PanelStageBody } from '../components/PanelStage';
import { PanelTopBar } from '../components/PanelTopBar';
import { refreshBranding } from '../lib/branding';
import { usePanelSession } from '../lib/session';
import { getCurrentRoute, goBack, navigate, parseHash, routeFromNext } from '../router';
import { SignInCard } from './SignInCard';
import type { SignInOutcome } from './signInFlow';

const LoginScreen = lazy(() => import('../screens/LoginScreen'));

/** Where a finished sign-in goes when there was no teacher to go back to. */
export function goAfterSignIn(nextParam: string | undefined): void {
    const next = routeFromNext(nextParam);
    if (next) navigate(next.screen, next.params, { replace: true });
    else navigate('home', undefined, { replace: true });
}

export default function SignInScreen({ overlay = false }: { overlay?: boolean }) {
    const { t } = useTranslation('device');
    // The real route: while this is an overlay, usePanelRoute is frozen for the screen below.
    const route = parseHash(window.location.hash);
    const { isSignedIn } = usePanelSession();
    const wasSignedIn = useRef(isSignedIn);
    const params = route.params;
    const attach = params.purpose === 'attach' && isSignedIn;

    if (params.mode === 'password') {
        return (
            <Suspense
                fallback={
                    <PanelStage className="items-center justify-center">
                        <PanelLoading />
                    </PanelStage>
                }
            >
                <LoginScreen />
            </Suspense>
        );
    }

    const onDone = (outcome: SignInOutcome) => {
        if (getCurrentRoute().screen !== 'signin') return;
        if (outcome.kind === 'attached') {
            toast.success(t('signIn.attached'));
            goBack();
            return;
        }
        if (outcome.kind !== 'signedIn') return;
        void refreshBranding();
        if (wasSignedIn.current && outcome.sameUser) goBack();
        else goAfterSignIn(params.next);
    };

    return (
        <PanelStage className={cn(overlay && 'z-50')}>
            <div
                role={overlay ? 'dialog' : undefined}
                aria-modal={overlay || undefined}
                className="contents"
            >
                <PanelTopBar
                    title={attach ? t('signIn.attachTitle') : t('signIn.title')}
                    sessionActions={false}
                    actions={
                        isSignedIn ? (
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-8"
                                onClick={goBack}
                            >
                                {t('signIn.cancel')}
                            </MyButton>
                        ) : (
                            <MyButton
                                buttonType="secondary"
                                scale="large"
                                className="h-16 px-8"
                                onClick={() => navigate('home', undefined, { replace: true })}
                            >
                                {t('signIn.home')}
                            </MyButton>
                        )
                    }
                />
                <PanelStageBody className="flex flex-col items-center justify-center p-6">
                    <div className="mx-auto w-full max-w-screen-xl">
                        <SignInCard
                            key={attach ? 'attach' : 'signin'}
                            purpose={attach ? 'ATTACH_REMOTE' : 'SIGN_IN'}
                            onDone={onDone}
                            showActions={!isSignedIn}
                        />
                    </div>
                </PanelStageBody>
            </div>
        </PanelStage>
    );
}
