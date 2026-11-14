import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileArrowDown, ImageSquare } from "@phosphor-icons/react";

/**
 * Read-only counterpart to CustomFieldRenderer: shows a stored custom-field value the way its
 * TYPE means it, for every surface that displays an answer rather than collecting one.
 *
 * The case that actually needed this is `file`. A file field stores the uploaded object's URL as
 * its value, so every read-only view that printed `{value}` showed the viewer a long S3 URL to
 * copy-paste instead of a file to open — the editable form has always rendered a "View current
 * file" link, but the submitted-answer views never did.
 *
 * `checkbox` gets the same treatment for a smaller reason: it stores "true"/"false", which reads
 * badly as an answer.
 *
 * Anything else renders as text, deliberately — a dropdown/radio/multi_select stores the option's
 * own value, which IS its label, so there is nothing to resolve.
 */
interface CustomFieldValueDisplayProps {
  value?: string | null;
  /** custom_fields.field_type. Casing follows whichever screen created the field. */
  fieldType?: string | null;
  className?: string;
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

const isHttpUrl = (v: string) => v.startsWith("http://") || v.startsWith("https://");

/** Last path segment, percent-decoded, query/hash stripped — the uploaded file's own name. */
export const fileNameFromUrl = (url: string): string => {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").filter(Boolean).pop() ?? "";
    const decoded = decodeURIComponent(last);
    // Uploads are stored as "<uuid>-<original name>"; show the part a human recognises.
    const dashed = decoded.replace(/^[0-9a-f-]{36}-/i, "");
    return dashed || decoded || url;
  } catch {
    return url;
  }
};

const extensionOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

export const CustomFieldValueDisplay = ({
  value,
  fieldType,
  className,
}: CustomFieldValueDisplayProps) => {
  const { t } = useTranslation("userProfileExtra");
  const [previewFailed, setPreviewFailed] = useState(false);
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return (
      <span className={`text-neutral-400 ${className ?? ""}`}>
        {t("submittedFormDialog.emptyValue")}
      </span>
    );
  }

  const type = String(fieldType ?? "").trim().toLowerCase();

  if (type === "checkbox") {
    const yes = trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "yes";
    return (
      <span className={className}>
        {yes ? t("fieldValue.yes") : t("fieldValue.no")}
      </span>
    );
  }

  // A file field whose value never became a URL (upload failed, or the value predates the
  // upload flow) falls through to plain text rather than rendering a broken link.
  if (type === "file" && isHttpUrl(trimmed)) {
    const name = fileNameFromUrl(trimmed);
    const isImage = IMAGE_EXTENSIONS.includes(extensionOf(name));
    return (
      <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary-500 hover:underline"
        >
          {isImage ? <ImageSquare className="size-4" /> : <FileArrowDown className="size-4" />}
          <span className="break-all">{name}</span>
        </a>
        {isImage && !previewFailed && (
          <img
            src={trimmed}
            alt={name}
            loading="lazy"
            // A thumbnail, not a viewer — the link above is the way to see it full size.
            // onError covers an object that has since been removed or is not publicly
            // readable, so a dead image never leaves an empty broken-icon box.
            onError={() => setPreviewFailed(true)}
            className="max-h-32 w-fit rounded-md border border-neutral-200 object-contain"
          />
        )}
      </div>
    );
  }

  return <span className={`break-words ${className ?? ""}`}>{trimmed}</span>;
};
