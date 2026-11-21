import React from "react";
import { useTranslation } from "react-i18next";
import { resolveMobileBarLinks, classifyBarLink, shouldShowMobileGetStarted } from "../-utils/catalogue-cta";
import { useSiteT } from "../-utils/catalogue-locale";
import { useSignupAvailability } from "@/hooks/use-signup-availability";

/**
 * The fixed bottom action bar on mobile catalogue pages.
 *
 * It renders THE SAME buttons as the site header (`authLinks`), stacked for
 * thumbs — one mental model, one place to configure. That makes it fully
 * admin-controllable from Global Header → Auth / CTA Buttons:
 *   - remove a button there → it disappears here too (remove ALL → no bar);
 *   - an "Enquire (form)" button bound to an Audience campaign opens that
 *     campaign's form as a popup here exactly like it does in the header.
 *
 * Catalogues that never configured authLinks keep the legacy hardcoded bar
 * (Login + Get Started → lead-collection modal) so nothing shifts under
 * institutes that never touched the setting.
 */

interface MobileActionBarProps {
  catalogueData: any;
  pageSlug?: string;
  /** Legacy Get Started visibility gate the page already computes. */
  legacyGetStartedVisible: boolean;
  onLogin: () => void;
  onLegacyGetStarted: () => void;
  onNavigate: (route: string) => void;
  /** Extra bottom padding on native shells (gesture bar). */
  nativePad?: boolean;
}

export const MobileActionBar: React.FC<MobileActionBarProps> = ({
  catalogueData,
  pageSlug,
  legacyGetStartedVisible,
  onLogin,
  onLegacyGetStarted,
  onNavigate,
  nativePad = false,
}) => {
  const { t } = useTranslation("coursePlayerA");
  // The links come from the raw catalogue JSON (the header's authLinks), so
  // their labels are put in the visitor's language here, at display only —
  // classifyBarLink keeps reading the authored values.
  const siteT = useSiteT();
  // New-user prompt shown as one line beside the signup link, not as a button.
  const signupPrompt = t("mobileActionBar.signupPrompt");
  // No institute prop: the hook falls back to the InstituteId that domain
  // routing writes on every catalogue page load, which keeps this component's
  // signature untouched.
  const { enabled: signupEnabled } = useSignupAvailability();
  const allLinks = resolveMobileBarLinks(catalogueData, pageSlug);
  // Same rule the header applies: an institute with signup switched off must not
  // be offered a "Sign Up" button on any surface.
  const links =
    allLinks && !signupEnabled
      ? allLinks.filter((link) => classifyBarLink(link) !== "signup")
      : allLinks;

  // Explicitly cleared header buttons → the admin asked for no bar at all.
  if (links !== null && links.length === 0) return null;

  // `catalogue-mobile-action-bar` is the hook a multi-course basket bar uses to
  // stand this bar down: both are fixed to bottom-0 on a phone and would
  // otherwise stack on top of each other. See catalogue-tokens.css.
  const shell = (children: React.ReactNode) => (
    <div className="catalogue-mobile-action-bar md:hidden fixed bottom-0 start-0 end-0 z-50 bg-catalogue-bg border-t border-catalogue-border p-4">
      <div className={`flex flex-col gap-3 ${nativePad ? "mb-8" : ""}`}>{children}</div>
    </div>
  );

  // ── Legacy default (authLinks never configured) ──
  if (links === null) {
    return shell(
      <>
        <div className="flex flex-col gap-1">
          <button onClick={onLogin} className="catalogue-btn catalogue-btn-secondary w-full justify-center">
            {t("common.login")}
          </button>
        </div>
        {legacyGetStartedVisible && shouldShowMobileGetStarted(catalogueData, pageSlug) && (
          <p className="text-center text-xs text-catalogue-text-secondary">
            {signupPrompt}{" "}
            <button
              type="button"
              onClick={onLegacyGetStarted}
              className="font-semibold text-primary-500 underline underline-offset-2"
            >
              {t("mobileActionBar.getStarted")}
            </button>
          </p>
        )}
      </>
    );
  }

  // ── Header-mirrored bar ──
  const handleClick = (link: any) => {
    switch (classifyBarLink(link)) {
      case "form": {
        const title = link.formTitle || link.label;
        window.dispatchEvent(
          new CustomEvent("openAudienceForm", {
            detail: { audienceId: String(link.audienceId).trim(), title: title ? siteT(title) : title },
          })
        );
        break;
      }
      case "login":
        onLogin();
        break;
      case "signup":
        // Not `/signup` — that route redirects straight back to /login, so this
        // button used to bounce the learner out at the login screen. The header
        // owns the signup modal; ask it to open. See HeaderComponent.
        window.dispatchEvent(new CustomEvent("openSignupModal"));
        break;
      case "leadCollection":
        onLegacyGetStarted();
        break;
      default:
        if (link.route) onNavigate(link.route);
    }
  };

  return shell(
    <>
      {links.slice(0, 3).map((link: any, i: number) => {
        const kind = classifyBarLink(link);

        // Signup / lead capture reads as one prompt line with an inline link
        // rather than a second full-width button: the bar offers a single
        // action, and registering is the aside for people who can't take it.
        // "form" (an Audience campaign CTA like Enquire Now) stays a button —
        // it is the page's own call to action, not a signup fallback.
        if (kind === "leadCollection" || kind === "signup") {
          return (
            <p key={i} className="text-center text-xs text-catalogue-text-secondary">
              {signupPrompt}{" "}
              <button
                type="button"
                onClick={() => handleClick(link)}
                className="font-semibold text-primary-500 underline underline-offset-2"
              >
                {siteT(link.label) || t("mobileActionBar.getStarted")}
              </button>
            </p>
          );
        }

        // The page's own CTA leads; login/navigation stay quiet.
        const primary = kind === "form";
        return (
          <button
            key={i}
            onClick={() => handleClick(link)}
            className={`catalogue-btn w-full justify-center ${primary ? "catalogue-btn-primary" : "catalogue-btn-secondary"}`}
          >
            {siteT(link.label) || t("mobileActionBar.open")}
          </button>
        );
      })}
    </>
  );
};

export default MobileActionBar;
