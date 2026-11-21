import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useProductPageStore } from "../-stores/product-page-store";
import { CheckCircle, BookOpen, ArrowRight } from "@phosphor-icons/react";
import { formatPriceAmount } from "@/components/common/price-with-mrp";
import { itemSubject } from "../-utils/cart-item-display";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import {
  getTerminology,
  getTerminologyPlural,
} from "@/components/common/layout-container/sidebar/utils";
import { ContentTerms, SystemTerms } from "@/types/naming-settings";
import { TokenKey } from "@/constants/auth/tokens";
import { getTokenFromCookie } from "@/lib/auth/sessionUtility";
import { resolveLearnerIdentity } from "@/lib/learner-identity";
import { buildOtpLoginHref } from "@/lib/auth/otp-login-handoff";
import { cn } from "@/lib/utils";
import type {
  ProductPageData,
  ProductPageSettings,
} from "../-types/product-page-types";
import { clampRedirectDelay, resolveRedirectTarget } from "../-utils/redirect-settings";

interface ProductPageSuccessProps {
  pageData: ProductPageData;
}

// Origins allowed to receive the PAYMENT_SUCCESS postMessage when this page is
// embedded in an iframe. Sending to a targetOrigin (not '*') prevents leaking
// the event to unintended embedders.
const PAYMENT_SUCCESS_TARGET_ORIGINS = [
  "https://shikshanation.com",
  "https://www.shikshanation.com",
  "http://localhost:3000",
];

/** A course with one class and one session names both "default"; that says nothing to a buyer. */
const isDefaultName = (name?: string | null) => name?.trim().toLowerCase() === "default";

/** Same lookup as main.tsx: localStorage first (WebViews), then the cookie. */
const hasAccessToken = (): boolean => {
  try {
    if (localStorage.getItem(TokenKey.accessToken)) return true;
  } catch {
    // localStorage may be blocked; fall through to the cookie
  }
  return !!getTokenFromCookie(TokenKey.accessToken);
};

