import { languageOfLevel, type CourseLanguageOption } from "../../-utils/course-variants";
import type { SiteCartItem } from "../../-utils/site-cart";
import type { SiteCartOpenRequest } from "../../-components/site-cart/site-cart-events";
import {
  invitePaymentEntryFor,
  type CourseLevel,
  type OpenEnrollInvite,
} from "../../-services/course-levels-service";

/**
 * Which version (language/level) of a course the course page shows, and what
 * changes when the visitor picks another one. Pure — the page wires it up in
 * -hooks/use-course-versions.ts.
 */

/**
 * What the course page asks of the site cart drawer (openSiteCartDrawer in
 * site-cart/site-cart-events.ts): `intent` "view" or "checkout" ("Buy now").
 */
export interface SiteCartOpenDetail extends SiteCartOpenRequest {
  intent: "view" | "checkout";
  /** The version just added, for a drawer that wants to highlight it. */
  packageSessionId?: string;
  source: "course";
}

/**
 * One store checkout holds at most this many courses — the cart stream's
 * SITE_CART_MAX_ITEMS (site-cart/site-cart-items.ts), which the site cart
 * store itself does not enforce.
 */
export const SITE_CART_MAX_ITEMS = 40;

/**
 * Whether the site cart can take `item`. A version already in the cart, or a
 * course whose other version it replaces, does not grow the cart, so it is
 * always accepted; a new course only below the cap (the cart stream's
 * capCartAdd rule).
 */
export const cartCanTake = (
  items: Pick<SiteCartItem, "packageSessionId" | "courseId">[],
  item: Pick<SiteCartItem, "packageSessionId" | "courseId">,
  max: number = SITE_CART_MAX_ITEMS,
): boolean =>
  items.some((i) => i.packageSessionId === item.packageSessionId || i.courseId === item.courseId) ||
  items.length < max;

const languageCodeOf = (version: Pick<CourseLevel, "levelName">, languages: CourseLanguageOption[]) =>
  languageOfLevel(version.levelName, languages)?.code ?? null;

/**
 * The invite a link carried (?enrollInviteId) — often a promo or a product
 * page's invite rather than a version's default one — and the package
 * sessions it sells. The page keeps it for the whole visit, so every version
 * it sells is enrolled through it: switching language keeps the link's offer,
 * and switching back finds it again.
 */
export interface InviteGrant {
  inviteId: string;
  /** Package sessions the invite sells; null while unknown (loading, unreadable or none listed). */
  packageSessionIds: string[] | null;
  /** ?packageSessionId of the link that carried the invite. */
  landingPackageSessionId?: string | null;
}

/** Whether `grant` sells `version`. */
export const grantCovers = (grant: InviteGrant | null | undefined, version: CourseLevel): boolean => {
  if (!grant) return false;
  if (version.enrollInviteId === grant.inviteId) return true;
  if (grant.packageSessionIds) return grant.packageSessionIds.includes(version.packageSessionId);
  // Not known (yet): the version the link named keeps the link's invite, as
  // the page always did.
  return !!grant.landingPackageSessionId && grant.landingPackageSessionId === version.packageSessionId;
};

/**
 * The invite a version is enrolled through: the link's invite (grant) for
 * every version it sells, else the version's own. A product page version
 * keeps that page's own mapping invite (the page's checkout sells it).
 */
export const effectiveInviteIdFor = (
  version: CourseLevel,
  grant: InviteGrant | null | undefined,
): string | null => {
  if (version.source === "productPage" && version.enrollInviteId) return version.enrollInviteId;
  return grant && grantCovers(grant, version) ? grant.inviteId : version.enrollInviteId;
};

/**
 * Whether a site-cart visit keeps its link's own invite enrol flow instead of
 * the site cart. The cart checks out through the store product page, which
 * charges the store's plan — so a version on screen that is enrolled through
 * any invite other than its own catalogue invite (a promo or bundle link, see
 * InviteGrant) would lose that invite's price there. Such visits enrol through
 * the invite, as a product page visit does through its page. With no version
 * to compare against (none listed, or the list failed to load), a link that
 * carried an invite keeps it too. Undecided (false) while the versions load.
 */
