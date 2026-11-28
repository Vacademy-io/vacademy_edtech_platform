/** A chapter's completion from its slides. A slide with no value counts as 0, each caps at 100. */
export const calculateOverallCompletion = (
  slides: ReadonlyArray<{ percentage_completed?: number | null }>,
): number => {
  if (!slides || slides.length === 0) return 0;

  const totalSlides = slides.length;
  const totalCompletion = slides.reduce((sum, slide) => {
    const percentage = Math.min(slide.percentage_completed ?? 0, 100);
    return sum + percentage;
  }, 0);

  return Math.min(Math.round(totalCompletion / totalSlides), 100);
};
