import { flavorConfig } from "../../../flavor.config";

/**
 * Query param on the OAuth return URL naming the native app to hand the result
 * to. Set by openOAuthInSystemBrowser on iOS; read by
 * functions/login/oauth/learner.ts. Pure (no browser APIs) so the Pages
 * Function can import it.
 */
export const NATIVE_OAUTH_CALLBACK_PARAM = "native_cb";

/**
 * `<app id>://login/oauth/learner?<query minus native_cb>` for a return URL
 * that asks for a hand-off, or null. Only app ids listed in flavor.config.ts
 * qualify: the query carries the learner's tokens, and an arbitrary scheme
 * would hand them to whichever app claims it.
 */
export function nativeOAuthHandoff(requestUrl: string): string | null {
  const url = new URL(requestUrl);
  const appId = url.searchParams.get(NATIVE_OAUTH_CALLBACK_PARAM);
  if (!appId || !Object.prototype.hasOwnProperty.call(flavorConfig, appId)) return null;
  url.searchParams.delete(NATIVE_OAUTH_CALLBACK_PARAM);
  return `${appId}://login/oauth/learner${url.search}`;
}
