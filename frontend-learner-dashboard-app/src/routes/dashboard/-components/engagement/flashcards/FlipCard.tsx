import { forwardRef, useRef, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
  type Variants,
} from "framer-motion";
import { ArrowsClockwise, CheckCircle, Lightbulb, Repeat } from "@phosphor-icons/react";
import type { EngagementFlashcard } from "@/services/engagement";
import { ecn, skinClasses } from "../engagement-tone";
import {
  FLASHCARD_FLICK_MIN_PX,
  FLASHCARD_FLICK_VELOCITY,
  FLASHCARD_SWIPE_PX,
} from "./use-flashcard-session";

/**
 * One flashcard on the study stage (flashcards spec B2).
 *
 * - The card is a real `button`: a tap, a click, Space or Enter flips it.
 * - After the first flip it can be swiped: further than 80 px, or a fast flick,
 *   rates it towards the side it went to ON SCREEN. `end` is the Got it side
 *   (the rating buttons sit Still learning, Got it in reading order), so in RTL
 *   a swipe to the left is Got it. `touch-pan-y` keeps vertical page scroll.
 * - Motion: a rotateY flip (two 150 ms halves) and a fly-out on rating, both
 *   only when motion is allowed; with reduced motion a 150 ms crossfade.
 * - Faces are text nodes with `dir="auto"`, fixed height (h-80 / sm:h-96), scrolling inside.
 */

/** Which side of the stage a card left by, in reading order. */
export type FlipCardSide = "start" | "end";

export interface FlipCardProps {
  /** The card on the stage; null once the round is fully rated (the last card flies out). */
  card: EngagementFlashcard | null;
  /** Showing the back. */
  flipped: boolean;
  /** Rating is unlocked (the card was flipped at least once): swipe is on. */
  canRate: boolean;
  /** The hint is open (drawn on the front face). */
  hintShown?: boolean;
  /** 1-based position and deck size, for the accessible name. */
  position: number;
  total: number;
  onFlip: () => void;
  /** A swipe past the threshold, as the side the card went to. */
  onSwipe: (side: FlipCardSide) => void;
  /** The side the previous card left by, so it flies out that way. */
  exitSide?: FlipCardSide | null;
  rtl: boolean;
  /** A practice round: a quiet marker on the face. */
  practice?: boolean;
  /** Drawn on the empty stage while `card` is null (e.g. "Saving your results"). */
  emptyStage?: ReactNode;
  className?: string;
}

/** Literal skin classes for the card surface (one layout, five skins). */
const FACE_BASE =
  "flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm " +
  "[.ui-vibrant_&]:border-primary-100 " +
  "[.ui-play_&]:rounded-play-card [.ui-play_&]:border-2 [.ui-play_&]:border-b-4 [.ui-play_&]:border-play-surface [.ui-play_&]:shadow-none " +
  "[.ui-cleaner-play_&]:border-cp-border [.ui-cleaner-play_&]:bg-cp-surface " +
  "[.ui-corporate_&]:rounded-lg";

const FACE_BACK =
  "bg-primary-50 [.ui-vibrant_&]:bg-primary-50 [.ui-play_&]:bg-play-info-soft [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-corporate_&]:bg-muted";

const OVERLAY_GOT_IT =
  "border-success-500 bg-success-50 text-success-700 [.ui-play_&]:border-play-success-deep [.ui-play_&]:bg-play-success-soft [.ui-play_&]:text-play-success-soft-ink [.ui-cleaner-play_&]:border-cp-sage [.ui-cleaner-play_&]:bg-cp-sage-tint [.ui-cleaner-play_&]:text-cp-sage";

const OVERLAY_LEARNING =
  "border-warning-500 bg-warning-50 text-warning-700 [.ui-play_&]:border-play-warn-deep [.ui-play_&]:bg-play-warn-soft [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:border-cp-gold [.ui-cleaner-play_&]:bg-cp-gold-tint [.ui-cleaner-play_&]:text-cp-ink";

const FLIP_HALF_S = 0.15;
const FADE_S = 0.075;

/** Short text reads large; long text steps down so it fits without scrolling. */
function frontSize(text: string): string {
  if (text.length <= 60) return "text-h2";
  if (text.length <= 120) return "text-h3";
  return "text-subtitle";
}

function backSize(text: string): string {
  if (text.length <= 80) return "text-h3";
  if (text.length <= 220) return "text-subtitle";
  return "text-body";
}

/** Direction (-1 / 1) on screen of a reading-order side. */
function screenDir(side: FlipCardSide, rtl: boolean): number {
  const toEnd = side === "end" ? 1 : -1;
  return rtl ? -toEnd : toEnd;
}

