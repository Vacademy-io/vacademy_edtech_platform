import { getInstituteId } from "@/constants/helper";
import { BASE_URL } from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { Preferences } from "@capacitor/preferences";
import { useSyncExternalStore } from "react";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";

export const DEFAULT_CHATBOT_SETTINGS: ChatbotSettingsData = {
  assistant_name: "Vacademy Chatbot",
  institute_name: "Vacademy",
  avatarUrl:
    "https://res.cloudinary.com/dwtmtd0oz/image/upload/t_chatbot/chatbot-avatar_xsyf0n",
  enable: false,
  enabled_modes: ['general', 'doubt', 'practice'],
  chatbot_pages: ['dashboard', 'all_courses', 'course_details', 'study_material'],
  show_ai_settings_shortcut: false,
  voice_settings: {
    default_language: 'en-IN',
    default_voice: 'shubh',
  },
  launcher_settings: {
    draggable: true,
    nudge_enabled: true,
    nudge_interval_seconds: 120,
    nudge_duration_seconds: 5,
    bounce: true,
  },
};
export const CHATBOT_SETTINGS_KEY = "CHATBOT_SETTING";
const LS_KEY = `${CHATBOT_SETTINGS_KEY}_cache_v1`;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — keeps settings fresh after admin updates

/** Fallback icon, used whenever the institute has not set one of its own. */
export const DEFAULT_CHATBOT_AVATAR_URL = DEFAULT_CHATBOT_SETTINGS.avatarUrl;

/**
 * The chatbot icon is admin-configurable (Settings -> AI -> Student AI), and the
 * stored value is either a direct image URL or a media-service file id that has
 * to be exchanged for a public URL. Components can't await that, so the resolved
 * URL lives in this tiny store: seeded synchronously from localStorage (no flash
 * of the default icon on reload) and refreshed whenever settings are fetched.
 */
const AVATAR_LS_KEY = `${LS_KEY}_avatar_v1`;

interface CachedAvatar {
  instituteId: string;
  url: string;
}

function readCachedAvatar(): CachedAvatar | null {
  try {
    const raw = localStorage.getItem(AVATAR_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAvatar;
    return parsed?.url ? parsed : null;
  } catch {
    return null;
  }
}

// Seeded from whichever institute last used this device, then corrected as soon
// as we know which institute we are actually on (see refreshAvatarUrl).
const seededAvatar = readCachedAvatar();
let resolvedAvatarUrl = seededAvatar?.url || DEFAULT_CHATBOT_AVATAR_URL;
let avatarInstituteId: string | null = seededAvatar?.instituteId ?? null;
// Several callers fetch settings on boot; only the newest resolution may win,
// otherwise a slow stale lookup can overwrite (and cache) a fresh icon.
let avatarResolutionId = 0;
const avatarListeners = new Set<() => void>();

export function getChatbotAvatarUrl(): string {
  return resolvedAvatarUrl;
}

function publishAvatarUrl(url: string, instituteId: string): void {
  const next = url || DEFAULT_CHATBOT_AVATAR_URL;
  avatarInstituteId = instituteId;
  try {
    localStorage.setItem(
      AVATAR_LS_KEY,
      JSON.stringify({ instituteId, url: next } satisfies CachedAvatar)
    );
  } catch {
    // noop
  }
  if (next === resolvedAvatarUrl) return;
  resolvedAvatarUrl = next;
  avatarListeners.forEach((listener) => listener());
}

function subscribeToAvatarUrl(listener: () => void): () => void {
  avatarListeners.add(listener);
  return () => {
    avatarListeners.delete(listener);
  };
}

/** Current chatbot icon; re-renders the caller when settings resolve. */
export function useChatbotAvatarUrl(): string {
  return useSyncExternalStore(
    subscribeToAvatarUrl,
    getChatbotAvatarUrl,
    getChatbotAvatarUrl
  );
}

function isDirectImageUrl(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("/")
  );
}

/**
 * Resolve the configured icon into a renderable URL. Runs unauthenticated so the
 * chatbot also shows the right icon on public catalogue pages.
 *
 * Call this only for a genuine settings resolution: a fallback to defaults (no
 * institute id yet, offline boot, 5xx, a failed file lookup) must leave the
 * cached icon alone, or one bad load permanently downgrades a white-labelled
 * institute to the Vacademy avatar.
 */
async function refreshAvatarUrl(
  settings: ChatbotSettingsData,
  instituteId: string
): Promise<void> {
  const resolutionId = ++avatarResolutionId;
  // Another institute was last seen on this device — drop its icon immediately
  // rather than showing it until this resolution lands.
  if (avatarInstituteId && avatarInstituteId !== instituteId) {
    publishAvatarUrl(DEFAULT_CHATBOT_AVATAR_URL, instituteId);
  }
  const stored = (settings.avatarUrl || settings.avatar_url || "").trim();
  if (!stored || isDirectImageUrl(stored)) {
    publishAvatarUrl(stored || DEFAULT_CHATBOT_AVATAR_URL, instituteId);
    return;
  }
  try {
    const url = await getPublicUrlWithoutLogin(stored);
    if (resolutionId === avatarResolutionId) publishAvatarUrl(url, instituteId);
  } catch {
    // Keep whatever icon is showing: a lookup failure is not a config change.
  }
}

