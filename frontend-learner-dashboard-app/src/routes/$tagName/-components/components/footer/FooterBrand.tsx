import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FacebookLogo, Globe, InstagramLogo, LinkedinLogo, TelegramLogo, TwitterLogo, YoutubeLogo, type Icon as PhosphorIcon } from "@phosphor-icons/react";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { RouteMatcher } from "../../../-services/route-matcher";
import type { FooterProps, GlobalSettings } from "../../../-types/course-catalogue-types";
import type { FooterBrandProps, FooterLinkColumn } from "../../../-types/site-chrome-types";
import { CatalogueLink } from "../../CatalogueLink";
import { HeaderLanguageSwitcher } from "../../header/HeaderLanguageSwitcher";
import { useNewsletterSignup } from "../newsletter/use-newsletter-signup";

/**
 * Footer variant "brand" (Figma 73:588): logo + wordmark + description +
 * tagline, the newsletter with socials beside it, four link columns and a
 * bottom bar (copyright, हिन्दी | EN, tagline). Every visible string is an
 * authored prop already in the visitor's language; the few fixed labels are
 * coursePlayerB `siteChrome.*` keys. Colours are palette classes.
 */

type Props = FooterProps &
  FooterBrandProps & {
    backgroundColor?: string;
    textColor?: string;
    instituteId?: string;
    tagName?: string;
    globalSettings?: GlobalSettings;
  };

// Exact design values, one per line so each carries its design-lint note.
const FOOTER_PAD = "px-4 pb-10 pt-12 sm:px-6 lg:px-8 lg:pb-12 lg:pt-20 xl:px-20";
const BRAND_COLUMN = "flex w-full flex-col gap-6 lg:w-[420px] lg:shrink-0"; // design-lint-ignore: Figma brand area 420px
const LOGO = "h-[70px] w-[73px] shrink-0 rounded-[6px] object-cover"; // design-lint-ignore: Figma footer logo 73×70, radius 6
const WORDMARK = "text-3xl font-bold leading-8 text-palette-body lg:text-[40px]"; // design-lint-ignore: Figma wordmark 40/32
const TAGLINE = "text-sm font-bold leading-[22px] text-palette-primary"; // design-lint-ignore: Figma tagline 14/22
const NEWS_HEADING = "text-[22px] font-bold leading-7 text-palette-body"; // design-lint-ignore: Figma 22/28
const NEWS_TEXT = "text-sm leading-[22px] text-palette-body"; // design-lint-ignore: Figma 14/22
const EMAIL_INPUT = "h-12 min-w-0 flex-1 rounded-full border border-palette-border bg-catalogue-bg-elevated px-4 text-sm leading-5 text-palette-text outline-none transition placeholder:text-palette-body focus:border-palette-primary focus:ring-2 focus:ring-palette-primary/20";
const SUBSCRIBE = "h-12 shrink-0 rounded-full bg-palette-primary px-[18px] text-sm font-bold leading-5 text-white transition-colors duration-200 hover:bg-palette-primary/90 disabled:cursor-not-allowed disabled:opacity-60"; // design-lint-ignore: Figma subscribe px 18
const SMALL = "text-[13px] leading-5 text-palette-body"; // design-lint-ignore: Figma note 13/20
const SOCIAL = "flex size-9 items-center justify-center rounded-[10px] border border-palette-border bg-catalogue-bg-elevated text-palette-olive transition-colors duration-200 hover:border-palette-outline"; // design-lint-ignore: Figma social tile radius 10
const COLUMN_HEADING = "text-[15px] font-bold leading-[22px] text-palette-body"; // design-lint-ignore: Figma column heading 15/22
const LINK = "text-start text-sm leading-5 text-palette-body transition-colors duration-200 hover:text-palette-primary";
const LEGAL = "text-[13px] leading-[18px] text-palette-body"; // design-lint-ignore: Figma legal row 13/18

// Outline glyphs in the palette olive, 14px, as in the design.
const SOCIAL_ICONS: Record<string, PhosphorIcon> = {
  youtube: YoutubeLogo,
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  twitter: TwitterLogo,
  x: TwitterLogo,
  linkedin: LinkedinLogo,
  telegram: TelegramLogo,
};

