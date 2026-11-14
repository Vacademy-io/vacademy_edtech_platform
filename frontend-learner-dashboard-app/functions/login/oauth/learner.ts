// Hands a finished OAuth sign-in back to the native iOS app.
//
// The iOS app runs Google / GitHub sign-in in an ASWebAuthenticationSession
// (MainViewController.swift) and adds `native_cb=<its app id>` to the OAuth
// return URL. auth-service then redirects here with the tokens appended. This
// answers that request with a redirect to `<app id>://login/oauth/learner?…`,
// which the session is waiting for: it closes and passes the URL to the app's
// `appUrlOpen` handler, so the SPA is never loaded inside the sheet.
// Anything else (no param, unknown app id) falls through to the SPA route.

import { nativeOAuthHandoff } from "../../../src/lib/auth/native-oauth-handoff";

export const onRequest: PagesFunction = async (context) => {
  const target = nativeOAuthHandoff(context.request.url);
  if (!target) return context.next();
  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
};
