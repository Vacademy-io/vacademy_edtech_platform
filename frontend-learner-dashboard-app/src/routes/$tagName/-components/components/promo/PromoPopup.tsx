import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Copy, Lightning, Megaphone, Ticket, X } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { RouteMatcher } from "../../../-services/route-matcher";
import { bindHtmlActions, renderHtmlSection } from "../../../-utils/catalogue-html";
import { CatalogueLink } from "../../CatalogueLink";
import { emitLeadCaptured } from "../../../-utils/catalogue-tracking";
import {
  MODAL_TEMPLATES,
  browserStores,
  canShowAgain,
  clampNumber,
  countdownParts,
  formatCountdown,
  isWithinSchedule,
  normalizeDevices,
  normalizeFrequency,
  normalizeTemplate,
  normalizeTrigger,
  parsePromoDate,
  promoStorageKey,
  rememberSeen,
  scrollPercent,
  splitHtmlAndCss,
  whatsappDigits,
  type CountdownParts,
  type PromoTemplate,
} from "../../../-utils/promo-popup";
import { isDarkHex } from "./CtaBand";

/**
 * Promo popup — the page-builder block "promoPopup": a sale / offer / admission
 * announcement that opens by itself (after a delay, on scroll, or when the
 * visitor heads for the tab bar) instead of sitting in the page flow.
 *
 * Six looks (`template`): four centred dialogs that dim the page — spotlight,
 * split, poster, ticket — and two that leave the page usable — a corner card
 * and a sticky bar. Every text, image, colour, the coupon and the countdown
 * come from props; nothing is specific to an institute.
 *
 * Rendered through a portal into the site's theme wrapper
 * ([data-catalogue-theme], as HeaderSearch and the document viewer do): a
 * section style (transform, overflow) around the block can never clip or
 * re-anchor it, and the site's brand colour, palette, radius and dark mode
 * still apply — they are set on that wrapper, not on <html>.
 * Editor preview: a dashed strip marks where the block sits; selecting the
 * block opens the popup so the admin sees exactly what visitors will.
 */

export interface PromoButtonConfig {
  text?: string;
  /** link (default) | openForm (an Audience campaign's form) | whatsapp */
  action?: string;
  url?: string;
  target?: string;
  audienceId?: string;
  formTitle?: string;
  whatsappPhone?: string;
  whatsappMessage?: string;
}

export interface PromoPopupProps {
  componentId: string;
  instituteId: string;
  /** Site tag, for page links in the custom template (data-vacademy="route"). */
  tagName?: string;
  /** Custom template: the admin's markup with its own <style> blocks, in one string. */
  html?: string;
  /** Custom template: card width — sm | md | lg. */
  customWidth?: string;
  isPreviewMode?: boolean;
  /** Editor preview with its own marks: draw the in-flow strip. */
  showPreviewStrip?: boolean;
  /** Editor preview: this block is the selected one, so its popup is open. */
  isSelected?: boolean;
  template?: string;
  badge?: string;
  heading?: string;
  highlight?: string;
  body?: string;
  image?: string;
  imageAlt?: string;
  couponCode?: string;
  showCountdown?: boolean;
  startDate?: string;
  endDate?: string;
  button?: PromoButtonConfig;
  dismissText?: string;
  footnote?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  trigger?: string;
  delaySeconds?: number | string;
  scrollPercent?: number | string;
  frequency?: string;
  devices?: string;
  closeOnBackdrop?: boolean;
}

/* ── hooks ───────────────────────────────────────────────────────────── */

/** Ticks once a second until `end`; null when there is no end or it has passed. */
const useCountdown = (end: number | null, frozen: boolean): CountdownParts | null => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (end === null || frozen) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [end, frozen]);
  return end === null ? null : countdownParts(end, now);
};

/** Another dialog (lead form, intro page, an open campaign form) is up. */
const otherDialogOpen = (): boolean => !!document.querySelector('[aria-modal="true"]');

const isTouchOnly = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(hover: none)").matches;

const isDesktopWidth = (): boolean =>
  typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 768px)").matches : true;

/** Exit intent cannot happen on a phone; it waits this long there instead. */
const TOUCH_EXIT_FALLBACK_MS = 20000;
/** A page too short to scroll fires a scroll trigger after this. */
const SHORT_PAGE_FALLBACK_MS = 5000;

/**
 * Fires once when the visitor shows the configured intent. Never fires while
 * another dialog is open — it waits for that one to close rather than stack.
 */
const usePromoTrigger = (
  armed: boolean,
  trigger: ReturnType<typeof normalizeTrigger>,
  delayMs: number,
  scrollAt: number,
): boolean => {
  const [fired, setFired] = useState(false);
  useEffect(() => {
    if (!armed || fired) return;
    let waitTimer: number | undefined;
    let done = false;
    const fire = () => {
      if (done) return;
      if (otherDialogOpen()) {
        window.clearTimeout(waitTimer);
        waitTimer = window.setTimeout(fire, 1500);
        return;
      }
      done = true;
      setFired(true);
    };
    const cleanups: Array<() => void> = [];
    const after = (ms: number) => {
      const id = window.setTimeout(fire, ms);
      cleanups.push(() => window.clearTimeout(id));
    };

    if (trigger === "delay") {
      after(delayMs);
    } else if (trigger === "scroll") {
      const check = () => {
        const doc = document.documentElement;
        if (scrollPercent(window.scrollY, window.innerHeight, doc.scrollHeight) >= scrollAt) fire();
      };
      const short = document.documentElement.scrollHeight <= window.innerHeight + 8;
      if (short) after(SHORT_PAGE_FALLBACK_MS);
      window.addEventListener("scroll", check, { passive: true });
      cleanups.push(() => window.removeEventListener("scroll", check));
    } else if (isTouchOnly()) {
      after(TOUCH_EXIT_FALLBACK_MS);
    } else {
      // The pointer leaving through the top edge (towards the tab bar / URL bar).
      const onOut = (e: MouseEvent) => {
        if (!e.relatedTarget && e.clientY <= 0) fire();
      };
      document.addEventListener("mouseout", onOut);
      cleanups.push(() => document.removeEventListener("mouseout", onOut));
    }
    return () => {
      done = true;
      window.clearTimeout(waitTimer);
      cleanups.forEach((c) => c());
    };
  }, [armed, fired, trigger, delayMs, scrollAt]);
  return fired;
};

