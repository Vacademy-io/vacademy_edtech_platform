/**
 * No-op redirect target for src/lib/amplitude.ts in the panel bundle
 * (vite.panel.config.ts REDIRECTS). Analytics never ship on classroom panels;
 * this keeps sessionUtility's deferred `import('@/lib/amplitude')` tiny.
 * Shape mirrors the real module's exports.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
const noop = (..._args: unknown[]): void => undefined;

export const initializeAmplitude = noop;
export const trackEvent = (_eventName: string, _eventProperties?: Record<string, unknown>) =>
    undefined;
export const identifyUser = (_userId: string, _properties?: Record<string, unknown>) => undefined;
export const trackPageView = (_pageName: string, _additional?: Record<string, unknown>) =>
    undefined;

export const amplitudeEvents = {
    signUp: noop,
    signIn: noop,
    signOut: noop,
    navigateToPage: noop,
    useFeature: noop,
    createAssessment: noop,
    submitAssessment: noop,
    enrollStudent: noop,
    inviteStudent: noop,
    accessStudyLibrary: noop,
    viewContent: noop,
};

const amplitude = {
    init: noop,
    track: noop,
    identify: noop,
    setUserId: noop,
    reset: noop,
};

export default amplitude;
