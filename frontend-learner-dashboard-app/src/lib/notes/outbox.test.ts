import { describe, expect, it } from "vitest";
import { classifyFailure, enqueue, mergeWithOutbox, type OutboxEntry } from "./outbox";
import type { LearnerNote } from "./types";

const note = (id: string, slide = "s", text = ""): LearnerNote => ({
  id,
  institute_id: "i",
  slide_id: slide,
  kind: "NOTE",
  note_text: text,
});

describe("enqueue", () => {
  it("keeps only the latest write for a note", () => {
    let q: OutboxEntry[] = [];
    q = enqueue(q, { op: "save", note: note("a", "s", "first") });
    q = enqueue(q, { op: "save", note: note("b") });
    q = enqueue(q, { op: "save", note: note("a", "s", "second") });
    expect(q.map((e) => (e.op === "save" ? e.note.note_text : ""))).toEqual(["", "second"]);
  });
  it("a delete replaces an unsent save", () => {
    const q = enqueue([{ op: "save", note: note("a") }], { op: "delete", id: "a" });
    expect(q).toEqual([{ op: "delete", id: "a" }]);
  });
});

describe("classifyFailure", () => {
  it("drops only writes the server says are wrong", () => {
    expect(classifyFailure({ response: { status: 400 } })).toBe("drop");
    expect(classifyFailure({ response: { status: 409 } })).toBe("drop");
  });
  it("keeps the note when the server is missing or failing", () => {
    expect(classifyFailure({ response: { status: 403 } })).toBe("retry-later");
    expect(classifyFailure({ response: { status: 404 } })).toBe("retry-later");
    expect(classifyFailure({ response: { status: 511 } })).toBe("retry-later");
    expect(classifyFailure({ response: { status: 401 } })).toBe("retry-later");
  });
  it("treats no answer as offline", () => {
    expect(classifyFailure(new Error("Network Error"))).toBe("offline");
  });
});

describe("mergeWithOutbox", () => {
  it("adds unsent notes for this slide, applies deletes, ignores other slides", () => {
    const merged = mergeWithOutbox(
      [note("server"), note("gone")],
      [
        { op: "delete", id: "gone" },
        { op: "save", note: note("new") },
        { op: "save", note: note("other", "s2") },
      ],
      "s",
    );
    expect(merged.map((n) => n.id).sort()).toEqual(["new", "server"]);
  });
  it("an unsent edit wins over the server copy", () => {
    const merged = mergeWithOutbox(
      [note("a", "s", "old")],
      [{ op: "save", note: note("a", "s", "new") }],
      "s",
    );
    expect(merged[0]?.note_text).toBe("new");
  });
});
