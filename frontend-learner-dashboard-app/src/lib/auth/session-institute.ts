import { Preferences } from "@capacitor/preferences";
import { TokenKey } from "@/constants/auth/tokens";
import {
  getTokenDecodedData,
  getTokenFromStorage,
  isTokenExpired,
} from "@/lib/auth/sessionUtility";
import { hasArrivalTokens } from "@/lib/auth/arrival-tokens";
import { INSTITUTE_SELECTED_EVENT } from "@/lib/auth/post-login-redirect";
import { adoptInstituteBranding, getCachedInstituteBranding } from "@/services/domain-routing";
import { NAMING_SETTINGS_KEY } from "@/types/naming-settings";
import { THEME_ROLE_SETTINGS_KEY } from "@/types/theme-role-settings";
import { syncLanguageSettingFromSettingJson } from "@/services/language-settings";
import { notifyNamingSettingsUpdated } from "@/components/common/layout-container/sidebar/utils";

/**
 * Which institute a signed-in learner belongs to, as opposed to which institute
 * this host is mapped to. The two differ on the shared host and whenever a
 * learner of one institute opens another institute's domain: the host's routing
 * answer then describes the site being visited, not the learner.
 *
 * The plain `localStorage.InstituteDetails` copy decides first, because
 * `Preferences.InstituteDetails` and `Preferences.InstituteId` also take writes
 * from public pages. It counts only for an institute the token or the student
 * record names: the record covers a learner enrolled after the token was issued.
 */
export interface SessionInstituteInputs {
  tokenInstitutes: string[];
  signedInCopyId?: string | null;
  studentInstituteId?: string | null;
  selectedId?: string | null;
  storedDetailsId?: string | null;
  storedInstituteId?: string | null;
}

export const pickSessionInstitute = ({
  tokenInstitutes,
  signedInCopyId,
  studentInstituteId,
  selectedId,
  storedDetailsId,
  storedInstituteId,
}: SessionInstituteInputs): string | null => {
  if (tokenInstitutes.length === 0) return null;
  const onToken = (id?: string | null) => !!id && tokenInstitutes.includes(id);
  if (signedInCopyId && (onToken(signedInCopyId) || signedInCopyId === studentInstituteId)) {
    return signedInCopyId;
  }
  if (onToken(selectedId)) return selectedId as string;
  if (onToken(storedDetailsId)) return storedDetailsId as string;
  if (onToken(storedInstituteId)) return storedInstituteId as string;
  return tokenInstitutes[0] ?? null;
};

/** A session is over once the access token has expired and nothing can renew it. */
export const isLiveSession = (
  accessToken: string | null | undefined,
  refreshToken: string | null | undefined,
): boolean => !!accessToken && (!!refreshToken || !isTokenExpired(accessToken));

const parseJson = <T>(raw: string | null | undefined): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

interface SavedInstitute {
  id?: string | null;
  institute_name?: string | null;
  institute_logo_file_id?: string | null;
  institute_theme_code?: string | null;
  institute_settings_json?: string | null;
  home_icon_click_route?: string | null;
  homeIconClickRoute?: string | null;
}

const readSignedInCopy = (): SavedInstitute | null => {
  try {
    return parseJson<SavedInstitute>(localStorage.getItem("InstituteDetails"));
  } catch {
    return null;
  }
};

interface SessionInstitute {
  instituteId: string;
  userId: string | null;
  storedDetails: SavedInstitute | null;
  storedInstituteId: string | null;
  signedInCopy: SavedInstitute | null;
  hasStudentRecord: boolean;
}

const readSessionInstitute = async (): Promise<SessionInstitute | null> => {
  const [accessToken, refreshToken] = await Promise.all([
    getTokenFromStorage(TokenKey.accessToken),
    getTokenFromStorage(TokenKey.refreshToken),
  ]);
  if (!isLiveSession(accessToken, refreshToken)) return null;

  const decoded = getTokenDecodedData(accessToken) as
    | { user?: string; authorities?: Record<string, unknown>; institute_id?: string }
    | undefined;
  const tokenInstitutes = Object.keys(decoded?.authorities ?? {});
  if (decoded?.institute_id && !tokenInstitutes.includes(decoded.institute_id)) {
    tokenInstitutes.push(decoded.institute_id);
  }

  const [selected, details, stored, student] = await Promise.all([
    Preferences.get({ key: "selectedInstituteId" }),
    Preferences.get({ key: "InstituteDetails" }),
    Preferences.get({ key: "InstituteId" }),
    Preferences.get({ key: "StudentDetails" }),
  ]);
  const storedDetails = parseJson<SavedInstitute>(details.value);
  const signedInCopy = readSignedInCopy();
  const instituteId = pickSessionInstitute({
    tokenInstitutes,
    signedInCopyId: signedInCopy?.id,
    studentInstituteId: parseJson<{ institute_id?: string | null }>(student.value)?.institute_id,
    selectedId: selected.value,
    storedDetailsId: storedDetails?.id,
    storedInstituteId: stored.value,
  });
  if (!instituteId) return null;

  return {
    instituteId,
    userId: decoded?.user ?? null,
    storedDetails,
    storedInstituteId: stored.value,
    signedInCopy,
    hasStudentRecord: !!student.value,
  };
};

/** The signed-in learner's institute, or null when nobody is signed in. */
export const readSessionInstituteId = async (): Promise<string | null> => {
  try {
    return (await readSessionInstitute())?.instituteId ?? null;
  } catch {
    return null;
  }
};

