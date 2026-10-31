import React from "react";
import { cn } from "@/lib/utils";

/**
 * A phone drawn in CSS showing one picture and a few placeholder lines, cut
 * off at the bottom (Figma "Phone holder" 73:547: 170×200 box, 150.8px phone).
 * Exact design geometry; colours are palette classes. Decorative except the
 * picture's alt text.
 */

// One element per line so each exact value carries its own design-lint note.
const HOLDER = "relative h-[200px] w-[170px] shrink-0 overflow-hidden"; // design-lint-ignore: Figma phone holder 170×200
const FRAME = "absolute start-[10px] top-0 h-[272.6px] w-[150.8px] overflow-hidden rounded-[26.1px] border-[2.9px] border-palette-accent bg-palette-text"; // design-lint-ignore: Figma phone frame
// The phone body = the ink colour lifted 7% toward white (the design's dark brown).
const FRAME_TINT = "absolute inset-0 bg-white/[0.07]"; // design-lint-ignore: Figma phone body tint
const SPEAKER = "absolute start-[50.75px] top-[8.7px] h-[7.25px] w-[43.5px] rounded-[4.35px] bg-palette-accent"; // design-lint-ignore: Figma speaker
const SCREEN = "absolute start-[5.8px] top-[26.1px] h-[232px] w-[133.4px] overflow-hidden rounded-[17.4px] bg-palette-cream"; // design-lint-ignore: Figma screen
const PICTURE = "absolute start-[8.7px] top-[11.6px] h-[75.4px] w-[116px] rounded-[11.6px] object-cover"; // design-lint-ignore: Figma screen picture
const BAR = "absolute start-[8.7px] h-[7.25px] rounded-[4.35px]"; // design-lint-ignore: Figma placeholder bars
const TITLE_BAR = "top-[95.7px] w-[101.5px] bg-palette-text/80"; // design-lint-ignore: Figma title bar
const LINE_1 = "top-[116px] w-[72.5px] bg-palette-muted/40"; // design-lint-ignore: Figma text line
const LINE_2 = "top-[133.4px] w-[87px] bg-palette-muted/40"; // design-lint-ignore: Figma text line
const TRACK = "top-[159.5px] w-[116px] bg-palette-border"; // design-lint-ignore: Figma progress track
const FILL = "top-[159.5px] w-[69.6px] bg-palette-olive"; // design-lint-ignore: Figma progress fill
const BUTTON = "absolute start-[8.7px] top-[185.6px] h-[26.1px] w-[116px] rounded-[8.7px] bg-palette-primary"; // design-lint-ignore: Figma screen button

export const PhoneMockup: React.FC<{ image?: string; alt?: string; className?: string }> = ({
  image,
  alt = "",
  className,
}) => (
  <div className={cn(HOLDER, className)} data-phone-mockup="">
    <div className={FRAME}>
      <span aria-hidden="true" className={FRAME_TINT} />
      <span aria-hidden="true" className={SPEAKER} />
      <div className={SCREEN}>
        {image ? <img src={image} alt={alt} loading="lazy" className={PICTURE} /> : null}
        <span aria-hidden="true" className={cn(BAR, TITLE_BAR)} />
        <span aria-hidden="true" className={cn(BAR, LINE_1)} />
        <span aria-hidden="true" className={cn(BAR, LINE_2)} />
        <span aria-hidden="true" className={cn(BAR, TRACK)} />
        <span aria-hidden="true" className={cn(BAR, FILL)} />
        <span aria-hidden="true" className={BUTTON} />
      </div>
    </div>
  </div>
);

export default PhoneMockup;
