import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CourseLanguageOption } from "../../-utils/course-variants";
import {
  fetchCourseLevels,
  getOpenEnrollInvite,
  invitePackageSessionIds,
  mergeCourseInit,
  type CourseInitLike,
  type CourseLevel,
  type OpenEnrollInvite,
} from "../../-services/course-levels-service";
import {
  effectiveInviteIdFor,
  languageOptionsFor,
  levelOptionsFor,
  orderVersions,
  pickInitialVersion,
  versionSearchUpdates,
  type InviteGrant,
  type LanguageVersionOption,
  type VersionPickerOption,
  type VersionSelectionInput,
} from "../-utils/course-version-selection";

export interface CourseVersionsState {
  /** off = the site did not opt in (no request is made). */
  status: "off" | "loading" | "ready" | "error";
  /** Every version, merged with course-init, in picker order. */
  versions: CourseLevel[];
  /** The version on screen; null in "off", while loading, or when the course has none. */
  selected: CourseLevel | null;
  /** The invite the selected version is enrolled through. */
  selectedInviteId: string | null;
  /** That invite, once loaded (plans, availability, closed message). */
  invite: OpenEnrollInvite | null;
  /** Language picker segments (fewer than two = no picker). */
  options: LanguageVersionOption[];
  /** Level picker segments: the selected language's versions when it has several. */
  levelOptions: VersionPickerOption[];
  /**
   * Shows another version. Returns the query-string updates the caller
   * mirrors into the URL (replace), or null when the version cannot be
   * picked (unknown, or nothing to enrol through).
   */
  select: (packageSessionId: string) => Record<string, string | null> | null;
}

/** The grant for one course (fetchKey); `settled` once its invite was read (or could not be). */
type HeldGrant = InviteGrant & { key: string; settled: boolean };

/**
 * The course's versions and the one on screen. Selection is derived from the
 * URL (?packageSessionId / ?enrollInviteId), then the visitor's language, then
 * the first version that can be enrolled in — so a shared link, a reload and
 * the Language picker (which writes the URL) all agree. Nothing is fetched
 * while `enabled` is false, which keeps sites that did not opt in on exactly
 * the requests they made before.
 *
 * The invite the visit's link carried (?enrollInviteId, often a promo) is kept
 * for the whole visit together with the package sessions it sells: every
 * version it sells is enrolled through it, even after the visitor switched to
 * a version it does not sell and back.
 */
