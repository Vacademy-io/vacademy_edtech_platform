/** A slide's built content, tagged with the slide it was built for. */
export interface LoadedSlideContent<T> {
  slideId: string | null;
  node: T;
}

/**
 * What may be on screen for the active slide: only content built for that
 * slide, or nothing while its own content is still being built.
 */
export const contentForSlide = <T>(
  loaded: LoadedSlideContent<T> | null,
  activeSlideId: string | null
): T | null => (loaded && loaded.slideId === activeSlideId ? loaded.node : null);
