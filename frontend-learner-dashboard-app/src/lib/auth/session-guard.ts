import { Preferences } from "@capacitor/preferences";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";

/**
 * A learner counts as signed in only with all three of: an access token, a
 * cached StudentDetails and a cached InstituteDetails. Any one missing means
 * the app cannot render an authenticated screen, so the caller must send the
 * visitor to /login.
 *
 * Extracted from the root route's private copy so individual routes that are
 * listed as "public" in __root.tsx (they must render their own shell before the
 * session is known) can run the exact same check instead of re-deriving it.
 */
export const hasLearnerSession = async (): Promise<boolean> => {
  const token = await getTokenFromStorage(TokenKey.accessToken);
  const studentDetails = await Preferences.get({ key: "StudentDetails" });
  const instituteDetails = await Preferences.get({ key: "InstituteDetails" });

  return (
    !isNullOrEmptyOrUndefined(token) &&
    !isNullOrEmptyOrUndefined(studentDetails?.value) &&
    !isNullOrEmptyOrUndefined(instituteDetails?.value)
  );
};