/** A logo prop that is a URL is used as is; anything else is a file id resolved to a public URL. */
const useLogoUrl = (raw: string | undefined): string | null => {
  const value = (raw || "").trim();
  const direct = /^https?:\/\//i.test(value) ? value : null;
  const [resolved, setResolved] = useState<string | null>(null);
  useEffect(() => {
    if (!value || direct) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    getPublicUrlWithoutLogin(value)
      .then((url) => {
        if (!cancelled && url) setResolved(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [value, direct]);
  return direct ?? resolved;
};

export const FooterBrand: React.FC<Props> = ({
  backgroundColor,
  textColor,
  leftSection,
  newsletter,
  rightSection1,
  rightSection2,
  rightSection3,
  rightSection4,
  bottomNote,
  bottomTagline,
  showLanguageSwitcher,
  instituteId,
  tagName,
  globalSettings,
}) => {
  const { t } = useTranslation("coursePlayerB");
  const left = (leftSection ?? {}) as FooterProps["leftSection"] & NonNullable<FooterBrandProps["leftSection"]>;
  const logoUrl = useLogoUrl(left.logo);
  const news = newsletter && newsletter.enabled !== false ? newsletter : null;
  const signup = useNewsletterSignup({
    instituteId,
    audienceId: news?.audienceId,
    tagName,
    sourceSuffix: "footer-newsletter",
  });
  const socials = Array.isArray(left.socials) ? left.socials.filter((s) => s && s.url) : [];
  const columns = [rightSection1, rightSection2, rightSection3, rightSection4].filter(
    (c): c is FooterLinkColumn => !!c && Array.isArray(c.links),
  );

  const renderLink = (link: { label: string; route: string; openInSameTab?: boolean }) =>
    RouteMatcher.isExternalLink(link.route) ? (
      <a
        href={link.route}
        className={LINK}
        target={link.openInSameTab ? "_self" : "_blank"}
        rel={!link.openInSameTab ? "noopener noreferrer" : undefined}
      >
        {link.label}
      </a>
    ) : (
      // A real link (href with the site prefix and the visitor's language), so
      // it opens in a new tab, copies and is followed by crawlers.
      <CatalogueLink to={link.route} className={LINK}>
        {link.label}
      </CatalogueLink>
    );

  return (
    <footer
      data-footer-variant="brand"
      className={`catalogue-footer border-t border-palette-border ${backgroundColor ? "" : "bg-palette-sand"} ${FOOTER_PAD}`}
      style={{ // design-lint-ignore: author-picked page-builder colours below
        ...(backgroundColor ? { backgroundColor } : {}), // design-lint-ignore: author-picked page-builder color
        ...(textColor ? { color: textColor } : {}), // design-lint-ignore: author-picked page-builder color
      }}
    >
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-10 lg:gap-12">
        <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
          <div className={BRAND_COLUMN}>
            {(logoUrl || left.title) && (
              <div className="flex items-center gap-6">
                {logoUrl && <img src={logoUrl} alt="" className={LOGO} />}
                {left.title && <p className={WORDMARK}>{left.title}</p>}
              </div>
            )}
            {(left.text || left.tagline) && (
              <div className="flex flex-col gap-1.5">
                {left.text && (
                  <div className="text-base leading-6 text-palette-body" dangerouslySetInnerHTML={{ __html: left.text }} />
                )}
                {left.tagline && <p className={TAGLINE}>{left.tagline}</p>}
              </div>
            )}
          </div>

          {(news || socials.length > 0) && (
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              {news?.heading && <h3 className={NEWS_HEADING}>{news.heading}</h3>}
              {news?.subheading && <p className={NEWS_TEXT}>{news.subheading}</p>}
              {news &&
                (signup.submitted ? (
                  <p role="status" className="text-base font-bold leading-6 text-palette-text">
                    {news.successMessage || t("siteChrome.newsletterSuccess", "Thank you. You're subscribed.")}
                  </p>
                ) : (
                  <form onSubmit={signup.handleSubmit} className="flex items-center gap-3">
                    <label className="sr-only" htmlFor="footer-newsletter-email">
                      {t("siteChrome.newsletterEmailLabel", "Email address")}
                    </label>
                    <input
                      id="footer-newsletter-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={signup.email}
                      onChange={(e) => signup.setEmail(e.target.value)}
                      placeholder={news.placeholder || t("siteChrome.newsletterPlaceholder", "Your email address")}
                      className={EMAIL_INPUT}
                    />
                    {/* Honeypot — hidden from humans, filled by bots. */}
                    <div className="sr-only" aria-hidden="true">
                      <label>
                        {t("siteChrome.newsletterHoneypot", "Company website")}
                        <input
                          type="text"
                          tabIndex={-1}
                          autoComplete="off"
                          value={signup.honeypot}
                          onChange={(e) => signup.setHoneypot(e.target.value)}
                        />
                      </label>
                    </div>
                    <button type="submit" disabled={signup.submitting} className={SUBSCRIBE}>
                      {signup.submitting ? "…" : news.buttonText || t("siteChrome.newsletterSubscribe", "Subscribe")}
                    </button>
                  </form>
                ))}
              {signup.error && (
                <p role="alert" className={SMALL}>
                  {signup.error}
                </p>
              )}
              {news?.note && <p className={SMALL}>{news.note}</p>}
              {socials.length > 0 && (
                <ul className="flex flex-wrap gap-3" aria-label={t("siteChrome.socialLinks", "Social media")}>
                  {socials.map((social, i) => {
                    const Icon = SOCIAL_ICONS[(social.icon || social.platform || "").toLowerCase()] ?? Globe;
                    // The icon is hidden from screen readers, so the link always needs a name.
                    const name = social.platform || social.icon || social.url;
                    return (
                      <li key={i}>
                        <a
                          href={social.url}
                          target={social.openInSameTab ? "_self" : "_blank"}
                          rel={social.openInSameTab ? undefined : "noopener noreferrer"}
                          aria-label={name}
                          title={name}
                          className={SOCIAL}
                        >
                          <Icon aria-hidden="true" size={14} />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {columns.length > 0 && (
          <>
            <div aria-hidden="true" className="h-px w-full bg-palette-border" />
            <nav
              aria-label={t("siteChrome.footerNav", "Footer")}
              className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4 lg:gap-12"
            >
              {columns.map((column, i) => (
                <div key={i} className="flex min-w-0 flex-col gap-4">
                  {column.title && <h3 className={COLUMN_HEADING}>{column.title}</h3>}
                  <ul>
                    {column.links.map((link, j) => (
                      <li key={j} className="flex py-3">
                        {renderLink(link)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </>
        )}

        {(bottomNote || bottomTagline || showLanguageSwitcher) && (
          <>
            <div aria-hidden="true" className="h-px w-full bg-palette-border" />
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              {bottomNote ? <p className={LEGAL}>{bottomNote}</p> : <span />}
              <div className="flex flex-wrap items-center gap-6">
                {showLanguageSwitcher && (
                  <HeaderLanguageSwitcher authoredLocales={globalSettings?.i18n?.locales} variant="footer" />
                )}
                {bottomTagline && <p className={LEGAL}>{bottomTagline}</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </footer>
  );
};

export default FooterBrand;
