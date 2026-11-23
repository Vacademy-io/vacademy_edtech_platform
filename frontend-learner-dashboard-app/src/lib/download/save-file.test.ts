// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ name: "web", plugins: new Set<string>() }));
const plugin = vi.hoisted(() => ({
  writeChunk: vi.fn(async (_o: { fileName: string; data: string; append: boolean }) => undefined),
  save: vi.fn(async (_o: { fileName: string; mimeType: string; open: boolean }) => ({
    savedToDownloads: true,
    opened: true,
  })),
}));
const fs = vi.hoisted(() => ({ writeFile: vi.fn(async (_o: Record<string, unknown>) => ({ uri: "file://x" })) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const openInBrowser = vi.hoisted(() => vi.fn(async (_url: string) => undefined));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => platform.name,
    isPluginAvailable: (name: string) => platform.plugins.has(name),
  },
  registerPlugin: () => plugin,
}));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Documents: "DOCUMENTS" }, Filesystem: fs }));
vi.mock("sonner", () => ({ toast }));
vi.mock("i18next", () => ({ default: { t: (key: string, o?: { name?: string }) => `${key}${o?.name ? `|${o.name}` : ""}` } }));
vi.mock("@/lib/open-in-browser", () => ({ openInBrowser }));

import { CHUNK_BYTES, downloadLink, safeFileName, saveFile, saveUrl } from "./save-file";

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

beforeEach(() => {
  platform.name = "web";
  platform.plugins = new Set();
  vi.clearAllMocks();
});

describe("safeFileName", () => {
  it("strips path separators and reserved characters", () => {
    expect(safeFileName("NEP 2020 / Mock: 1?.pdf")).toBe("NEP 2020 _ Mock_ 1_.pdf");
  });
  it("never returns an empty or hidden name", () => {
    expect(safeFileName("")).toBe("download");
    expect(safeFileName("   ")).toBe("download");
    expect(safeFileName(".env")).toBe("_.env");
  });
  it("keeps the extension when shortening a long name", () => {
    const name = safeFileName(`${"a".repeat(300)}.pdf`);
    expect(name).toHaveLength(150);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

type Click = { href: string; download: string; target: string; rel: string };
const recordClicks = () => {
  const clicks: Click[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download, target: this.target, rel: this.rel });
  });
  return clicks;
};

describe("saveFile on the web (unchanged behaviour)", () => {
  it("clicks an <a download> with the name exactly as given and never calls the native plugin", async () => {
    const clicks = recordClicks();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();

    await expect(saveFile(new Blob(["%PDF"], { type: "application/pdf" }), "Report/1.pdf")).resolves.toBe(true);
    expect(clicks).toEqual([{ href: "blob:x", download: "Report/1.pdf", target: "", rel: "" }]);
    expect(plugin.writeChunk).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("behaves the same in Electron", async () => {
    platform.name = "electron";
    platform.plugins = new Set(["VacademyFileSave"]);
    const clicks = recordClicks();
    URL.createObjectURL = vi.fn(() => "blob:y");
    await saveFile(new Blob(["x"]), "a.pdf");
    expect(clicks).toHaveLength(1);
    expect(plugin.writeChunk).not.toHaveBeenCalled();
  });
});

describe("downloadLink", () => {
  it("on the web clicks the plain link synchronously, without fetching", () => {
    const clicks = recordClicks();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    void downloadLink("https://cdn.example/r.pdf", "receipt.pdf");
    // Synchronous: the click is still inside the learner's own gesture.
    expect(clicks).toEqual([{ href: "https://cdn.example/r.pdf", download: "receipt.pdf", target: "", rel: "" }]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps target and rel when the old link had them", async () => {
    const clicks = recordClicks();
    await expect(
      downloadLink("https://cdn.example/a.pdf", "a.pdf", { target: "_blank", rel: "noopener noreferrer" }),
    ).resolves.toBe(true);
    expect(clicks[0]).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
  });

  it("in the app fetches the file and saves it natively", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    const clicks = recordClicks();
    const response = { ok: true, status: 200, blob: async () => new Blob(["%PDF"], { type: "application/pdf" }) };
    globalThis.fetch = vi.fn(async () => response) as unknown as typeof fetch;
    await expect(downloadLink("https://cdn.example/c.pdf", "c.pdf")).resolves.toBe(true);
    expect(clicks).toHaveLength(0);
    expect(plugin.save).toHaveBeenCalledWith({ fileName: "c.pdf", mimeType: "application/pdf", open: true });
  });
});

describe("saveFile in the app with the native saver", () => {
  it("sends big files in chunks that add up to the original bytes, then saves and opens", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    const bytes = new Uint8Array(CHUNK_BYTES + 10).map((_, i) => i % 251);

    await expect(saveFile(new Blob([bytes], { type: "application/pdf" }), "ai report.pdf")).resolves.toBe(true);

    const calls = plugin.writeChunk.mock.calls.map(([o]) => o);
    expect(calls.map((c) => c.append)).toEqual([false, true]);
    expect(calls.every((c) => c.fileName === "ai report.pdf")).toBe(true);
    const joined = new Uint8Array([...decode(calls[0]!.data), ...decode(calls[1]!.data)]);
    expect(joined).toEqual(bytes);
    expect(plugin.save).toHaveBeenCalledWith({ fileName: "ai report.pdf", mimeType: "application/pdf", open: true });
    expect(toast.success).toHaveBeenCalledWith("common:fileSave.savedToDownloads|ai report.pdf");
  });

  it("writes an empty file once", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    await saveFile(new Blob([]), "empty.txt");
    expect(plugin.writeChunk).toHaveBeenCalledTimes(1);
    expect(plugin.writeChunk.mock.calls[0]![0]).toMatchObject({ data: "", append: false });
  });

  it("guesses the type from the extension and passes open: false through", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    await saveFile(new Blob(["x"]), "notes.docx", { open: false });
    expect(plugin.save).toHaveBeenCalledWith({
      fileName: "notes.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      open: false,
    });
  });

  it("takes the type from a known extension, so Android does not rename code.py to code.py.txt", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    await saveFile(new Blob(["print(1)"], { type: "text/plain" }), "code.py");
    expect(plugin.save.mock.calls[0]![0].mimeType).toBe("text/x-python");
  });

  it("uses the blob's type when the extension is unknown", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    await saveFile(new Blob(["x"], { type: "image/heic" }), "photo");
    expect(plugin.save.mock.calls[0]![0].mimeType).toBe("image/heic");
  });

  it("cleans the file name for the device", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    await saveFile(new Blob(["x"]), "NEP 2020 / Mock.pdf");
    expect(plugin.save.mock.calls[0]![0].fileName).toBe("NEP 2020 _ Mock.pdf");
  });

  it("drops type parameters (an Android intent would not match them)", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    await saveFile(new Blob(["# notes"], { type: "text/markdown;charset=utf-8" }), "my-notebook.md");
    expect(plugin.save.mock.calls[0]![0].mimeType).toBe("text/markdown");
  });

  it("shows no toast on iOS, where the share sheet is the feedback", async () => {
    platform.name = "ios";
    platform.plugins = new Set(["VacademyFileSave"]);
    plugin.save.mockResolvedValueOnce({ savedToDownloads: false, opened: true });
    await saveFile(new Blob(["x"], { type: "application/pdf" }), "a.pdf");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says so when no app can open the file", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    plugin.save.mockResolvedValueOnce({ savedToDownloads: false, opened: false });
    await saveFile(new Blob(["x"]), "a.xyz");
    expect(toast.error).toHaveBeenCalledWith("common:fileSave.noAppToOpen");
  });

  it("never rejects: a failed native write shows a toast and resolves false", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    plugin.writeChunk.mockRejectedValueOnce(new Error("disk full"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(saveFile(new Blob(["x"]), "a.pdf")).resolves.toBe(false);
    expect(plugin.save).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("common:fileSave.saveFailed");
  });
});

