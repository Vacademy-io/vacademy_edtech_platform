import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSiteNavigate } from "../../-utils/catalogue-route-search";
import { FooterProps } from "../../-types/course-catalogue-types";
import { CourseCatalogueData } from "../../-types/course-catalogue-types";
import { RouteMatcher } from "../../-services/route-matcher";
import type { GlobalSettings } from "../../-types/course-catalogue-types";
import type { FooterBrandProps } from "../../-types/site-chrome-types";
import { FooterBrand } from "./footer/FooterBrand";

export const FooterComponent: React.FC<FooterProps & {
  catalogueData?: CourseCatalogueData;
  tagName?: string;
  /** Author-picked surface colours. The editor has always offered these; the
   *  footer ignored them and stayed on the .catalogue-footer token, so the
   *  pickers appeared to do nothing. */
  backgroundColor?: string;
  textColor?: string;
  /** Used by the opt-in "brand" variant only (newsletter, language switch). */
  instituteId?: string;
  globalSettings?: GlobalSettings;
} & Omit<FooterBrandProps, "leftSection">> = (allProps) => {
  const {
  layout,
  backgroundColor,
  textColor,
  leftSection,
  rightSection1,
  rightSection2,
  rightSection3,
  rightSections,
  rightSection,
  socialsSection,
  bottomNote,
  catalogueData,
  tagName = "home"
  } = allProps;
  const navigate = useNavigate();
  const siteNavigate = useSiteNavigate();
  
  // Helper function to handle footer link navigation
  const handleLinkNavigation = (route: string, openInSameTab: boolean = false) => {
    if (RouteMatcher.isExternalLink(route)) {
      if (openInSameTab) {
        window.location.href = route;
      } else {
        window.open(route, '_blank');
      }
      return;
    }

    if (catalogueData && catalogueData.pages) {
      const matchedPage = RouteMatcher.findMatchingPage(route, catalogueData.pages);
      if (matchedPage) {
        const navigationRoute = RouteMatcher.getPageNavigationRoute(matchedPage, tagName);
        void siteNavigate(navigationRoute);
        return;
      }
    }

    const normalizedRoute = RouteMatcher.normalizeRoute(route);
    if (normalizedRoute === 'home' || normalizedRoute === '') {
      navigate({ to: RouteMatcher.pagePath(tagName) });
      return;
    }

    void siteNavigate(route);
  };

  const handleSocialLinkNavigation = (url: string, openInSameTab: boolean = false) => {
    if (openInSameTab) {
      window.location.href = url;
    } else {
      window.open(url, '_blank');
    }
  };

  // Get social media icon component
  const getSocialIcon = (iconName: string) => {
    const iconProps = { className: "w-5 h-5", fill: "currentColor" };
    
    switch (iconName.toLowerCase()) {
      case "facebook":
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
          </svg>
        );
      case "instagram":
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
          </svg>
        );
      case "youtube":
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
        );
      case "linkedin":
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
        );
      case "x":
      case "twitter":
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
        );
      case "telegram":
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
        );
      case "pinterest":
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.174-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.751.098.118.112.221.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.402.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.747-1.378 0 0-.599 2.282-.744 2.84-.282 1.084-1.064 2.456-1.549 3.235C9.584 23.815 10.77 24.001 12.017 24.001c6.624 0 11.99-5.367 11.99-11.987C24.007 5.367 18.641.001 12.017.001z"/>
          </svg>
        );
      default:
        return (
          <svg {...iconProps} viewBox="0 0 24 24">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 8.16c-.169 1.858-.896 3.46-2.053 4.617-1.157 1.157-2.759 1.884-4.617 2.053C9.03 14.828 8.5 14.5 8.5 14.5s-.53.328-1.398.33c-1.858-.169-3.46-.896-4.617-2.053C1.328 11.62.601 10.018.432 8.16.33 7.192.5 6.5.5 6.5s-.17.692-.068 1.66c.169 1.858.896 3.46 2.053 4.617 1.157 1.157 2.759 1.884 4.617 2.053C7.97 14.828 8.5 14.5 8.5 14.5s.53.328 1.398.33c1.858-.169 3.46-.896 4.617-2.053 1.157-1.157 1.884-2.759 2.053-4.617.102-.968-.068-1.66-.068-1.66s.17-.692.068-1.66z"/>
          </svg>
        );
    }
  };

  // Opt-in "brand" footer (logo + newsletter + four columns + bottom bar).
  // Every other footer renders the original markup below.
  if (allProps.variant === "brand") {
    return <FooterBrand {...allProps} tagName={tagName} />;
  }

  // Determine grid columns based on layout
  const getGridCols = () => {
    switch (layout) {
      case "four-column":
        return "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";
      case "three-column":
        return "grid-cols-1 md:grid-cols-3";
      case "two-column":
      default:
        return "grid-cols-1 md:grid-cols-2";
    }
  };

  // Link styles - neutral with primary accent on hover
  const linkClasses = "text-sm text-catalogue-text-secondary hover:text-primary-500 transition-colors cursor-pointer";
  const linkClassesLeft = "text-sm text-catalogue-text-secondary hover:text-primary-500 transition-colors cursor-pointer text-start";

  return (
    <footer
      className="catalogue-footer"
      style={{
        ...(backgroundColor ? { backgroundColor } : {}), // design-lint-ignore: author-picked page-builder color
        ...(textColor ? { color: textColor } : {}), // design-lint-ignore: author-picked page-builder color
      }}
    >
      <div className="w-full px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
        <div className={`grid ${getGridCols()} gap-6 lg:gap-8`}>
          {/* Left Section - Company Info */}
          <div>
            {/* PRIMARY ACCENT: Section title uses primary color */}
            <h3 className="text-sm font-semibold mb-3 text-primary-500">{leftSection.title}</h3>
            {/* NEUTRAL: Body text */}
            <div className="text-sm text-catalogue-text-secondary mb-3" dangerouslySetInnerHTML={{ __html: leftSection.text }} />

            {/* Social Media Links - PRIMARY ACCENT on hover */}
            {leftSection.socials && leftSection.socials.length > 0 && (
              <div className="flex gap-3 mt-3">
                {leftSection.socials.map((social, linkIndex) => (
                  <button
                    key={linkIndex}
                    onClick={() => handleSocialLinkNavigation(social.url, social.openInSameTab)}
                    className="text-catalogue-text-muted hover:text-primary-500 transition-colors"
                    aria-label={social.platform}
                    title={social.platform}
                  >
                    {getSocialIcon(social.icon)}
                  </button>
                ))}
              </div>
            )}

            {/* Legacy Social Media Section */}
            {socialsSection && !leftSection.socials && (
              <div className="mt-4 space-y-2">
                <h4 className="text-sm font-medium text-catalogue-text-primary">{socialsSection.title}</h4>
                <div className="flex gap-3">
                  {socialsSection.links.map((social, linkIndex) => (
                    <a
                      key={linkIndex}
                      href={social.url}
                      className="text-catalogue-text-muted hover:text-primary-500 transition-colors"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={social.platform}
                    title={social.platform}
                    >
                      {getSocialIcon(social.icon)}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right Section 1 */}
          {rightSection1 && (
            <div>
              {/* PRIMARY ACCENT: Section title */}
              <h3 className="text-sm font-semibold mb-3 text-primary-500">{rightSection1.title}</h3>
              <ul className="space-y-1.5">
                {rightSection1.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    {RouteMatcher.isExternalLink(link.route) ? (
                      <a
                        href={link.route}
                        className={linkClasses}
                        target={link.openInSameTab ? "_self" : "_blank"}
                        rel={!link.openInSameTab ? "noopener noreferrer" : undefined}
                      >
                        {link.label}
                      </a>
                    ) : (
                      <button
                        onClick={() => handleLinkNavigation(link.route, link.openInSameTab)}
                        className={linkClassesLeft}
                      >
                        {link.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Right Section 2 */}
          {rightSection2 && (
            <div className="space-y-stack">
              <h3 className="text-sm font-semibold text-primary-500">{rightSection2.title}</h3>
              <ul className="space-y-1.5">
                {rightSection2.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    {RouteMatcher.isExternalLink(link.route) ? (
                      <a
                        href={link.route}
                        className={linkClasses}
                        target={link.openInSameTab ? "_self" : "_blank"}
                        rel={!link.openInSameTab ? "noopener noreferrer" : undefined}
                      >
                        {link.label}
                      </a>
                    ) : (
                      <button
                        onClick={() => handleLinkNavigation(link.route, link.openInSameTab)}
                        className={linkClassesLeft}
                      >
                        {link.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Right Section 3 */}
          {rightSection3 && (
            <div className="space-y-stack">
              <h3 className="text-sm font-semibold text-primary-500">{rightSection3.title}</h3>
              <ul className="space-y-1.5">
                {rightSection3.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    {RouteMatcher.isExternalLink(link.route) ? (
                      <a
                        href={link.route}
                        className={linkClasses}
                        target={link.openInSameTab ? "_self" : "_blank"}
                        rel={!link.openInSameTab ? "noopener noreferrer" : undefined}
                      >
                        {link.label}
                      </a>
                    ) : (
                      <button
                        onClick={() => handleLinkNavigation(link.route, link.openInSameTab)}
                        className={linkClassesLeft}
                      >
                        {link.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Legacy Support - Single Right Section */}
          {rightSection && !rightSection1 && !rightSection2 && !rightSection3 && (
            <div className="space-y-stack">
              <h3 className="text-sm font-semibold text-primary-500">{rightSection.title}</h3>
              <ul className="space-y-1.5">
                {rightSection.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    {RouteMatcher.isExternalLink(link.route) ? (
                      <a
                        href={link.route}
                        className={linkClasses}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <button
                        onClick={() => handleLinkNavigation(link.route)}
                        className={linkClassesLeft}
                      >
                        {link.label}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Legacy Support - Multiple Right Sections Array */}
          {rightSections && rightSections.length > 0 && !rightSection1 && !rightSection2 && !rightSection3 && (
            <>
              {rightSections.map((section, sectionIndex) => (
                <div className="space-y-stack" key={sectionIndex}>
                  <h3 className="text-sm font-semibold text-primary-500">{section.title}</h3>
                  <ul className="space-y-1.5">
                    {section.links.map((link, linkIndex) => (
                      <li key={linkIndex}>
                        {RouteMatcher.isExternalLink(link.route) ? (
                          <a
                            href={link.route}
                            className={linkClasses}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {link.label}
                          </a>
                        ) : (
                          <button
                            onClick={() => handleLinkNavigation(link.route)}
                            className={linkClassesLeft}
                          >
                            {link.label}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Bottom Note - NEUTRAL with subtle primary accent */}
        <div className="border-t border-catalogue-border-subtle mt-6 sm:mt-8 pt-5 sm:pt-6 text-center">
          <p className="text-catalogue-text-secondary text-xs">
            {bottomNote}
          </p>
        </div>
      </div>
    </footer>
  );
};
