import { describe, expect, it, vi } from "vitest";

// branding.ts also holds the favicon/tab-title code, which imports native and
// network modules; only the pure font-stack helpers are under test here.
vi.mock("@capacitor/preferences", () => ({ Preferences: { get: vi.fn(async () => ({ value: null })) } }));
vi.mock("@/services/upload_file", () => ({ getPublicUrlWithoutLogin: vi.fn(async () => "") }));

const { DEVANAGARI_FALLBACK_FAMILY, withArabicFallback, withDevanagariFallback } = await import("./branding");

describe("withDevanagariFallback", () => {
  it("adds the Devanagari face right after the brand font and the Arabic face", () => {
    expect(withDevanagariFallback(withArabicFallback("Poppins, sans-serif"))).toBe(
      "Poppins, 'Noto Naskh Arabic', 'Noto Sans Devanagari', sans-serif",
    );
    expect(withDevanagariFallback("'Figtree', system-ui, sans-serif")).toBe(
      "'Figtree', 'Noto Sans Devanagari', system-ui, sans-serif",
    );
  });

  it("keeps the brand font first, so Latin text renders exactly as before", () => {
    const stack = withDevanagariFallback(withArabicFallback('"Open Sans", sans-serif'));
    expect(stack.split(",")[0]).toBe('"Open Sans"');
    expect(stack.trim().endsWith("sans-serif")).toBe(true);
  });

  it("does not add the face twice", () => {
    const once = withDevanagariFallback("Mukta, sans-serif");
    expect(withDevanagariFallback(once)).toBe(once);
    expect(withDevanagariFallback('"Noto Sans Devanagari", sans-serif')).toBe('"Noto Sans Devanagari", sans-serif');
  });

  it("builds a full stack for an empty value", () => {
    const stack = withDevanagariFallback("  ");
    expect(stack).toContain("'Noto Sans Devanagari'");
    expect(stack).toContain("'Noto Naskh Arabic'");
  });

  it("names the face the catalogue shells load", () => {
    expect(DEVANAGARI_FALLBACK_FAMILY).toBe("Noto Sans Devanagari");
  });
});
