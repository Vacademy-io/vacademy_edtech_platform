"use client"

import type React from "react"

import { useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { UploadSimple, X, FileText } from "@phosphor-icons/react"

export type AllowedFileType = "pdf" | "image" | "doc" | "video" | "audio"

interface AllowedTypeSpec {
  label: string
  // File extensions including leading dot, lowercased.
  extensions: string[]
  // MIME prefix patterns used for the <input accept> attribute and validation.
  // A trailing slash (e.g. "image/") is treated as a wildcard prefix.
  mimePatterns: string[]
}

const ALLOWED_TYPE_SPECS: Record<AllowedFileType, AllowedTypeSpec> = {
  pdf: {
    label: "PDF",
    extensions: [".pdf"],
    mimePatterns: ["application/pdf"],
  },
  image: {
    label: "Image",
    extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp"],
    mimePatterns: ["image/"],
  },
  doc: {
    label: "DOC/DOCX",
    extensions: [".doc", ".docx"],
    mimePatterns: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  video: {
    label: "Video",
    extensions: [".mp4", ".mov", ".webm"],
    mimePatterns: ["video/"],
  },
  audio: {
    label: "Audio",
    extensions: [".mp3", ".wav", ".m4a"],
    mimePatterns: ["audio/"],
  },
}

const KNOWN_TYPES = Object.keys(ALLOWED_TYPE_SPECS) as AllowedFileType[]

// The admin's selection is piggybacked on the existing comma_separated_media_ids
// column with a sentinel prefix so we can tell our payload apart from a real
// media-id list. A returned empty array means "no restriction" (legacy data or
// admin explicitly left the selection blank); the uploader falls back to
// accepting any of the known types in that case.
const ALLOWED_TYPES_PREFIX = "types:"

export const parseAllowedFileTypes = (raw?: string | null): AllowedFileType[] => {
  if (!raw || !raw.startsWith(ALLOWED_TYPES_PREFIX)) return []
  // The admin's "All Files" option is encoded as the token "all", which isn't
  // one of the AllowedFileType categories below, so it's filtered out here —
  // leaving an empty array, which is exactly what "no restriction" means.
  return Array.from(
    new Set(
      raw
        .slice(ALLOWED_TYPES_PREFIX.length)
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t): t is AllowedFileType => (KNOWN_TYPES as string[]).includes(t))
    )
  )
}

const isFileAllowed = (file: File, allowed: AllowedFileType[]): boolean => {
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()
  return allowed.some((type) => {
    const spec = ALLOWED_TYPE_SPECS[type]
    const extOk = spec.extensions.some((ext) => name.endsWith(ext))
    const mimeOk =
      !!mime && spec.mimePatterns.some((p) => (p.endsWith("/") ? mime.startsWith(p) : mime === p))
    return extOk || mimeOk
  })
}

const buildAcceptAttr = (allowed: AllowedFileType[]): string =>
  allowed
    .flatMap((t) => [
      ...ALLOWED_TYPE_SPECS[t].extensions,
      ...ALLOWED_TYPE_SPECS[t].mimePatterns.map((p) => (p.endsWith("/") ? `${p}*` : p)),
    ])
    .join(",")

const buildHintLabel = (
  allowed: AllowedFileType[],
  translateLabel: (type: AllowedFileType) => string
): string => allowed.map((t) => translateLabel(t)).join(", ")

interface FileUploaderProps {
  onUpload: (file: File) => Promise<boolean>
  isUploading: boolean
  uploadedFiles: File[]
  onRemove: (index: number) => void
  allowedFileTypes?: AllowedFileType[]
  onRejected?: (file: File, reason: string) => void
}

export const FileUploader = ({
  onUpload,
  isUploading,
  uploadedFiles,
  onRemove,
  allowedFileTypes,
  onRejected,
}: FileUploaderProps) => {
  const { t } = useTranslation("libraryCommonB")
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const translateTypeLabel = (type: AllowedFileType) =>
    t(`fileUploader.types.${type}`)

  // Empty / unset → no restriction: accept any of the known types.
  const isUnrestricted = !allowedFileTypes || allowedFileTypes.length === 0
  const allowed = (isUnrestricted ? KNOWN_TYPES : allowedFileTypes) as AllowedFileType[]
  // A present-but-empty `accept=""` attribute makes some mobile browsers'
  // native file pickers default to Photos/Camera only. Omit the attribute
  // entirely (undefined) instead of an empty string so "unrestricted" truly
  // opens the general file browser.
  const acceptAttr = isUnrestricted ? undefined : buildAcceptAttr(allowed)
  const hintLabel = isUnrestricted
    ? t("fileUploader.anyFile")
    : buildHintLabel(allowed, translateTypeLabel)

  const guardedUpload = async (file: File) => {
    if (!isUnrestricted && !isFileAllowed(file, allowed)) {
      const reason = t("fileUploader.onlyTypesAllowed", { types: hintLabel })
      onRejected?.(file, reason)
      return
    }
    await onUpload(file)
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await guardedUpload(e.dataTransfer.files[0])
    }
  }

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (e.target.files && e.target.files[0]) {
      await guardedUpload(e.target.files[0])
    }
    // Reset so re-picking the same file still fires onChange
    if (inputRef.current) inputRef.current.value = ""
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " bytes"
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"
    else return (bytes / 1048576).toFixed(1) + " MB"
  }

  return (
    <div className="w-full">
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center ${
          dragActive ? "border-primary-500 bg-primary-50" : "border-gray-300"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={acceptAttr}
          onChange={handleChange}
          disabled={isUploading}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-3 bg-gray-100 rounded-full">
            <UploadSimple className="h-6 w-6 text-gray-500" />
          </div>
          <div className="text-sm text-gray-600">
            <span className="font-medium">{t("fileUploader.clickToUpload")}</span> {t("fileUploader.orDragAndDrop")}
          </div>
          <p className="text-xs text-gray-500">{t("fileUploader.sizeLimit", { hint: hintLabel })}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? t("fileUploader.uploading") : t("fileUploader.selectFile")}
          </Button>
        </div>
      </div>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium">{t("fileUploader.uploadedFiles")}</h4>
          <div className="space-y-2">
            {uploadedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-md border border-gray-200"
              >
                <div className="flex items-center space-x-3">
                  <FileText className="h-5 w-5 text-gray-500" />
                  <div>
                    <p className="text-sm font-medium truncate max-w-reg-200">{file.name}</p>
                    <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onRemove(index)} className="h-8 w-8 p-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
