import React from "react";
import { WhatsappLogo } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { emitLeadCaptured } from "../-utils/catalogue-tracking";
import { useSiteT } from "../-utils/catalogue-locale";

/**
 * Floating WhatsApp / call button for catalogue sites.
 *
 * WHY: in this market a parent is far likelier to tap WhatsApp than fill a
 * form — every competing coaching site has this — and we shipped none. The
 * builder had no way to express it at all.
 *
 * Configured once per site (Global Settings → WhatsApp) so it rides every
 * page, and its taps fire the same lead event as forms, so ad platforms and
 * GA4 see WhatsApp enquiries as conversions too.
 */

export interface WhatsAppSettings {
  enabled?: boolean;
  /** Digits with country code, e.g. 919895603342. Non-digits are stripped. */
  phone?: string;
  /** Prefilled first message; the visitor can edit before sending. */
  message?: string;
  label?: string;
  position?: "right" | "left";
}

interface Props {
  settings?: WhatsAppSettings | null;
  /** Lifted so the button clears the fixed mobile action bar. */
  hasMobileBar?: boolean;
}

export const WhatsAppFloatingButton: React.FC<Props> = ({ settings, hasMobileBar = false }) => {
  const { t } = useTranslation("coursePlayerA");
  // Label and prefilled message are authored once in Global Settings; a
  // हिन्दी visitor gets their translations (the phone number never changes).
  const siteT = useSiteT();
  const phone = (settings?.phone || "").replace(/\D/g, "");
  if (!settings?.enabled || !phone) return null;

  const label = settings.label ? siteT(settings.label) : "";
  const href = `https://wa.me/${phone}${
    settings.message ? `?text=${encodeURIComponent(siteT(settings.message))}` : ""
  }`;
  const isLeft = settings.position === "left";

  // `catalogue-floating-cta` lets a multi-course basket bar lift this clear of
  // itself: that bar takes the bottom of the viewport at EVERY width, not only
  // the mobile one hasMobileBar already accounts for. See catalogue-tokens.css.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        emitLeadCaptured({ sourceType: "WHATSAPP_CLICK", sourceId: "floating-button" })
      }
      aria-label={label || t("whatsAppFloatingButton.chatWithUs")}
      title={label || t("whatsAppFloatingButton.chatWithUs")}
      className={`catalogue-floating-cta fixed z-catalogue-fixed flex items-center gap-2 rounded-full bg-success-500 px-4 py-3 font-semibold text-white no-underline shadow-lg transition hover:opacity-90 active:scale-[0.98] ${
        isLeft ? "start-4" : "end-4"
      } ${hasMobileBar ? "bottom-32 md:bottom-6" : "bottom-6"}`}
    >
      <WhatsappLogo weight="fill" className="size-6 shrink-0" aria-hidden="true" />
      {label && <span className="hidden text-sm sm:inline">{label}</span>}
    </a>
  );
};

export default WhatsAppFloatingButton;