export const keepsLinkInviteEnrolment = (input: {
  status: "off" | "loading" | "ready" | "error";
  selected: Pick<CourseLevel, "enrollInviteId"> | null;
  /** The invite the selected version is enrolled through (effectiveInviteIdFor). */
  selectedInviteId: string | null;
  /** ?enrollInviteId */
  urlEnrollInviteId?: string | null;
}): boolean => {
  if (input.status !== "ready" && input.status !== "error") return false;
  if (input.selected) {
    return !!input.selectedInviteId && input.selectedInviteId !== input.selected.enrollInviteId;
  }
  return !!input.urlEnrollInviteId;
};

/**
 * Versions in picker order: the site's language order first (English before
 * Hindi by default), versions whose language is unknown last, and the source
 * order (catalogue / product page order) within each group.
 */
export const orderVersions = (versions: CourseLevel[], languages: CourseLanguageOption[]): CourseLevel[] => {
  if (!languages.length) return versions;
  const rank = (v: CourseLevel) => {
    const code = languageCodeOf(v, languages);
    const i = code ? languages.findIndex((l) => l.code === code) : -1;
    return i < 0 ? languages.length : i;
  };
  return versions
    .map((v, index) => ({ v, index, r: rank(v) }))
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map(({ v }) => v);
};

/** One segment of a version picker (Language or Level). */
export interface VersionPickerOption {
  /** The version this segment selects. */
  packageSessionId: string;
  label: string;
  chip?: string;
  /** No invite: the version cannot be enrolled in, so it cannot be picked. */
  disabled: boolean;
}

/** One segment of the Language picker. */
export interface LanguageVersionOption extends VersionPickerOption {
  code: string;
}

/**
 * One option per language the course is offered in, in the site's order.
 * When a language has several versions (two levels or sessions), the selected
 * one represents it, else its first version that can be enrolled in, else its
 * first. A version is enrolled through the link's invite when that sells it
 * (`grant`), so a version only the link's invite sells can still be picked.
 */
export const languageOptionsFor = (
  versions: CourseLevel[],
  languages: CourseLanguageOption[],
  selectedPackageSessionId: string | null | undefined,
  grant?: InviteGrant | null,
): LanguageVersionOption[] => {
  const enrollable = (v: CourseLevel) => !!effectiveInviteIdFor(v, grant);
  const options: LanguageVersionOption[] = [];
  for (const lang of languages) {
    const ofLanguage = versions.filter((v) => languageCodeOf(v, languages) === lang.code);
    if (!ofLanguage.length) continue;
    const rep =
      ofLanguage.find((v) => v.packageSessionId === selectedPackageSessionId) ??
      ofLanguage.find(enrollable) ??
      ofLanguage[0];
    options.push({
      code: lang.code,
      label: lang.label,
      chip: lang.chip,
      packageSessionId: rep.packageSessionId,
      disabled: !enrollable(rep),
    });
  }
  return options;
};

/**
 * The versions in the selected version's language when there are several
 * ("Beginner Hindi" and "Advanced Hindi", or two batches of "Hindi"), for a
 * Level picker under the Language picker. Labelled by level, with the session
 * added where two share a level name. Empty when the language has one version.
 */
export const levelOptionsFor = (
  versions: CourseLevel[],
  languages: CourseLanguageOption[],
  selectedPackageSessionId: string | null | undefined,
  grant?: InviteGrant | null,
): VersionPickerOption[] => {
  const selected = versions.find((v) => v.packageSessionId === selectedPackageSessionId);
  if (!selected) return [];
  const code = languageCodeOf(selected, languages);
  const group = versions.filter((v) => languageCodeOf(v, languages) === code);
  if (group.length < 2) return [];
  const nameOf = (v: CourseLevel) => v.levelName?.trim() || v.sessionName?.trim() || "";
  return group.map((v, index) => {
    const name = nameOf(v);
    const shared = group.some((o) => o !== v && nameOf(o) === name);
    const session = v.sessionName?.trim();
    const label = !name
      ? String(index + 1)
      : shared
        ? session && session !== name
          ? `${name} · ${session}`
          : `${name} (${index + 1})`
        : name;
    return { packageSessionId: v.packageSessionId, label, disabled: !effectiveInviteIdFor(v, grant) };
  });
};

