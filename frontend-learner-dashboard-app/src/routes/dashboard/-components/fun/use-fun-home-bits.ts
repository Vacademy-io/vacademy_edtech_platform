import { useEffect, useState } from "react";
import { Preferences } from "@capacitor/preferences";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { hslChannelsToHex } from "@/lib/colour/contrast";
import { safeJsonParse } from "@/utils/safe-json-parse";
import { fetchUserData } from "../../-lib/utils";

/** Signed URLs for course images, keyed by media id. A missing or expired id gives no entry. */
export function useCourseImages(mediaIds: readonly (string | null | undefined)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = Array.from(new Set(mediaIds.filter((id): id is string => Boolean(id)))).sort().join(",");
  useEffect(() => {
    if (!key) return;
    let alive = true;
    Promise.all(
      key.split(",").map(async (id) => {
        try {
          return [id, await getPublicUrlWithoutLogin(id)] as const;
        } catch {
          return [id, ""] as const;
        }
      }),
    ).then((pairs) => {
      if (!alive) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const [id, url] of pairs) if (url) next[id] = url;
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return urls;
}

/** A clock for the live cards: classes start and end while the page stays open. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** The institute's brand as a hex, read from the theme the app already applied. */
export function readBrandHex(): string | null {
  if (typeof document === "undefined") return null;
  return hslChannelsToHex(getComputedStyle(document.documentElement).getPropertyValue("--primary-500").trim());
}

/** The learner's full name (for the avatar's initials) and the institute's name, from what sign-in stored. */
export function useStoredNames(): { fullName: string | null; instituteName: string | null } {
  const [names, setNames] = useState<{ fullName: string | null; instituteName: string | null }>({
    fullName: null,
    instituteName: null,
  });
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchUserData().catch(() => null),
      Preferences.get({ key: "InstituteDetails" }).catch(() => ({ value: null })),
    ]).then(([user, institute]) => {
      if (!alive) return;
      const details = safeJsonParse(institute?.value ?? null) as { institute_name?: unknown } | null;
      setNames({
        fullName: typeof user?.full_name === "string" ? user.full_name : null,
        instituteName: typeof details?.institute_name === "string" ? details.institute_name.trim() || null : null,
      });
    });
    return () => {
      alive = false;
    };
  }, []);
  return names;
}
