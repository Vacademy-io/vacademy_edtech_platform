/**
 * Every "Download" button in the app saves its file through here.
 *
 * Web / Electron: exactly what the buttons did before — the blob + `<a download>` click, the
 * plain link click (downloadLink), and window.open when a file host refuses a fetch.
 *
 * Android / iOS app: the WebView drops `<a download>` clicks (Capacitor has no download
 * handler), so the bytes go to the in-repo `VacademyFileSave` plugin
 * (android/.../filesave/FileSavePlugin.java, ios/App/App/MainViewController.swift):
 *  - Android 10+ saves into the public Downloads folder and opens the file in the phone's viewer;
 *    Android 7–9 opens it straight from the app cache.
 *  - iOS opens the share sheet (Save to Files, Print, WhatsApp…).
 * The JS reaches older app builds by OTA before the plugin does: there, Android 11+ still saves
 * to the public Documents folder through @capacitor/filesystem, and anything else is told to
 * update the app.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { toast } from "sonner";
// The default instance that src/i18n.ts initialises at boot; importing "@/i18n" here would
// re-run that setup in every test that imports a download button.
import i18next from "i18next";
import { openInBrowser } from "@/lib/open-in-browser";

interface FileSavePlugin {
  writeChunk(options: { fileName: string; data: string; append: boolean }): Promise<void>;
  save(options: {
    fileName: string;
    mimeType: string;
    open: boolean;
  }): Promise<{ savedToDownloads: boolean; opened: boolean }>;
}

let fileSavePlugin: FileSavePlugin | undefined;
/** Registered on first use, not at import: pages (and their tests) import the download buttons. */
const fileSave = (): FileSavePlugin => (fileSavePlugin ??= registerPlugin<FileSavePlugin>("VacademyFileSave"));

/** Bytes per bridge message (~4 MB of base64). A multiple of 3, so no chunk carries padding. */
export const CHUNK_BYTES = 3 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  json: "application/json",
  zip: "application/zip",
  py: "text/x-python",
  js: "text/javascript",
};

const t = (key: string, options?: Record<string, unknown>): string =>
  String(i18next.t(`common:fileSave.${key}`, options as Record<string, string>));

/** A file name with no path separators or reserved characters, at most 150 characters, never empty. */
export function safeFileName(name: string | null | undefined, fallback = "download"): string {
  let clean = Array.from(name || "")
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.startsWith(".")) clean = `_${clean}`;
  if (clean.length > 150) {
    const dot = clean.lastIndexOf(".");
    const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : "";
    clean = clean.slice(0, 150 - ext.length) + ext;
  }
  return clean || fallback;
}

/**
 * The type for the native saver: from a known extension first, because Android's Downloads
 * folder renames a file whose type and extension disagree (code.py sent as text/plain is saved
 * as code.py.txt); else the blob's own type without parameters.
 */
function mimeTypeOf(blob: Blob, name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext]!;
  return (blob.type || "").split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
}

function blobToBase64(blob: Blob): Promise<string> {
  // Chromium and WebKit read an empty blob as "data:" with no comma.
  if (blob.size === 0) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      resolve(comma < 0 ? "" : dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(blob);
  });
}

function browserDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking at once can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** True inside the Android / iOS app; false on the web and in Electron. */
export const isNativeApp = (): boolean => {
  const platform = Capacitor.getPlatform();
  return platform === "android" || platform === "ios";
};

export interface SaveFileOptions {
  /** Android app: open the saved file in the phone's viewer (default true). Pass false for a batch. */
  open?: boolean;
}

/**
 * Saves `blob` as `fileName` on whatever the learner is using. Resolves true once the file is
 * saved (or handed to the share sheet / browser). Never rejects: when the app cannot save it,
 * the learner sees a toast (failed, or update the app) and it resolves false.
 */
export async function saveFile(blob: Blob, fileName: string, options: SaveFileOptions = {}): Promise<boolean> {
  if (!isNativeApp()) {
    browserDownload(blob, fileName);
    return true;
  }
  const name = safeFileName(fileName);

  if (Capacitor.isPluginAvailable("VacademyFileSave")) {
    try {
      let offset = 0;
      do {
        const data = await blobToBase64(blob.slice(offset, offset + CHUNK_BYTES));
        await fileSave().writeChunk({ fileName: name, data, append: offset > 0 });
        offset += CHUNK_BYTES;
      } while (offset < blob.size);
      const { savedToDownloads, opened } = await fileSave().save({
        fileName: name,
        mimeType: mimeTypeOf(blob, name),
        open: options.open ?? true,
      });
      if (savedToDownloads) toast.success(t("savedToDownloads", { name }));
      else if (!opened) toast.error(t("noAppToOpen"));
      return true;
    } catch (error) {
      console.error("Saving the file failed:", error);
      toast.error(t("saveFailed"));
      return false;
    }
  }

  // An app build from before the native saver.
  if (Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("Filesystem")) {
    try {
      const { Directory, Filesystem } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({
        path: name,
        data: await blobToBase64(blob),
        directory: Directory.Documents,
        recursive: true,
      });
      toast.success(t("savedToDocuments", { name }));
      return true;
    } catch {
      // Android 7–10 needs a storage permission these builds do not declare.
    }
  }
  toast.error(t("updateApp"));
  return false;
}

/**
 * Fetches `url` and saves it (see saveFile). `fileName` may be derived from the fetched blob,
 * e.g. to pick the extension from its type. When the file host refuses the fetch (CORS), the
 * file opens in the browser instead, where the learner can still view and save it. Never rejects.
 */
export async function saveUrl(
  url: string,
  fileName: string | ((blob: Blob) => string),
  options: SaveFileOptions = {},
): Promise<boolean> {
  let blob: Blob;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    blob = await response.blob();
  } catch {
    if (!isNativeApp()) {
      window.open(url, "_blank", "noopener,noreferrer");
      return true;
    }
    try {
      await openInBrowser(url);
      return true;
    } catch {
      toast.error(t("saveFailed"));
      return false;
    }
  }
  return saveFile(blob, typeof fileName === "function" ? fileName(blob) : fileName, options);
}

/**
 * For a button that clicks a plain link to the file (`<a href={url} download>`). On the web and
 * in Electron it still does exactly that, synchronously, so the browser treats it as the
 * learner's own click (no popup blocking). In the app, where that click does nothing, the file
 * is fetched and saved natively (saveUrl). Never rejects.
 */
export function downloadLink(
  url: string,
  fileName: string,
  attributes: { target?: string; rel?: string } = {},
): Promise<boolean> {
  if (!isNativeApp()) {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    if (attributes.target) link.target = attributes.target;
    if (attributes.rel) link.rel = attributes.rel;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return Promise.resolve(true);
  }
  return saveUrl(url, fileName);
}
