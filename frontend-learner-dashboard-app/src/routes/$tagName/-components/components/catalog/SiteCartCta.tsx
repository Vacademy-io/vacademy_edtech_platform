import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CaretDown, Check, ShoppingCart, SpinnerGap, Trash } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PriceWithMrp } from "@/components/common/price-with-mrp";
import { cn } from "@/lib/utils";
import { useSiteCartStore } from "../../../-stores/site-cart-store";
import { SITE_CART_MAX_ITEMS } from "../../../-utils/site-cart";
import { useCourseTerms } from "../../../-utils/catalogue-naming";
import type { CourseLanguageOption } from "../../../-utils/course-variants";
import { rowLanguage, type CatalogRowLike } from "./catalog-cards";
import {
  cartVersionOf,
  choosesLanguageOnly,
  inCartVersionText,
  packageSessionOf,
  toSiteCartItem,
  versionChoiceLabel,
} from "./catalog-site-cart";
import { ThemedPortalSurface } from "./ThemedPortalSurface";

/**
 * In place of SiteCartCta while the store page loads (cardCartOffer
 * "pending"): whether this card's versions go to the cart or keep the course
 * page's enrol flow is not known yet, so there is nothing to press.
 */
export const SiteCartCtaPending = () => {
  const { t } = useTranslation("coursePlayerB");
  return (
    <button
      type="button"
      disabled
      aria-busy="true"
      aria-label={t("siteCart.checking", "Checking availability…")}
      className="catalogue-btn catalogue-btn-primary mt-2 w-full"
    >
      <SpinnerGap size={16} weight="bold" className="animate-spin" aria-hidden="true" />
    </button>
  );
};

/**
 * The card CTA when the site-wide cart is on: "Add to cart" ⇄ "In cart".
 * A course sold in several languages opens a small chooser first; picking
 * another language swaps the version in the cart (one version per course).
 * Two versions in the same language (two levels) are told apart by their
 * level, in the chooser and on the button.
 * Disabled until the stored cart has loaded for this institute — an add made
 * before that would be overwritten when the stored cart arrives.
 */