describe("saveFile on app builds from before the native saver", () => {
  it("Android saves to the public Documents folder", async () => {
    platform.name = "android";
    platform.plugins = new Set(["Filesystem"]);
    await expect(saveFile(new Blob(["%PDF"]), "r.pdf")).resolves.toBe(true);
    expect(fs.writeFile).toHaveBeenCalledWith({ path: "r.pdf", data: btoa("%PDF"), directory: "DOCUMENTS", recursive: true });
    expect(toast.success).toHaveBeenCalledWith("common:fileSave.savedToDocuments|r.pdf");
  });

  it("asks for an app update when Documents is not writable (Android 7–10)", async () => {
    platform.name = "android";
    platform.plugins = new Set(["Filesystem"]);
    fs.writeFile.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(saveFile(new Blob(["x"]), "r.pdf")).resolves.toBe(false);
    expect(toast.error).toHaveBeenCalledWith("common:fileSave.updateApp");
  });

  it("asks for an app update on iOS", async () => {
    platform.name = "ios";
    await expect(saveFile(new Blob(["x"]), "r.pdf")).resolves.toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("common:fileSave.updateApp");
  });
});

describe("saveUrl", () => {
  it("on the web falls back to window.open, as the buttons always did", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    await expect(saveUrl("https://cdn.example/c.pdf", "c.pdf")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://cdn.example/c.pdf", "_blank", "noopener,noreferrer");
    expect(openInBrowser).not.toHaveBeenCalled();
  });

  it("in the app opens the file in the in-app browser when the host refuses the fetch", async () => {
    platform.name = "ios";
    platform.plugins = new Set(["VacademyFileSave"]);
    globalThis.fetch = vi.fn(async () => new Response("no", { status: 403 })) as typeof fetch;
    await expect(saveUrl("https://cdn.example/c.pdf", "c.pdf")).resolves.toBe(true);
    expect(openInBrowser).toHaveBeenCalledWith("https://cdn.example/c.pdf");
    expect(plugin.writeChunk).not.toHaveBeenCalled();
  });

  it("names the file from the fetched blob and saves it natively", async () => {
    platform.name = "android";
    platform.plugins = new Set(["VacademyFileSave"]);
    // Not `new Response(...)`: Node's Response.blob() is not a jsdom Blob, which FileReader rejects.
    const response = { ok: true, status: 200, blob: async () => new Blob(["img"], { type: "image/png" }) };
    globalThis.fetch = vi.fn(async () => response) as unknown as typeof fetch;
    await saveUrl("https://cdn.example/x", (blob) => `slide.${blob.type === "image/png" ? "png" : "bin"}`, {
      open: false,
    });
    expect(openInBrowser).not.toHaveBeenCalled();
    expect(plugin.save).toHaveBeenCalledWith({ fileName: "slide.png", mimeType: "image/png", open: false });
  });
});
