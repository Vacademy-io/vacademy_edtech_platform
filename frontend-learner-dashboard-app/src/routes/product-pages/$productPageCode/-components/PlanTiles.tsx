import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check, CheckCircle, Star } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useProductPageStore } from "../-stores/product-page-store";
import type {
  PaymentPlan,
  ProductPageData,
  ProductPageMappingResponse,
  ProductPageSettings,
} from "../-types/product-page-types";
import { getTerminology, getTerminologyPlural } from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { useCatalogueLocale } from "@/routes/$tagName/-utils/catalogue-locale";
import { useCourseTerms } from "@/routes/$tagName/-utils/catalogue-naming";

/**
 * "Choose a Plan" tiles, built entirely from the payment plans already
 * configured against this product page's mappings — there is no separate
 * pricing rule engine. A tile is one distinct payment_plan_id; picking it puts
 * every mapping sold on that plan into the cart, so the price the visitor sees
 * is the plan price the backend will verify at enroll time.
 *
 * Opt-in per page via settings_json → planSelector.enabled, because on a page
 * whose courses each carry their own plan the tiles would just restate the
 * course grid. Turn it on for pages that sell the *same* thing several ways
 * (single subject vs. combo vs. full pack).
 */

interface PlanGroup {
  plan: PaymentPlan;
  planId: string;
  mappings: ProductPageMappingResponse[];
  /** Sum of actual_price across the plan's mappings — what the cart will charge. */
  price: number;
  /** Sum of elevated_price (list price); equals `price` when nothing is discounted. */
  listPrice: number;
}

function parseFeatures(featureJson?: string): string[] {
  if (!featureJson) return [];
  try {
    const parsed = JSON.parse(featureJson);
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === "string") : [];
  } catch {
    return [];
  }
}

function currencySymbolFor(currency: string): string {
  return currency === "INR" ? "₹" : `${currency} `;
}