export interface VersionSelectionInput {
  /** ?packageSessionId */
  urlPackageSessionId?: string | null;
  /** ?enrollInviteId */
  urlEnrollInviteId?: string | null;
  /** The invite the visit's link carried and what it sells (see InviteGrant). */
  grant?: InviteGrant | null;
  /** The visitor's course language, from the site locale (preferredCourseLanguage). */
  preferredLanguage?: string | null;
  languages: CourseLanguageOption[];
}

const preferLanguage = (candidates: CourseLevel[], input: VersionSelectionInput): CourseLevel | undefined =>
  (input.preferredLanguage
    ? candidates.find((v) => languageCodeOf(v, input.languages) === input.preferredLanguage)
    : undefined) ?? candidates[0];

/**
 * The version the URL names: ?packageSessionId, else the version(s) sold by
 * ?enrollInviteId (the visitor's language first when one invite sells several).
 */
export const urlDesignatedVersion = (
  versions: CourseLevel[],
  input: VersionSelectionInput,
): CourseLevel | null => {
  if (input.urlPackageSessionId) {
    const byPs = versions.find((v) => v.packageSessionId === input.urlPackageSessionId);
    if (byPs) return byPs;
  }
  if (input.urlEnrollInviteId) {
    // What the URL's invite sells, when the grant is that invite (a
    // non-default invite is no version's own).
    const grant = input.grant && input.grant.inviteId === input.urlEnrollInviteId ? input.grant : null;
    const sold = new Set(grant?.packageSessionIds ?? []);
    const candidates = versions.filter(
      (v) => v.enrollInviteId === input.urlEnrollInviteId || sold.has(v.packageSessionId),
    );
    const byInvite = preferLanguage(candidates, input);
    if (byInvite) return byInvite;
  }
  return null;
};

/**
 * The version to show first: what the URL names, else the visitor's language
 * (a version that can be enrolled in), else the first version that can be
 * enrolled in, else the first version. Null only when there are no versions.
 */
export const pickInitialVersion = (versions: CourseLevel[], input: VersionSelectionInput): CourseLevel | null => {
  if (!versions.length) return null;
  const fromUrl = urlDesignatedVersion(versions, input);
  if (fromUrl) return fromUrl;
  const enrollable = versions.filter((v) => !!effectiveInviteIdFor(v, input.grant));
  if (input.preferredLanguage) {
    const preferred = enrollable.find((v) => languageCodeOf(v, input.languages) === input.preferredLanguage);
    if (preferred) return preferred;
  }
  return enrollable[0] ?? versions[0];
};

/**
 * Duration and authors to show for the selected version: its own, even when
 * empty, so a version without faculty or read time never shows another
 * version's. `undefined` keeps the course-level value the page read from
 * course-init — only for a course's lone version whose details are unknown.
 */
export const versionOwnDetails = (
  version: Pick<CourseLevel, "durationMinutes" | "instructors">,
  versionCount: number,
): { durationMinutes: number | null | undefined; instructors: unknown[] | undefined } => {
  const own = versionCount > 1;
  return {
    durationMinutes: version.durationMinutes ?? (own ? null : undefined),
    instructors: version.instructors ?? (own ? [] : undefined),
  };
};

/** What the overview card shows for a version. */
export interface VersionOffer {
  price: number;
  elevatedPrice?: number;
  currency?: string;
  availability?: string;
  /** The invite's setting_json (carries the admin's "enrolment closed" message). */
  settingJson?: string;
}

/**
 * Price and availability of a version. A product page version keeps that
 * page's own plan. A catalogue version takes the plan of its invite entry for
 * THIS package session (the rule the page has always applied to the invite it
 * fetched, minus the entry-[0] bug), and the search row's price until the
 * invite has loaded.
 */