export const ProductPageSuccess = ({ pageData }: ProductPageSuccessProps) => {
  const { t } = useTranslation("productPages");
  const course = getTerminology(ContentTerms.Course, SystemTerms.Course);
  const coursePlural = getTerminologyPlural(ContentTerms.Course, SystemTerms.Course);
  const { selectedPsOptionIds, utmParams, finalPrice, totalPrice, loginCode, registrationData } =
    useProductPageStore();

  const settings: ProductPageSettings = pageData.settings_json
    ? (() => {
        try {
          return JSON.parse(pageData.settings_json);
        } catch {
          return {};
        }
      })()
    : {};

  const redirectTarget = resolveRedirectTarget(
    settings.afterPaymentRedirectUrl?.trim() ?? "",
  );
  const redirectDelayMs = clampRedirectDelay(settings.afterPaymentRedirectDelaySeconds) * 1000;
  const showLoginButton = settings.showLoginButton ?? true;
  const successPageContent = settings.successPageContent?.trim() ?? "";

  // "Log in automatically after purchase": the server only hands out a code
  // for a buyer whose account this checkout created, so anyone without one
  // (or whose code fails) gets the normal receipt below.
  const [autoLogin, setAutoLogin] = useState<"pending" | "failed" | "idle">(
    settings.autoLoginAfterPayment && loginCode ? "pending" : "idle",
  );

  // Same setting, buyer without a code: their account was there before this
  // checkout (e.g. migrated from the institute's old store), so they may not
  // know its password. Send them to the login page with their email and phone
  // in the link; it opens whichever OTP form the portal allows, prefilled, or
  // its usual form when none is on. Skipped when this browser is already
  // logged in.
  const otpLoginHref =
    settings.autoLoginAfterPayment && !hasAccessToken()
      ? buildOtpLoginHref(resolveLearnerIdentity(Object.values(registrationData ?? {})))
      : null;

  const enrolledCount = selectedPsOptionIds.length;
  const currency =
    pageData.currency || pageData.mappings[0]?.payment_plan?.currency || "";

  const enrolledMappings = pageData.mappings.filter((m) =>
    selectedPsOptionIds.includes(m.ps_invite_payment_option_id),
  );

  // What was actually PAID, not what each course lists for.
  //
  // This page used to print the payment plan's price beside every course, so a
  // ₹949 four-subject order read "₹349" four times — ₹1,396 of receipts for one
  // ₹949 payment, and no total anywhere to reconcile it against. On a page that
  // prices the basket as a whole (any 3 for ₹799, +₹150 each) the per-course
  // list price is not a figure the parent ever paid, so it is the one number
  // that must NOT appear on a receipt. The order total is; the saving beside it
  // is what makes the smaller figure legible.
  const amountPaid = finalPrice();
  const listTotal = totalPrice();
  const saved = Math.max(0, Math.round(listTotal - amountPaid));
  // Prices are hidden wholesale inside Apple's reader-app builds.
  const showAmount = !shouldHidePaidPurchaseUI() && enrolledMappings.length > 0;

  /** "1 year access" / "6 months access" / "45 days access"; "" when unset. */
  const accessLabel = (days?: number): string => {
    if (!days || days <= 0) return "";
    if (days === 365) return t("success.access.oneYear");
    if (days % 30 === 0) return t("success.access.months", { count: days / 30 });
    return t("success.access.days", { count: days });
  };

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (window.parent && window.parent !== window) {
      const payload = {
        type: "PAYMENT_SUCCESS",
        event: "payment_success",
        status: "success",
        utm: utmParams,
      };
      PAYMENT_SUCCESS_TARGET_ORIGINS.forEach((origin) => {
        try {
          window.parent.postMessage(payload, origin);
        } catch {
          // Ignore — postMessage to a non-matching origin is a no-op,
          // and we don't want a single bad origin to block the others.
        }
      });
    }
  }, [utmParams]);

  useEffect(() => {
    if (autoLogin !== "pending" || !loginCode) return;
    let cancelled = false;
    (async () => {
      try {
        // Loaded on demand: only buyers who get a login code need the auth cycle.
        const [{ exchangeProductPageLoginCode }, { performFullAuthCycle }] = await Promise.all([
          import("../-services/product-page-service"),
          import("@/services/auth-cycle-service"),
        ]);
        const tokens = await exchangeProductPageLoginCode(loginCode, pageData.institute_id);
        await performFullAuthCycle(
          { accessToken: tokens.access_token, refreshToken: tokens.refresh_token },
          pageData.institute_id,
        );
        // replace(): Back must not return to a checkout that is already paid.
        if (!cancelled) window.location.replace("/dashboard");
      } catch {
        if (!cancelled) setAutoLogin("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoLogin, loginCode, pageData.institute_id]);

  // "Redirect Path" in the product page's Post Enrollment Configuration: once
  // the enrolment is through, hand the buyer over to the institute's own
  // thank-you page instead of this receipt.
  useEffect(() => {
    if (!redirectTarget || autoLogin === "pending") return;
    const timer = window.setTimeout(() => {
      // replace(), not assign() — Back from the thank-you page must not walk
      // the buyer into a checkout they have already paid for.
      window.location.replace(redirectTarget);
    }, redirectDelayMs);
    return () => window.clearTimeout(timer);
  }, [redirectTarget, redirectDelayMs, autoLogin]);

  if (autoLogin === "pending") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12">
        <div className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-green-100">
          <CheckCircle className="size-10 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t("success.title")}</h1>
        <p className="mt-3 flex items-center gap-2 text-sm text-gray-500">
          <span className="size-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          {t("success.loggingIn")}
        </p>
      </div>
    );
  }

  // While the handover is pending, the receipt below would only flash past, so
  // show the one thing that matters — the enrolment went through — plus a link
  // for the case where the automatic navigation is blocked.
  if (redirectTarget) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12">
        <div className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-green-100">
          <CheckCircle className="size-10 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{t("success.title")}</h1>
        <p className="mt-3 flex items-center gap-2 text-sm text-gray-500">
          <span className="size-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          {t("success.redirecting")}
        </p>
        <a
          href={redirectTarget}
          className="mt-6 text-sm font-medium text-blue-600 underline underline-offset-2 hover:text-blue-700"
        >
          {t("success.redirectNow")}
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-12">
      {/* Success icon */}
      <div className="mb-6 flex size-20 items-center justify-center rounded-3xl bg-green-100">
        <CheckCircle className="size-10 text-green-600" />
      </div>

      <h1 className="text-2xl font-bold text-gray-900">{t("success.title")}</h1>

      {/* Custom or default content */}
      {successPageContent ? (
        <div
          className="mt-3 max-w-sm text-center text-sm text-gray-500"
          dangerouslySetInnerHTML={{ __html: successPageContent }}
        />
      ) : (
        <p className="mt-2 max-w-sm text-center text-sm text-gray-500">
          {t("success.defaultMessage", {
            count: enrolledCount,
            course: (enrolledCount === 1 ? course : coursePlural).toLocaleLowerCase(),
          })}
        </p>
      )}

      {/* Enrolled course list */}
      <div className="mt-8 w-full max-w-sm space-y-2">
        {enrolledMappings.map((m) => {
          // The COURSE's name, not the plan's. Every course on a basket-priced
          // page shares one plan ("Per Subject"), so a receipt built from the
          // plan name lists the same row four times and cannot be checked
          // against what was actually bought. itemSubject is the same label the
          // cart showed two screens earlier, so the two agree.
          //
          // Class and session sit on the meta line because a parent buying for
          // two children needs to see WHICH child each row is for; the plan's
          // validity joins them rather than owning a line of its own.
          const meta = [
            isDefaultName(m.level_name) ? "" : m.level_name,
            isDefaultName(m.session_name) ? "" : m.session_name,
            accessLabel(m.payment_plan?.validity_in_days),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div
              key={m.ps_invite_payment_option_id}
              className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm"
            >
              <CheckCircle className="size-4 shrink-0 text-green-500" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">{itemSubject(m, course)}</p>
                {meta && <p className="mt-0.5 text-xs text-gray-400">{meta}</p>}
              </div>
            </div>
          );
        })}

        {showAmount && (
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-gray-900">
                {t("success.totalPaid")}
              </span>
              <span className="text-sm font-semibold text-gray-900">
                {formatPriceAmount(amountPaid, currency)}
              </span>
            </div>
            {saved > 0 && (
              <p className="mt-1 text-xs text-green-600">
                {t("success.youSaved", {
                  amount: formatPriceAmount(saved, currency),
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {showLoginButton && otpLoginHref && (
        <p className="mt-8 max-w-sm text-center text-sm text-gray-500">
          {t("success.existingAccountHint", { courses: coursePlural })}
        </p>
      )}

      {showLoginButton && (
        <a
          href={otpLoginHref ?? "/dashboard"}
          className={cn(
            "flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700",
            otpLoginHref ? "mt-4" : "mt-8",
          )}
        >
          <BookOpen className="size-4" />
          {otpLoginHref
            ? t("success.logInToContinue")
            : t("success.goToMyCourses", { courses: coursePlural })}
          <ArrowRight className="size-4" />
        </a>
      )}
    </div>
  );
};
