/**
 * Evalezy video tutorials. The videos (720x1280 MP4, English voice-over, captions burned in) and their
 * posters live on the website (evalezy_landing public/tutorials/), so the web app and the native apps
 * play the same files and a new cut needs no app release.
 */
export const TUTORIAL_BASE = 'https://evalezy.com/tutorials/';

export const FULL_TUTORIAL = { slug: 'full-tutorial', seconds: 124 } as const;

/** In the order a new user needs them. Titles, summaries and steps: evalezy.json `tutorials.items.<slug>`. */
export const TUTORIALS = [
    { slug: '01-sign-up', seconds: 66 },
    { slug: '03-create-test', seconds: 49 },
    { slug: '04-marks-criteria', seconds: 55 },
    { slug: '05-upload-copies', seconds: 48 },
    { slug: '06-scan-camera', seconds: 44 },
    { slug: '07-check-results', seconds: 39 },
    { slug: '08-download-zip', seconds: 25 },
    { slug: '09-pen-handwriting', seconds: 64 },
    { slug: '10-checking-style', seconds: 80 },
] as const;

/** On the home screen, below the tests: the steps a signed-in user does next (sign-up is behind them). */
export const HOME_TUTORIALS = TUTORIALS.filter((v) =>
    ['03-create-test', '04-marks-criteria', '05-upload-copies', '07-check-results'].includes(v.slug)
);

/** From this many tests on, the list fills the home screen and the tutorials section steps aside. */
export const HOME_TUTORIALS_MAX_TESTS = 5;

export const tutorialVideo = (slug: string) => `${TUTORIAL_BASE}${slug}.mp4`;
export const tutorialPoster = (slug: string) => `${TUTORIAL_BASE}${slug}.jpg`;
export const formatSeconds = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Set right after a sign-up (trial, demo or "Buy <plan>"): the app then offers the full tutorial
 * once. Kept on logout (sessionUtility LOGOUT_PRESERVE_KEYS) so the sign-up's own logout cannot drop it.
 */
export const WELCOME_TUTORIAL_KEY = 'evalezy-welcome-tutorial';
/**
 * The home tutorials section, once closed. Session storage: it stays closed while the app is open
 * and is back on the next launch (a new tab, or the native app started again).
 */
export const TUTORIAL_CARD_KEY = 'evalezy-tutorial-card-closed';

const read = (key: string) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const write = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // private mode: the card simply shows again next time
    }
};

export const markWelcomeTutorial = () => write(WELCOME_TUTORIAL_KEY, 'pending');
export const isWelcomeTutorialPending = () => read(WELCOME_TUTORIAL_KEY) === 'pending';
export const finishWelcomeTutorial = () => write(WELCOME_TUTORIAL_KEY, 'done');
export const isTutorialCardHidden = () => {
    try {
        return sessionStorage.getItem(TUTORIAL_CARD_KEY) === '1';
    } catch {
        return false;
    }
};
export const hideTutorialCard = () => {
    try {
        sessionStorage.setItem(TUTORIAL_CARD_KEY, '1');
    } catch {
        // private mode: closed until this screen is left
    }
};
