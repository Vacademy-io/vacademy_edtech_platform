import {
    GET_SIGNED_URL,
    GET_SIGNED_URL_PUBLIC,
    ACKNOWLEDGE,
    GET_PUBLIC_URL,
    GET_DETAILS,
    GET_PUBLIC_URL_PUBLIC,
} from "@/constants/urls";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { getWithETag } from "@/lib/http/etagClient";
import axios from "axios";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";

interface SignedURLResponse {
    id: string;
    url: string;
}

// interface PublicURLResponse {
//     url: string;
// }

export enum StatusCode {
    success = 200,
}

/**
 * Upload a file to S3 through a signed URL and acknowledge it. Returns the file id.
 *
 * @param onUploadProgress optional; called with 0–99 as the PUT progresses, then
 *   with 100 once the upload is acknowledged.
 */
export const UploadFileInS3 = async (
    file: File | undefined,
    setIsUploadingFile: React.Dispatch<React.SetStateAction<boolean>> = () =>
        false,
    user_id: string,
    source?: string,
    sourceId?: string,
    onUploadProgress?: (percent: number) => void
): Promise<string | undefined> => {
    setIsUploadingFile(true);
    const effectiveSource = source || "FLOOR_DOCUMENTS";
    const effectiveSourceId = sourceId || "STUDENTS";

    try {
        if (isNullOrEmptyOrUndefined(file)) {
            throw new Error("Invalid File");
        }

        if (file) {
            const signedURLData: SignedURLResponse = await getSignedURL(
                file.name.toLowerCase().replace(/\s+/g, "_"),
                file.type,
                effectiveSource,
                effectiveSourceId
            );

            const uploadResponse = await axios({
                method: "PUT",
                url: signedURLData.url,
                data: file,
                headers: {
                    // S3 stores whatever Content-Type the PUT sends. Without
                    // this, axios defaults to application/x-www-form-urlencoded,
                    // so files are stored with the wrong type (breaks PDF/image
                    // rendering and social link previews). Use the file's real
                    // MIME type (same value passed to getSignedURL above).
                    "Content-Type": file.type || "application/octet-stream",
                },
                onUploadProgress: onUploadProgress
                    ? (event) => {
                          // Some browsers omit the total; the file size is the same number.
                          const total = event.total || file.size;
                          if (!total) return;
                          // Hold at 99 until the acknowledge lands.
                          const percent = Math.round((event.loaded / total) * 100);
                          onUploadProgress(Math.min(99, Math.max(0, percent)));
                      }
                    : undefined,
            });

            if (uploadResponse.status === StatusCode.success) {
                await acknowledgeUpload(signedURLData.id, user_id);
            }
            onUploadProgress?.(100);

            setIsUploadingFile(false);
            return signedURLData.id;
        }
    } catch (error) {
        console.error(error);
        setIsUploadingFile(false);
        throw error;
    }
    return undefined;
};

const getSignedURL = async (
    file_name: string,
    file_type: string,
    source: string,
    source_id: string
) => {
    // });
    const requestBody = {
        file_name: file_name,
        file_type: file_type,
        source: source,
        source_id: source_id,
    };
    const response = await authenticatedAxiosInstance.post(
        GET_SIGNED_URL,
        requestBody
    );
    return response.data;
};

const acknowledgeUpload = async (
    file_id: string,
    user_id: string
): Promise<boolean> => {
    const requestBody = {
        file_id: file_id,
        user_id: user_id,
    };

    const response = await authenticatedAxiosInstance.post(
        ACKNOWLEDGE,
        requestBody
    );

    return response.data;
};

/** If the value is already a direct http(s) URL, return true (callers should use it as-is and not call the file API). */
export function isDirectUrl(value: string | undefined | null): value is string {
    if (!value || typeof value !== "string") return false;
    const t = value.trim();
    return t.startsWith("http://") || t.startsWith("https://");
}

export const getPublicUrl = async (
    fileId: string | undefined | null
): Promise<string> => {
    if (isDirectUrl(fileId)) return fileId.trim();
    return getWithETag<string>(
        authenticatedAxiosInstance,
        GET_PUBLIC_URL,
        { fileId, expiryDays: 7 }
    );
};

export const getPublicUrlWithoutLogin = async (
    fileId: string | undefined | null
): Promise<string> => {
    if (!fileId) return "";
    if (isDirectUrl(fileId)) return fileId.trim();
    return getWithETag<string>(
        undefined,
        GET_PUBLIC_URL_PUBLIC,
        { fileId, expiryDays: 7 },
        { withCredentials: false }
    );
};

export const getPublicUrls = async (fileIds: string | undefined | null) => {
    return getWithETag<any>(
        authenticatedAxiosInstance,
        GET_DETAILS,
        { fileIds, expiryDays: 7 }
    );
};

/** A single file's viewable details from media-service (real name + MIME type). */
export interface FileDetail {
    id?: string;
    url: string;
    fileName?: string;
    fileType?: string;
}

/**
 * Resolve a single fileId to its signed URL AND its real name/MIME type, so a
 * caller can render/download it in its actual format (PDF, JPEG, PNG, …) rather
 * than assuming one. Falls back to the URL alone for direct-URL values.
 */