/** Groups the page's active mappings by payment plan, preserving display_order. */
function groupByPlan(mappings: ProductPageMappingResponse[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();

  for (const mapping of mappings) {
    if (mapping.status !== "ACTIVE") continue;
    const plan = mapping.payment_plan;
    if (!plan) continue;

    const existing = groups.get(mapping.payment_plan_id);
    const actual = plan.actual_price ?? 0;
    const list = Math.max(plan.elevated_price ?? 0, actual);

    if (existing) {
      existing.mappings.push(mapping);
      existing.price += actual;
      existing.listPrice += list;
    } else {
      groups.set(mapping.payment_plan_id, {
        plan,
        planId: mapping.payment_plan_id,
        mappings: [mapping],
        price: actual,
        listPrice: list,
      });
    }
  }

  return [...groups.values()];
}

interface PlanTilesProps {
  pageData: ProductPageData;
  settings: ProductPageSettings;
  primaryColor: string;
}

export const PlanTiles = ({ pageData, settings, primaryColor }: PlanTilesProps) => {
  const { selectedPsOptionIds, setSelection } = useProductPageStore();
  // On a site with languages (a checkout inside CatalogueChrome) the course
  // word is the site language's, so the line under each tile is a sentence
  // of that language too. Anywhere else it is the English line it always was.
  const { enabled: siteLanguages } = useCatalogueLocale();
  const { t } = useTranslation("productPages");
  const terms = useCourseTerms();

  const config = settings.planSelector;
  const groups = useMemo(() => groupByPlan(pageData.mappings), [pageData.mappings]);

  /**
   * Are these plans genuine alternatives, or just different plans that happen
   * to sit on different courses?
   *
   * A tile is only a real choice when every plan can sell at least one course
   * in common — "1 Subject" vs "EMS Combo" vs "Full Grade Pack" all include
   * English, so picking between them is meaningful. Where the plans carve up
   * disjoint courses instead (an institute plan owning some levels and
   * partner sub-org plans owning the rest), the plans are bookkeeping, not an
   * offer: tiles there would list every plan on the page and a single click
   * would sweep dozens of unrelated courses into the cart.
   */
  const arePlansAlternatives = useMemo(() => {
    if (groups.length < 2) return false;
    const sessionSets = groups.map(
      (g) => new Set(g.mappings.map((m) => m.package_session_id)),
    );
    const [first, ...rest] = sessionSets;
    return [...first!].some((id) => rest.every((s) => s.has(id)));
  }, [groups]);

  // One plan is not a choice — rendering a lone tile just adds a step.
  if (!config?.enabled || groups.length < 2 || !arePlansAlternatives) return null;

  const currency = pageData.currency || groups[0]?.plan.currency || "INR";
  const symbol = currencySymbolFor(currency);
  const money = (n: number) => `${symbol}${n.toLocaleString("en-IN")}`;

  const exclusive = config.mode !== "ADDITIVE";
  /** Every option id that belongs to some plan tile — the set a tile may clear. */
  const tileOwnedIds = new Set(
    groups.flatMap((g) => g.mappings.map((m) => m.ps_invite_payment_option_id)),
  );

  const isSelected = (group: PlanGroup) =>
    group.mappings.length > 0 &&
    group.mappings.every((m) => selectedPsOptionIds.includes(m.ps_invite_payment_option_id));

  /** The line under a tile on a site with languages: what the plan sells, and for how long. */
  const siteContentsLine = (count: number, validity: number): string => {
    const contents =
      count > 1
        ? t("planTiles.coursesIncluded", {
            count,
            courses: terms.courses.toLocaleLowerCase(),
            defaultValue: "{{count}} {{courses}} included",
          })
        : t("planTiles.oneCourse", {
            course: terms.course.toLocaleLowerCase(),
            defaultValue: "1 {{course}}",
          });
    return validity > 0
      ? `${contents} · ${t("success.access.days", { count: validity, defaultValue: "{{count}} days access" })}`
      : contents;
  };

  const choosePlan = (group: PlanGroup) => {
    const groupIds = group.mappings.map((m) => m.ps_invite_payment_option_id);

    if (isSelected(group)) {
      // Deselecting the active plan is only offered when the page allows it —
      // otherwise the visitor could empty the cart with no way back but a reload.
      if (settings.allowCourseDeselection === false) return;
      setSelection(selectedPsOptionIds.filter((id) => !groupIds.includes(id)));
      return;
    }

    if (exclusive) {
      // Drop the other tiles' items but keep anything the visitor added from
      // the course grid — those are separate purchases, not rival plans.
      const kept = selectedPsOptionIds.filter((id) => !tileOwnedIds.has(id));
      setSelection([...kept, ...groupIds]);
    } else {
      const merged = new Set([...selectedPsOptionIds, ...groupIds]);
      setSelection([...merged]);
    }
  };

  return (
    <section aria-labelledby="plan-tiles-heading">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
        <h2 id="plan-tiles-heading" className="text-sm font-bold text-gray-900">
          {config.heading || "Choose a Plan"}
        </h2>
        {exclusive && (
          <span className="text-caption text-gray-400">
            Picking one replaces the other plan
          </span>
        )}
      </div>
      {config.subheading && (
        <p className="mb-3 text-caption text-gray-500">{config.subheading}</p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => {
          const selected = isSelected(group);
          const savings = Math.max(0, group.listPrice - group.price);
          const features = parseFeatures(group.plan.feature_json).slice(0, 3);
          const validity = group.plan.validity_in_days;

          return (
            <button
              key={group.planId}
              type="button"
              onClick={() => choosePlan(group)}
              aria-pressed={selected}
              className={cn(
                "relative flex flex-col rounded-2xl border p-4 text-start transition-all duration-150",
                selected
                  ? "shadow-md"
                  : "border-gray-200 bg-white shadow-sm hover:border-gray-300 hover:shadow-md",
              )}
              // Dynamic: the selected ring is the institute's own page colour,
              // which only exists at runtime in page_json.globalSettings.
              style={
                selected
                  ? { borderColor: primaryColor, boxShadow: `0 0 0 2px ${primaryColor}33` }
                  : undefined
              }
            >
              {group.plan.tag && (
                <span
                  className="absolute -top-2.5 start-4 rounded-full px-2 py-0.5 text-2xs font-bold text-white shadow-sm"
                  // Dynamic: institute page colour, see above.
                  style={{ backgroundColor: primaryColor }}
                >
                  <Star className="me-0.5 inline size-2.5" weight="fill" aria-hidden="true" />
                  {group.plan.tag}
                </span>
              )}

              {selected && (
                <CheckCircle
                  className="absolute end-3 top-3 size-5"
                  weight="fill"
                  // Dynamic: institute page colour, see above.
                  style={{ color: primaryColor }}
                  aria-hidden="true"
                />
              )}

              <p className="mb-1 pe-6 text-sm font-bold text-gray-900">
                {group.plan.name}
              </p>

              <div className="mb-1 flex items-baseline gap-1.5">
                <span className="text-h3-semibold font-bold tabular-nums text-gray-900">
                  {group.price > 0 ? money(group.price) : "Free"}
                </span>
                {savings > 0 && (
                  <span className="text-caption text-gray-400 line-through tabular-nums">
                    {money(group.listPrice)}
                  </span>
                )}
              </div>

              {savings > 0 && (
                <p className="mb-2 text-caption font-semibold text-success-600">
                  Save {money(savings)}
                </p>
              )}

              {group.plan.description && (
                <p className="mb-2 line-clamp-2 text-caption text-gray-500">
                  {group.plan.description}
                </p>
              )}

              {features.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5 text-caption text-gray-600">
                      <Check className="mt-0.5 size-3 shrink-0 text-success-600" aria-hidden="true" />
                      <span className="line-clamp-1">{feature}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-auto text-2xs text-gray-400">
                {siteLanguages ? (
                  siteContentsLine(group.mappings.length, validity)
                ) : (
                  <>
                    {group.mappings.length > 1
                      ? `${group.mappings.length} ${getTerminologyPlural(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()} included`
                      : `1 ${getTerminology(ContentTerms.Course, SystemTerms.Course).toLocaleLowerCase()}`}
                    {validity > 0 ? ` · ${validity} days access` : ""}
                  </>
                )}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
};
