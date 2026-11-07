import { describe, expect, it } from "vitest";
import { BEGIN_CAP_MS, decideBegin, hasUserActivation } from "./tutorAudioGate";

const base = { avatarWanted: true, painted: false, activated: false, failed: false, needsTap: false, sinceReadyMs: 0 };

describe("decideBegin", () => {
  it("begins at once when there is no face to wait for", () => {
    expect(decideBegin({ ...base, avatarWanted: false })).toBe("now");
    expect(decideBegin({ ...base, failed: true })).toBe("now");
  });
  it("waits for the face to paint and unlock, then begins", () => {
    expect(decideBegin(base)).toBe("wait");
    expect(decideBegin({ ...base, painted: true })).toBe("wait");
    expect(decideBegin({ ...base, painted: true, activated: true })).toBe("now");
  });
  it("keeps waiting for a face that is still on its way (the voice must not arrive first)", () => {
    // Prod: the face paints 6-9 s after the tap. The old 6 s cap started the voice early.
    expect(decideBegin({ ...base, sinceReadyMs: 9000 })).toBe("wait");
    expect(decideBegin({ ...base, painted: true, sinceReadyMs: 9000 })).toBe("wait");
    expect(decideBegin({ ...base, painted: true, activated: true, sinceReadyMs: 9000 })).toBe("now");
  });
  it("never holds the lesson past the cap", () => {
    expect(decideBegin({ ...base, sinceReadyMs: BEGIN_CAP_MS - 1 })).toBe("wait");
    expect(decideBegin({ ...base, sinceReadyMs: BEGIN_CAP_MS })).toBe("now");
  });
  it("shows the tap gate only when the browser needs a gesture — before anything is spoken", () => {
    expect(decideBegin({ ...base, needsTap: true, painted: true })).toBe("gate");
    expect(decideBegin({ ...base, needsTap: true, avatarWanted: false })).toBe("gate");
  });
});

describe("hasUserActivation", () => {
  it("reads the sticky activation flag and assumes none without the API", () => {
    expect(hasUserActivation({ userActivation: { hasBeenActive: true } })).toBe(true);
    expect(hasUserActivation({ userActivation: { hasBeenActive: false } })).toBe(false);
    expect(hasUserActivation({})).toBe(false);
  });
});
