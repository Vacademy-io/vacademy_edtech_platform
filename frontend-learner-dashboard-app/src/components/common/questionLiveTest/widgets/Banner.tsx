import { useConsole } from "../layouts/console-context";
import type { ConsoleChrome } from "../layouts/console-chrome";
import { useInstituteBrand } from "./use-console-data";

/**
 * Top banner. The slot an exam body fills with its own artwork carries the
 * institute's logo and name instead; no exam body's mark is ever drawn.
 */
export function Banner() {
  const { chrome } = useConsole();
  return <BannerStrip bannerStyle={chrome.bannerStyle} />;
}

/**
 * The banner without the console context, for screens drawn before the
 * attempt opens (the instruction page).
 */
export function BannerStrip({ bannerStyle }: { bannerStyle: ConsoleChrome["bannerStyle"] }) {
  const { name, logoUrl } = useInstituteBrand();
  const logo = logoUrl ? <img className="tcs-banner__logo" src={logoUrl} alt="" /> : null;
  if (bannerStyle === "white") {
    return (
      <header className="tcs-banner tcs-banner--white">
        <span className="tcs-banner__side">{logo}</span>
        <span className="tcs-banner__title">{name}</span>
        <span className="tcs-banner__side" />
      </header>
    );
  }
  return (
    <header className="tcs-banner tcs-banner--blue">
      {(logo || name) && (
        <span className="tcs-banner__tab">
          {logo}
          <span className="tcs-banner__name">{name}</span>
        </span>
      )}
    </header>
  );
}
