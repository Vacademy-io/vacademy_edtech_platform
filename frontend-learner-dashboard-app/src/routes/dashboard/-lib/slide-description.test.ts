import { describe, expect, it } from "vitest";
import { readableSlideDescription } from "./slide-description";

const doc = (value: string | null | undefined) => readableSlideDescription(value, "DOCUMENT");

describe("readableSlideDescription", () => {
  it("keeps prose", () => {
    expect(doc("A short overview of the chapter.")).toBe("A short overview of the chapter.");
  });

  it("keeps prose that happens to use brackets or braces", () => {
    expect(doc("{x} is the set of inputs")).toBe("{x} is the set of inputs");
    expect(doc("[Part 1] Getting started")).toBe("[Part 1] Getting started");
    expect(doc('"Fluency" and how to build it')).toBe('"Fluency" and how to build it');
  });

  it("keeps comparison signs and ampersands in prose", () => {
    expect(doc("Compare a < b and c > d in this lesson")).toBe(
      "Compare a < b and c > d in this lesson",
    );
    expect(doc("Q&A session: Part 1")).toBe("Q&A session: Part 1");
  });

  it("returns nothing for a JSON object, pretty printed or not", () => {
    const payload = { questions: [{ question_number: "1", options: ["a", "b"] }] };
    expect(doc(JSON.stringify(payload))).toBe("");
    expect(doc(JSON.stringify(payload, null, 2))).toBe("");
  });

  it("returns nothing for a JSON array", () => {
    expect(doc('[{"a":1}]')).toBe("");
    expect(doc("[]")).toBe("");
    expect(doc('["a","b"]')).toBe("");
  });

  it("returns nothing for a payload cut off part way", () => {
    expect(doc('{"videoId":"video-1","script":"Once upon a ti')).toBe("");
    expect(doc('{\n  "questions": [\n    {\n      "ques')).toBe("");
  });

  it("returns nothing for a payload encoded as a string", () => {
    expect(doc(JSON.stringify(JSON.stringify({ a: 1 })))).toBe("");
    expect(doc('"{\\"questions\\":[{\\"q')).toBe("");
  });

  it("returns nothing for a payload wrapped in markup", () => {
    expect(doc('<p>{"questions":[]}</p>')).toBe("");
    expect(doc("<p>{&quot;questions&quot;:[]}</p>")).toBe("");
  });

  it("turns markup into text", () => {
    expect(doc("<p>How <b>culture</b> shapes pricing.</p>")).toBe("How culture shapes pricing.");
    expect(doc("Salt &amp; light&nbsp;today")).toBe("Salt & light today");
  });

  it("returns nothing when there is no text", () => {
    expect(doc("")).toBe("");
    expect(doc("   ")).toBe("");
    expect(doc("<p></p>")).toBe("");
    expect(doc(null)).toBe("");
    expect(doc(undefined)).toBe("");
  });

  it("keeps prose on the types that hold it, in any case", () => {
    for (const type of ["DOCUMENT", "VIDEO", "AUDIO", "SCORM", "video"]) {
      expect(readableSlideDescription("A short overview.", type)).toBe("A short overview.");
    }
  });

  it("shows nothing from any other type, whatever the value looks like", () => {
    const values = [
      "Create an assessment quiz. Provide multiple-choice options and correct answers.",
      "Generate an illustrated storybook about the water cycle.",
      "{'correct_options': [0]}",
      "{&#34;correct_options&#34;:[0]}",
      '```json\n{"questions":[]}\n```',
      'Quiz: {"questions":[{"correct_options":[0]}]}',
      "Quiz",
    ];
    for (const type of ["QUIZ", "HTML_VIDEO", "ASSIGNMENT", "QUESTION", "QUESTION_SLIDE", "ASSESSMENT", "NEW_TYPE"]) {
      for (const value of values) {
        expect(readableSlideDescription(value, type)).toBe("");
      }
    }
    expect(readableSlideDescription("A short overview.", null)).toBe("");
    expect(readableSlideDescription("A short overview.", undefined)).toBe("");
  });

  it("drops a tag cut off at the end of a long value", () => {
    expect(doc('<p>Written overview.</p> <p>More <a href="http...')).toBe("Written overview. More");
    expect(doc("<p>Written overview.</p> <p...")).toBe("Written overview.");
    expect(doc("<p>Written overview.</p> <...")).toBe("Written overview.");
    expect(doc("<p>Written overview.</p> </p...")).toBe("Written overview.");
    expect(doc('Written overview. <a href="https://exam')).toBe("Written overview.");
  });

  it("keeps an unclosed comparison sign in prose", () => {
    expect(doc("Why a < b and so on...")).toBe("Why a < b and so on...");
    expect(doc("When x <y")).toBe("When x <y");
  });

  it("returns nothing for generated video notes, whole or cut off", () => {
    const video = (value: string) => readableSlideDescription(value, "VIDEO");
    const whole =
      "<div>\n  <p><strong>Motors</strong></p>\n  <p>Video related to: how motors work</p>\n" +
      '  <p>YouTube URL: <a href="https://example.com/v">link</a></p>\n</div>';
    expect(video(whole)).toBe("");
    expect(video('<div><p>Motors</p><p>Video related to: motors</p><p>YouTube URL: <a href="http...')).toBe("");
    expect(video("<div><p>Motors</p><p>Video related to: motors</p> <p...")).toBe("");
    expect(video("<div><p>Motors</p><p>Video related to: motors</p> <...")).toBe("");
    expect(video("A beginner-friendly video to start learning Java.")).toBe(
      "A beginner-friendly video to start learning Java.",
    );
    expect(video("A video related to motors")).toBe("A video related to motors");
  });

  it("returns nothing for a course outline path", () => {
    expect(doc("Summary > Summary > Notes")).toBe("");
    expect(doc("6.1 The Tissue System > 6.1.2 Ground Tissue &gt; Notes")).toBe("");
    expect(doc("One long chapter name > Another long topic name > ...")).toBe("");
    expect(doc("When a > b the result is positive")).toBe("When a > b the result is positive");
  });

  it("returns nothing for a bare file name", () => {
    for (const value of ["Electricity.pdf", "Project Report.docx.pdf", "Untitled document.docx", "UNIT 1.PPTX"]) {
      expect(doc(value)).toBe("");
    }
    expect(doc("Notes on the PDF format")).toBe("Notes on the PDF format");
    expect(doc("Version 2.5 of the guide")).toBe("Version 2.5 of the guide");
  });

  it("treats a default value as no description", () => {
    for (const value of ["Image", "External Link", "embedded url", " PDF ", "string", "<p>Video</p>"]) {
      expect(doc(value)).toBe("");
    }
    expect(doc("Image processing basics")).toBe("Image processing basics");
  });
});