export const getFileDetail = async (
    fileId: string | undefined | null
): Promise<FileDetail | null> => {
    if (!fileId) return null;
    if (isDirectUrl(fileId)) return { url: fileId.trim() };
    const res = await getWithETag<any>(
        authenticatedAxiosInstance,
        GET_DETAILS,
        { fileIds: fileId, expiryDays: 7 }
    );
    const detail = Array.isArray(res) ? res[0] : res;
    if (!detail?.url) return null;
    return {
        id: detail.id,
        url: detail.url,
        // media-service serialises snake_case; keep a camelCase fallback too.
        fileName: detail.file_name ?? detail.fileName,
        fileType: detail.file_type ?? detail.fileType,
    };
};

// Formats an evaluated copy / submission can be (admin allows PDF / JPEG / PNG;
// a few extra images kept for safety).
const MIME_TO_EXT: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/avif": "avif",
    "image/tiff": "tiff",
};

const KNOWN_EXTS = new Set<string>([
    "pdf", "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "heic", "heif",
    "avif", "tiff", "tif",
]);

// Treat equivalent spellings as the same format so we don't needlessly rename a
// user's ".jpeg" to ".jpg" (same format, different spelling).
const canonicalExt = (ext: string): string => {
    const e = ext.toLowerCase();
    if (e === "jpeg") return "jpg";
    if (e === "tif") return "tiff";
    return e;
};

/**
 * Resolve a KNOWN extension from a media-service file_type (normally a MIME like
 * "application/pdf", occasionally a bare "pdf") or a blob's own content type.
 * Returns undefined for anything we can't confidently classify, so we never
 * overwrite a good filename with a guess.
 */
const extensionFromType = (type?: string | null): string | undefined => {
    if (!type) return undefined;
    const t = type.toLowerCase().split(";")[0].trim();
    if (!t) return undefined;
    if (t.includes("/")) return MIME_TO_EXT[t];
    return KNOWN_EXTS.has(t) ? canonicalExt(t) : undefined;
};

const splitExtension = (name: string): { base: string; ext: string | null } => {
    const m = name.match(/^(.*)\.([A-Za-z0-9]{1,5})$/);
    return m ? { base: m[1], ext: m[2].toLowerCase() } : { base: name, ext: null };
};

/**
 * Download an evaluated-copy / submission file to the device in its true format.
 * The stored filename can carry a stale/wrong/no extension, so we normalise the
 * saved name to match the actual bytes, resolving the extension in order of
 * trust:
 *   1. media-service file_type (the real content type)
 *   2. the fetched blob's own S3 Content-Type
 *   3. a known extension already on the filename
 *   4. default to PDF — the admin evaluation tool uploads the annotated copy
 *      WITHOUT a MIME type (empty file_type, octet-stream on S3) and with an
 *      extension-less name, so nothing above resolves; those files are (and
 *      render as) PDFs. Real image submissions always carry a browser MIME
 *      type, so they never fall through to this default.
 * Fetching via a Blob is also what lets the download carry any extension at all
 * (the S3 signed URL has none).
 */
export const downloadFileWithName = async (
    url: string,
    fileName: string,
    fileType?: string | null
): Promise<void> => {
    const response = await axios.get(url, { responseType: "blob" });
    const blob: Blob = response.data;
    let name = (fileName || "download").trim() || "download";

    const { base, ext: nameExt } = splitExtension(name);
    const ext =
        extensionFromType(fileType) ||
        extensionFromType(blob?.type) ||
        (nameExt && KNOWN_EXTS.has(nameExt) ? canonicalExt(nameExt) : undefined) ||
        "pdf";
    // Replace a missing or format-mismatched extension; keep an equivalent one.
    if (!nameExt || canonicalExt(nameExt) !== canonicalExt(ext)) {
        name = `${base}.${ext}`;
    }

    const objectUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(objectUrl);
};

/**
 * Upload a file using the PUBLIC (unauthenticated) signed-URL endpoint.
 * Used on public-facing registration pages (live-class, audience-response)
 * where the learner is not logged in.
 *
 * Flow: POST /media-service/public/get-signed-url → PUT to S3 → return fileId.
 * The public signed-URL endpoint auto-acknowledges so no separate ACKNOWLEDGE
 * call is needed.
 */
export const UploadFilePublic = async (
    file: File,
    source = "CUSTOM_FIELD",
    sourceId = "PUBLIC_UPLOAD"
): Promise<string | undefined> => {
    const requestBody = {
        file_name: file.name.toLowerCase().replace(/\s+/g, "_"),
        file_type: file.type,
        source,
        source_id: sourceId,
    };

    // 1. Get a signed URL from the public endpoint (no auth token needed)
    const signedUrlResponse = await axios.post<SignedURLResponse>(
        GET_SIGNED_URL_PUBLIC,
        requestBody
    );
    const { id: fileId, url: signedUrl } = signedUrlResponse.data;

    // 2. Upload the file directly to S3 via the signed URL
    await axios.put(signedUrl, file);

    return fileId;
};
