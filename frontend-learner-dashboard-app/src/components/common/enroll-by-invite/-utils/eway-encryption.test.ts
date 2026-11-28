// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

const SRC = "https://secure.ewaypayments.com/scripts/eCrypt.min.js";
const fakeECrypt = { encryptValue: (v: string) => `eCrypted:${v}` };

const scripts = () =>
  Array.from(document.head.querySelectorAll<HTMLScriptElement>(`script[src="${SRC}"]`));

describe("loadEwayCrypt (eCrypt loaded on demand, not from index.html)", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = "";
    delete (window as { eCrypt?: unknown }).eCrypt;
  });
  afterEach(() => {
    delete (window as { eCrypt?: unknown }).eCrypt;
  });

  it("injects the script once and resolves true when it loads", async () => {
    const { loadEwayCrypt, isCryptoSupported } = await import("./eway-encryption");
    const a = loadEwayCrypt();
    const b = loadEwayCrypt();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0].async).toBe(true);

    (window as { eCrypt?: unknown }).eCrypt = fakeECrypt;
    scripts()[0].onload?.(new Event("load"));

    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(isCryptoSupported()).toBe(true);
    // Already loaded: no second tag.
    await expect(loadEwayCrypt()).resolves.toBe(true);
    expect(scripts()).toHaveLength(1);
  });

  it("waits for eCrypt.init() after the script loads (the real library defers it)", async () => {
    const { loadEwayCrypt } = await import("./eway-encryption");
    const p = loadEwayCrypt();
    // Script evaluated: the eCrypt function exists, encryptValue not yet.
    (window as { eCrypt?: unknown }).eCrypt = { encryptValue: null };
    scripts()[0].onload?.(new Event("load"));
    setTimeout(() => {
      (window as { eCrypt?: unknown }).eCrypt = fakeECrypt; // docReady → init()
    }, 60);
    await expect(p).resolves.toBe(true);
  });

  it("waits on a tag already in the page instead of adding a second one", async () => {
    const tag = document.createElement("script");
    tag.src = SRC;
    document.head.appendChild(tag);
    const { loadEwayCrypt } = await import("./eway-encryption");
    const p = loadEwayCrypt();
    expect(scripts()).toHaveLength(1);
    setTimeout(() => {
      (window as { eCrypt?: unknown }).eCrypt = fakeECrypt;
    }, 30);
    await expect(p).resolves.toBe(true);
  });

  it("does nothing when eCrypt is already on the page", async () => {
    (window as { eCrypt?: unknown }).eCrypt = fakeECrypt;
    const { loadEwayCrypt } = await import("./eway-encryption");
    await expect(loadEwayCrypt()).resolves.toBe(true);
    expect(scripts()).toHaveLength(0);
  });

  it("resolves false on a failed load and retries on the next call", async () => {
    const { loadEwayCrypt } = await import("./eway-encryption");
    const first = loadEwayCrypt();
    scripts()[0].onerror?.(new Event("error"));
    await expect(first).resolves.toBe(false);
    expect(scripts()).toHaveLength(0);

    const second = loadEwayCrypt();
    expect(scripts()).toHaveLength(1);
    (window as { eCrypt?: unknown }).eCrypt = fakeECrypt;
    scripts()[0].onload?.(new Event("load"));
    await expect(second).resolves.toBe(true);
  });

  it("encryptCardData waits for the library instead of failing", async () => {
    const { encryptCardData } = await import("./eway-encryption");
    const pending = encryptCardData(
      { name: "A B", number: "4444 3333 2222 1111", expiryMonth: "12", expiryYear: "30", cvn: "123" },
      "key"
    );
    (window as { eCrypt?: unknown }).eCrypt = fakeECrypt;
    scripts()[0].onload?.(new Event("load"));
    await expect(pending).resolves.toEqual({
      encryptedNumber: "eCrypted:4444333322221111",
      encryptedCVN: "eCrypted:123",
      encryptionMethod: "eCrypt",
    });
  });
});
