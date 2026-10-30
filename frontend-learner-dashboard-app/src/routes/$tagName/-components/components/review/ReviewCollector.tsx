import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChatCircleText, Star, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  browserStores,
  canShowAgain,
  clampNumber,
  normalizeDevices,
  normalizeFrequency,
  normalizeTrigger,
  promoStorageKey,
  rememberSeen,
} from "../../../-utils/promo-popup";
import {
  hasSubmittedReview,
  markReviewSubmitted,
  normalizeButtonStyle,
  normalizeDisplay,
  normalizeFormFields,
  normalizePopupStyle,
  normalizePosition,
  opensByItself,
  showsLauncher,
  type ReviewButtonStyle,
  type ReviewPosition,
} from "../../../-utils/review-collector";
import { focusablesIn, isDesktopWidth, useMobileBarOffset, usePromoTrigger } from "../promo/PromoPopup";
import { ReviewForm, type ReviewFormLabels } from "./ReviewForm";
import "./review-collector.css";

/**
 * Reviews & feedback — the page-builder block "reviewCollector": asks site
 * visitors for a star rating and a short review. What they send waits for the
 * admin (Website Builder → Reviews); approved reviews can then show in any
 * testimonials section set to read them.
 *
 * How it asks (`display`):
 *   floatingPopup  a launcher button that stays + the form opening by itself once
 *   floating       the launcher only
 *   popup          the form opening by itself only (delay / scroll / exit intent)
 *   inline         the form in the page flow, like any section
 *
 * The launcher (`buttonStyle` pill | icon | tab) and the corner card sit at
 * `position`; the self-opening form is a centred dialog or a corner card
 * (`popupStyle`). Trigger, delay and how often it may open again reuse the
 * promo popup's rules. Once a visitor has sent a review the form never opens
 * by itself again, and the launcher hides unless `hideAfterSubmit` is off.
 *
 * Rendered through a portal into the site's theme wrapper, like the promo
 * popup, so the site's colours and radius apply and no section can clip it.
 */

export interface ReviewCollectorProps extends ReviewFormLabels {
  componentId: string;
  instituteId: string;
  tagName?: string;
  pageRoute?: string;
  isPreviewMode?: boolean;
  /** Editor preview with its own marks: draw the in-flow strip. */
  showPreviewStrip?: boolean;
  /** Editor preview: this block is the selected one, so its form is open. */
  isSelected?: boolean;
  display?: string;
  position?: string;
  buttonStyle?: string;
  popupStyle?: string;
  buttonLabel?: string;
  trigger?: string;
  delaySeconds?: number | string;
  scrollPercent?: number | string;
  frequency?: string;
  devices?: string;
  hideAfterSubmit?: boolean;
  /** The form's fields in order (see normalizeFormFields); absent on blocks saved before the builder. */
  formFields?: unknown;
  /* older blocks: per-field modes, labels and course choices */
  fields?: unknown;
  courseOptions?: unknown;
  nameLabel?: string;
  textLabel?: string;
  textPlaceholder?: string;
  cityLabel?: string;
  courseLabel?: string;
  designationLabel?: string;
  /** Inline only. */
  backgroundColor?: string;
}

const sideOf = (p: ReviewPosition): "left" | "right" => (p.endsWith("left") ? "left" : "right");

/* ── launcher ────────────────────────────────────────────────────────── */

const Launcher: React.FC<{
  style: ReviewButtonStyle;
  position: ReviewPosition;
  label: string;
  expanded: boolean;
  onOpen: () => void;
  bottomOffset: number;
}> = ({ style, position, label, expanded, onOpen, bottomOffset }) => {
  const anchorStyle = { "--review-bottom": `${bottomOffset}px` } as React.CSSProperties;
  // A tab belongs on a side edge; at a bottom corner it reads as a pill.
  const effective: ReviewButtonStyle = style === "tab" && position.startsWith("bottom") ? "pill" : style;
  const side = sideOf(position);
  return (
    <div
      className={cn("review-anchor", `review-anchor--${position}`, effective !== "tab" && "review-anchor--floating")}
      style={anchorStyle}
      data-review-launcher={effective}
    >
      {effective === "tab" ? (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          className={cn(
            "flex flex-col items-center gap-2 bg-primary-500 px-2 py-4 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
            side === "right" ? "rounded-l-catalogue-md" : "rounded-r-catalogue-md"
          )}
        >
          <Star size={18} weight="fill" aria-hidden="true" />
          <span className="review-tab-label">{label}</span>
        </button>
      ) : effective === "icon" ? (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          aria-label={label}
          title={label}
          className="flex size-14 items-center justify-center rounded-full bg-primary-500 text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          <Star size={26} weight="fill" aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          aria-expanded={expanded}
          className="catalogue-btn catalogue-btn-primary rounded-full shadow-lg"
        >
          <Star size={18} weight="fill" aria-hidden="true" /> {label}
        </button>
      )}
    </div>
  );
};

