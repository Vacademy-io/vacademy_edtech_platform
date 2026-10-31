import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { useTranslation } from "react-i18next";
import {
  CheckCircle,
  FilePdf,
  FileText,
  Paperclip,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { Progress } from "@/components/ui/progress";
import { getUserId } from "@/constants/getUserId";
import { parseQuestionPayload, type EngagementItem } from "@/services/engagement";
import { UploadFileInS3 } from "@/services/upload_file";
import { ecn, outcomeClasses, skinClasses } from "../engagement-tone";
import { RichText } from "./QuestionBody";

/**
 * "Show your work" (D28): a keyboard-focusable dropzone, a progress bar per
 * file, thumbnail chips with a 44 px remove button, and an error that clears on
 * the next pick.
 */

export const UPLOAD_MAX_FILES = 5;
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

const ACCEPT = {
  "image/*": [],
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

export interface UploadEntry {
  key: string;
  name: string;
  type: string;
  /** Object URL for an image thumbnail; revoked when the entry goes. */
  previewUrl?: string;
  /** 0–100 while uploading. */
  progress: number;
  status: "uploading" | "done" | "error";
  fileId?: string;
}

export interface UploadQueue {
  files: UploadEntry[];
  /** Ids of the finished uploads, in pick order. */
  fileIds: string[];
  uploading: boolean;
  /** Key under `runner.upload.errors`, or null. */
  errorKey: string | null;
  add: (files: File[]) => void;
  reject: (rejections: FileRejection[]) => void;
  remove: (key: string) => void;
}

let keySeq = 0;

/** Upload state for one task. Owned by the runner so the footer can read it. */
export function useUploadQueue(): UploadQueue {
  const [files, setFiles] = useState<UploadEntry[]>([]);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const entry of filesRef.current) {
        if (entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      }
    };
  }, []);

  const patch = useCallback((key: string, next: Partial<UploadEntry>) => {
    if (!mounted.current) return;
    setFiles((prev) => prev.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)));
  }, []);

  const add = useCallback(
    (picked: File[]) => {
      setErrorKey(null);
      const room = UPLOAD_MAX_FILES - filesRef.current.filter((f) => f.status !== "error").length;
      if (room <= 0) {
        setErrorKey("tooMany");
        return;
      }
      if (picked.length > room) setErrorKey("tooMany");
      const accepted = picked.slice(0, room);
      const entries: UploadEntry[] = accepted.map((file) => ({
        key: `upload-${(keySeq += 1)}`,
        name: file.name,
        type: file.type,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        progress: 0,
        status: "uploading",
      }));
      setFiles((prev) => [...prev, ...entries]);

      void (async () => {
        const userId = (await getUserId()) ?? "";
        await Promise.all(
          accepted.map(async (file, index) => {
            const { key } = entries[index]!;
            try {
              const fileId = await UploadFileInS3(
                file,
                () => {},
                userId,
                "ENGAGEMENT_ANSWERS",
                "LEARNER",
                (percent) => patch(key, { progress: percent })
              );
              if (fileId) patch(key, { status: "done", progress: 100, fileId });
              else {
                patch(key, { status: "error" });
                if (mounted.current) setErrorKey("failed");
              }
            } catch {
              patch(key, { status: "error" });
              if (mounted.current) setErrorKey("failed");
            }
          })
        );
      })();
    },
    [patch]
  );

  const reject = useCallback((rejections: FileRejection[]) => {
    if (rejections.length === 0) return;
    const codes = new Set(rejections.flatMap((r) => r.errors.map((e) => e.code)));
    if (codes.has("file-too-large")) setErrorKey("tooLarge");
    else if (codes.has("file-invalid-type")) setErrorKey("wrongType");
    else if (codes.has("too-many-files")) setErrorKey("tooMany");
    else setErrorKey("failed");
  }, []);

  const remove = useCallback((key: string) => {
    setErrorKey(null);
    setFiles((prev) => {
      const gone = prev.find((entry) => entry.key === key);
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((entry) => entry.key !== key);
    });
  }, []);

  return {
    files,
    fileIds: files.filter((f) => f.status === "done" && f.fileId).map((f) => f.fileId as string),
    uploading: files.some((f) => f.status === "uploading"),
    errorKey,
    add,
    reject,
    remove,
  };
}

function FileGlyph({ entry }: { entry: Pick<UploadEntry, "type" | "previewUrl"> }) {
  if (entry.previewUrl) {
    return <img src={entry.previewUrl} alt="" aria-hidden className="size-10 shrink-0 rounded-md object-cover" />;
  }
  const GlyphIcon = entry.type === "application/pdf" ? FilePdf : FileText;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [.ui-cleaner-play_&]:bg-cp-bg-deep">
      <GlyphIcon aria-hidden className="size-5" />
    </span>
  );
}

