/**
 * Learner home builder: the one place that talks to
 * /admin-core-service/learner/home/v1 (resolved home, dismiss, acknowledge,
 * analytics events). Contract: the backend's API-CONTRACT (section 4).
 *
 * - `useLearnerHome()` answers which home to draw. An institute that never
 *   published a layout answers LEGACY and keeps today's dashboard unchanged.
 * - The last answer is kept per institute AND user in localStorage
 *   (`LEARNER_HOME_V1:<instituteId>:<userId>`) for an instant first paint and
 *   offline use. Logout clears localStorage, so nothing crosses accounts.
 * - In the admin's preview frame the draft home sent by the admin replaces the
 *   network answer, and nothing is written.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { jwtDecode } from "jwt-decode";
import { Capacitor } from "@capacitor/core";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";
import { getUserId } from "@/constants/getUserId";
import { getTokenFromStorage } from "@/lib/auth/sessionUtility";
import { TokenKey } from "@/constants/auth/tokens";
import { PREVIEW_HOME_EVENT, isStudentPreviewMode, readStudentPreviewDraft } from "@/lib/student-preview";
import { isBuilderHome, type ResolvedHome } from "@/types/learner-home";

export const LEARNER_HOME_API = `${BASE_URL}/admin-core-service/learner/home/v1`;
export const LEARNER_HOME_SNAPSHOT_PREFIX = "LEARNER_HOME_V1:";
const STALE_MS = 60 * 1000;

const LEGACY: ResolvedHome = { mode: "LEGACY" };

export const learnerHomeKey = (instituteId: string | null, userId: string | null) =>
  ["learner-home", instituteId, userId] as const;

// ── ids, read synchronously so the first render can use the snapshot ─────────

const readLocal = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** The selected institute and the signed-in user, from the synchronous copies the auth code keeps. */
export function readHomeIdsSync(): { instituteId: string | null; userId: string | null } {
  const instituteId = readLocal("InstituteId") || readLocal("CapacitorStorage.InstituteId");
  const token = readLocal(TokenKey.accessToken) || readLocal(`CapacitorStorage.${TokenKey.accessToken}`);
  let userId: string | null = null;
  if (token) {
    try {
      userId = (jwtDecode(token) as { user?: string })?.user ?? null;
    } catch {
      userId = null;
    }
  }
  return { instituteId: instituteId || null, userId };
}

// ── snapshot ──────────────────────────────────────────────────────────────────

interface Snapshot {
  savedAt: number;
  home: ResolvedHome;
}

export const snapshotKey = (instituteId: string, userId: string) =>
  `${LEARNER_HOME_SNAPSHOT_PREFIX}${instituteId}:${userId}`;

/** A well-formed answer, or null. Anything unexpected counts as LEGACY upstream. */
export function normaliseHome(raw: unknown): ResolvedHome | null {
  if (!raw || typeof raw !== "object") return null;
  const mode = (raw as { mode?: unknown }).mode;
  if (mode === "LEGACY") return LEGACY;
  if (mode === "BUILDER" && isBuilderHome(raw as ResolvedHome)) return raw as ResolvedHome;
  return null;
}