/** Height of the phone action bar pinned to the bottom, so edge popups sit above it. */
const useMobileBarOffset = (active: boolean): number => {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const bar = document.querySelector<HTMLElement>(".catalogue-mobile-action-bar");
      // A fixed element has no offsetParent, so read its box: md:hidden gives 0.
      const h = bar ? bar.getBoundingClientRect().height : 0;
      setOffset(Math.round(h));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);
  return offset;
};

/* ── pieces ──────────────────────────────────────────────────────────── */

type Tone = "onAccent" | "onCard";

const FALLBACK_ACCENT = "hsl(var(--palette-primary, var(--primary-500)))";

interface Look {
  accent: string;
  /** Text on the accent colour is light. */
  accentDark: boolean;
  gradient: string;
  tint: string;
  cardStyle: React.CSSProperties | undefined;
  textStyle: React.CSSProperties | undefined;
}

const buildLook = (accentColor?: string, backgroundColor?: string, textColor?: string): Look => {
  const accent = accentColor?.trim() || FALLBACK_ACCENT;
  return {
    accent,
    // No author accent = the institute's brand colour, which carries white text.
    accentDark: accentColor?.trim() ? isDarkHex(accentColor) : true,
    gradient: `linear-gradient(135deg, ${accent} 0%, color-mix(in srgb, ${accent} 62%, black) 100%)`,
    tint: `color-mix(in srgb, ${accent} 12%, transparent)`,
    cardStyle: backgroundColor?.trim() ? { backgroundColor } : undefined,
    textStyle: textColor?.trim() ? { color: textColor } : undefined,
  };
};

const Badge: React.FC<{ text?: string; tone: Tone; look: Look }> = ({ text, tone, look }) =>
  text ? (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
        tone === "onAccent" && "bg-white/20 text-white ring-1 ring-inset ring-white/30 backdrop-blur",
      )}
      style={tone === "onCard" ? { backgroundColor: look.tint, color: look.accent } : undefined}
    >
      <Lightning weight="fill" className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
    </span>
  ) : null;

const Countdown: React.FC<{ parts: CountdownParts | null; tone: Tone; compact?: boolean; className?: string }> = ({
  parts,
  tone,
  compact,
  className,
}) => {
  const { t } = useTranslation("coursePlayerA");
  if (!parts) return null;
  const units = [
    { key: "days", label: t("promoPopup.days"), value: parts.days },
    { key: "hours", label: t("promoPopup.hours"), value: parts.hours },
    { key: "minutes", label: t("promoPopup.mins"), value: parts.minutes },
    { key: "seconds", label: t("promoPopup.secs"), value: parts.seconds },
  ].filter((u) => u.key !== "days" || parts.days > 0);
  return (
    <div
      className={cn("flex items-center gap-2", compact ? "gap-1.5" : "justify-center", className)}
      role="timer"
      aria-label={t("promoPopup.endsIn")}
    >
      {units.map((u) => (
        <div
          key={u.key}
          className={cn(
            "flex flex-col items-center rounded-xl text-center",
            compact ? "min-w-10 px-1.5 py-1" : "min-w-14 px-2 py-2 sm:min-w-16",
            tone === "onAccent" ? "bg-black/25 text-white" : "bg-catalogue-bg-muted text-catalogue-text-primary",
          )}
        >
          <span className={cn("font-bold tabular-nums leading-none", compact ? "text-sm" : "text-xl sm:text-2xl")}>
            {String(u.value).padStart(2, "0")}
          </span>
          <span className={cn("mt-1 uppercase leading-none opacity-75", compact ? "text-2xs" : "text-xs")}>{u.label}</span>
        </div>
      ))}
    </div>
  );
};

/** Copies the coupon; falls back to a hidden textarea where the clipboard API is blocked. */
const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
};

const useCopy = (code: string) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  const copy = useCallback(() => {
    void copyText(code).then((ok) => ok && setCopied(true));
  }, [code]);
  return { copied, copy };
};