export interface UploadBodyProps {
  item: EngagementItem;
  queue: UploadQueue;
  /** Answered or read-only: list the work instead of the dropzone. */
  submitted?: boolean;
  /** File ids from the server for a task finished earlier (names unknown). */
  submittedCount?: number;
  disabled?: boolean;
}

export function UploadBody({ item, queue, submitted, submittedCount, disabled }: UploadBodyProps) {
  const { t } = useTranslation("dashboardEngagement");
  const promptId = useId();
  const hintId = useId();
  const prompt = parseQuestionPayload(item)?.prompt ?? item.promptText ?? "";
  const full = queue.files.filter((f) => f.status !== "error").length >= UPLOAD_MAX_FILES;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: ACCEPT,
    maxSize: UPLOAD_MAX_BYTES,
    multiple: true,
    disabled: disabled || submitted || full,
    onDropAccepted: queue.add,
    onDropRejected: queue.reject,
  });

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 py-5 sm:px-6">
      {prompt ? (
        <RichText id={promptId} html={prompt} className={ecn("text-subtitle font-medium", skinClasses("ink"))} />
      ) : (
        <p id={promptId} className={ecn("text-subtitle font-medium", skinClasses("ink"))}>
          {item.title}
        </p>
      )}

      {!submitted && (
        <div
          {...getRootProps({
            "aria-labelledby": promptId,
            "aria-describedby": hintId,
            role: "button",
          })}
          className={ecn(
            "flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors duration-150",
            "border-border hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
            "[.ui-play_&]:border-play-surface [.ui-cleaner-play_&]:border-cp-border",
            isDragActive && "border-primary-500 bg-primary-50 [.ui-play_&]:border-play-info-deep [.ui-play_&]:bg-play-info-soft",
            (disabled || full) && "cursor-not-allowed opacity-60"
          )}
        >
          <input {...getInputProps()} />
          <UploadSimple aria-hidden weight="bold" className="size-7 text-primary-500 [.ui-play_&]:text-play-info-deep [.ui-cleaner-play_&]:text-cp-ink" />
          <p className={ecn("text-body font-medium", skinClasses("ink"))}>
            {isDragActive ? t("runner.upload.dropHere") : t("runner.upload.choose")}
          </p>
          <p id={hintId} className={ecn("text-caption", skinClasses("mutedInk"))}>
            {t("runner.upload.hint", { count: UPLOAD_MAX_FILES, size: 25 })}
          </p>
        </div>
      )}

      {queue.errorKey && !submitted && (
        <p role="alert" className="flex items-start gap-2 text-caption text-danger-700 [.ui-play_&]:text-play-danger-soft-ink [.ui-cleaner-play_&]:text-cp-terracotta">
          <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
          <span>{t(`runner.upload.errors.${queue.errorKey}`, { count: UPLOAD_MAX_FILES, size: 25 })}</span>
        </p>
      )}

      {queue.files.length > 0 && (
        <ul aria-label={t("runner.upload.listLabel")} className="flex min-w-0 flex-col gap-2">
          {queue.files.map((entry) => (
            <li
              key={entry.key}
              className={ecn(
                "flex min-w-0 items-center gap-3 rounded-lg border bg-card py-1.5 pe-1 ps-2",
                skinClasses("divider"),
                entry.status === "error" && outcomeClasses("wrong", "option")
              )}
            >
              <FileGlyph entry={entry} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p dir="auto" className={ecn("truncate text-body", skinClasses("ink"))}>
                  {entry.name}
                </p>
                {entry.status === "uploading" ? (
                  <Progress
                    value={entry.progress}
                    aria-label={t("runner.upload.progress", { name: entry.name, percent: entry.progress })}
                    className="h-1.5 bg-muted rtl:-scale-x-100 [.ui-cleaner-play_&]:bg-cp-bg-deep"
                  />
                ) : entry.status === "done" ? (
                  <p className={ecn("flex items-center gap-1 text-caption", outcomeClasses("correct", "ink"))}>
                    <CheckCircle aria-hidden weight="fill" className="size-3.5" />
                    {t("runner.upload.uploaded")}
                  </p>
                ) : (
                  <p className={ecn("text-caption", outcomeClasses("wrong", "ink"))}>{t("runner.upload.failed")}</p>
                )}
              </div>
              {!submitted && (
                <button
                  type="button"
                  onClick={() => queue.remove(entry.key)}
                  aria-label={t("runner.upload.remove", { name: entry.name })}
                  className={ecn(
                    "flex size-11 shrink-0 items-center justify-center rounded-md transition-colors duration-150",
                    "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400",
                    skinClasses("mutedInk")
                  )}
                >
                  <X aria-hidden weight="bold" className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {submitted && queue.files.length === 0 && (submittedCount ?? 0) > 0 && (
        <p className={ecn("flex items-center gap-2 text-body", skinClasses("ink"))}>
          <Paperclip aria-hidden className="size-4 shrink-0" />
          {t("runner.upload.attached", { count: submittedCount })}
        </p>
      )}
    </div>
  );
}