export function readHomeSnapshot(instituteId: string | null, userId: string | null): Snapshot | null {
  if (!instituteId || !userId) return null;
  const raw = readLocal(snapshotKey(instituteId, userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    const home = normaliseHome(parsed?.home);
    if (!home || typeof parsed.savedAt !== "number") return null;
    return { savedAt: parsed.savedAt, home };
  } catch {
    return null;
  }
}

export function writeHomeSnapshot(instituteId: string, userId: string, home: ResolvedHome): void {
  try {
    localStorage.setItem(snapshotKey(instituteId, userId), JSON.stringify({ savedAt: Date.now(), home }));
  } catch {
    // Storage full or blocked: the next load fetches again.
  }
}

// ── network ───────────────────────────────────────────────────────────────────

async function resolveIds(): Promise<{ instituteId: string | null; userId: string | null }> {
  const sync = readHomeIdsSync();
  const [instituteId, userId] = await Promise.all([
    getInstituteId().catch(() => null),
    getUserId().catch(() => null),
  ]);
  return { instituteId: instituteId || sync.instituteId, userId: userId || sync.userId };
}

export async function fetchResolvedHome(): Promise<ResolvedHome> {
  const { instituteId, userId } = await resolveIds();
  if (!instituteId) return LEGACY;
  const res = await authenticatedAxiosInstance.get(`${LEARNER_HOME_API}/resolved`, {
    params: { instituteId },
  });
  const home = normaliseHome(res.data) ?? LEGACY;
  if (userId) writeHomeSnapshot(instituteId, userId, home);
  return home;
}

async function postBlockAction(blockKey: string, action: "dismiss" | "ack"): Promise<void> {
  const instituteId = (await getInstituteId()) || readHomeIdsSync().instituteId;
  await authenticatedAxiosInstance.post(
    `${LEARNER_HOME_API}/blocks/${encodeURIComponent(blockKey)}/${action}`,
    null,
    { params: { instituteId } }
  );
}

export const dismissHomeBlock = (blockKey: string) => postBlockAction(blockKey, "dismiss");
export const acknowledgeHomeBlock = (blockKey: string) => postBlockAction(blockKey, "ack");

/**
 * The feature's own error code from a failed dismiss / ack (API contract:
 * `{ code, message }`), e.g. NOT_DISMISSIBLE, ACK_REQUIRED, ACK_NOT_REQUIRED,
 * BLOCK_NOT_FOUND. Null for a network failure or any other body.
 */
export function homeActionErrorCode(error: unknown): string | null {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === "string" ? code : null;
}

/**
 * What the page does after a failed dismiss / ack:
 * - "keep": the outcome already holds (ack not required; the notice is no longer
 *   in the published home, so the next load drops it anyway);
 * - "revert": show the notice / button again and tell the learner.
 */
export function homeActionOutcome(error: unknown): "keep" | "revert" {
  const code = homeActionErrorCode(error);
  return code === "ACK_NOT_REQUIRED" || code === "BLOCK_NOT_FOUND" ? "keep" : "revert";
}

export interface HomeEvent {
  block_key: string;
  item_key?: string;
  type: "VIEW" | "CLICK";
  device: "PHONE" | "TABLET" | "DESKTOP";
  platform: "WEB" | "ANDROID" | "IOS" | "ELECTRON";
  layout_version: number;
  ts: string;
}

/**
 * Sends analytics with fetch keepalive, so a batch flushed while the page is
 * going away still leaves. Not sendBeacon: it cannot carry the bearer token.
 * Not axios: an interceptor may try to refresh the token during unload.
 * Failures are swallowed; analytics never affect the page.
 */
export async function postHomeEvents(events: HomeEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    const ids = readHomeIdsSync();
    const token =
      readLocal(TokenKey.accessToken) || (await getTokenFromStorage(TokenKey.accessToken));
    const instituteId = ids.instituteId || (await getInstituteId());
    if (!token || !instituteId) return;
    await fetch(`${LEARNER_HOME_API}/events?instituteId=${encodeURIComponent(instituteId)}`, {
      method: "POST",
      keepalive: true,
      headers: {
        Authorization: `Bearer ${token}`,
        clientId: instituteId,
        "X-Institute-Id": instituteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events: events.slice(0, 50) }),
    });
  } catch {
    // swallowed
  }
}

// ── cache updates (optimistic dismiss / acknowledge) ──────────────────────────

/** Applies `update` to the NOTICE `blockKey` in every cached home and in the snapshot. */
export function updateCachedNotice(
  queryClient: QueryClient,
  blockKey: string,
  state: { dismissed?: boolean; acknowledged_at?: string | null }
): () => void {
  const previous = queryClient.getQueriesData<ResolvedHome>({ queryKey: ["learner-home"] });
  for (const [key, home] of previous) {
    if (!isBuilderHome(home)) continue;
    const next: ResolvedHome = {
      ...home,
      blocks: home.blocks.map((b) =>
        b.type === "NOTICE" && b.key === blockKey
          ? { ...b, config: { ...b.config, state: { ...(b.config.state ?? {}), ...state } } }
          : b
      ),
    };
    queryClient.setQueryData(key, next);
    const [, instituteId, userId] = key as unknown as [string, string | null, string | null];
    if (instituteId && userId) writeHomeSnapshot(instituteId, userId, next);
  }
  return () => {
    for (const [key, home] of previous) {
      queryClient.setQueryData(key, home);
      const [, instituteId, userId] = key as unknown as [string, string | null, string | null];
      if (instituteId && userId && home) writeHomeSnapshot(instituteId, userId, home);
    }
  };
}

// ── the hook ──────────────────────────────────────────────────────────────────

export interface LearnerHomeState {
  /** Null until known: draw the classic home meanwhile (spec 7.1, first-ever load). */
  home: ResolvedHome | null;
  preview: boolean;
}

export function useLearnerHome(enabled = true): LearnerHomeState {
  const preview = isStudentPreviewMode();
  // Bumped when the admin sends a new home draft, so the frame redraws.
  const [, setPreviewVersion] = useState(0);
  useEffect(() => {
    if (!preview) return;
    const onHome = () => setPreviewVersion((v) => v + 1);
    window.addEventListener(PREVIEW_HOME_EVENT, onHome);
    return () => window.removeEventListener(PREVIEW_HOME_EVENT, onHome);
  }, [preview]);
  const previewHome = preview ? normaliseHome(readStudentPreviewDraft()?.home) : null;
  const { instituteId, userId } = readHomeIdsSync();
  const snapshot = readHomeSnapshot(instituteId, userId);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: learnerHomeKey(instituteId, userId),
    queryFn: fetchResolvedHome,
    enabled: enabled && !previewHome,
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    retry: 1,
    initialData: snapshot?.home,
    initialDataUpdatedAt: snapshot?.savedAt,
  });

  // The native app comes back from the background without a window focus event.
  useEffect(() => {
    if (!enabled || previewHome || !Capacitor.isNativePlatform()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("resume", () => {
          void queryClient.invalidateQueries({ queryKey: ["learner-home"] });
        })
      )
      .then((handle) => {
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [enabled, previewHome, queryClient]);

  if (previewHome) return { home: previewHome, preview: true };
  if (!enabled) return { home: LEGACY, preview };
  return { home: query.data ?? (query.isError ? LEGACY : null), preview };
}