const Coupon: React.FC<{ code?: string; tone: Tone; look: Look; size?: "md" | "lg" | "chip" }> = ({
  code,
  tone,
  look,
  size = "md",
}) => {
  const { t } = useTranslation("coursePlayerA");
  const trimmed = (code || "").trim();
  const { copied, copy } = useCopy(trimmed);
  if (!trimmed) return null;
  const label = copied ? t("promoPopup.copied") : t("promoPopup.copy");
  const Icon = copied ? Check : Copy;

  if (size === "chip") {
    return (
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-white/60 bg-white/10 px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-white transition-colors hover:bg-white/20"
        aria-label={t("promoPopup.copyCode", { code: trimmed })}
      >
        {trimmed}
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="sr-only" aria-live="polite">
          {copied ? t("promoPopup.copied") : ""}
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border-2 border-dashed",
        size === "lg" ? "px-4 py-4" : "px-4 py-3",
        tone === "onAccent" && "border-white/50 bg-white/10",
      )}
      style={tone === "onCard" ? { borderColor: look.accent, backgroundColor: look.tint } : undefined}
    >
      <div className="min-w-0 text-start">
        <p className={cn("text-xs uppercase tracking-wider opacity-70", tone === "onAccent" && "text-white")}>
          {t("promoPopup.useCode")}
        </p>
        <p
          className={cn(
            "truncate font-mono font-black tracking-widest",
            size === "lg" ? "text-2xl sm:text-3xl" : "text-lg",
            tone === "onAccent" && "text-white",
          )}
          style={tone === "onCard" ? { color: look.accent } : undefined}
        >
          {trimmed}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition-transform active:scale-95",
          tone === "onAccent" || look.accentDark ? "text-white" : "text-catalogue-text-primary",
          tone === "onAccent" && "bg-white/20 hover:bg-white/30",
        )}
        style={tone === "onCard" ? { backgroundColor: look.accent } : undefined}
        aria-label={t("promoPopup.copyCode", { code: trimmed })}
      >
        <Icon className="size-4" weight="bold" aria-hidden="true" />
        <span aria-live="polite">{label}</span>
      </button>
    </div>
  );
};

/** Opens WhatsApp; counted as a lead like the button block's WhatsApp action. */
const openWhatsApp = (phone?: string, message?: string) => {
  const digits = whatsappDigits(phone);
  if (!digits) return;
  emitLeadCaptured({ sourceType: "WHATSAPP_CLICK", sourceId: "promoPopup" });
  window.open(
    `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`,
    "_blank",
    "noopener,noreferrer",
  );
};

const CtaButton: React.FC<{
  button?: PromoButtonConfig;
  look: Look;
  inverted?: boolean;
  size?: "md" | "sm";
  className?: string;
  isPreviewMode?: boolean;
  onConvert: () => void;
  /** A link button with no destination just closes the popup. */
  onDismiss: () => void;
}> = ({ button, look, inverted, size = "md", className, isPreviewMode, onConvert, onDismiss }) => {
  const text = (button?.text || "").trim();
  if (!text) return null;
  const classes = cn(
    "group inline-flex items-center justify-center gap-2 font-semibold shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    size === "md" ? "rounded-2xl px-6 py-3.5 text-base" : "rounded-xl px-4 py-2 text-sm",
    inverted ? "bg-white" : look.accentDark ? "text-white" : "text-catalogue-text-primary",
    className,
  );
  const style: React.CSSProperties = inverted ? { color: look.accent } : { background: look.gradient };
  const content = (
    <>
      <span className="truncate">{text}</span>
      <ArrowRight
        weight="bold"
        className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100"
        aria-hidden="true"
      />
    </>
  );

  // The editor preview never leaves the page or opens a form.
  if (isPreviewMode) {
    return (
      <button type="button" className={classes} style={style}>
        {content}
      </button>
    );
  }
  const action = button?.action || "link";
  const audienceId = (button?.audienceId || "").trim();
  if (action === "openForm" && audienceId) {
    return (
      <button
        type="button"
        className={classes}
        style={style}
        onClick={() => {
          onConvert();
          window.dispatchEvent(
            new CustomEvent("openAudienceForm", { detail: { audienceId, title: button?.formTitle || text } }),
          );
        }}
      >
        {content}
      </button>
    );
  }
  if (action === "whatsapp") {
    return (
      <button
        type="button"
        className={classes}
        style={style}
        onClick={() => {
          onConvert();
          openWhatsApp(button?.whatsappPhone, button?.whatsappMessage);
        }}
      >
        {content}
      </button>
    );
  }
  if (!(button?.url || "").trim()) {
    return (
      <button type="button" className={classes} style={style} onClick={onDismiss}>
        {content}
      </button>
    );
  }
  // CatalogueLink spreads extra props after its own onClick, so the close
  // rides on the capture phase and leaves its navigation alone.
  return (
    <CatalogueLink to={button?.url || ""} target={button?.target} className={classes} style={style} onClickCapture={onConvert}>
      {content}
    </CatalogueLink>
  );
};

const CloseButton: React.FC<{ onClose: () => void; tone: Tone; className?: string; autoFocusRef?: React.Ref<HTMLButtonElement> }> = ({
  onClose,
  tone,
  className,
  autoFocusRef,
}) => {
  const { t } = useTranslation("coursePlayerA");
  return (
    <button
      ref={autoFocusRef}
      type="button"
      onClick={onClose}
      aria-label={t("promoPopup.close")}
      className={cn(
        "z-10 inline-flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2",
        tone === "onAccent"
          ? "bg-black/20 text-white hover:bg-black/35 focus-visible:ring-white"
          : "bg-catalogue-bg-muted text-catalogue-text-secondary hover:bg-catalogue-interactive-hover focus-visible:ring-catalogue-border-strong",
        className,
      )}
    >
      <X weight="bold" className="size-4" aria-hidden="true" />
    </button>
  );
};

const Dismiss: React.FC<{ text?: string; onClose: () => void; light?: boolean }> = ({ text, onClose, light }) =>
  text?.trim() ? (
    <button
      type="button"
      onClick={onClose}
      className={cn(
        "mx-auto block text-sm underline-offset-4 hover:underline",
        light ? "text-white/75 hover:text-white" : "text-catalogue-text-muted",
      )}
    >
      {text}
    </button>
  ) : null;

const Footnote: React.FC<{ text?: string; light?: boolean }> = ({ text, light }) =>
  text?.trim() ? (
    <p className={cn("text-center text-xs", light ? "text-white/60" : "text-catalogue-text-muted")}>{text}</p>
  ) : null;

