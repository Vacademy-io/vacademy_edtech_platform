import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

/**
 * The Fun skin's lip button (styles/fun/base.css, .fun-btn).
 *
 * - primary: the institute's brand solid, white text, brand lip. One per card.
 * - onColour: white on a course band, the course's text shade and lip. Put it
 *   inside the band: an element with a fun-course-N class (courseColourClass)
 *   and the fun-on-colour class, which turns its focus ring white.
 * - outline: white with a grey border and lip. While Join is live, Continue
 *   becomes this one.
 *
 * Pressed moves it down by the lip; focus-visible draws a 3px ink ring with a
 * 2px gap (white inside a fun-on-colour band). Only styled under html.ui-fun.
 */
export type FunButtonVariant = "primary" | "onColour" | "outline";

const VARIANT_CLASS: Record<FunButtonVariant, string> = {
  primary: "fun-btn--primary",
  onColour: "fun-btn--on-colour",
  outline: "fun-btn--outline",
};

export interface FunButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: FunButtonVariant;
  /** 44px tall instead of 54px, for rows and tight cards. */
  compact?: boolean;
  /** Full width. */
  block?: boolean;
  /** Render the child (a router Link, say) with the button's look. */
  asChild?: boolean;
}

export const FunButton = forwardRef<HTMLButtonElement, FunButtonProps>(
  ({ variant = "primary", compact, block, asChild, className, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        // A button inside a form must not submit it by accident.
        type={asChild ? undefined : (type ?? "button")}
        className={cn(
          "fun-btn",
          VARIANT_CLASS[variant],
          compact && "fun-btn--compact",
          block && "fun-btn--block",
          className,
        )}
        {...props}
      />
    );
  },
);
FunButton.displayName = "FunButton";
