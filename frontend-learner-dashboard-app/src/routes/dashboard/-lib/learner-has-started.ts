/**
 * Has this learner done anything yet? Each source sees only part of the picture:
 * study library data covers one batch, recent slides need an incomplete slide,
 * and the enrolled check reads a page of enrollments. Any one is enough.
 */
export const learnerHasStarted = ({
  subjects,
  recentSlides,
  enrolledHasProgress,
}: {
  subjects?: ReadonlyArray<{ percentage_completed?: number | null }> | null;
  recentSlides?: ReadonlyArray<unknown> | null;
  enrolledHasProgress?: boolean;
}): boolean =>
  Boolean(enrolledHasProgress) ||
  (recentSlides?.length ?? 0) > 0 ||
  (subjects ?? []).some((subject) => (subject.percentage_completed ?? 0) > 0);