/* ── the six looks ───────────────────────────────────────────────────── */

interface ViewProps extends PromoPopupProps {
  look: Look;
  countdown: CountdownParts | null;
  titleId: string;
  onClose: () => void;
  onConvert: () => void;
  closeRef: React.Ref<HTMLButtonElement>;
}

const Blobs = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
    <div className="absolute -end-10 -top-12 size-44 rounded-full bg-white/15 blur-2xl" />
    <div className="absolute -bottom-16 -start-10 size-52 rounded-full bg-black/15 blur-3xl" />
    <div className="absolute end-24 top-16 size-2 rounded-full bg-white/60" />
    <div className="absolute start-10 top-20 size-1.5 rounded-full bg-white/50" />
    <div className="absolute bottom-10 end-16 size-1 rounded-full bg-white/70" />
  </div>
);

const SpotlightView: React.FC<ViewProps> = (p) => (
  <div
    className={cn("relative w-full max-w-md overflow-hidden rounded-3xl shadow-2xl", !p.look.cardStyle && "bg-catalogue-bg-elevated")}
    style={p.look.cardStyle}
  >
    <div className="relative px-6 pb-12 pt-10 text-center text-white" style={{ background: p.look.gradient }}>
      {p.image && (
        <>
          <img src={p.image} alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 opacity-85" style={{ background: p.look.gradient }} />
        </>
      )}
      <Blobs />
      <CloseButton onClose={p.onClose} tone="onAccent" className="absolute end-3 top-3" autoFocusRef={p.closeRef} />
      <div className="relative flex flex-col items-center gap-3">
        <Badge text={p.badge} tone="onAccent" look={p.look} />
        {p.highlight && (
          <p className="text-5xl font-black leading-none tracking-tight drop-shadow-sm sm:text-6xl">{p.highlight}</p>
        )}
        {p.heading && (
          <h2 id={p.titleId} className="text-xl font-bold leading-snug sm:text-2xl">
            {p.heading}
          </h2>
        )}
      </div>
    </div>
    <div
      className={cn(
        "relative -mt-6 flex flex-col gap-4 rounded-t-3xl px-6 pb-6 pt-6",
        !p.look.cardStyle && "bg-catalogue-bg-elevated",
        !p.look.textStyle && "text-catalogue-text-primary",
      )}
      style={{ ...p.look.cardStyle, ...p.look.textStyle }}
    >
      {p.body && <p className="text-center text-sm leading-relaxed opacity-80 sm:text-base">{p.body}</p>}
      <Countdown parts={p.countdown} tone="onCard" />
      <Coupon code={p.couponCode} tone="onCard" look={p.look} />
      <CtaButton button={p.button} look={p.look} className="w-full" isPreviewMode={p.isPreviewMode} onConvert={p.onConvert} onDismiss={p.onClose} />
      <Dismiss text={p.dismissText} onClose={p.onClose} />
      <Footnote text={p.footnote} />
    </div>
  </div>
);

const SplitView: React.FC<ViewProps> = (p) => (
  <div
    className={cn(
      "relative grid w-full max-w-3xl overflow-hidden rounded-3xl shadow-2xl md:grid-cols-2",
      !p.look.cardStyle && "bg-catalogue-bg-elevated",
    )}
    style={p.look.cardStyle}
  >
    <div className="relative h-44 overflow-hidden sm:h-56 md:h-auto md:min-h-96" style={{ background: p.look.gradient }}>
      {p.image ? (
        <img src={p.image} alt={p.imageAlt || ""} className="absolute inset-0 size-full object-cover" />
      ) : (
        <Blobs />
      )}
      {p.highlight && (
        <div
          className={cn(
            "absolute",
            p.image
              ? "bottom-4 start-4 rounded-2xl bg-white px-4 py-2 shadow-xl"
              : "inset-0 flex items-center justify-center px-6 text-center",
          )}
        >
          <p
            className={cn("font-black leading-none tracking-tight", p.image ? "text-2xl" : "text-5xl text-white sm:text-6xl")}
            style={p.image ? { color: p.look.accent } : undefined}
          >
            {p.highlight}
          </p>
        </div>
      )}
    </div>
    <div
      className={cn("relative flex flex-col gap-4 p-6 sm:p-8", !p.look.textStyle && "text-catalogue-text-primary")}
      style={p.look.textStyle}
    >
      <div className="flex items-start justify-between gap-3">
        <Badge text={p.badge} tone="onCard" look={p.look} />
        <CloseButton onClose={p.onClose} tone="onCard" className="-me-2 -mt-2 ms-auto" autoFocusRef={p.closeRef} />
      </div>
      {p.heading && (
        <h2 id={p.titleId} className="text-2xl font-bold leading-tight sm:text-3xl">
          {p.heading}
        </h2>
      )}
      {p.body && <p className="text-sm leading-relaxed opacity-80 sm:text-base">{p.body}</p>}
      <Countdown parts={p.countdown} tone="onCard" compact className="flex-wrap" />
      <Coupon code={p.couponCode} tone="onCard" look={p.look} />
      <div className="mt-auto flex flex-col gap-3 pt-2">
        <CtaButton button={p.button} look={p.look} className="w-full" isPreviewMode={p.isPreviewMode} onConvert={p.onConvert} onDismiss={p.onClose} />
        <Dismiss text={p.dismissText} onClose={p.onClose} />
        <Footnote text={p.footnote} />
      </div>
    </div>
  </div>
);

