import { describe, expect, it } from "vitest";
import { looksLikeName, termLooksPlural } from "./display-name";

describe("looksLikeName", () => {
  it("greets real names in any script", () => {
    for (const name of ["Tara", "TARA", "tara", "A.K.", "Jean-Luc", "O'Neel", "तारा", "سارة"]) {
      expect(looksLikeName(name)).toBe(true);
    }
  });
  it("does not greet a number, an email or an id", () => {
    for (const name of ["", "  ", null, undefined, "9876543210", "tara.sample+test@example.invalid", "user_123", "tara.sample", "९८७६५"]) {
      expect(looksLikeName(name)).toBe(false);
    }
  });
  it("does not greet a run too long to be a first name", () => {
    expect(looksLikeName("x".repeat(21))).toBe(false);
    expect(looksLikeName("Venkatanarasimha")).toBe(true);
  });
});

describe("termLooksPlural", () => {
  it("spots a plural saved as the singular", () => {
    expect(termLooksPlural("chapters")).toBe(true);
    expect(termLooksPlural("chapter")).toBe(false);
    expect(termLooksPlural("class")).toBe(false);
    expect(termLooksPlural("अध्याय")).toBe(false);
  });
});
