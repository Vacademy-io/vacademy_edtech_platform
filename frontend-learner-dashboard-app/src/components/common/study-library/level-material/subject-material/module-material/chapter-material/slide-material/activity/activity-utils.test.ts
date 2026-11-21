import { describe, expect, it } from "vitest";
import { activityTutorText, parseFlashcardsSlide, parseGameSlide, parsePollSlide, votePercent } from "./activity-utils";

describe("activity slide parsers", () => {
  it("reads a flashcards/v1 deck and skips half-empty cards", () => {
    const deck = parseFlashcardsSlide(
      JSON.stringify({
        schema: "flashcards/v1",
        cards: [
          { id: "a", front: "H2O", back: "Water" },
          { id: "b", front: "  ", back: "x" },
        ],
        settings: { shuffle: false },
      })
    );
    expect(deck?.cards.map((c) => c.id)).toEqual(["a"]);
    expect(deck?.shuffle).toBe(false);
    expect(parseFlashcardsSlide("{")).toBeNull();
    expect(parseFlashcardsSlide(null)).toBeNull();
  });

  it("needs two filled options for a poll", () => {
    expect(parsePollSlide(JSON.stringify({ question: "Q", options: [{ id: "a", text: "Yes" }] }))).toBeNull();
    const poll = parsePollSlide(
      JSON.stringify({ question: "Q", options: [{ id: "a", text: " Yes " }, { id: "b", text: "No" }, { id: "c", text: "" }] })
    );
    expect(poll?.options).toEqual([
      { id: "a", text: "Yes" },
      { id: "b", text: "No" },
    ]);
  });

  it("needs a page for a game and ignores a bad max score", () => {
    expect(parseGameSlide(JSON.stringify({ html: "  " }))).toBeNull();
    expect(parseGameSlide(JSON.stringify({ html: "<p>x</p>", maxScore: -1 }))?.maxScore).toBeNull();
    expect(parseGameSlide(JSON.stringify({ html: "<p>x</p>", maxScore: 10 }))?.maxScore).toBe(10);
  });

  it("gives the tutor readable text, never the raw JSON", () => {
    const text = activityTutorText(
      "POLL",
      JSON.stringify({ question: "Best fruit?", options: [{ id: "a", text: "Apple" }, { id: "b", text: "Mango" }] })
    );
    expect(text).toBe("Best fruit?\n- Apple\n- Mango");
    expect(activityTutorText("GAME", "{bad")).toBe("");
  });

  it("rounds vote shares and survives zero votes", () => {
    expect(votePercent(1, 3)).toBe(33);
    expect(votePercent(0, 0)).toBe(0);
  });
});
