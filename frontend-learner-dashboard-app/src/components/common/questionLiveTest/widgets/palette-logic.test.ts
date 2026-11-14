import { describe, expect, it } from "vitest";
import {
  chipLabel,
  chipStatusOf,
  examSummaryRows,
  formatConsoleClock,
  formatMarks,
  paletteEntries,
  parseMarking,
  statusCounts,
} from "./palette-logic";

const state = (flags: {
  isAnswered?: boolean;
  isVisited?: boolean;
  isMarkedForReview?: boolean;
}) => ({
  isAnswered: false,
  isVisited: false,
  isMarkedForReview: false,
  isDisabled: false,
  ...flags,
});

describe("chip status", () => {
  it("derives the five console states", () => {
    const states = {
      nv: state({}),
      na: state({ isVisited: true }),
      ans: state({ isVisited: true, isAnswered: true }),
      mk: state({ isVisited: true, isMarkedForReview: true }),
      am: state({ isVisited: true, isAnswered: true, isMarkedForReview: true }),
    };
    expect(chipStatusOf(states, "nv")).toBe("not-visited");
    expect(chipStatusOf(states, "na")).toBe("not-answered");
    expect(chipStatusOf(states, "ans")).toBe("answered");
    expect(chipStatusOf(states, "mk")).toBe("marked");
    expect(chipStatusOf(states, "am")).toBe("answered-marked");
  });

  it("a question with no state is Not Visited", () => {
    expect(chipStatusOf({}, "missing")).toBe("not-visited");
  });

  it("a restored answer without the visited flag still shows Answered", () => {
    expect(chipStatusOf({ q: state({ isAnswered: true }) }, "q")).toBe("answered");
  });
});

describe("counts and the Exam Summary", () => {
  const states = {
    a: state({ isVisited: true, isAnswered: true }),
    b: state({ isVisited: true }),
    c: state({ isVisited: true, isMarkedForReview: true }),
    d: state({ isVisited: true, isAnswered: true, isMarkedForReview: true }),
  };

  it("counts each status", () => {
    const counts = statusCounts(
      [{ question_id: "a" }, { question_id: "b" }, { question_id: "c" }, { question_id: "d" }, { question_id: "e" }],
      states,
    );
    expect(counts).toEqual({
      answered: 1,
      "not-answered": 1,
      "not-visited": 1,
      marked: 1,
      "answered-marked": 1,
    });
  });

  it("builds one row per section, in paper order", () => {
    const rows = examSummaryRows(
      [
        { id: "s1", name: "Physics", question_preview_dto_list: [{ question_id: "a" }, { question_id: "b" }] },
        { id: "s2", name: "Chemistry", question_preview_dto_list: [{ question_id: "c" }, { question_id: "d" }, { question_id: "x" }] },
      ],
      states,
    );
    expect(rows.map((row) => [row.name, row.total])).toEqual([
      ["Physics", 2],
      ["Chemistry", 3],
    ]);
    expect(rows[0].counts.answered).toBe(1);
    expect(rows[0].counts["not-answered"]).toBe(1);
    expect(rows[1].counts.marked).toBe(1);
    expect(rows[1].counts["answered-marked"]).toBe(1);
    expect(rows[1].counts["not-visited"]).toBe(1);
  });
});

describe("formatting", () => {
  it("prints the console clock in total minutes", () => {
    expect(formatConsoleClock(179 * 60 + 50, "MMM:SS")).toBe("179:50");
    expect(formatConsoleClock(65, "MMM:SS")).toBe("01:05");
    expect(formatConsoleClock(-3, "MMM:SS")).toBe("00:00");
  });

  it("prints the hours form", () => {
    expect(formatConsoleClock(2 * 3600 + 59 * 60 + 52, "HH:MM:SS")).toBe("02:59:52");
  });

  it("labels chips plainly or with two digits", () => {
    expect(chipLabel(0, "plain")).toBe("1");
    expect(chipLabel(0, "two-digit")).toBe("01");
    expect(chipLabel(11, "two-digit")).toBe("12");
  });

  it("reads marks from marking_json", () => {
    expect(parseMarking(JSON.stringify({ data: { totalMark: 4, negativeMark: 1 } }))).toEqual({
      correct: 4,
      negative: 1,
    });
    expect(parseMarking(JSON.stringify({ data: { totalMark: "3", negativeMark: -1 } }))).toEqual({
      correct: 3,
      negative: 1,
    });
    expect(parseMarking("not json")).toEqual({ correct: 0, negative: 0 });
    expect(parseMarking(null)).toEqual({ correct: 0, negative: 0 });
  });

  it("prints marks with at most two decimals", () => {
    expect(formatMarks(4)).toBe("4");
    expect(formatMarks(1 / 3)).toBe("0.33");
    expect(formatMarks(0.5)).toBe("0.5");
    expect(formatMarks(Number.NaN)).toBe("0");
  });
});

describe("paletteEntries", () => {
  const sections = [
    { question_preview_dto_list: [{ question_id: "a1" }, { question_id: "a2" }] },
    { question_preview_dto_list: [{ question_id: "b1" }, { question_id: "b2" }] },
    { question_preview_dto_list: [{ question_id: "c1" }] },
  ];
  const view = (entries: ReturnType<typeof paletteEntries>) =>
    entries.map((entry) => `${entry.section}:${entry.question.question_id}:${entry.number}`);

  it("section scope: the open section only, numbered from 1", () => {
    expect(view(paletteEntries(sections, "section", 1))).toEqual(["1:b1:1", "1:b2:2"]);
  });

  it("paper scope: every question in paper order, numbered across sections", () => {
    expect(view(paletteEntries(sections, "paper", 1))).toEqual([
      "0:a1:1",
      "0:a2:2",
      "1:b1:3",
      "1:b2:4",
      "2:c1:5",
    ]);
  });

  it("two-digit chips follow the paper-wide number", () => {
    const entries = paletteEntries(sections, "paper", 0);
    expect(entries.map((entry) => chipLabel(entry.number - 1, "two-digit"))).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
    ]);
  });

  it("no sections or an unknown section index gives no chips", () => {
    expect(paletteEntries([], "paper", 0)).toEqual([]);
    expect(paletteEntries(sections, "section", 7)).toEqual([]);
  });
});
