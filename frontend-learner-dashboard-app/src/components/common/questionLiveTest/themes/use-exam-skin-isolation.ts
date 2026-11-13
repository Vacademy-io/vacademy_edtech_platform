import { useLayoutEffect } from "react";
import { suspendAppSkin } from "@/lib/app-skin";
import type { ExamPresetId } from "@/types/exam-theme";

/**
 * Holds the institute's app skin (Play, Fun, Corporate, ...) off <html> while
 * a non-default exam theme is on screen, and puts it back exactly on
 * unmount. The default theme keeps the skin. A layout effect, so the themed
 * screen never paints with the skin first.
 */
export function useExamSkinIsolation(themeId: ExamPresetId): void {
  const isolate = themeId !== "default";
  useLayoutEffect(() => (isolate ? suspendAppSkin() : undefined), [isolate]);
}
