import { useEffect, useState } from "react";
import axios from "axios";
import { urlInstituteDetails } from "@/constants/urls";
import { NAMING_SETTINGS_KEY } from "@/types/naming-settings";
import { notifyNamingSettingsUpdated } from "@/components/common/layout-container/sidebar/utils";

/**
 * Seed the institute's Naming Settings for the public catalogue.
 *
 * Every catalogue label goes through getTerminology(), which reads the
 * `namingSettings` blob in localStorage. Post-login that blob is written by
 * fetchAndStoreInstituteDetails; pre-login the only writer is the domain-
 * routing hook, and it only receives overrides when the domain-routing row has
 * `apply_naming_setting = true` — an opt-in flag with no admin UI, off for
 * nearly every institute. So a public catalogue for an institute that calls
 * sessions "Streams" and levels "Categories" kept rendering "Session"/"Level".
 *
 * The public institute endpoint already carries the same NAMING_SETTING the
 * admin app edits (it is the institute's own `setting` JSON), so read it from
 * there. Memoised per institute: the catalogue shells (listing, sub-page,
 * course page) all call this, and the endpoint is CDN-cached for 10 minutes.
 *
 * Never throws — the catalogue must render with default terminology rather
 * than not at all. A failed attempt is forgotten so the next shell retries.
 */
const inFlight = new Map<string, Promise<void>>();

export const ensureInstituteNamingSettings = (instituteId: string): Promise<void> => {
  if (!instituteId || typeof window === "undefined") return Promise.resolve();
  const existing = inFlight.get(instituteId);
  if (existing) return existing;

  const task = (async () => {
    try {
      const res = await axios.get(`${urlInstituteDetails}/${instituteId}`, {
        params: { instituteId },
        timeout: 8000,
      });
      const raw = (res.data as { setting?: unknown } | null)?.setting;
      if (typeof raw !== "string" || !raw) return;
      const entries = JSON.parse(raw)?.setting?.NAMING_SETTING?.data?.data;
      if (!Array.isArray(entries) || entries.length === 0) return;
      const serialized = JSON.stringify(entries);
      if (localStorage.getItem(NAMING_SETTINGS_KEY) === serialized) return;
      localStorage.setItem(NAMING_SETTINGS_KEY, serialized);
      notifyNamingSettingsUpdated();
    } catch (error) {
      inFlight.delete(instituteId);
      console.warn("[Catalogue] institute naming settings seed failed", error);
    }
  })();
  inFlight.set(instituteId, task);
  return task;
};

/**
 * `true` once the seed for `instituteId` has settled (success or failure).
 * Shells hold their loader until then so the first paint already carries the
 * institute's words — nothing in the learner app re-renders on the
 * naming-settings-updated event.
 */
export const useInstituteNamingSettings = (instituteId: string): boolean => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    ensureInstituteNamingSettings(instituteId).finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [instituteId]);
  return ready;
};