/* ── panel (dialog or corner card) ───────────────────────────────────── */

const Panel: React.FC<{
  corner: boolean;
  side: "left" | "right";
  titleId: string;
  bottomOffset: number;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ corner, side, titleId, bottomOffset, onClose, children }) => {
  const { t } = useTranslation("coursePlayerB");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!corner) closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (corner && !panelRef.current?.contains(document.activeElement)) return;
        e.stopPropagation();
        onClose();
        return;
      }
      if (corner || e.key !== "Tab" || !panelRef.current) return;
      const items = focusablesIn(panelRef.current);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    let restoreOverflow: (() => void) | undefined;
    if (!corner) {
      const root = document.documentElement;
      const before = root.style.overflow;
      root.style.overflow = "hidden";
      restoreOverflow = () => {
        root.style.overflow = before;
      };
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreOverflow?.();
      if (previous && typeof previous.focus === "function" && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [corner, onClose]);

  const card = (
    <div className="catalogue-card relative w-full bg-catalogue-bg p-6 shadow-xl sm:p-7">
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={t("reviewCollector.close")}
        className="absolute end-3 top-3 rounded-full p-1.5 text-catalogue-text-muted transition-colors hover:bg-catalogue-bg-subtle hover:text-catalogue-text-primary"
      >
        <X size={18} aria-hidden="true" />
      </button>
      {children}
    </div>
  );

  if (corner) {
    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        className={cn("review-corner duration-300 animate-in fade-in slide-in-from-bottom-6 motion-reduce:animate-none", `review-corner--${side}`)}
        style={{ "--review-bottom": `${bottomOffset}px` } as React.CSSProperties} // design-lint-ignore: phone action bar height, measured at runtime
        data-review-panel="corner"
      >
        {card}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-60 overflow-y-auto" data-review-panel="modal">
      <div
        aria-hidden="true"
        className="fixed inset-0 bg-black/60 backdrop-blur-sm duration-300 animate-in fade-in motion-reduce:animate-none"
        onClick={onClose}
      />
      <div className="pointer-events-none relative flex min-h-full items-center justify-center p-4 sm:p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto w-full max-w-md duration-300 animate-in fade-in zoom-in-95 slide-in-from-bottom-4 motion-reduce:animate-none"
        >
          {card}
        </div>
      </div>
    </div>
  );
};

/* ── the block ───────────────────────────────────────────────────────── */

