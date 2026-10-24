import { useEffect, useLayoutEffect, useRef } from "react";
import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useProductPageStore } from "../-stores/product-page-store";
import { resolveInitialSelection } from "../-utils/custom-field-aggregator";
import { checkoutEntryOf } from "../-utils/page-switch";
import { cartBackTarget } from "../-utils/cart-back";
import {
  injectGtm,
  pushProductPageView,
} from "@/components/common/enroll-by-invite/-utils/gtm";
import { CatalogStep } from "./CatalogStep";
import { isFinderUsable, parseCourseFinder } from "../-utils/course-finder";
import { CartStep } from "./CartStep";
import { MultiEnrollForm } from "./MultiEnrollForm";
import { CombinedPaymentStep } from "./CombinedPaymentStep";
import { CpoInstallmentsCheckoutStep } from "./CpoInstallmentsCheckoutStep";
import { ProductPageSuccess } from "./ProductPageSuccess";
import { CheckoutLayout } from "./CheckoutLayout";
import { CatalogueChrome } from "@/routes/$tagName/-components/CatalogueChrome";
import { requestCourseFinder } from "@/routes/$tagName/-utils/reopen-course-finder";
import { requestSiteCartReopen } from "@/routes/$tagName/-components/site-cart/site-cart-events";
import type {
  ProductPageSettings,
  PageJson,
  ProductPageData,
  ProductPageStep,
} from "../-types/product-page-types";

interface ProductPageShellProps {
  productPageCode: string;
  instituteId: string;
  pageData: ProductPageData;
  courseIds?: string;
  defaultTab?: "CATALOG" | "CART" | "PAYMENT";
  /** Catalogue the visitor came from — supplies header, footer and theme. */
  tagName?: string;
  /** Comma-separated level names the browse step is restricted to. */
  levels?: string;
  /** Site language (?lang=) the visitor arrived in; kept on the way back out. */
  lang?: string;
  /** Sent here by the site cart's Checkout (?source=siteCart): Back returns to that page. */
  fromSiteCart?: boolean;
  utmParams: Record<string, string | undefined>;
}

