import { describe, expect, it } from "vitest";
import { findQuestionPosition } from "./question-position";

const paper = {
  section_dtos: [
    {
      name: "Physics",
      question_preview_dto_list: [{ question_id: "p1" }, { question_id: "p2" }],
    },
    {
      name: "  ",
      question_preview_dto_list: [
        { question_id: "c1" },
        { question_id: "c2" },
        { question_id: "c3" },
      ],
    },
  ],
};

describe("findQuestionPosition", () => {
  it("numbers a question within its own section, from 1", () => {
    expect(findQuestionPosition(paper, "p2")).toEqual({ sectionName: "Physics", number: 2 });
    expect(findQuestionPosition(paper, "c3")).toEqual({ sectionName: null, number: 3 });
  });

  it("is null when there is no paper, no question, or the question is not in the paper", () => {
    expect(findQuestionPosition(null, "p1")).toBeNull();
    expect(findQuestionPosition(paper, null)).toBeNull();
    expect(findQuestionPosition(paper, "missing")).toBeNull();
    expect(findQuestionPosition({ section_dtos: null }, "p1")).toBeNull();
  });
});