export const ReviewCollector: React.FC<ReviewCollectorProps> = (props) => {
  const {
    componentId, instituteId, tagName, pageRoute, isPreviewMode = false, showPreviewStrip = false, isSelected = false,
    hideAfterSubmit = true, backgroundColor,
  } = props;
  const { t } = useTranslation("coursePlayerB");
  const display = normalizeDisplay(props.display);
  const position = normalizePosition(props.position);
  const buttonStyle = normalizeButtonStyle(props.buttonStyle);
  const popupStyle = normalizePopupStyle(props.popupStyle);
  const trigger = normalizeTrigger(props.trigger);
  const frequency = normalizeFrequency(props.frequency ?? "once");
  const devices = normalizeDevices(props.devices);
  const delayMs = clampNumber(props.delaySeconds, 0, 120, 5) * 1000;
  const scrollAt = clampNumber(props.scrollPercent, 5, 100, 40);
  const fields = normalizeFormFields(props as unknown as Record<string, unknown>);
  const storageKey = promoStorageKey(instituteId, `review-${componentId}`);
  const titleId = useId();

  // Decided once on mount, like the promo popup.
  const [submittedBefore] = useState(() =>
    !isPreviewMode && typeof window !== "undefined" && hasSubmittedReview(instituteId)
  );
  const [deviceOk] = useState(() => {
    if (typeof window === "undefined") return false;
    if (isPreviewMode || devices === "all") return true;
    return (devices === "desktop") === isDesktopWidth();
  });
  const [autoEligible] = useState(
    () =>
      !isPreviewMode &&
      typeof window !== "undefined" &&
      deviceOk &&
      opensByItself(display) &&
      !submittedBefore &&
      canShowAgain(frequency, storageKey, Date.now(), browserStores())
  );
  const fired = usePromoTrigger(autoEligible, trigger, delayMs, scrollAt);

  const [openedBy, setOpenedBy] = useState<"none" | "auto" | "launcher">("none");
  const [autoDone, setAutoDone] = useState(false);
  const [submittedNow, setSubmittedNow] = useState(false);
  useEffect(() => {
    if (fired && !autoDone && openedBy === "none") setOpenedBy("auto");
  }, [fired, autoDone, openedBy]);

  // Preview: open while selected; closing hides it until it is selected again.
  const [previewClosed, setPreviewClosed] = useState(false);
  useEffect(() => {
    if (!isSelected) setPreviewClosed(false);
  }, [isSelected]);

  const isOpen = isPreviewMode ? isSelected && !previewClosed && display !== "inline" : openedBy !== "none";

  const close = useCallback(() => {
    if (isPreviewMode) {
      setPreviewClosed(true);
      return;
    }
    if (openedBy === "auto") {
      rememberSeen(frequency, storageKey, Date.now(), browserStores());
      setAutoDone(true);
    }
    setOpenedBy("none");
  }, [isPreviewMode, openedBy, frequency, storageKey]);

  const onSubmitted = useCallback(() => {
    markReviewSubmitted(instituteId);
    rememberSeen(frequency, storageKey, Date.now(), browserStores(), true);
    setAutoDone(true);
    setSubmittedNow(true);
  }, [instituteId, frequency, storageKey]);

  const launcherVisible =
    showsLauncher(display) && deviceOk && !((submittedBefore || submittedNow) && hideAfterSubmit && openedBy === "none");
  const bottomOffset = useMobileBarOffset((launcherVisible || (isOpen && popupStyle === "corner")) && !isPreviewMode);

  const [host, setHost] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback((node: HTMLSpanElement | null) => {
    if (node) setHost((node.closest("[data-catalogue-theme]") as HTMLElement | null) ?? document.body);
  }, []);

  const form = (
    <ReviewForm
      {...props}
      instituteId={instituteId}
      tagName={tagName}
      pageRoute={pageRoute}
      fields={fields}
      isPreviewMode={isPreviewMode}
      titleId={titleId}
      onSubmitted={onSubmitted}
    />
  );

  if (display === "inline") {
    return (
      <section
        className="catalogue-section bg-catalogue-bg"
        style={backgroundColor ? { backgroundColor } : undefined} // design-lint-ignore: admin-picked section colour
        data-review-collector="inline"
        aria-labelledby={titleId}
      >
        <div className="catalogue-shell">
          <div className="catalogue-card mx-auto w-full max-w-xl p-6 sm:p-8">{form}</div>
        </div>
      </section>
    );
  }

  const label = props.buttonLabel || t("reviewCollector.buttonLabel");
  // The launcher's own panel follows popupStyle too; a self-opened modal is always centred.
  const corner = popupStyle === "corner";

  const overlay = host
    ? createPortal(
        <>
          {launcherVisible && !isOpen && (
            <Launcher
              style={buttonStyle}
              position={position}
              label={label}
              expanded={isOpen}
              bottomOffset={bottomOffset}
              onOpen={() => {
                if (isPreviewMode) {
                  setPreviewClosed(false);
                  return;
                }
                setOpenedBy("launcher");
              }}
            />
          )}
          {isOpen && (
            <Panel corner={corner} side={sideOf(position)} titleId={titleId} bottomOffset={bottomOffset} onClose={close}>
              {form}
            </Panel>
          )}
        </>,
        host
      )
    : null;

  return (
    <>
      <span ref={anchorRef} hidden />
      {isPreviewMode && showPreviewStrip && (
        <PreviewStrip display={display} trigger={trigger} delayMs={delayMs} scrollAt={scrollAt} frequency={frequency} />
      )}
      {overlay}
    </>
  );
};

/** Editor preview only: where the block sits, and how it asks. */
const PreviewStrip: React.FC<{
  display: ReturnType<typeof normalizeDisplay>;
  trigger: ReturnType<typeof normalizeTrigger>;
  delayMs: number;
  scrollAt: number;
  frequency: ReturnType<typeof normalizeFrequency>;
}> = ({ display, trigger, delayMs, scrollAt, frequency }) => {
  const { t } = useTranslation("coursePlayerB");
  const { t: tPromo } = useTranslation("coursePlayerA");
  const when =
    trigger === "scroll"
      ? tPromo("promoPopup.whenScroll", { percent: scrollAt })
      : trigger === "exit"
        ? tPromo("promoPopup.whenExit")
        : delayMs === 0
          ? tPromo("promoPopup.whenLoad")
          : tPromo("promoPopup.whenDelay", { seconds: delayMs / 1000 });
  return (
    <div className="mx-auto my-2 flex max-w-5xl items-center gap-3 rounded-catalogue-md border border-dashed border-catalogue-border-strong bg-catalogue-bg-subtle px-4 py-3 text-sm text-catalogue-text-secondary">
      <ChatCircleText weight="duotone" className="size-5 shrink-0 text-palette-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold text-catalogue-text-primary">
          {t("reviewCollector.previewTitle")} · {t(`reviewCollector.display.${display}`)}
        </span>
        {opensByItself(display) && (
          <>
            {" · "}
            {when}
            {" · "}
            {tPromo(`promoPopup.frequency.${frequency}`)}
          </>
        )}
      </span>
      <span className="hidden shrink-0 text-xs text-catalogue-text-muted sm:inline">{t("reviewCollector.previewHint")}</span>
    </div>
  );
};

export default ReviewCollector;
