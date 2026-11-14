import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, ArrowSquareOut, File, Image as ImageIcon, FileVideo, SpinnerGap } from "@phosphor-icons/react";
import { getPublicUrl } from "@/services/upload_file";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface FileAttachmentsProps {
  fileIds: string;
  className?: string;
  showPreview?: boolean;
}

interface FileMetadata {
  id: string;
  url?: string;
  type?: string;
  loading: boolean;
  error?: string;
}

export default function FileAttachments({
  fileIds,
  className,
  showPreview = true,
}: FileAttachmentsProps) {
  const { t } = useTranslation("planning");
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [expanded, setExpanded] = useState(showPreview);

  const fileIdArray = fileIds
    ? fileIds
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  useEffect(() => {
    if (fileIdArray.length > 0) {
      setFiles(
        fileIdArray.map((id) => ({
          id,
          loading: false,
        }))
      );
    }
  }, [fileIds]);

  const getFileIcon = (url?: string) => {
    if (!url) return File;
    const ext = url.toLowerCase();
    if (ext.match(/\.(jpg|jpeg|png|gif|svg|webp)$/)) return ImageIcon;
    if (ext.match(/\.(mp4|avi|mov|wmv|flv|webm)$/)) return FileVideo;
    return FileText;
  };

  const handleViewFile = async (fileId: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, loading: true } : f))
    );

    try {
      const url = await getPublicUrl(fileId);
      if (url) {
        setFiles((prev) =>
          prev.map((f) => (f.id === fileId ? { ...f, url, loading: false } : f))
        );
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      console.error("Error getting file URL:", error);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId
            ? { ...f, loading: false, error: t("attachments.failedToLoad") }
            : f
        )
      );
    }
  };

  if (fileIdArray.length === 0) return null;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("attachments.label")}</span>
          <Badge variant="secondary" className="text-xs">
            {fileIdArray.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="h-auto p-1"
        >
          {expanded ? t("common.close") : t("common.view")}
        </Button>
      </div>

      {expanded && (
        <div className="grid gap-2 sm:grid-cols-2">
          {files.map((file, index) => {
            const FileIcon = getFileIcon(file.url);

            return (
              <div
                key={file.id}
                className="group relative flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex size-10 items-center justify-center rounded-md bg-primary/10">
                  <FileIcon className="size-5 text-primary" />
                </div>

                <div className="flex-1 overflow-hidden">
                  <p className="truncate text-sm font-medium">
                    {t("attachments.item", { index: index + 1 })}
                  </p>
                  {file.error && (
                    <p className="text-xs text-destructive">{file.error}</p>
                  )}
                </div>

                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleViewFile(file.id)}
                    disabled={file.loading}
                    className="h-8 px-2"
                    title={t("attachments.openInNewTab")}
                  >
                    {file.loading ? (
                      <SpinnerGap className="size-4 animate-spin" />
                    ) : (
                      <ArrowSquareOut className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
