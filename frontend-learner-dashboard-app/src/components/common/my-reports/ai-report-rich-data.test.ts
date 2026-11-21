import { describe, expect, it } from "vitest";
import {
  type AiReportWebData, type Outcome, type ReportQuestion,
  confidenceQuadrant, easyMarksMissed, expertise, histogram, negativeMarking, num, quarterAccuracy, speedBands, uniformPenalty,
} from "./ai-report-rich-data";

function q(n: number, outcome: Outcome, time: number | null, marks: number, classPct: number | null = 70, classTime: number | null = 20): ReportQuestion {
  return {
    question_id: `q${n}`, section_id: "s1", section_index: 0, section_name: "Physics", number: n, max: 2, marks, outcome,
    time_seconds: time, class_correct_percent: classPct, class_average_time_seconds: classTime, short_text: `Question ${n}`,
    type: "MCQ", text: null, your_answer: null, correct_answer: null, feedback: null, criteria: [], explanation: null,
  };
}

function data(questions: ReportQuestion[], extra: Partial<AiReportWebData> = {}): AiReportWebData {
  return {
    institute_name: "Sample", assessment_name: "Unit Test", student_name: "Riya", enrollment_number: null, attempt_date: null,
    headline: null, subline: null, score: questions.reduce((a, x) => a + x.marks, 0), max_score: questions.length * 2,
    time_taken_seconds: 300, duration_limit_minutes: 20, has_class: true, rank: 3, participants: 20, percentile: 80,
    class_average: 10, class_highest: 18, class_average_time_seconds: 280, class_scores: [2, 4, 6, 8, 10, 12],
    marking_note: null, hide_question_wise: false, hide_your_answer: false, hide_correct_answer: false, hide_explanation: false,
    sections: [], questions, history: [], potential: null, ai: {}, ...extra,
  };
}

describe("ai report numbers match the PDF builder", () => {
  it("prints marks like AiReportCharts.num", () => {
    expect(num(12)).toBe("12");
    expect(num(-0.25)).toBe("−0.25");
    expect(num(1.5)).toBe("1.5");
    expect(num(0.004)).toBe("0");
    expect(num(-1.5)).toBe("−1.5");
  });

  it("buckets answered questions by time, skipping skipped and pending ones", () => {
    const bands = speedBands([q(1, "CORRECT", 5, 2), q(2, "WRONG", 8, -0.5), q(3, "CORRECT", 20, 2), q(4, "SKIPPED", null, 0), q(5, "PENDING", 40, 0), q(6, "CORRECT", 90, 2)]);
    expect(bands.map((b) => [b.right, b.total])).toEqual([[1, 2], [1, 1], [0, 0], [1, 1]]);
  });

  it("needs 8 graded questions for stamina and splits them in quarters", () => {
    expect(quarterAccuracy([q(1, "CORRECT", 5, 2)])).toBeNull();
    const qs = Array.from({ length: 8 }, (_, i) => q(i + 1, i < 4 ? "CORRECT" : "WRONG", 20, 0));
    expect(quarterAccuracy(qs)?.map((x) => [x.label, x.percent])).toEqual([["Q1–2", 100], ["Q3–4", 100], ["Q5–6", 0], ["Q7–8", 0]]);
  });

  it("splits quick and slow by the class time per question", () => {
    const qs = [q(1, "CORRECT", 10, 2), q(2, "CORRECT", 30, 2), q(3, "WRONG", 5, 0), q(4, "WRONG", 40, 0), q(5, "CORRECT", 15, 2), q(6, "CORRECT", 25, 2)];
    expect(confidenceQuadrant(qs)).toEqual({ quickRight: 2, slowRight: 2, quickWrong: 1, slowWrong: 1, classRef: true });
    expect(confidenceQuadrant(qs.slice(0, 5))).toBeNull();
  });

  it("works out negative marking and the score without sub-10-second guesses", () => {
    const d = data([q(1, "CORRECT", 20, 2), q(2, "WRONG", 4, -0.5), q(3, "WRONG", 30, -0.5)]);
    expect(negativeMarking(d)).toEqual({ earned: 2, lost: -1, withoutGuesses: 1.5, guesses: 1 });
    expect(uniformPenalty(d)).toBe("−0.5");
    expect(negativeMarking(data([q(1, "CORRECT", 20, 2)]))).toBeNull();
  });

  it("lists easy marks missed and expertise only with a class of 5 and question-wise items shown", () => {
    const qs = [q(1, "WRONG", 20, 0, 90), q(2, "SKIPPED", null, 0, 65), q(3, "WRONG", 20, 0, 40), q(4, "CORRECT", 20, 2, 20), q(5, "CORRECT", 20, 2, 80)];
    expect(easyMarksMissed(data(qs)).map((x) => x.number)).toEqual([1, 2]);
    expect(expertise(data(qs)).map((x) => x.number)).toEqual([4]);
    expect(easyMarksMissed(data(qs, { participants: 4 }))).toEqual([]);
    expect(expertise(data(qs, { hide_question_wise: true }))).toEqual([]);
  });

  it("counts every class score once and marks the learner's range", () => {
    const bins = histogram([0, 3, 3, 10, 19, 20], 10, 20);
    expect(bins).toHaveLength(10);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(6);
    expect(bins.filter((b) => b.mine)).toHaveLength(1);
    expect(bins[5]!.mine).toBe(true);
  });
});
