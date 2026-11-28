import { useLayoutEffect, useState } from "react";
import { suspendAppSkin } from "@/lib/app-skin";
import { isDarkFunVariantOn } from "@/hooks/use-fun-variant";
import type { ExamPresetId } from "@/types/exam-theme";

/**
 * Holds the institute's app skin (Play, Fun, Corporate, ...) off <html> while
 * a non-default exam theme is on screen, and puts it back exactly on
 * unmount. The default theme keeps the skin, except the night skins (Neon City,
 * Pulse): a test is never taken on a night look, so the exam keeps its usual
 * white screen.
 * A layout effect, so the themed screen never paints with the skin first.
 */
export function useExamSkinIsolation(themeId: ExamPresetId): void {
  // Read once: holding the skin off removes the night class, which must not
  // flip the decision and hand the skin straight back.
  const [neonAtOpen] = useState(isDarkFunVariantOn);
  const isolate = themeId !== "default" || neonAtOpen;
  useLayoutEffect(() => (isolate ? suspendAppSkin() : undefined), [isolate]);
}
