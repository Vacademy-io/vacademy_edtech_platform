/**
 * When does the lesson begin? The teacher should not start speaking before
 * the learner's device can show her face and play her voice — but a slow
 * face must never hold a lesson hostage. Pure so it can be tested.
 */

/** The learner's tap that opened the lesson still counts here (same document),
 *  so audio can unlock without a second tap. Missing API → assume no gesture. */
export function hasUserActivation(nav: { userActivation?: { hasBeenActive: boolean } } = navigator): boolean {
  try {
    return !!nav.userActivation?.hasBeenActive;
  } catch {
    return false;
  }
}

/**
 * How long after `ready` the client waits for a face that is still loading
 * before it begins on the speaker. A safety net for a stuck vendor, not a
 * guess at load time: measured on prod the face paints 6-9 s after the tap,
 * and a 6 s cap here meant the learner heard the teacher before seeing her.
 */
export const BEGIN_CAP_MS = 25000;

export interface BeginInputs {
  /** The course has a premium avatar and the lesson is in voice mode. */
  avatarWanted: boolean;
  /** The SDK has painted its first frame. */
  painted: boolean;
  /** Its audio is unlocked and the motion session is connected. */
  activated: boolean;
  /** The avatar gave up (fatal error) — nothing to wait for. */
  failed: boolean;
  /** The learner has not tapped yet and the browser needs one before audio plays. */
  needsTap: boolean;
  /** Milliseconds since the server said `ready`. */
  sinceReadyMs: number;
}

export type BeginDecision = "now" | "wait" | "gate";

/**
 * "now": tell the server to open. "wait": the face is on its way. "gate":
 * show "Tap to begin" — nothing else can unlock the audio.
 */
export function decideBegin(i: BeginInputs): BeginDecision {
  if (i.needsTap) return "gate";
  if (!i.avatarWanted || i.failed) return "now";
  if (i.painted && i.activated) return "now";
  if (i.sinceReadyMs >= BEGIN_CAP_MS) return "now";
  return "wait";
}
