import { useCallback, useEffect, useState } from 'react';
import { ActionButton, StateCard } from './components/ui';
import { ApproveScreen } from './screens/ApproveScreen';
import { CodeEntryScreen } from './screens/CodeEntryScreen';
import { PairScreen } from './screens/PairScreen';
import { RemoteScreen } from './screens/RemoteScreen';
import { StartScreen } from './screens/StartScreen';
import { expireSignIn, useAuth } from './lib/auth';
import { clearRemote, useRemote } from './lib/remoteStore';
import { forgetTap, useRoute } from './lib/route';
import { readLocalString, writeLocalString } from './lib/storage';
import { applyTheme } from './lib/theme';
import { detectLang, STRINGS, StringsContext, type PhoneLang } from './strings';

const LANG_KEY = 'classroom.lang';

export function App() {
    const [lang, setLang] = useState<PhoneLang>(() =>
        detectLang(readLocalString(LANG_KEY), navigator.language)
    );
    const strings = STRINGS[lang];
    const { route, revision } = useRoute();
    const remote = useRemote();
    const { signedIn } = useAuth();
    const [sessionEnded, setSessionEnded] = useState(false);

    useEffect(() => {
        document.documentElement.lang = lang;
        document.title = strings.appName;
    }, [lang, strings]);

    // The remote goes too: on a borrowed computer the next person who opens this page
    // must not get the previous teacher's remote. The route stays, so another account
    // can carry on with the same approve or pair step, but a number already tapped does not.
    const signOutOfPhone = useCallback(() => {
        forgetTap();
        expireSignIn();
        clearRemote();
        setSessionEnded(false);
    }, []);

    const noteSessionEnded = useCallback(() => setSessionEnded(true), []);

    useEffect(() => {
        if (!route && remote) applyTheme(remote.themeCode);
    }, [route, remote]);

    const toggleLang = () => {
        const next: PhoneLang = lang === 'en' ? 'hi' : 'en';
        writeLocalString(LANG_KEY, next);
        setLang(next);
    };

    let screen;
    if (route?.kind === 'approve') {
        screen = <ApproveScreen key={revision} route={route} onSignOutRetry={signOutOfPhone} />;
    } else if (route?.kind === 'pair') {
        screen = <PairScreen key={revision} route={route} onSignOutRetry={signOutOfPhone} />;
    } else if (route?.kind === 'start') {
        screen = <StartScreen key={revision} route={route} onSignOutRetry={signOutOfPhone} />;
    } else if (remote) {
        screen = (
            <RemoteScreen key={remote.token} remote={remote} onSessionEnded={noteSessionEnded} />
        );
    } else if (sessionEnded) {
        screen = (
            <StateCard
                tone="info"
                testId="session-ended"
                title={strings.sessionEnded}
                body={strings.sessionEndedBody}
            >
                <ActionButton secondary onClick={() => setSessionEnded(false)}>
                    {strings.enterCodeInstead}
                </ActionButton>
            </StateCard>
        );
    } else {
        screen = <CodeEntryScreen key={revision} />;
    }

    return (
        <StringsContext.Provider value={strings}>
            <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-4">
                <main className="flex flex-1 flex-col gap-4">{screen}</main>
                <footer className="flex items-center justify-between gap-3 text-body">
                    {signedIn || remote ? (
                        <button
                            type="button"
                            data-action="sign-out-phone"
                            onClick={signOutOfPhone}
                            className="min-h-10 text-start text-muted-foreground underline"
                        >
                            {strings.signOutPhone}
                        </button>
                    ) : (
                        <span />
                    )}
                    <button
                        type="button"
                        data-action="language"
                        onClick={toggleLang}
                        className="min-h-10 text-muted-foreground underline"
                    >
                        {strings.language}
                    </button>
                </footer>
            </div>
        </StringsContext.Provider>
    );
}