// What a sign-in leaves behind while, or after failing, fetching the institute.
const LOADING_NAME = "Loading...";
const isPlaceholder = (copy: SavedInstitute) =>
  copy.institute_theme_code === "#000000" && // design-lint-ignore: sign-in placeholder value
  (copy.institute_name === LOADING_NAME || copy.institute_name === "Institute");

const isUsableCopy = (copy: SavedInstitute | null, instituteId: string) =>
  !!copy && copy.id === instituteId && !isPlaceholder(copy);

export interface InstituteStateCheck {
  /** Saved details, id or colours describe an institute other than the learner's. */
  identity: boolean;
  /** Saved branding describes an institute other than the learner's. */
  branding: boolean;
  /** Sign-in hydration never completed, so only the server can fill this in. */
  hydration: boolean;
}

export const checkInstituteState = (
  instituteId: string,
  saved: {
    storedDetails: SavedInstitute | null;
    storedInstituteId: string | null;
    signedInCopy: SavedInstitute | null;
    brandingInstituteId: string | null | undefined;
    brandingInstituteName?: string | null;
  },
): InstituteStateCheck => ({
  identity:
    saved.storedDetails?.id !== instituteId ||
    (!!saved.storedInstituteId && saved.storedInstituteId !== instituteId),
  branding:
    (!!saved.brandingInstituteId && saved.brandingInstituteId !== instituteId) ||
    saved.brandingInstituteName === LOADING_NAME,
  hydration: !isUsableCopy(saved.signedInCopy ?? saved.storedDetails, instituteId),
});

const restoreColours = (theme: string | null | undefined) => {
  localStorage.removeItem("theme-custom-color");
  localStorage.removeItem("theme-code");
  if (theme?.startsWith("#")) localStorage.setItem("theme-custom-color", theme);
  else if (theme) localStorage.setItem("theme-code", theme);
};

const restoreSettings = (copy: SavedInstitute) => {
  const settings = parseJson<{
    setting?: {
      NAMING_SETTING?: { data?: { data?: unknown } };
      THEME_SETTING?: { data?: { roles?: unknown } };
    };
  }>(copy.institute_settings_json)?.setting;

  const words = settings?.NAMING_SETTING?.data?.data;
  if (Array.isArray(words)) localStorage.setItem(NAMING_SETTINGS_KEY, JSON.stringify(words));
  else localStorage.removeItem(NAMING_SETTINGS_KEY);
  notifyNamingSettingsUpdated();

  const theme = settings?.THEME_SETTING?.data;
  if (theme?.roles) localStorage.setItem(THEME_ROLE_SETTINGS_KEY, JSON.stringify(theme));
  else localStorage.removeItem(THEME_ROLE_SETTINGS_KEY);

  syncLanguageSettingFromSettingJson(copy.institute_settings_json ?? "");
};

const restoreFromCopy = async (
  instituteId: string,
  copy: SavedInstitute,
  check: InstituteStateCheck,
) => {
  const value = JSON.stringify(copy);
  await Preferences.set({ key: "InstituteDetails", value });
  await Preferences.set({ key: "InstituteId", value: instituteId });
  localStorage.setItem("InstituteDetails", value);
  localStorage.setItem("InstituteId", instituteId);
  if (check.identity || check.branding) restoreSettings(copy);
  if (check.identity) restoreColours(copy.institute_theme_code);
  adoptInstituteBranding({ ...copy, id: instituteId });
};

const hydrateFromServer = async (instituteId: string, userId: string | null) => {
  const { fetchAndStoreInstituteDetails } = await import(
    "@/services/fetchAndStoreInstituteDetails"
  );
  const details = await fetchAndStoreInstituteDetails(instituteId, userId ?? "");
  if (isUsableCopy(details as SavedInstitute | null, instituteId)) {
    restoreColours(details?.institute_theme_code);
  }
  // The app may have started while this was in flight: let it repaint.
  window.dispatchEvent(new Event(INSTITUTE_SELECTED_EVENT));
};

/**
 * Brings a signed-in learner's saved institute state into line with the
 * institute they signed in to. Runs on every start and does nothing when the
 * state already agrees. Local copies are used first; the server is asked only
 * when none is usable.
 */
export const repairSessionInstituteState = async (): Promise<void> => {
  try {
    // The admin page editor's frames and in-progress sign-ins own their state.
    if (window.self !== window.top || hasArrivalTokens()) return;

    const session = await readSessionInstitute();
    if (!session?.hasStudentRecord || !session.storedDetails) return;

    const { instituteId, storedDetails, signedInCopy, storedInstituteId, userId } = session;
    const branding = getCachedInstituteBranding();
    const check = checkInstituteState(instituteId, {
      storedDetails,
      storedInstituteId,
      signedInCopy,
      brandingInstituteId: branding?.instituteId,
      brandingInstituteName: branding?.instituteName,
    });
    if (!check.identity && !check.branding && !check.hydration) return;

    const copy = [signedInCopy, storedDetails].find((c) => isUsableCopy(c, instituteId));
    if (copy) {
      await restoreFromCopy(instituteId, copy, check);
      return;
    }
    // Nothing local can stand in, so at least stop showing another institute.
    if (check.identity || check.branding) {
      localStorage.removeItem(NAMING_SETTINGS_KEY);
      notifyNamingSettingsUpdated();
      adoptInstituteBranding({ id: instituteId });
    }
    await hydrateFromServer(instituteId, userId);
  } catch (error) {
    console.warn("[SessionInstitute] Could not check saved institute state:", error);
  }
};