const PosterView: React.FC<ViewProps> = (p) => (
  <div
    className="relative flex min-h-96 w-full max-w-lg flex-col justify-end overflow-hidden rounded-3xl text-white shadow-2xl sm:min-h-reg-480"
    style={{ background: p.look.gradient }}
  >
    {p.image ? (
      <>
        <img src={p.image} alt={p.imageAlt || ""} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />
      </>
    ) : (
      <>
        <Blobs />
        <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-72 rounded-full border-8 border-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -start-20 size-56 rounded-full border-8 border-white/10" />
      </>
    )}
    <CloseButton onClose={p.onClose} tone="onAccent" className="absolute end-3 top-3" autoFocusRef={p.closeRef} />
    <div className="relative flex flex-col items-center gap-4 px-6 pb-7 pt-20 text-center sm:px-8">
      <Badge text={p.badge} tone="onAccent" look={p.look} />
      {p.highlight && (
        <p className="text-6xl font-black leading-none tracking-tight drop-shadow-lg sm:text-7xl">{p.highlight}</p>
      )}
      {p.heading && (
        <h2 id={p.titleId} className="text-2xl font-bold leading-tight drop-shadow sm:text-3xl">
          {p.heading}
        </h2>
      )}
      {p.body && <p className="max-w-sm text-sm leading-relaxed text-white/85 sm:text-base">{p.body}</p>}
      <Countdown parts={p.countdown} tone="onAccent" />
      {p.couponCode?.trim() && (
        <div className="w-full max-w-xs">
          <Coupon code={p.couponCode} tone="onAccent" look={p.look} />
        </div>
      )}
      <CtaButton button={p.button} look={p.look} inverted className="w-full max-w-xs" isPreviewMode={p.isPreviewMode} onConvert={p.onConvert} onDismiss={p.onClose} />
      <Dismiss text={p.dismissText} onClose={p.onClose} light />
      <Footnote text={p.footnote} light />
    </div>
  </div>
);

/** Cut-out notches on the ticket's tear line, punched with a mask so the dimmed page shows through. */
const notchMask = (edge: "top" | "bottom"): React.CSSProperties => {
  const y = edge === "bottom" ? "100%" : "0";
  const mask = `radial-gradient(circle at 0 ${y}, transparent 14px, black 14.5px) left / 51% 100% no-repeat, radial-gradient(circle at 100% ${y}, transparent 14px, black 14.5px) right / 51% 100% no-repeat`;
  return { WebkitMask: mask, mask };
};

const TicketView: React.FC<ViewProps> = (p) => {
  const surface = cn(!p.look.cardStyle && "bg-catalogue-bg-elevated", !p.look.textStyle && "text-catalogue-text-primary");
  const surfaceStyle = { ...p.look.cardStyle, ...p.look.textStyle };
  return (
    <div className="relative w-full max-w-md drop-shadow-2xl">
      <div className={cn("relative rounded-t-3xl px-6 pb-7 pt-8 text-center", surface)} style={{ ...surfaceStyle, ...notchMask("bottom") }}>
        <CloseButton onClose={p.onClose} tone="onCard" className="absolute end-3 top-3" autoFocusRef={p.closeRef} />
        <div className="flex flex-col items-center gap-3">
          <span
            className="flex size-14 items-center justify-center rounded-2xl text-white shadow-lg"
            style={{ background: p.look.gradient }}
            aria-hidden="true"
          >
            <Ticket weight="fill" className="size-7" />
          </span>
          <Badge text={p.badge} tone="onCard" look={p.look} />
          {p.highlight && (
            <p className="text-4xl font-black leading-none tracking-tight sm:text-5xl" style={{ color: p.look.accent }}>
              {p.highlight}
            </p>
          )}
          {p.heading && (
            <h2 id={p.titleId} className="text-xl font-bold leading-snug sm:text-2xl">
              {p.heading}
            </h2>
          )}
          {p.body && <p className="text-sm leading-relaxed opacity-80">{p.body}</p>}
        </div>
      </div>
      <div className={cn("relative rounded-b-3xl px-6 pb-6 pt-6", surface)} style={{ ...surfaceStyle, ...notchMask("top") }}>
        <div aria-hidden="true" className="absolute inset-x-6 top-0 border-t-2 border-dashed border-catalogue-border" />
        <div className="flex flex-col gap-4">
          <Coupon code={p.couponCode} tone="onCard" look={p.look} size="lg" />
          <Countdown parts={p.countdown} tone="onCard" compact className="justify-center" />
          <CtaButton button={p.button} look={p.look} className="w-full" isPreviewMode={p.isPreviewMode} onConvert={p.onConvert} onDismiss={p.onClose} />
          <Dismiss text={p.dismissText} onClose={p.onClose} />
          <Footnote text={p.footnote} />
        </div>
      </div>
    </div>
  );
};

