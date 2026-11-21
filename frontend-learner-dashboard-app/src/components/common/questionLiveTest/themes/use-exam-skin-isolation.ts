import { useLayoutEffect, useState } from "react";
import { suspendAppSkin } from "@/lib/app-skin";
import { isNeonCityOn } from "@/hooks/use-neon-city";
import type { ExamPresetId } from "@/types/exam-theme";

/**
 * Holds the institute's app skin (Play, Fun, Corporate, ...) off <html> while
 * a non-default exam theme is on screen, and puts it back exactly on
 * unmount. The default theme keeps the skin, except Neon City: a test is
 * never taken on the night look, so the exam keeps its usual white screen.
 * A layout effect, so the themed screen never paints with the skin first.
 */
export function useExamSkinIsolation(themeId: ExamPresetId): void {
  // Read once: holding the skin off removes ui-neon-city, which must not
  // flip the decision and hand the skin straight back.
  const [neonAtOpen] = useState(isNeonCityOn);
  const isolate = themeId !== "default" || neonAtOpen;
  useLayoutEffect(() => (isolate ? suspendAppSkin() : undefined), [isolate]);
}
