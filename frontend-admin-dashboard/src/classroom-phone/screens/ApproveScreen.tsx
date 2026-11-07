/**
 * Approve a panel's QR or typed code. Before sign-in the page has only what
 * /challenge/info returns: an institute name and a theme. The room and the three
 * numbers come from /challenge/describe, after the policy check.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
    ChallengeApprovedResponse,
    ChallengeDescribeResponse,
    ChallengeHandle,
    ChallengeInfoResponse,
} from '@/classroom-shared/apiTypes';
import { isPanelApiError } from '@/classroom-shared/apiTypes';
import { challengeApprove, challengeDescribe, challengeInfo, resolveInstitute } from '../lib/api';
import { currentUserId, useAuth } from '../lib/auth';
import { errorCode, errorKind, PhoneApiError } from '../lib/http';
import { setRemote } from '../lib/remoteStore';
import { clearRoute, forgetStash, rememberTap, setRoute, type PhoneRoute } from '../lib/route';
import { applyTheme } from '../lib/theme';
import { SignInForm } from '../components/SignInForm';
import {
    ActionButton,
    FailureCard,
    NumberChoice,
    Spinner,
    StateCard,
    Warning,
} from '../components/ui';
import { fill, useStrings } from '../strings';

type Route = Extract<PhoneRoute, { kind: 'approve' }>;

type View =
    | { kind: 'loading' }
    | { kind: 'numbers'; details: ChallengeDescribeResponse }
    | { kind: 'working' }
    | { kind: 'expired' }
    | { kind: 'wrong-number' }
    | { kind: 'not-staff'; institute: string | null }
    | { kind: 'other-user' }
    | { kind: 'denied' }
    | { kind: 'failed'; failure: 'network' | 'busy' | 'error'; retry: () => void };

const CLOSED_STATES = new Set(['DEAD', 'EXPIRED']);

export function ApproveScreen({
    route,
    onSignOutRetry,
}: {
    route: Route;
    onSignOutRetry: () => void;
}) {
    const s = useStrings();
    const { signedIn, name } = useAuth();
    const [info, setInfo] = useState<ChallengeInfoResponse | null>(null);
    const [infoReady, setInfoReady] = useState(!route.t);
    const [view, setView] = useState<View>({ kind: 'loading' });
    const [describeTick, setDescribeTick] = useState(0);

    const handle: ChallengeHandle = route.t ? { t: route.t } : { user_code: route.userCode ?? '' };
    const instituteName = info?.institute_name ?? null;
    const typedCode = !route.t;

    const fail = useCallback((error: unknown, retry: () => void): void => {
        const kind = errorKind(error);
        // The sign-in form takes over: the screen restarts when the auth state returns.
        if (kind === 'sign-in') {
            setView({ kind: 'loading' });
            return;
        }
        const code = errorCode(error);
        if (code === 'EXPIRED' || code === 'NOT_FOUND') {
            forgetStash();
            setView({ kind: 'expired' });
        } else if (code === 'WRONG_NUMBER') {
            forgetStash();
            setView({ kind: 'wrong-number' });
        } else if (code === 'NOT_STAFF') {
            const body = error instanceof PhoneApiError ? error.body : null;
            setView({
                kind: 'not-staff',
                institute: isPanelApiError(body) ? body.institute_name ?? null : null,
            });
        } else if (code === 'OTHER_USER') {
            setView({ kind: 'other-user' });
        } else {
            setView({
                kind: 'failed',
                failure: kind === 'network' ? 'network' : kind === 'busy' ? 'busy' : 'error',
                retry,
            });
        }
    }, []);

    const approve = useCallback(
        (matchCode: number, details: ChallengeDescribeResponse | null) => {
            rememberTap(matchCode, currentUserId());
            setView({ kind: 'working' });
            challengeApprove({ ...handle, match_code: matchCode })
                .then((response) => {
                    const approved = response as ChallengeApprovedResponse;
                    setRemote({
                        token: approved.remote_token,
                        roomName: approved.room_name,
                        instituteId: details?.institute_id ?? info?.institute_id ?? null,
                        instituteName: details?.institute_name ?? instituteName,
                        themeCode: info?.theme_code ?? null,
                    });
                    clearRoute();
                })
                .catch((error) => fail(error, () => approve(matchCode, details)));
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [route.t, route.userCode, info, instituteName, fail]
    );

    const deny = useCallback(() => {
        setView({ kind: 'working' });
        challengeApprove({ ...handle, deny: true })
            .then(() => {
                forgetStash();
                setView({ kind: 'denied' });
            })
            .catch((error) => fail(error, deny));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.t, route.userCode, fail]);

    const loadInfo = useCallback(() => {
        if (!route.t) return;
        setInfoReady(false);
        setView({ kind: 'loading' });
        challengeInfo(route.t)
            .then((response) => {
                setInfo(response);
                applyTheme(response.theme_code);
                setInfoReady(true);
                if (CLOSED_STATES.has(response.state)) {
                    forgetStash();
                    setView({ kind: 'expired' });
                }
            })
            .catch((error) => fail(error, loadInfo));
    }, [route.t, fail]);

    useEffect(() => {
        loadInfo();
    }, [loadInfo]);

    const describe = useCallback(() => {
        setView({ kind: 'loading' });
        challengeDescribe(handle)
            .then((details) => {
                setView({ kind: 'numbers', details });
                // A typed code has no /challenge/info call to bring the theme.
                if (typedCode) {
                    void resolveInstitute(details.institute_id).then((branding) =>
                        applyTheme(branding?.instituteThemeCode)
                    );
                }
            })
            .catch((error) => fail(error, () => setDescribeTick((n) => n + 1)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.t, route.userCode, fail]);

    useEffect(() => {
        if (!signedIn || !infoReady) return;
        if (info && CLOSED_STATES.has(info.state)) return;
        // A reload after a lost approve response: repeat it, which is safe for 60 s. Only
        // for the account that tapped: any other account sees the room and numbers first.
        const sameAccount = !!route.tappedBy && route.tappedBy === currentUserId();
        if (route.tapped !== undefined && sameAccount) approve(route.tapped, null);
        else describe();
        // Only these decide whether to start over: the callbacks change with `info`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signedIn, infoReady, describeTick]);

    const scanAgain = typedCode ? (
        <ActionButton onClick={() => setRoute(null)}>{s.tryAnotherCode}</ActionButton>
    ) : (
        <ActionButton text onClick={() => setRoute(null)}>
            {s.enterCodeInstead}
        </ActionButton>
    );

    switch (view.kind) {
        case 'expired':
            return (
                <StateCard
                    tone="warning"
                    testId="expired"
                    title={typedCode ? s.codeExpiredTitle : s.expiredTitle}
                    body={typedCode ? s.codeExpiredBody : s.expiredBody}
                >
                    {scanAgain}
                </StateCard>
            );
        case 'wrong-number':
            return (
                <StateCard tone="danger" testId="wrong-number" title={s.wrongNumberTitle}>
                    {scanAgain}
                </StateCard>
            );
        case 'denied':
            return (
                <StateCard tone="info" testId="denied" title={s.deniedTitle} body={s.deniedBody}>
                    <ActionButton secondary onClick={clearRoute}>
                        {s.done}
                    </ActionButton>
                </StateCard>
            );
        case 'failed':
            return <FailureCard kind={view.failure} onRetry={view.retry} />;
        default:
            break;
    }

    if (!infoReady) return <Spinner />;

    if (!signedIn) {
        return <SignInForm instituteId={info?.institute_id} instituteName={instituteName} />;
    }

    switch (view.kind) {
        case 'not-staff':
            return (
                <StateCard
                    tone="danger"
                    testId="not-staff"
                    title={
                        view.institute || instituteName
                            ? fill(s.notStaffTitle, {
                                  institute: view.institute ?? instituteName ?? '',
                              })
                            : s.notStaffGeneric
                    }
                >
                    <ActionButton onClick={onSignOutRetry}>{s.signOutTryAnother}</ActionButton>
                </StateCard>
            );
        case 'other-user':
            return (
                <StateCard
                    tone="danger"
                    testId="other-user"
                    title={s.otherUserTitle}
                    body={s.otherUserBody}
                >
                    <ActionButton onClick={onSignOutRetry}>{s.signOutTryAnother}</ActionButton>
                </StateCard>
            );
        case 'numbers': {
            const { details } = view;
            const question =
                details.purpose === 'ATTACH_REMOTE' ? s.attachQuestion : s.approveQuestion;
            return (
                <section className="flex flex-col gap-4" data-state="approve">
                    <h1 className="text-h3 text-foreground">
                        {fill(question, {
                            room: details.room_name ?? s.aRoom,
                            institute: details.institute_name ?? instituteName ?? s.thisInstitute,
                            you: name ?? s.yourAccount,
                        })}
                    </h1>
                    <Warning>{s.approveWarning}</Warning>
                    <p className="text-subtitle text-foreground">{s.tapNumber}</p>
                    <NumberChoice
                        options={details.match_options}
                        onPick={(value) => approve(value, details)}
                    />
                    <ActionButton secondary onClick={deny}>
                        {s.notMe}
                    </ActionButton>
                </section>
            );
        }
        case 'working':
            return <Spinner label={s.working} testId="working" />;
        default:
            return <Spinner />;
    }
}