export interface ChatbotSettingsData {
  enable: boolean;
  assistant_name: string;
  institute_name: string;
  /** Direct image URL or media-service file id for the chatbot icon. */
  avatarUrl: string;
  /** Tolerated alias in case a setting was written with snake_case keys. */
  avatar_url?: string;
  enabled_modes?: string[];
  chatbot_pages?: string[];
  /**
   * Institute-wide switch (Admin -> Settings -> AI Settings -> Student AI) for
   * the gear in the chatbot header that opens /ai-settings. Absent or false
   * keeps it hidden, which is what every learner should see.
   */
  show_ai_settings_shortcut?: boolean;
  voice_settings?: {
    default_language: string;
    default_voice: string;
  };
  // Floating launcher (FAB) behavior — all optional; the button falls back to
  // sensible defaults (draggable, a 2-min/5-sec nudge, bounce on reveal).
  launcher_settings?: {
    draggable?: boolean;
    nudge_enabled?: boolean;
    nudge_interval_seconds?: number;
    nudge_duration_seconds?: number;
    bounce?: boolean;
  };
}

// export async function getChatbotSettings(): Promise<ChatbotSettingsData> {
//   const storageKey = "chatbotSettings";
//   const stored = await Preferences.get({ key: storageKey });
//   if (stored.value) {
//     try {
//       const parsed: ChatbotSettingsData = JSON.parse(stored.value);
//       return parsed;
//     } catch (e) {
//       console.error("Failed to parse stored chatbot settings:", e);
//       return DEFAULT_CHATBOT_SETTINGS;
//     }
//   }
//   return DEFAULT_CHATBOT_SETTINGS;
// }

export async function setChatbotSettings(
  settings: ChatbotSettingsData
): Promise<void> {
  await Preferences.set({
    key: LS_KEY,
    value: JSON.stringify(settings),
  });
}

function readCacheForInstitute(
  instituteId: string | null | undefined,
  allowStale = false
): ChatbotSettingsData | null {
  if (!instituteId) return null;
  try {
    const raw = localStorage.getItem(`${LS_KEY}:${instituteId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      ts: number;
      data: ChatbotSettingsData;
    };
    return parsed?.ts && (allowStale || Date.now() - parsed.ts <= CACHE_TTL_MS)
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

async function writeCacheForInstitute(
  instituteId: string | null | undefined,
  data: ChatbotSettingsData
): Promise<void> {
  if (!instituteId) return;
  try {
    localStorage.setItem(
      `${LS_KEY}:${instituteId}`,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {
    // noop
  }
}

export async function getChatbotSettings(
  forceRefresh = false,
  instituteId?: string
): Promise<ChatbotSettingsData> {
  const id = await getInstituteId();
  if (!instituteId) instituteId = id ?? "";
  if (!forceRefresh) {
    const cached = readCacheForInstitute(instituteId);
    if (cached) {
      void refreshAvatarUrl(cached, instituteId);
      return cached;
    }
  }
  if (!instituteId) {
    // No institute yet (logged-out boot): leave the cached icon untouched.
    const defaults = DEFAULT_CHATBOT_SETTINGS;
    await writeCacheForInstitute(null, defaults);
    return defaults;
  }

  try {
    // API returns SettingDto: { key, name, data: { enable, assistant_name, ... } }
    const res = await authenticatedAxiosInstance.get<{
      key: string;
      name: string;
      data: ChatbotSettingsData | null;
    }>(`${BASE_URL}/admin-core-service/institute/setting/v1/get`, {
      params: { instituteId, settingKey: CHATBOT_SETTINGS_KEY },
    });

    const settings = res.data?.data || DEFAULT_CHATBOT_SETTINGS;
    await writeCacheForInstitute(instituteId, settings);
    void refreshAvatarUrl(settings, instituteId);
    return settings;
  } catch {
    // Fetch failed (network blip, deploy). Serve the last settings we saw, even
    // if stale, and do NOT cache anything: caching the defaults here
    // (enable:false) used to hide the launcher for five minutes after a single
    // transient error. The next call retries the fetch.
    return readCacheForInstitute(instituteId, true) ?? DEFAULT_CHATBOT_SETTINGS;
  }
}

/** Forget the cached icon and fall back to the default until settings reload. */
function resetChatbotAvatarUrl(): void {
  avatarInstituteId = null;
  avatarResolutionId += 1;
  if (resolvedAvatarUrl === DEFAULT_CHATBOT_AVATAR_URL) return;
  resolvedAvatarUrl = DEFAULT_CHATBOT_AVATAR_URL;
  avatarListeners.forEach((listener) => listener());
}

export function clearChatbotSettingsCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      // Matches both the per-institute settings cache and the avatar cache,
      // so a logout on a shared device doesn't leave the icon behind.
      if (key && key.startsWith(LS_KEY)) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    resetChatbotAvatarUrl();
  } catch (error) {
    console.error("Error clearing chatbot settings cache:", error);
  }
}