const CornerView: React.FC<ViewProps> = (p) => (
  <div
    className={cn(
      "relative w-full overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/5 sm:w-96",
      !p.look.cardStyle && "bg-catalogue-bg-elevated",
      !p.look.textStyle && "text-catalogue-text-primary",
    )}
    style={{ ...p.look.cardStyle, ...p.look.textStyle }}
  >
    {p.image ? (
      <div className="relative h-32 overflow-hidden">
        <img src={p.image} alt={p.imageAlt || ""} className="size-full object-cover" />
        {p.highlight && (
          <span
            className="absolute bottom-3 start-3 rounded-xl px-3 py-1 text-lg font-black text-white shadow-lg"
            style={{ background: p.look.gradient }}
          >
            {p.highlight}
          </span>
        )}
      </div>
    ) : (
      <div className="h-1.5" style={{ background: p.look.gradient }} />
    )}
    <div className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <Badge text={p.badge} tone="onCard" look={p.look} />
          {!p.image && p.highlight && (
            <p className="text-3xl font-black leading-none tracking-tight" style={{ color: p.look.accent }}>
              {p.highlight}
            </p>
          )}
        </div>
        <CloseButton onClose={p.onClose} tone="onCard" className="-me-1 -mt-1 size-8" autoFocusRef={p.closeRef} />
      </div>
      {p.heading && (
        <h2 id={p.titleId} className="text-lg font-bold leading-snug">
          {p.heading}
        </h2>
      )}
      {p.body && <p className="line-clamp-3 text-sm leading-relaxed opacity-80">{p.body}</p>}
      <Countdown parts={p.countdown} tone="onCard" compact />
      <Coupon code={p.couponCode} tone="onCard" look={p.look} />
      <CtaButton button={p.button} look={p.look} size="sm" className="w-full py-2.5" isPreviewMode={p.isPreviewMode} onConvert={p.onConvert} onDismiss={p.onClose} />
      <Footnote text={p.footnote} />
    </div>
  </div>
);

const BarView: React.FC<ViewProps> = (p) => (
  <div className="relative w-full text-white shadow-2xl" style={{ background: p.look.gradient }}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-10 start-1/4 size-32 rounded-full bg-white/10 blur-2xl" />
    </div>
    <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 py-3 pe-14 ps-4 md:flex-nowrap md:ps-6">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3 md:basis-auto">
        {p.highlight && (
          <span className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-base font-black leading-none ring-1 ring-inset ring-white/30">
            {p.highlight}
          </span>
        )}
        <div className="min-w-0">
          {p.heading && (
            <p id={p.titleId} className="line-clamp-2 text-sm font-semibold leading-snug md:truncate md:text-base">
              {p.heading}
            </p>
          )}
          {p.body && <p className="hidden truncate text-xs text-white/80 lg:block">{p.body}</p>}
        </div>
      </div>
      <Countdown parts={p.countdown} tone="onAccent" compact className="shrink-0" />
      <Coupon code={p.couponCode} tone="onAccent" look={p.look} size="chip" />
      <CtaButton
        button={p.button}
        look={p.look}
        inverted
        size="sm"
        className="ms-auto shrink-0 shadow-md"
        isPreviewMode={p.isPreviewMode}
        onConvert={p.onConvert} onDismiss={p.onClose}
      />
    </div>
    <CloseButton onClose={p.onClose} tone="onAccent" className="absolute end-3 top-3 size-8 md:top-1/2 md:-translate-y-1/2" autoFocusRef={p.closeRef} />
  </div>
);

const CUSTOM_WIDTH: Record<string, string> = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl" };

/** First element on the click's path (through the shadow boundary) carrying data-vacademy. */
const hookTarget = (event: Event): HTMLElement | null => {
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement && node.hasAttribute("data-vacademy")) return node;
  }
  return null;
};

/**
 * The custom template: the admin's own HTML + <style>, in a shadow root through
 * the same safety layer as the Custom HTML section (no scripts, forms or
 * iframes; CSS scoped to the popup). The popup keeps its frame — ✕, Escape,
 * triggers, frequency — and the markup gets hooks:
 *   data-vacademy="close"                          closes the popup
 *   data-vacademy="copy" data-target="CODE"        copies CODE
 *   data-vacademy="countdown"                      time left to "Offer ends at"
 *   data-vacademy="route" data-route="courses"     a page of this site
 *   data-vacademy="lead-form" data-audience="ID"   a campaign's form
 *   data-vacademy="link" data-href="https://…"     an outside link, new tab
 * Following any link or hook other than close/copy counts as taking the offer.
 */
const CustomView: React.FC<ViewProps> = (p) => {
  const { t } = useTranslation("coursePlayerA");
  const hostRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  // The render effect keys on the markup only; everything else is read live.
  const live = useRef({ ...p, navigate, copied: t("promoPopup.copied") });
  live.current = { ...p, navigate, copied: t("promoPopup.copied") };
  const source = typeof p.html === "string" ? p.html : "";

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const { html, css } = splitHtmlAndCss(source);
    renderHtmlSection(host, html, css);
    const root = host.shadowRoot;
    if (!root) return;

    const unbind = bindHtmlActions(root, (action) => {
      const c = live.current;
      if (c.isPreviewMode || action.kind === "scroll") return;
      c.onConvert();
      if (action.kind === "route") {
        const [path, query] = action.route.split("?");
        const search = query ? Object.fromEntries(new URLSearchParams(query)) : undefined;
        void c.navigate({ to: RouteMatcher.pagePath(c.tagName || "", path || ""), ...(search ? { search } : {}) } as never);
      } else if (action.kind === "lead-form" && action.audienceId) {
        window.dispatchEvent(new CustomEvent("openAudienceForm", { detail: { audienceId: action.audienceId } }));
      } else if (action.kind === "enrol" && action.courseId) {
        void c.navigate({ to: RouteMatcher.pagePath(c.tagName || "", action.courseId) } as never);
      } else if (action.kind === "link") {
        window.open(action.href, "_blank", "noopener,noreferrer");
      }
    });

    const onClick = (event: Event) => {
      const c = live.current;
      const el = hookTarget(event);
      const verb = el?.getAttribute("data-vacademy");
      if (el && verb === "close") {
        event.preventDefault();
        c.onClose();
        return;
      }
      if (el && verb === "copy") {
        event.preventDefault();
        const code = el.getAttribute("data-target") || "";
        if (!code) return;
        void copyText(code).then((ok) => {
          if (!ok || el.dataset.promoCopying) return;
          el.dataset.promoCopying = "1";
          // innerHTML, not textContent: the button may hold an icon. It is the
          // already-sanitized markup going back where it was.
          const before = el.innerHTML;
          el.textContent = c.copied;
          window.setTimeout(() => {
            el.innerHTML = before;
            delete el.dataset.promoCopying;
          }, 2000);
        });
        return;
      }
      // A plain <a href>: the preview never leaves the page; the live site counts it.
      const anchor = event.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && !!n.getAttribute("href"));
      if (anchor && !el) {
        if (c.isPreviewMode) event.preventDefault();
        else c.onConvert();
      }
    };
    root.addEventListener("click", onClick);

    const timers = root.querySelectorAll<HTMLElement>('[data-vacademy="countdown"]');
    let tick: number | undefined;
    if (timers.length) {
      const paint = () => {
        const end = parsePromoDate(live.current.endDate);
        const parts = end === null ? null : countdownParts(end, Date.now());
        timers.forEach((node) => {
          node.textContent = parts ? formatCountdown(parts) : "";
        });
      };
      paint();
      tick = window.setInterval(paint, 1000);
    }
    return () => {
      unbind();
      root.removeEventListener("click", onClick);
      window.clearInterval(tick);
    };
  }, [source]);

  const width = CUSTOM_WIDTH[typeof p.customWidth === "string" ? p.customWidth : ""] ?? CUSTOM_WIDTH.md;
  return (
    <div className={cn("relative w-full overflow-hidden rounded-3xl bg-catalogue-bg-elevated text-catalogue-text-primary shadow-2xl", width)}>
      <CloseButton
        onClose={p.onClose}
        tone="onAccent"
        className="absolute end-3 top-3 bg-black/45 backdrop-blur hover:bg-black/60"
        autoFocusRef={p.closeRef}
      />
      {source.trim() ? (
        <div ref={hostRef} className="catalogue-html-section" />
      ) : (
        <p className="px-6 py-16 text-center text-sm text-catalogue-text-muted">{t("promoPopup.customEmpty")}</p>
      )}
    </div>
  );
};

