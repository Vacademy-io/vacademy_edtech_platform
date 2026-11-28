/**
 * Practice tests and surveys have no clock.
 *
 * The product copy promises it ("no time limits", "always available"), the
 * player hides every timer for them, and the admin cannot even set a duration
 * on a survey. But the timer machinery still ran underneath: a missing
 * duration became an entire-test timer of 0, which the auto-submit effect
 * read as "time's up" and submitted the attempt the moment it opened, and the
 * remote autosave was skipped for the same reason. Prod showed it plainly -
 * every practice/survey attempt without a duration ended within 60 seconds.
 *
 * Anything that decides "is the time up?" must consult this first.
 */
export const UNTIMED_PLAY_MODES = new Set(["PRACTICE", "SURVEY"]);

export const isUntimedPlayMode = (
  playMode: string | null | undefined,
): boolean => !!playMode && UNTIMED_PLAY_MODES.has(playMode.toUpperCase());