export const FlipCard = forwardRef<HTMLButtonElement, FlipCardProps>(function FlipCard(
  {
    card,
    flipped,
    canRate,
    hintShown,
    position,
    total,
    onFlip,
    onSwipe,
    exitSide,
    rtl,
    practice,
    emptyStage,
    className,
  },
  ref
) {
  const { t } = useTranslation("dashboardEngagement");
  const reduced = useReducedMotion() ?? false;

  // Resolved at exit time with the AnimatePresence `custom` (the latest side).
  const variants: Variants = {
    exit: (side: FlipCardSide | null | undefined) => {
      if (reduced || !side) return { opacity: 0, transition: { duration: FADE_S * 2 } };
      const dir = screenDir(side, rtl);
      return { x: dir * 360, rotate: dir * 10, opacity: 0, transition: { duration: 0.22, ease: "easeIn" } };
    },
  };

  return (
    <div className={ecn("relative h-80 w-full sm:h-96", className)}>
      {card == null && emptyStage != null && (
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: reduced ? 0 : 0.15, duration: 0.15 } }}
        >
          {emptyStage}
        </motion.div>
      )}
      <AnimatePresence initial={false} custom={exitSide}>
        {card && (
          <CardShell
            key={card.id}
            ref={ref}
            card={card}
            flipped={flipped}
            canRate={canRate}
            hintShown={hintShown}
            position={position}
            total={total}
            onFlip={onFlip}
            onSwipe={onSwipe}
            rtl={rtl}
            practice={practice}
            reduced={reduced}
            variants={variants}
          />
        )}
      </AnimatePresence>
      {/* The back is announced when it turns up; the card's own name covers the front. */}
      <div aria-live="polite" className="sr-only">
        {card && flipped ? t("runner.flashcards.backAnnounce", { text: card.back }) : ""}
      </div>
    </div>
  );
});

interface CardShellProps extends Omit<FlipCardProps, "card" | "exitSide" | "emptyStage" | "className"> {
  card: EngagementFlashcard;
  reduced: boolean;
  variants: Variants;
}

