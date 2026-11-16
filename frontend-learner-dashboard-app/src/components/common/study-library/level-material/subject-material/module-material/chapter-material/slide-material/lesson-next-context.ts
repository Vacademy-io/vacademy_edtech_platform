import { createContext, useContext } from "react";

/**
 * The lesson viewer's own Next, for content drawn inside the viewer. Null when
 * the viewer's Next is disabled (last slide with nowhere to go, or the next
 * slide is still locked). A context rather than a prop because the viewer
 * builds a slide's content once, while whether Next is open can change later.
 */
export const LessonNextContext = createContext<(() => void) | null>(null);

export const useLessonNext = () => useContext(LessonNextContext);