export const useCourseVersions = (opts: {
  enabled: boolean;
  instituteId: string;
  courseId: string;
  productPageCode?: string;
  courseInit: CourseInitLike | null;
  urlPackageSessionId?: string;
  urlEnrollInviteId?: string;
  /** Languages that tell versions apart; [] when the site has language versions off. */
  languages: CourseLanguageOption[];
  preferredLanguage: string | null;
}): CourseVersionsState => {
  const {
    enabled,
    instituteId,
    courseId,
    productPageCode,
    courseInit,
    urlPackageSessionId,
    urlEnrollInviteId,
    languages,
    preferredLanguage,
  } = opts;

  const fetchKey = enabled && instituteId && courseId ? `${instituteId}|${courseId}|${productPageCode ?? ""}` : null;

  const [loaded, setLoaded] = useState<{
    key: string;
    levels: CourseLevel[];
    status: "loading" | "ready" | "error";
  } | null>(null);

  useEffect(() => {
    if (!fetchKey) return;
    let cancelled = false;
    setLoaded({ key: fetchKey, levels: [], status: "loading" });
    fetchCourseLevels({ instituteId, courseId, productPageCode })
      .then((levels) => {
        if (!cancelled) setLoaded({ key: fetchKey, levels, status: "ready" });
      })
      .catch((err) => {
        console.warn("[CourseDetailsPage] Course versions unavailable:", err);
        if (!cancelled) setLoaded({ key: fetchKey, levels: [], status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // fetchKey already encodes instituteId / courseId / productPageCode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // The link's invite, held for the visit. The invite itself lists the
  // package sessions it sells (usually a cache hit: the page fetched this
  // invite for its price). Invites this hook wrote into the URL on a pick are
  // not a new link, so they never replace it.
  const [grant, setGrant] = useState<HeldGrant | null>(null);
  const grantRef = useRef<HeldGrant | null>(null);
  const writtenRef = useRef<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() });
  useEffect(() => {
    if (!fetchKey || !instituteId || !urlEnrollInviteId) return;
    const held = grantRef.current;
    if (held && held.key === fetchKey) {
      if (held.inviteId === urlEnrollInviteId) return;
      const written = writtenRef.current;
      if (written.key === fetchKey && written.ids.has(urlEnrollInviteId)) return;
    }
    const next: HeldGrant = {
      key: fetchKey,
      inviteId: urlEnrollInviteId,
      packageSessionIds: null,
      landingPackageSessionId: urlPackageSessionId ?? null,
      settled: false,
    };
    grantRef.current = next;
    setGrant(next);
    const isNext = (g: HeldGrant | null): g is HeldGrant =>
      !!g && g.key === next.key && g.inviteId === next.inviteId;
    // Not cancelled when the URL moves on: the URL's next invite is usually
    // one this hook wrote, and the grant still needs its list.
    getOpenEnrollInvite(instituteId, urlEnrollInviteId)
      .then((invite) => {
        const ids = invitePackageSessionIds(invite);
        // An invite listing nothing stays "unknown": the version the link
        // named keeps it, as before.
        setGrant((g) => (isNext(g) ? { ...g, packageSessionIds: ids.length ? ids : null, settled: true } : g));
      })
      .catch(() => {
        // Unknown: the version the link named keeps the invite.
        setGrant((g) => (isNext(g) ? { ...g, settled: true } : g));
      });
  }, [fetchKey, instituteId, urlEnrollInviteId, urlPackageSessionId]);

  const current = loaded && loaded.key === fetchKey ? loaded : null;
  const activeGrant: HeldGrant | null = grant && grant.key === fetchKey ? grant : null;

  const versions = useMemo(
    () => (current?.status === "ready" ? orderVersions(mergeCourseInit(current.levels, courseInit), languages) : []),
    [current, courseInit, languages],
  );

  // A pick made on this page (instant; the URL catches up a tick later).
  const [picked, setPicked] = useState<{ key: string; packageSessionId: string } | null>(null);
  const select = useCallback(
    (packageSessionId: string): Record<string, string | null> | null => {
      if (!fetchKey) return null;
      const next = versions.find((v) => v.packageSessionId === packageSessionId);
      const inviteId = next ? effectiveInviteIdFor(next, activeGrant) : null;
      if (!next || !inviteId) return null;
      setPicked({ key: fetchKey, packageSessionId });
      if (writtenRef.current.key !== fetchKey) writtenRef.current = { key: fetchKey, ids: new Set() };
      writtenRef.current.ids.add(inviteId);
      return versionSearchUpdates(next, inviteId);
    },
    [fetchKey, versions, activeGrant],
  );
  // A later URL that names another version (an in-page link, Back/Forward)
  // takes over from the pick.
  useEffect(() => {
    setPicked((current) =>
      current && urlPackageSessionId && urlPackageSessionId !== current.packageSessionId ? null : current,
    );
  }, [urlPackageSessionId]);

  const selectionInput = useMemo<VersionSelectionInput>(
    () => ({ urlPackageSessionId, urlEnrollInviteId, grant: activeGrant, preferredLanguage, languages }),
    [urlPackageSessionId, urlEnrollInviteId, activeGrant, preferredLanguage, languages],
  );

  const selected = useMemo(() => {
    const pick =
      picked && picked.key === fetchKey ? versions.find((v) => v.packageSessionId === picked.packageSessionId) : undefined;
    return pick ?? pickInitialVersion(versions, selectionInput);
  }, [picked, fetchKey, versions, selectionInput]);

  const selectedInviteId = selected ? effectiveInviteIdFor(selected, activeGrant) : null;

  const [inviteState, setInviteState] = useState<{ inviteId: string; invite: OpenEnrollInvite | null } | null>(null);
  useEffect(() => {
    if (!enabled || !instituteId || !selectedInviteId) return;
    let cancelled = false;
    getOpenEnrollInvite(instituteId, selectedInviteId)
      .then((invite) => {
        if (!cancelled) setInviteState({ inviteId: selectedInviteId, invite });
      })
      .catch(() => {
        // The search row's price and availability stay on screen.
        if (!cancelled) setInviteState({ inviteId: selectedInviteId, invite: null });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, instituteId, selectedInviteId]);

  const invite = inviteState && inviteState.inviteId === selectedInviteId ? inviteState.invite : null;

  const options = useMemo(
    () => languageOptionsFor(versions, languages, selected?.packageSessionId, activeGrant),
    [versions, languages, selected, activeGrant],
  );
  const levelOptions = useMemo(
    () => (languages.length ? levelOptionsFor(versions, languages, selected?.packageSessionId, activeGrant) : []),
    [versions, languages, selected, activeGrant],
  );

  // Still "loading" until the link's invite has been read: what it sells can
  // change the version on screen and the invite it is enrolled through.
  const status: CourseVersionsState["status"] = !fetchKey
    ? "off"
    : !current || current.status === "loading" || (activeGrant && !activeGrant.settled)
      ? "loading"
      : current.status;

  return { status, versions, selected, selectedInviteId, invite, options, levelOptions, select };
};
