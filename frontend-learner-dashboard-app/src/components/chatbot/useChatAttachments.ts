import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { UploadFileInS3, getPublicUrl } from "@/services/upload_file";
import { getUserId } from "@/constants/getUserId";

export interface PendingAttachment {
  /** Local key; uploads finish out of order, so never address chips by index. */
  key: string;
  type: "image";
  /** Public URL once uploaded; "" while the upload runs. */
  url: string;
  name?: string;
  previewUrl?: string;
}

export interface ChatAttachments {
  attachments: PendingAttachment[];
  isUploading: boolean;
  /** Uploaded attachments in the shape `sendMessage` takes. */
  ready: Array<{ type: string; url: string; name?: string }>;
  addFile: (file: File) => void;
  remove: (key: string) => void;
  clear: () => void;
}

let keySeq = 0;

const revokePreview = (live: Set<string>, previewUrl?: string) => {
  if (!previewUrl) return;
  URL.revokeObjectURL(previewUrl);
  live.delete(previewUrl);
};

/**
 * Images the learner attached to the next message. Each one uploads to S3
 * (CHATBOT_IMAGES) as soon as it is picked or dropped; a failed upload drops
 * its chip. Owned by the panel so a drop anywhere on it lands in the composer.
 */
export const useChatAttachments = (): ChatAttachments => {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const live = previews.current;
    return () => live.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const addFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const key = `att-${++keySeq}`;
    const previewUrl = URL.createObjectURL(file);
    previews.current.add(previewUrl);
    setAttachments((prev) => [...prev, { key, type: "image", url: "", name: file.name, previewUrl }]);

    (async () => {
      try {
        const userId = await getUserId();
        const fileId = await UploadFileInS3(file, () => {}, userId || "", "CHATBOT_IMAGES", "LEARNER");
        if (!fileId) throw new Error("Upload returned no file id");
        const publicUrl = await getPublicUrl(fileId);
        if (!publicUrl) throw new Error("No public URL for uploaded file");
        setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, url: publicUrl } : a)));
      } catch (err) {
        console.error("Failed to upload image:", err);
        setAttachments((prev) => prev.filter((a) => a.key !== key));
        revokePreview(previews.current, previewUrl);
      }
    })();
  }, []);

  const remove = useCallback((key: string) => {
    setAttachments((prev) => {
      revokePreview(previews.current, prev.find((a) => a.key === key)?.previewUrl);
      return prev.filter((a) => a.key !== key);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachments((prev) => {
      prev.forEach((a) => revokePreview(previews.current, a.previewUrl));
      return [];
    });
  }, []);

  return {
    attachments,
    isUploading: attachments.some((a) => !a.url),
    ready: attachments.filter((a) => a.url).map(({ type, url, name }) => ({ type, url, name })),
    addFile,
    remove,
    clear,
  };
};

/** Drag-an-image-onto-the-panel handlers plus the state for its overlay. */
export const useImageDrop = (onFile: (file: File) => void) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const dropHandlers = {
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
    },
  };
  return { isDragOver, dropHandlers };
};