const CardShell = forwardRef<HTMLButtonElement, CardShellProps>(function CardShell(
  { card, flipped, canRate, hintShown, position, total, onFlip, onSwipe, rtl, practice, reduced, variants },
  ref
) {
  const { t } = useTranslation("dashboardEngagement");
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], reduced ? [0, 0] : [-8, 8]);
  // Heading to the end side (Got it) fades its stamp in; the start side likewise.
  const endOpacity = useTransform(x, rtl ? [-FLASHCARD_SWIPE_PX, -16] : [16, FLASHCARD_SWIPE_PX], rtl ? [1, 0] : [0, 1]);
  const startOpacity = useTransform(x, rtl ? [16, FLASHCARD_SWIPE_PX] : [-FLASHCARD_SWIPE_PX, -16], rtl ? [0, 1] : [1, 0]);
  const draggedRef = useRef(false);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const dx = info.offset.x;
    const vx = info.velocity.x;
    const far = Math.abs(dx) > FLASHCARD_SWIPE_PX;
    const flick = Math.abs(vx) > FLASHCARD_FLICK_VELOCITY && Math.abs(dx) > FLASHCARD_FLICK_MIN_PX && Math.sign(vx) === Math.sign(dx);
    if (!far && !flick) return;
    const towardsRight = dx > 0;
    // Right is the end side in LTR, the start side in RTL.
    onSwipe(towardsRight !== rtl ? "end" : "start");
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (draggedRef.current) {
      // The pointer-up that ended a drag is not a tap.
      draggedRef.current = false;
      e.preventDefault();
      return;
    }
    onFlip();
  };

  const label = flipped
    ? t("runner.flashcards.cardAriaBack", { current: position, total, text: card.back })
    : t("runner.flashcards.cardAriaFront", { current: position, total, text: card.front });

  // Two 150 ms halves of a rotateY turn; a 150 ms crossfade under reduced motion.
  const faceVariants: Variants = reduced
    ? {
        hidden: { opacity: 0 },
        shown: { opacity: 1, transition: { duration: FADE_S } },
        gone: { opacity: 0, transition: { duration: FADE_S } },
      }
    : {
        hidden: { rotateY: rtl ? 90 : -90, transformPerspective: 1200 },
        shown: { rotateY: 0, transformPerspective: 1200, transition: { duration: FLIP_HALF_S, ease: "easeOut" } },
        gone: { rotateY: rtl ? -90 : 90, transformPerspective: 1200, transition: { duration: FLIP_HALF_S, ease: "easeIn" } },
      };

  const text = flipped ? card.back : card.front;

  return (
    <motion.div
      className={ecn("absolute inset-0 touch-pan-y select-none", canRate && "cursor-grab active:cursor-grabbing")}
      style={{ x, rotate }} // design-lint-ignore: framer motion values for the live swipe
      drag={canRate ? "x" : false}
      dragSnapToOrigin
      dragElastic={0.6}
      dragMomentum={false}
      onDragStart={() => {
        draggedRef.current = true;
      }}
      onDragEnd={(e, info) => {
        handleDragEnd(e, info);
        // The click that may follow this pointer-up is swallowed once; if none
        // comes (the pointer left the card), the flag clears on the next tick.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: reduced ? FADE_S * 2 : 0.2 } }}
      exit="exit"
      variants={variants}
    >
      <button
        ref={ref}
        type="button"
        onClick={handleClick}
        aria-label={label}
        className={ecn(
          "block h-full w-full touch-pan-y rounded-2xl text-start outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
          "[.ui-play_&]:rounded-play-card [.ui-corporate_&]:rounded-lg"
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={flipped ? "back" : "front"}
            className={ecn(FACE_BASE, flipped && FACE_BACK)}
            variants={faceVariants}
            initial="hidden"
            animate="shown"
            exit="gone"
          >
            <span className="flex items-center justify-between gap-2 px-card pt-card">
              <span className={ecn("text-caption font-semibold uppercase tracking-wide", skinClasses("mutedInk"))}>
                {flipped ? t("runner.flashcards.back") : t("runner.flashcards.front")}
              </span>
              {practice && (
                <span className={ecn("inline-flex items-center gap-1 text-caption font-medium", skinClasses("mutedInk"))}>
                  <Repeat aria-hidden weight="bold" className="size-3.5" />
                  {t("runner.flashcards.practiceBadge")}
                </span>
              )}
            </span>
            {/* A scroll container resets touch-action, so it restates pan-y for the swipe. */}
            <span className="flex min-h-0 flex-1 touch-pan-y flex-col overflow-y-auto overscroll-contain px-card-lg py-3">
              <span
                dir="auto"
                className={ecn(
                  "my-auto block whitespace-pre-wrap break-words text-center",
                  flipped ? backSize(text) : frontSize(text),
                  flipped ? "font-medium" : "font-semibold",
                  skinClasses("ink")
                )}
              >
                {text}
              </span>
            </span>
            {!flipped && hintShown && card.hint && (
              <span className="mx-4 mb-2 flex items-start gap-2 rounded-md bg-muted px-3 py-2 [.ui-play_&]:bg-play-warn-soft [.ui-cleaner-play_&]:bg-cp-gold-tint">
                <Lightbulb aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0 text-warning-600 [.ui-play_&]:text-play-warn-soft-ink [.ui-cleaner-play_&]:text-cp-gold" />
                <span dir="auto" className={ecn("min-w-0 whitespace-pre-wrap break-words text-caption", skinClasses("ink"))}>
                  {card.hint}
                </span>
              </span>
            )}
            <span
              className={ecn(
                "flex items-center justify-center gap-1.5 px-card pb-card text-caption",
                skinClasses("mutedInk")
              )}
            >
              <ArrowsClockwise aria-hidden weight="bold" className="size-3.5" />
              {flipped ? t("runner.flashcards.tapToSeeFront") : t("runner.flashcards.tapToFlip")}
            </span>
          </motion.span>
        </AnimatePresence>
      </button>

      {/* Swipe feedback: a stamp on the trailing edge (the one still on screen)
          names the rating the card is heading to. */}
      {canRate && (
        <>
          <motion.span
            aria-hidden
            style={{ opacity: endOpacity }} // design-lint-ignore: framer motion value
            className={ecn(
              "pointer-events-none absolute top-4 inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-body font-bold start-4",
              OVERLAY_GOT_IT
            )}
          >
            <CheckCircle weight="fill" className="size-4" />
            {t("runner.flashcards.gotIt")}
          </motion.span>
          <motion.span
            aria-hidden
            style={{ opacity: startOpacity }} // design-lint-ignore: framer motion value
            className={ecn(
              "pointer-events-none absolute top-4 inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-body font-bold end-4",
              OVERLAY_LEARNING
            )}
          >
            <Repeat weight="bold" className="size-4" />
            {t("runner.flashcards.stillLearning")}
          </motion.span>
        </>
      )}
    </motion.div>
  );
});
