// ─────────────────────────────────────────────────────────────
// Documents Module — Upload, verify, track
// ─────────────────────────────────────────────────────────────

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ChildProfile, DocumentRequirement } from "@/types/parent-portal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  FileText,
  Upload,
  CheckCircle,
  Clock,
  XCircle,
  Trash,
  Camera,
  Image,
  FileDashed,
  File,
  SpinnerGap,
  Warning,
  ShieldCheck,
} from "@phosphor-icons/react";
import { formatDate } from "@/lib/formatters";

interface DocumentsModuleProps {
  child: ChildProfile;
}

export function DocumentsModule({ child }: DocumentsModuleProps) {
  const { t } = useTranslation("parent");
  // Placeholder data - Document upload API endpoints not implemented yet
  const docData = null;
  const isLoading = false;
  const uploadingId = null;

  const progress = docData
    ? {
        uploaded: docData.total_uploaded,
        approved: docData.total_approved,
        rejected: docData.total_rejected,
        total: docData.total_required,
        percent: Math.round(
          (docData.total_approved / Math.max(docData.total_required, 1)) * 100,
        ),
      }
    : null;

  const handleFileSelect = async (requirementId: string, file: File) => {
    // Validate file size (max size from requirement)
    const requirement = docData?.documents.find((d) => d.id === requirementId);
    if (requirement && file.size > requirement.max_size_mb * 1024 * 1024) {
      toast.error(
        t("admissionPortal.documents.toast.fileExceeds", {
          size: requirement.max_size_mb,
        }),
      );
      return;
    }

    setUploadingId(requirementId);
    uploadMutation.mutate(
      {
        child_id: child.id,
        requirement_id: requirementId,
        file,
      },
      {
        onSettled: () => setUploadingId(null),
      },
    );
  };

  const handleDelete = (requirementId: string) => {
    if (!confirm(t("admissionPortal.documents.confirmDelete"))) return;
    deleteMutation.mutate({
      childId: child.id,
      requirementId,
    });
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-5 pb-20 lg:pb-8">
      {/* Header */}
      <div>
        <h2 className="text-lg sm:text-xl font-bold text-foreground">
          {t("admissionPortal.documents.heading")}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t("admissionPortal.documents.subheading", {
            name: child.full_name,
          })}
        </p>
      </div>

      {/* ── Progress Overview ─────────────────────────────────── */}
      {progress && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <Card className="shadow-sm overflow-hidden">
            <div
              className="h-1 bg-primary/20"
              style={{
                background: `linear-gradient(to right, rgb(16 185 129) ${progress.percent}%, rgb(229 231 235) ${progress.percent}%)`,
              }}
            />
            <CardContent className="p-card space-y-stack">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-primary" />
                  <p className="text-sm font-semibold text-foreground">
                    {t("admissionPortal.documents.submissionProgress", {
                      percent: progress.percent,
                    })}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admissionPortal.documents.verifiedOfTotal", {
                    approved: progress.approved,
                    total: progress.total,
                  })}
                </p>
              </div>

              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">
                    {t("admissionPortal.documents.verifiedCount", {
                      count: progress.approved,
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-muted-foreground">
                    {t("admissionPortal.documents.underReviewCount", {
                      count:
                        progress.uploaded - progress.approved - progress.rejected,
                    })}
                  </span>
                </div>
                {progress.rejected > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-muted-foreground">
                      {t("admissionPortal.documents.rejectedCount", {
                        count: progress.rejected,
                      })}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Document List ─────────────────────────────────────── */}
      <div className="space-y-3">
        {docData?.documents.map((doc, idx) => (
          <motion.div
            key={doc.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * idx }}
          >
            <DocumentCard
              document={doc}
              onFileSelect={(file) => handleFileSelect(doc.id, file)}
              onDelete={() => handleDelete(doc.id)}
              isUploading={uploadingId === doc.id}
              isDeleting={
                deleteMutation.isPending &&
                deleteMutation.variables?.requirementId === doc.id
              }
            />
          </motion.div>
        ))}
      </div>

      {/* Empty state */}
      {docData?.documents.length === 0 && (
        <Card className="shadow-sm">
          <CardContent className="py-10 text-center">
            <FileText
              size={28}
              className="mx-auto text-muted-foreground/40 mb-3"
            />
            <p className="text-sm font-medium text-muted-foreground">
              {t("admissionPortal.documents.emptyTitle")}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {t("admissionPortal.documents.emptyBody")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Document Card ────────────────────────────────────────────

function DocumentCard({
  document: doc,
  onFileSelect,
  onDelete,
  isUploading,
  isDeleting,
}: {
  document: DocumentRequirement;
  onFileSelect: (file: File) => void;
  onDelete: () => void;
  isUploading: boolean;
  isDeleting: boolean;
}) {
  const { t } = useTranslation("parent");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusConfig = getDocStatusConfig(doc.status, t);
  const isUploaded = doc.status !== "NOT_UPLOADED";
  const isRejected = doc.status === "REJECTED";
  const isApproved = doc.status === "APPROVED";

  const handleCapture = () => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute("capture", "environment");
      fileInputRef.current.click();
    }
  };

  const handleUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute("capture");
      fileInputRef.current.click();
    }
  };

  return (
    <Card
      className={`shadow-sm overflow-hidden transition-all ${
        isRejected
          ? "border-destructive/30"
          : isApproved
            ? "border-emerald-200 dark:border-emerald-900"
            : ""
      }`}
    >
      <CardContent className="p-card">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={`p-2 rounded-lg shrink-0 ${statusConfig.iconBg}`}>
            {statusConfig.icon}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-semibold text-foreground truncate">
                {doc.document_name}
              </p>
              {doc.is_required && (
                <Badge variant="outline" className="text-caption shrink-0">
                  {t("admissionPortal.documents.required")}
                </Badge>
              )}
            </div>

            {doc.description && (
              <p className="text-xs text-muted-foreground mb-2">
                {doc.description}
              </p>
            )}

            {/* Status Badge */}
            <Badge
              className={`${statusConfig.badgeBg} ${statusConfig.badgeText} text-caption mb-2`}
            >
              {statusConfig.statusIcon}
              {statusConfig.label}
            </Badge>

            {/* Uploaded file info */}
            {isUploaded && doc.uploaded_file_name && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-muted/30 border border-border/50">
                <FileIcon filename={doc.uploaded_file_name} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">
                    {doc.uploaded_file_name}
                  </p>
                  {doc.uploaded_at && (
                    <p className="text-caption text-muted-foreground">
                      {t("admissionPortal.documents.uploadedOn", {
                        date: formatDate(doc.uploaded_at, {
                          month: "short",
                          day: "numeric",
                        }),
                      })}
                    </p>
                  )}
                </div>
                {!isApproved && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={onDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <SpinnerGap size={12} className="animate-spin" />
                    ) : (
                      <Trash size={12} />
                    )}
                  </Button>
                )}
              </div>
            )}

            {/* Rejection reason */}
            {isRejected && doc.rejection_reason && (
              <div className="mt-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20">
                <p className="text-xs text-destructive flex items-start gap-1.5">
                  <Warning size={12} className="shrink-0 mt-0.5" />
                  {doc.rejection_reason}
                </p>
              </div>
            )}

            {/* Upload buttons */}
            {(!isUploaded || isRejected) && (
              <div className="flex items-center gap-2 mt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept={doc.allowed_formats.map((f) => `.${f}`).join(",")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onFileSelect(file);
                  }}
                />

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs"
                  onClick={handleUpload}
                  disabled={isUploading}
                >
                  {isUploading ? (
                    <SpinnerGap size={12} className="animate-spin" />
                  ) : (
                    <UploadSimple size={12} />
                  )}
                  {isRejected
                    ? t("admissionPortal.documents.reupload")
                    : t("admissionPortal.documents.upload")}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 h-8 text-xs text-muted-foreground"
                  onClick={handleCapture}
                  disabled={isUploading}
                >
                  <Camera size={12} />
                  {t("admissionPortal.documents.camera")}
                </Button>

                <span className="text-caption text-muted-foreground ms-auto">
                  {t("admissionPortal.documents.maxSizeAndFormats", {
                    size: doc.max_size_mb,
                    formats: doc.allowed_formats.join(", ").toUpperCase(),
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── File Type Icon ───────────────────────────────────────────

function FileIcon({ filename }: { filename: string }) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf")
    return <FileDashed size={16} className="text-red-500 shrink-0" />;
  if (["jpg", "jpeg", "png", "webp"].includes(ext || ""))
    return <Image size={16} className="text-blue-500 shrink-0" />;
  return <File size={16} className="text-muted-foreground shrink-0" />;
}

// ── Status Config ────────────────────────────────────────────

function getDocStatusConfig(status: string, t: TFunction) {
  const map: Record<
    string,
    {
      label: string;
      icon: React.ReactNode;
      iconBg: string;
      badgeBg: string;
      badgeText: string;
      statusIcon: React.ReactNode;
    }
  > = {
    NOT_UPLOADED: {
      label: t("admissionPortal.documents.status.notUploaded"),
      icon: <UploadSimple size={18} className="text-muted-foreground" />,
      iconBg: "bg-muted",
      badgeBg: "bg-gray-100 dark:bg-gray-800",
      badgeText: "text-gray-600 dark:text-gray-300",
      statusIcon: null,
    },
    UPLOADED: {
      label: t("admissionPortal.documents.status.uploaded"),
      icon: <FileText size={18} className="text-blue-600 dark:text-blue-400" />,
      iconBg: "bg-blue-100 dark:bg-blue-900/30",
      badgeBg: "bg-blue-100 dark:bg-blue-900/30",
      badgeText: "text-blue-700 dark:text-blue-300",
      statusIcon: <UploadSimple size={10} className="me-1" />,
    },
    UNDER_REVIEW: {
      label: t("admissionPortal.documents.status.underReview"),
      icon: <Clock size={18} className="text-amber-600 dark:text-amber-400" />,
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      badgeBg: "bg-amber-100 dark:bg-amber-900/30",
      badgeText: "text-amber-700 dark:text-amber-300",
      statusIcon: <Clock size={10} className="me-1" />,
    },
    APPROVED: {
      label: t("admissionPortal.documents.status.verified"),
      icon: (
        <CheckCircle
          size={18}
          className="text-emerald-600 dark:text-emerald-400"
        />
      ),
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      badgeBg: "bg-emerald-100 dark:bg-emerald-900/30",
      badgeText: "text-emerald-700 dark:text-emerald-300",
      statusIcon: <CheckCircle size={10} className="me-1" />,
    },
    REJECTED: {
      label: t("admissionPortal.documents.status.rejected"),
      icon: <XCircle size={18} className="text-red-600 dark:text-red-400" />,
      iconBg: "bg-red-100 dark:bg-red-900/30",
      badgeBg: "bg-red-100 dark:bg-red-900/30",
      badgeText: "text-red-700 dark:text-red-300",
      statusIcon: <XCircle size={10} className="me-1" />,
    },
  };

  return map[status] || map["NOT_UPLOADED"]!;
}
