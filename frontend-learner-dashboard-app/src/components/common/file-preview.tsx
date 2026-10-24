import { useTranslation } from "react-i18next";
import SimplePDFViewer from "@/components/common/simple-pdf-viewer";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i;

/**
 * Whether a file should be shown as an image. The real content type
 * (media-service file_type) is authoritative — a stored filename can carry a
 * stale/wrong extension. Only when the type is absent/unknown do we fall back
 * to the filename. Admin answer-sheet uploads allow PDF / JPEG / PNG, so a
 * confident non-image type (e.g. PDF) renders in the PDF viewer.
 */
export function isImageFile(
  fileType?: string | null,
  fileName?: string | null
): boolean {
  const t = (fileType || "").toLowerCase().split(";")[0].trim();
  if (t.startsWith("image/")) return true;
  if (t === "application/pdf" || t === "pdf") return false;
  // file_type may be a bare extension like "png"; treat it like one.
  if (t && IMAGE_EXT.test(`.${t}`)) return true;
  return fileName ? IMAGE_EXT.test(fileName.trim()) : false;
}

interface FilePreviewProps {
  url: string;
  fileName?: string;
  fileType?: string;
}

/**
 * Renders a media-service file in its actual format: images inline, everything
 * else (PDF) in the in-app PDF viewer. Keeps the learner side in lockstep with
 * whatever the admin uploaded instead of assuming a PDF.
 */
export function FilePreview({ url, fileName, fileType }: FilePreviewProps) {
  const { t } = useTranslation("layoutCommonA");
  if (isImageFile(fileType, fileName)) {
    return (
      <div className="flex size-full items-center justify-center overflow-auto bg-neutral-100 p-4">
        <img
          src={url}
          alt={fileName || t("filePreview.attachmentAlt")}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    );
  }
  return <SimplePDFViewer pdfUrl={url} fileName={fileName} />;
}

export default FilePreview;