const VIEWS: Record<PromoTemplate, React.FC<ViewProps>> = {
  spotlight: SpotlightView,
  split: SplitView,
  poster: PosterView,
  ticket: TicketView,
  corner: CornerView,
  bar: BarView,
  custom: CustomView,
};

/* ── shell: dialog behaviour around a look ───────────────────────────── */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable elements in document order, reaching into the custom template's shadow root. */
const focusablesIn = (root: ParentNode): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(`${FOCUSABLE}, .catalogue-html-section`)).flatMap((el) =>
    el.shadowRoot ? focusablesIn(el.shadowRoot) : el.matches(FOCUSABLE) ? [el] : [],
  );

/** The focused element itself, not the shadow host that document.activeElement reports. */
const deepActiveElement = (): Element | null => {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
};

const PopupShell: React.FC<{
  template: PromoTemplate;
  titleId: string;
  hasTitle: boolean;
  closeOnBackdrop: boolean;
  bottomOffset: number;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ template, titleId, hasTitle, closeOnBackdrop, bottomOffset, onClose, children }) => {
  const { t } = useTranslation("coursePlayerA");
  const modal = MODAL_TEMPLATES.has(template);
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape closes every look; the dialogs also keep Tab inside themselves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // The corner card and bar leave the page usable: Escape there belongs
        // to whatever the visitor is in (a search box, a menu) unless it is the popup.
        if (!modal && !panelRef.current?.contains(document.activeElement)) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (!modal || e.key !== "Tab" || !panelRef.current) return;
      const items = focusablesIn(panelRef.current);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = deepActiveElement();
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal, onClose]);

  // A dialog freezes the page behind it; the corner card and bar do not.
  useEffect(() => {
    if (!modal) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [modal]);

  const labelProps = hasTitle ? { "aria-labelledby": titleId } : { "aria-label": t("promoPopup.dialogLabel") };

  if (modal) {
    return (
      <div className="fixed inset-0 z-60 overflow-y-auto" data-promo-popup={template}>
        <div
          aria-hidden="true"
          className="fixed inset-0 bg-black/60 backdrop-blur-sm duration-300 animate-in fade-in motion-reduce:animate-none"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <div
          // Click-through: a click beside the card reaches the backdrop below.
          className="pointer-events-none relative flex min-h-full items-center justify-center p-4 sm:p-6"
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            {...labelProps}
            className="pointer-events-auto flex w-full justify-center duration-300 animate-in fade-in zoom-in-95 slide-in-from-bottom-4 motion-reduce:animate-none"
          >
            {children}
          </div>
        </div>
      </div>
    );
  }

  const edgeStyle = { "--promo-bottom": `${bottomOffset}px` } as React.CSSProperties;
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      {...labelProps}
      data-promo-popup={template}
      style={edgeStyle}
      className={cn(
        "fixed z-60 duration-500 animate-in fade-in slide-in-from-bottom-8 motion-reduce:animate-none",
        template === "bar"
          ? "inset-x-0 bottom-[var(--promo-bottom)] md:bottom-0" // design-lint-ignore: sits above the phone action bar, measured at runtime
          : "inset-x-3 bottom-[calc(var(--promo-bottom)+0.75rem)] sm:inset-x-auto sm:start-5 md:bottom-5", // design-lint-ignore: sits above the phone action bar, measured at runtime
      )}
    >
      {children}
    </div>
  );
};

/* ── the block ───────────────────────────────────────────────────────── */

