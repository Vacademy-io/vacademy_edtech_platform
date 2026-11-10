// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isInsideCbeWorkspace, normalizeClipboardText } from "./workspace-dom";

describe("isInsideCbeWorkspace", () => {
  it("finds the data-cbe-workspace ancestor of elements and text nodes", () => {
    document.body.innerHTML = `<div data-cbe-workspace=""><p id="in">a<b>b</b></p></div><p id="out">c</p>`;
    const inside = document.getElementById("in")!;
    expect(isInsideCbeWorkspace(inside)).toBe(true);
    expect(isInsideCbeWorkspace(inside.firstChild)).toBe(true); // text node
    expect(isInsideCbeWorkspace(document.getElementById("out"))).toBe(false);
    expect(isInsideCbeWorkspace(null)).toBe(false);
    expect(isInsideCbeWorkspace(window)).toBe(false);
  });
});

describe("normalizeClipboardText", () => {
  it("ignores whitespace differences between copy and paste serializations", () => {
    expect(normalizeClipboardText("a\tb\r\nc  d\n")).toBe(normalizeClipboardText("a b\nc d"));
    expect(normalizeClipboardText(undefined)).toBe("");
  });
});