function parseSafeJson<T>(jsonStr: string | null | undefined, fallback: T): T {
  if (!jsonStr) return fallback;
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_SETTINGS: ProductPageSettings = {
  defaultStep: "CATALOG",
  allowCourseDeselection: true,
  gtmContainerId: "",
  tnc: { enabled: false, content: "", externalUrl: "" },
  invoice: { enabled: true, channels: ["EMAIL"] },
};

const DEFAULT_PAGE_JSON: PageJson = {
  globalSettings: { primaryColor: "#4F46E5", logoFileId: "" }, // design-lint-ignore: page-builder default color
  components: [],
};

/** Steps that act on a basket the learner already confirmed in the cart. */
const PAST_THE_CART: ProductPageStep[] = ["FORM", "PAYMENT", "CPO_INSTALLMENTS"];

export const ProductPageShell = ({
  productPageCode,
  instituteId,
  pageData,
  courseIds,
  defaultTab,
  tagName,
  levels,
  lang,
  fromSiteCart = false,
  utmParams,
}: ProductPageShellProps) => {
  const { step, setPageData, setStep, setSelection, setUtmParams, selectedPsOptionIds } =
    useProductPageStore();
  const gtmFired = useRef(false);
  const initialized = useRef(false);
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();

  /**
   * Where "Back" from the cart leads.
   *
   * A visitor who arrived from a catalogue with a basket already filled
   * (defaultTab=CART) has never seen THIS page's own catalogue step, so
   * dropping them there is a place they have never been — a different grid of
   * the same courses, with the basket bar they were just using replaced by
   * another one. Send them back where they came from instead; the catalogue
   * restores their basket from sessionStorage, so nothing is lost.
   *
   * Once they have actually visited this page's catalogue step, that becomes
   * the honest destination again.
   *
   * Set from the RESOLVED start step in the layout effect below, not from the
   * store: the store initialises to CATALOG and is corrected to CART before
   * paint, but a passive effect reading `step` still sees that first CATALOG
   * and would mark the visitor as having been somewhere they never went —
   * which sent every Back to this page's own catalogue instead of theirs.
   */
  const sawOwnCatalog = useRef(false);

  /**
   * Set when the Course Finder sent the visitor straight from a class pick to
   * the details step. Back from that form must then return to the catalogue —
   * dropping them on the cart would be a step they have never seen, showing a
   * basket that filled itself.
   */
  const cartSkipped = useRef(false);
  const prevStep = useRef<ProductPageStep | null>(null);
  useEffect(() => {
    const previous = prevStep.current;
    prevStep.current = step;
    // Only a real navigation INTO the catalogue counts; the initial value is
    // not a place anyone has been.
    if (previous !== null && previous !== "CATALOG" && step === "CATALOG") {
      sawOwnCatalog.current = true;
    }
  }, [step]);

  const backFromCart = () => {
    // Any visitor who arrived from a catalogue carries its slug. If they have
    // not since browsed THIS page's catalogue step, that slug is where Back
    // belongs — the catalogue restores their basket from sessionStorage.
    // The site cart's store checkout is the exception: the visitor opened the
    // cart on some page of the site, so Back returns there (see cart-back).
    const target = cartBackTarget({
      fromSiteCart,
      sawOwnCatalog: sawOwnCatalog.current,
      canGoBack,
      tagName,
    });
    if (target === "history") {
      // The cart drawer they checked out from opens again on that page.
      requestSiteCartReopen();
      router.history.back();
      return;
    }
    if ((target === "siteHome" || target === "siteFinder") && tagName) {
      if (target === "siteFinder") {
        // Going back to choose is exactly when the Course Finder earns its
        // keep, but its once-ever seen flag would suppress it. Ask for it
        // explicitly.
        requestCourseFinder(tagName);
      } else {
        requestSiteCartReopen();
      }
      // The params form, not a template path: real catalogue tags contain
      // spaces, parentheses and even leading slashes ("Home Page", "Arabian
      // International Stem Hub (AISH)", "/cement-factory"), which the router
      // encodes here and a hand-built `/${tagName}` would not.
      // The site language the visitor was reading in goes back with them.
      navigate({ to: "/$tagName", params: { tagName }, ...(lang ? { search: { lang } } : {}) });
      return;
    }
    setStep("CATALOG");
  };

  // useLayoutEffect runs synchronously before the browser paints — ensures the
  // correct step is set before any frame is visible, preventing a flash of the
  // catalog when the page is supposed to start on CART / FORM.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Priority: URL courseIds → DB preselected → empty. Never auto-select all.
    const initialSelection = resolveInitialSelection(pageData.mappings, courseIds);

    // The store is module-level, so it outlives this page. A DIFFERENT
    // product page (e.g. the site cart's store checkout after another page's
    // checkout), or a return after this page's order went through, starts
    // from a clean store: a coupon, discount, learner or CPO plan from there
    // must never ride into this checkout. A different basket on this page
    // drops the coupon and CPO state worked out for the previous one. The
    // same basket on the same page keeps its state, exactly as before.
    const entry = checkoutEntryOf(useProductPageStore.getState(), pageData, initialSelection);
    if (entry === "RESET") {
      useProductPageStore.getState().reset();
    } else if (entry === "NEW_BASKET") {
      useProductPageStore.getState().clearBasketState();
    }

    setPageData(pageData);

    const settings = parseSafeJson<ProductPageSettings>(
      pageData.settings_json,
      DEFAULT_SETTINGS,
    );

    const resolvedStep = defaultTab ?? settings.defaultStep;
    const configuredStep =
      resolvedStep === "CART"
        ? "CART"
        : resolvedStep === "PAYMENT"
          ? "FORM"
          : "CATALOG";

    /**
     * A Course Finder is a gate: it decides WHICH courses the visitor may see,
     * and it lives on the catalogue step. A page configured to land on Cart or
     * Payment therefore skips the question and drops the visitor on an empty
     * basket — "Nothing in your cart yet", with no way to choose anything.
     *
     * So when a usable finder exists and nothing has been selected for them,
     * the catalogue wins over the configured landing step. A link that DOES
     * carry a basket (?courseIds=) has answered the question and is honoured
     * as configured.
     */
    const finderGates =
      isFinderUsable(parseCourseFinder(pageData.settings_json), pageData.mappings) &&
      initialSelection.length === 0;
    const startStep = finderGates ? "CATALOG" : configuredStep;

    // Starting ON this page's catalogue means it IS where Back belongs. Recorded
    // here, in the layout effect, because it runs before any passive effect can
    // misread the store's transient initial step.
    sawOwnCatalog.current = startStep === "CATALOG";

    setSelection(initialSelection);

    const utmFiltered = Object.fromEntries(
      Object.entries(utmParams).filter(([, v]) => v !== undefined),
    ) as Record<string, string>;
    setUtmParams(utmFiltered);

    setStep(startStep);
  }, []);

  // The page can arrive again while it is open: the refetch after a 409
  // "price changed", or a background refresh. The totals, the Pay button and
  // the receipt are all priced from the store, so it follows the new copy
  // (see syncPageData) — before paint, so no frame mixes old and new prices.
  // A finished order's receipt keeps what was paid. A basket that lost a
  // course the page no longer sells goes back to the cart to be reviewed,
  // rather than paying for — or, emptied, "enrolling" in — a basket nobody
  // confirmed.
  useLayoutEffect(() => {
    if (!initialized.current) return;
    const store = useProductPageStore.getState();
    if (store.pageData === pageData || store.step === "SUCCESS") return;
    const selectionBefore = store.selectedPsOptionIds;
    store.syncPageData(pageData);
    const synced = useProductPageStore.getState();
    if (synced.selectedPsOptionIds !== selectionBefore && PAST_THE_CART.includes(synced.step)) {
      synced.setStep("CART");
    }
  }, [pageData]);

  // GTM injection — run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (gtmFired.current) return;
    const settings = parseSafeJson<ProductPageSettings>(
      pageData.settings_json,
      DEFAULT_SETTINGS,
    );
    const gtmId = settings.gtmContainerId || pageData.gtm_container_id;
    if (gtmId) {
      injectGtm(gtmId);
      gtmFired.current = true;
      const utmFiltered = Object.fromEntries(
        Object.entries(utmParams).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      pushProductPageView(productPageCode, settings.defaultStep, utmFiltered);
    }
  }, []);

  const settings = parseSafeJson<ProductPageSettings>(
    pageData.settings_json,
    DEFAULT_SETTINGS,
  );
  const pageJson = parseSafeJson<PageJson>(pageData.page_json, DEFAULT_PAGE_JSON);
  const primaryColor = pageJson.globalSettings?.primaryColor || "#4F46E5"; // design-lint-ignore: page-builder default color
  const vendor = (pageData.vendor || "FREE").toUpperCase();

  // Matches the header/footer types PageRenderer renders itself, so a product
  // page the admin gave its own chrome never gets a second one layered on.
  const pageHasOwnChrome = (pageJson.components || []).some(
    (c) =>
      c.enabled !== false &&
      ["Header", "header", "Footer", "footer"].includes(c.type as string),
  );

  // Determine if the current selection is all-CPO (routes to CPO installments step)
  const selectedMappings = pageData.mappings.filter((m) =>
    selectedPsOptionIds.includes(m.ps_invite_payment_option_id)
  );
  const isCpoSelection =
    selectedMappings.length > 0 &&
    selectedMappings.every((m) => m.payment_option_type?.toUpperCase() === "CPO");

  const handleFormNext = () => {
    setStep(isCpoSelection ? "CPO_INSTALLMENTS" : "PAYMENT");
  };

  const jumpToForm = () => {
    cartSkipped.current = true;
    setStep("FORM");
  };

  const backFromForm = () => {
    if (cartSkipped.current) {
      // Returning to the catalogue means returning to the finder's answer, not
      // the finder itself — the pick is still stored, so they land on their
      // class with the way to change it in reach.
      cartSkipped.current = false;
      setStep("CATALOG");
      return;
    }
    setStep("CART");
  };

  return (
    <div className="min-h-screen w-full bg-white">
      {/* Only the browse step wears the catalogue chrome. The checkout steps
          stay in CheckoutLayout's focused shell — dropping site navigation
          into a payment flow invites visitors to wander out of it.
          A page_json that already declares its own header/footer keeps them:
          injecting the catalogue's on top would stack two headers. */}
      {step === "CATALOG" && (
        <CatalogueChrome
          tagName={pageHasOwnChrome ? undefined : tagName}
          instituteId={instituteId}
          showFooter
        >
          <CatalogStep
            pageData={pageData}
            settings={settings}
            tagName={tagName}
            productPageCode={productPageCode}
            levels={levels}
            courseIds={courseIds}
            onNext={() => setStep("CART")}
            onJumpToForm={jumpToForm}
          />
        </CatalogueChrome>
      )}

      {/* Checkout wears the SAME chrome as the catalogue the visitor came from.
          The header changing character mid-purchase — site header while
          browsing, a bare coloured bar once money is involved — reads as
          having left the site. A page that declares its own header/footer keeps
          them instead (tagName undefined makes this a passthrough), so nothing
          stacks two headers. */}
      {(step === "CART" || step === "FORM" || step === "PAYMENT" || step === "CPO_INSTALLMENTS") && (
        <CatalogueChrome
          tagName={pageHasOwnChrome ? undefined : tagName}
          instituteId={instituteId}
          showFooter
        >
        <CheckoutLayout
          pageData={pageData}
          pageJson={pageJson}
          settings={settings}
          primaryColor={primaryColor}
        >
          {step === "CART" && (
            <CartStep
              pageData={pageData}
              settings={settings}
              primaryColor={primaryColor}
              onBack={backFromCart}
              onNext={() => setStep("FORM")}
            />
          )}
          {step === "FORM" && (
            <MultiEnrollForm
              pageData={pageData}
              settings={settings}
              primaryColor={primaryColor}
              courseIds={courseIds}
              onBack={backFromForm}
              onNext={handleFormNext}
            />
          )}
          {step === "PAYMENT" && (
            <CombinedPaymentStep
              pageData={pageData}
              settings={settings}
              instituteId={instituteId}
              vendor={vendor}
              primaryColor={primaryColor}
              onBack={() => setStep("FORM")}
              onSuccess={() => setStep("SUCCESS")}
            />
          )}
          {step === "CPO_INSTALLMENTS" && (
            <CpoInstallmentsCheckoutStep
              pageData={pageData}
              settings={settings}
              vendor={vendor}
              primaryColor={primaryColor}
              onBack={() => setStep("FORM")}
              onSuccess={() => setStep("SUCCESS")}
            />
          )}
        </CheckoutLayout>
        </CatalogueChrome>
      )}

      {step === "SUCCESS" && <ProductPageSuccess pageData={pageData} />}
    </div>
  );
};
