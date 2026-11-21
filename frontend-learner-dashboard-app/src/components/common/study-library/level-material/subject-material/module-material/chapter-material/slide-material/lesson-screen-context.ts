import { createContext, useContext, useLayoutEffect, type Dispatch, type SetStateAction } from "react";

/**
 * Content drawn inside the lesson viewer that brings its own header and its own
 * row of buttons (the Fun quiz question and result) takes the whole screen: the
 * viewer leaves out its top bar and phone bar while any such content is
 * mounted, so the screen has one title and one Previous / Next.
 *
 * The viewer provides a counter's setter; each mounted screen adds one. A layout
 * effect, so the bars are gone before the first paint and before anything
 * measures the foot of the screen.
 */
export const LessonScreenContext = createContext<Dispatch<SetStateAction<number>> | null>(null);

/** Call from content that draws its own header and buttons. No-op outside the viewer. */
export function useOwnLessonScreen() {
  const claim = useContext(LessonScreenContext);
  useLayoutEffect(() => {
    if (!claim) return;
    claim((n) => n + 1);
    return () => claim((n) => n - 1);
  }, [claim]);
}