export const SiteCartCta = <R extends CatalogRowLike & { thumbnail?: string }>({
  instituteId,
  courseId,
  versions,
  purchasable = versions,
  title,
  languages,
  translate,
  themeAnchor,
}: {
  /** The institute the page's site cart belongs to (the catalogue hydrates it). */
  instituteId: string;
  courseId: string;
  /** The versions the store sells, purchasable now (cardCartOffer). */
  versions: R[];
  /**
   * All the card's purchasable versions, the store's or not (cardCartOffer).
   * The chooser names versions against them all, as the card's chips do, and
   * opens even for the one version the store sells when the card has others —
   * so the visitor sees which version goes in, at what price, and the button
   * names it once it is in.
   */
  purchasable?: R[];
  /** Base-language course title (translated here for display). */
  title: string;
  languages: CourseLanguageOption[];
  translate: (s: string) => string;
  /** Any element inside the catalogue section (finds the theme for the chooser). */
  themeAnchor: React.RefObject<HTMLElement | null>;
}) => {
  const { t } = useTranslation("coursePlayerB");
  const terms = useCourseTerms();
  const items = useSiteCartStore((s) => s.items);
  const add = useSiteCartStore((s) => s.add);
  const remove = useSiteCartStore((s) => s.remove);
  const ready = useSiteCartStore((s) => s.hydrated && s.instituteId === instituteId);
  const [open, setOpen] = useState(false);

  const inCart = useMemo(() => new Set(items.map((i) => i.packageSessionId)), [items]);
  const current = cartVersionOf(versions, inCart);
  const displayTitle = translate(title);
  const languageOf = (v: R) => rowLanguage(v, languages);
  const versionLabel = (v: R) => versionChoiceLabel(v, purchasable, languages, translate);

  const addVersion = (v: R) => {
    add(toSiteCartItem(v, courseId, languages));
    setOpen(false);
    // The store refuses a new course once the cart holds SITE_CART_MAX_ITEMS.
    if (!useSiteCartStore.getState().has(packageSessionOf(v))) {
      toast.error(
        t("siteCart.full", {
          max: SITE_CART_MAX_ITEMS,
          courses: terms.courses.toLocaleLowerCase(),
          defaultValue: "Your cart is full — up to {{max}} {{courses}} per order.",
        }),
      );
      return;
    }
    toast.success(t("courseCatalog.addedToCart", { title: displayTitle }));
  };
  const removeVersion = (v: R) => {
    remove(packageSessionOf(v));
    toast.success(t("courseCatalog.removedFromCart", { title: displayTitle }));
    setOpen(false);
  };

  // One version and no other on the card: a plain button. Otherwise a chooser.
  const single = versions.length === 1 && purchasable.length <= 1;
  // Which version is in the cart, when the course has more than one.
  const currentVersion = current && !single ? inCartVersionText(current, languages, translate) : "";
  const label = current
    ? currentVersion
      ? t("courseCatalog.inCartWithLanguage", {
          language: currentVersion,
          defaultValue: "In cart · {{language}}",
        })
      : t("courseCatalog.inCart", "In cart")
    : t("courseCatalog.addToCart", "Add to cart");
  const icon = current ? (
    <Check size={16} weight="bold" aria-hidden="true" />
  ) : (
    <ShoppingCart size={16} weight="bold" aria-hidden="true" />
  );
  const buttonClass = cn("catalogue-btn mt-2 w-full", current ? "catalogue-btn-secondary" : "catalogue-btn-primary");

  if (single) {
    const only = versions[0];
    return (
      <button
        type="button"
        aria-pressed={!!current}
        disabled={!ready}
        aria-busy={!ready || undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!ready) return;
          if (current) removeVersion(only);
          else addVersion(only);
        }}
        className={buttonClass}
      >
        {icon}
        {label}
      </button>
    );
  }

  return (
    <Popover open={ready && open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!ready}
          aria-busy={!ready || undefined}
          onClick={(e) => e.stopPropagation()}
          className={buttonClass}
        >
          {icon}
          {label}
          <CaretDown size={14} weight="bold" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-72 border-0 bg-transparent p-0 shadow-none"
        // React events bubble through portals: keep clicks in the chooser
        // from reaching the card, which would open the course page.
        onClick={(e) => e.stopPropagation()}
      >
        <ThemedPortalSurface
          anchor={themeAnchor}
          className="rounded-catalogue-lg border border-catalogue-border bg-catalogue-bg-elevated p-2 text-catalogue-text-primary shadow-lg"
        >
          <p className="px-2 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-catalogue-text-muted">
            {choosesLanguageOnly(purchasable, languages)
              ? t("courseCatalog.chooseLanguage", "Choose a language")
              : t("courseCatalog.chooseVersion", "Choose a version")}
          </p>
          <ul className="space-y-0.5">
            {versions.map((v) => {
              const selected = current === v;
              const lang = languageOf(v);
              return (
                <li key={packageSessionOf(v)}>
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    onClick={() => (selected ? setOpen(false) : addVersion(v))}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-catalogue-md px-2 py-2 text-start text-sm transition-colors",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                      selected ? "bg-primary-50" : "hover:bg-catalogue-interactive-hover",
                    )}
                  >
                    {lang?.chip && (
                      <span className="rounded-catalogue-sm border border-catalogue-border px-1.5 py-0.5 text-3xs font-semibold leading-none text-catalogue-text-secondary">
                        {lang.chip}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{versionLabel(v)}</span>
                    <PriceWithMrp
                      actual={v.price}
                      elevated={v.elevatedPrice}
                      currency={v.currency}
                      size="xs"
                      layout="inline"
                      hideBadge
                    />
                    {selected && <Check size={14} weight="bold" className="text-primary-500" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {current && (
            <button
              type="button"
              onClick={() => removeVersion(current)}
              className="mt-1 flex w-full items-center gap-2 rounded-catalogue-md px-2 py-2 text-start text-sm text-danger-600 transition-colors hover:bg-danger-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
            >
              <Trash size={14} weight="bold" aria-hidden="true" />
              {t("courseCatalog.removeFromCart", "Remove from cart")}
            </button>
          )}
        </ThemedPortalSurface>
      </PopoverContent>
    </Popover>
  );
};