export const resolveVersionOffer = (
  version: CourseLevel,
  invite: OpenEnrollInvite | null | undefined,
): VersionOffer => {
  let price = version.price ?? 0;
  let elevatedPrice = version.elevatedPrice ?? undefined;
  let currency = version.currency ?? undefined;
  if (version.source === "catalogue" && invite) {
    const plan = invitePaymentEntryFor(invite, version.packageSessionId)?.payment_option?.payment_plans?.[0];
    if (plan) {
      if (typeof plan.actual_price === "number") price = plan.actual_price;
      if (typeof plan.elevated_price === "number") elevatedPrice = plan.elevated_price;
      if (plan.currency) currency = plan.currency;
    }
  }
  return {
    price,
    elevatedPrice,
    currency,
    availability: invite?.availability_status ?? version.availability ?? undefined,
    settingJson: invite?.setting_json ?? undefined,
  };
};

/**
 * A value written straight into the query string, encoded the way the router
 * would write it. TanStack Router parses every value as JSON on read ("10"
 * comes back as the number 10, "true" as a boolean), so a string that would
 * parse is JSON-quoted — exactly what its default stringifySearch does.
 */
export const searchParamValue = (value: string): string => {
  try {
    JSON.parse(value);
    return JSON.stringify(value);
  } catch {
    return value;
  }
};

/**
 * A search param as text. The router parses values as JSON, so a hand-typed
 * or older link can hand the page a number or a boolean ("?level=10") where
 * it compares and trims strings.
 */
export const searchText = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value : String(value);
  return text === "" ? undefined : text;
};

/**
 * Query-string updates for a picked version (applied with replace), enrolled
 * through `inviteId` (effectiveInviteIdFor). ?price and ?available_slots
 * described the version the link was built for, so they go.
 */
export const versionSearchUpdates = (
  version: CourseLevel,
  inviteId: string | null | undefined,
): Record<string, string | null> => ({
  packageSessionId: searchParamValue(version.packageSessionId),
  enrollInviteId: inviteId ? searchParamValue(inviteId) : null,
  level: version.levelName ? searchParamValue(version.levelName) : null,
  price: null,
  available_slots: null,
});

const isPlaceholderImage = (src: string | null | undefined) =>
  !src || src === "null" || src.startsWith("/api/placeholder/");

/** The site-cart line for the version on screen. Title and level stay in the base language. */
export const buildCourseCartItem = (input: {
  courseId: string;
  title: string;
  packageSessionId: string;
  levelName?: string | null;
  languages: CourseLanguageOption[];
  price?: number;
  elevatedPrice?: number;
  currency?: string;
  image?: string | null;
  enrollInviteId?: string | null;
}): SiteCartItem => ({
  packageSessionId: input.packageSessionId,
  courseId: input.courseId,
  title: input.title,
  levelName: input.levelName || undefined,
  languageCode: languageOfLevel(input.levelName, input.languages)?.code,
  price: input.price,
  elevatedPrice: input.elevatedPrice,
  currency: input.currency,
  image: isPlaceholderImage(input.image) ? undefined : (input.image as string),
  enrollInviteId: input.enrollInviteId || undefined,
  source: { kind: "course" },
});

/** Live course fields shown as text (hero, HTML page tokens, overview). */
const DISPLAY_TEXT_FIELDS = [
  "title",
  "description",
  "fullDescription",
  "level",
  "instructor",
  "aboutCourse",
  "whyLearn",
  "whoShouldLearn",
  "about_the_course_html",
  "course_html_description_html",
] as const;

/**
 * A display copy of the course with its live text through the site
 * dictionary (useSiteT). Returns the SAME object when nothing is translated,
 * so a single-language site passes exactly the data it always did. Never use
 * the copy for submission (payment descriptions, cart lines).
 */
export const localizeCourseDisplay = <T extends object>(course: T, translate: (text: string) => string): T => {
  const source = course as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };
  let changed = false;
  for (const key of DISPLAY_TEXT_FIELDS) {
    const value = source[key];
    if (typeof value !== "string" || !value) continue;
    const next = translate(value);
    if (next !== value) {
      out[key] = next;
      changed = true;
    }
  }
  if (Array.isArray(source.tags)) {
    const tags = source.tags as unknown[];
    const next = tags.map((tag) => (typeof tag === "string" ? translate(tag) : tag));
    if (next.some((tag, i) => tag !== tags[i])) {
      out.tags = next;
      changed = true;
    }
  }
  return changed ? (out as T) : course;
};