export const PromoPopup: React.FC<PromoPopupProps> = (props) => {
  const {
    componentId,
    instituteId,
    isPreviewMode = false,
    showPreviewStrip = false,
    isSelected = false,
    startDate,
    endDate,
    showCountdown = true,
    closeOnBackdrop = true,
  } = props;
  const template = normalizeTemplate(props.template);
  const frequency = normalizeFrequency(props.frequency);
  const trigger = normalizeTrigger(props.trigger);
  const devices = normalizeDevices(props.devices);
  const delayMs = clampNumber(props.delaySeconds, 0, 120, 3) * 1000;
  const scrollAt = clampNumber(props.scrollPercent, 5, 100, 40);
  const storageKey = promoStorageKey(instituteId, componentId);
  const end = parsePromoDate(endDate);

  // Live: decided once on mount, so a visitor mid-page is never re-evaluated.
  const [eligible] = useState(() => {
    if (isPreviewMode || typeof window === "undefined") return false;
    // A custom popup with nothing in it would be an empty box.
    if (template === "custom" && !splitHtmlAndCss(props.html).html) return false;
    if (!isWithinSchedule(startDate, endDate, Date.now())) return false;
    if (devices !== "all" && (devices === "desktop") !== isDesktopWidth()) return false;
    return canShowAgain(frequency, storageKey, Date.now(), browserStores());
  });
  const fired = usePromoTrigger(eligible, trigger, delayMs, scrollAt);
  const [closed, setClosed] = useState(false);

  // Preview: open while selected; closing it hides it until it is selected again.
  const [previewClosed, setPreviewClosed] = useState(false);
  useEffect(() => {
    if (!isSelected) setPreviewClosed(false);
  }, [isSelected]);

  const open = isPreviewMode ? isSelected && !previewClosed : eligible && fired && !closed;
  // Time left runs whenever there is an end date — it also decides expiry, so
  // switching the countdown display off must not make the offer look ended.
  const timeLeft = useCountdown(end, !open);
  const countdown = showCountdown ? timeLeft : null;
  // The offer ran out while it was on screen.
  const expired = !isPreviewMode && end !== null && open && timeLeft === null;
  const visible = open && !expired;

  const restoreFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!visible) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    // Dialogs take focus; the corner card and bar leave it where the visitor is.
    if (MODAL_TEMPLATES.has(template)) closeRef.current?.focus({ preventScroll: true });
    return () => {
      const prev = restoreFocus.current;
      if (prev && typeof prev.focus === "function" && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, [visible, template]);

  const close = useCallback(() => {
    if (isPreviewMode) {
      setPreviewClosed(true);
      return;
    }
    rememberSeen(frequency, storageKey, Date.now(), browserStores());
    setClosed(true);
  }, [isPreviewMode, frequency, storageKey]);

  const convert = useCallback(() => {
    if (isPreviewMode) return;
    rememberSeen(frequency, storageKey, Date.now(), browserStores(), true);
    setClosed(true);
  }, [isPreviewMode, frequency, storageKey]);

  const bottomOffset = useMobileBarOffset(visible && !MODAL_TEMPLATES.has(template));
  const titleId = useId();
  // Where the popup mounts: the theme wrapper around this block, else <body>.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) setHost((node.closest("[data-catalogue-theme]") as HTMLElement | null) ?? document.body);
  }, []);
  const look = buildLook(props.accentColor, props.backgroundColor, props.textColor);
  const View = VIEWS[template];

  const strip = isPreviewMode && showPreviewStrip ? (
    <PreviewStrip template={template} trigger={trigger} delayMs={delayMs} scrollAt={scrollAt} frequency={frequency} />
  ) : null;

  const popup =
    visible && host
      ? createPortal(
          <PopupShell
            template={template}
            titleId={titleId}
            hasTitle={template !== "custom" && !!props.heading}
            closeOnBackdrop={closeOnBackdrop}
            bottomOffset={bottomOffset}
            onClose={close}
          >
            <View
              {...props}
              countdown={countdown}
              look={look}
              titleId={titleId}
              onClose={close}
              onConvert={convert}
              closeRef={closeRef}
            />
          </PopupShell>,
          host,
        )
      : null;

  return (
    <>
      <span ref={anchorRef} hidden />
      {strip}
      {popup}
    </>
  );
};

/** Editor preview only: where the popup block sits, and when it will open. */
const PreviewStrip: React.FC<{
  template: PromoTemplate;
  trigger: ReturnType<typeof normalizeTrigger>;
  delayMs: number;
  scrollAt: number;
  frequency: ReturnType<typeof normalizeFrequency>;
}> = ({ template, trigger, delayMs, scrollAt, frequency }) => {
  const { t } = useTranslation("coursePlayerA");
  const when =
    trigger === "scroll"
      ? t("promoPopup.whenScroll", { percent: scrollAt })
      : trigger === "exit"
        ? t("promoPopup.whenExit")
        : delayMs === 0
          ? t("promoPopup.whenLoad")
          : t("promoPopup.whenDelay", { seconds: delayMs / 1000 });
  return (
    <div className="mx-auto my-2 flex max-w-5xl items-center gap-3 rounded-catalogue-md border border-dashed border-catalogue-border-strong bg-catalogue-bg-subtle px-4 py-3 text-sm text-catalogue-text-secondary">
      <Megaphone weight="duotone" className="size-5 shrink-0 text-palette-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-catalogue-text-primary">
          {t("promoPopup.previewTitle", { template: t(`promoPopup.template.${template}`) })}
        </span>
        {" · "}
        {when}
        {" · "}
        {t(`promoPopup.frequency.${frequency}`)}
      </span>
      <span className="hidden shrink-0 text-xs text-catalogue-text-muted sm:inline">{t("promoPopup.previewHint")}</span>
    </div>
  );
};

export default PromoPopup;
