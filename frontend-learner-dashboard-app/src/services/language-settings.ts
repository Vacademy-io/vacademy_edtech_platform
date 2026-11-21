/**
 * Institute language configuration — cached locally from the institute
 * settings JSON (setting.LANGUAGE_SETTING.data) by
 * fetchAndStoreInstituteDetails.tsx, the same way NAMING_SETTING populates
 * the naming-settings key. Mirrors the admin app's
 * src/services/language-settings.ts — keep the storage key and shape in sync.
 */
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  normalizeLocale,
  type SupportedLocale,
} from "@/i18n/locales";

export const LANGUAGE_SETTING_STORAGE_KEY = "languageSetting";

/** Shape persisted at LANGUAGE_SETTING.data (snake_case backend contract). */
export interface LanguageSetting {
  default_locale?: string;
  enabled_locales?: string[];
  content_source_locale?: string;
  timezone?: string;
}

/** Reads the cached institute language setting; null when absent/corrupt. */
export function getLanguageSetting(): LanguageSetting | null {
  try {
    const raw = localStorage.getItem(LANGUAGE_SETTING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as LanguageSetting) : null;
  } catch {
    return null;
  }
}

export function setLanguageSettingCache(setting: LanguageSetting): void {
  try {
    localStorage.setItem(LANGUAGE_SETTING_STORAGE_KEY, JSON.stringify(setting));
  } catch {
    // Storage full/unavailable — non-fatal, pickers fall back to defaults.
  }
}

export function clearLanguageSettingCache(): void {
  try {
    localStorage.removeItem(LANGUAGE_SETTING_STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Extract LANGUAGE_SETTING.data out of an institute's settings JSON (the
 * `institute_settings_json` / public `setting` field, string or object) and
 * refresh the cache from it. Clears the cache when the institute has no
 * LANGUAGE_SETTING so a value from a previously used institute never lingers.
 *
 * fetchAndStoreInstituteDetails only runs at login, so without this a learner
 * who was already signed in when the admin enabled more languages keeps an
 * English-only cache until they log out and back in — and the pre-login page
 * never gets one at all. Callers that already have the public institute
 * details (navbar, language dropdown) pass the `setting` field through here.
 */
export function syncLanguageSettingFromSettingJson(
  settingJson: unknown
): LanguageSetting | null {
  try {
    const parsed =
      typeof settingJson === "string"
        ? settingJson
          ? JSON.parse(settingJson)
          : null
        : settingJson;
    const data = parsed?.setting?.LANGUAGE_SETTING?.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      setLanguageSettingCache(data as LanguageSetting);
      return data as LanguageSetting;
    }
    clearLanguageSettingCache();
    return null;
  } catch {
    return null;
  }
}

/**
 * Locales the language picker should offer, in canonical SUPPORTED_LOCALES
 * order. Uses the institute's enabled_locales when configured; when the
 * institute has no LANGUAGE_SETTING (all existing institutes), defaults to
 * English plus whatever the user currently has selected, so an already-made
 * choice never becomes unselectable.
 */
export function getEnabledLocales(currentLocale?: string): SupportedLocale[] {
  const setting = getLanguageSetting();
  const configured = (setting?.enabled_locales ?? []).filter(isSupportedLocale);

  const enabled = new Set<SupportedLocale>(
    configured.length > 0 ? configured : [DEFAULT_LOCALE]
  );
  if (currentLocale) {
    enabled.add(normalizeLocale(currentLocale));
  }

  return SUPPORTED_LOCALES.filter((locale) => enabled.has(locale));
}
