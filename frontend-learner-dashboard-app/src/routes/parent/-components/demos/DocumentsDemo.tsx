import { useRef } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ChildProfile, DocumentsResponse, DocumentRequirement } from "@/types/parent-portal";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FileText, UploadSimple, CheckCircle, Clock, XCircle, Trash, Camera, Image, File, Warning, ShieldCheck, FileDashed } from "@phosphor-icons/react";
import { formatDate } from "@/lib/formatters";

interface Props { child: ChildProfile; docData: DocumentsResponse }

export function DocumentsDemo({ child, docData }: Props) {
  const { t } = useTranslation("parent");
  const pct = Math.round((docData.total_approved / Math.max(docData.total_required, 1)) * 100);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full space-y-5 pb-20 lg:pb-8">
      <div><h2 className="text-lg sm:text-xl font-bold text-foreground">{t("admissionPortal.demo.nav.documents")}</h2><p className="text-sm text-muted-foreground mt-0.5">{t("admissionPortal.demo.documentsFor", { name: child.full_name })}</p></div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="shadow-sm overflow-hidden">
          <div className="h-1" style={{ background: `linear-gradient(to right, rgb(16 185 129) ${pct}%, rgb(229 231 235) ${pct}%)` }} />
          <CardContent className="p-card space-y-stack">
            <div className="flex items-center justify-between"><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /><p className="text-sm font-semibold">{t("admissionPortal.demo.percentComplete", { percent: pct })}</p></div><p className="text-xs text-muted-foreground">{t("admissionPortal.documents.verifiedOfTotal", { approved: docData.total_approved, total: docData.total_required })}</p></div>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-muted-foreground">{t("admissionPortal.documents.verifiedCount", { count: docData.total_approved })}</span></div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-muted-foreground">{t("admissionPortal.documents.underReviewCount", { count: docData.total_uploaded - docData.total_approved - docData.total_rejected })}</span></div>
              {docData.total_rejected > 0 && <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500" /><span className="text-muted-foreground">{t("admissionPortal.documents.rejectedCount", { count: docData.total_rejected })}</span></div>}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      <div className="space-y-3">{docData.documents.map((doc, i) => (
        <motion.div key={doc.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i }}>
          <DocCard doc={doc} />
        </motion.div>
      ))}</div>
    </div>
  );
}

function DocCard({ doc }: { doc: DocumentRequirement }) {
  const { t } = useTranslation("parent");
  const ref = useRef<HTMLInputElement>(null);
  const cfg = statusCfg(doc.status, t);
  const uploaded = doc.status !== "NOT_UPLOADED";
  const rejected = doc.status === "REJECTED";
  const approved = doc.status === "APPROVED";

  return (
    <Card className={`shadow-sm overflow-hidden ${rejected ? "border-destructive/30" : approved ? "border-emerald-200 dark:border-emerald-900" : ""}`}>
      <CardContent className="p-card">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${cfg.iconBg}`}>{cfg.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5"><p className="text-sm font-semibold truncate">{doc.document_name}</p>{doc.is_required && <Badge variant="outline" className="text-caption shrink-0">{t("admissionPortal.documents.required")}</Badge>}</div>
            {doc.description && <p className="text-xs text-muted-foreground mb-2">{doc.description}</p>}
            <Badge className={`${cfg.badgeBg} ${cfg.badgeText} text-caption mb-2`}>{cfg.label}</Badge>
            {uploaded && doc.uploaded_file_name && (
              <div className="flex items-center gap-2 mt-2 p-2 rounded-lg bg-muted/30 border border-border/50">
                <FIcon name={doc.uploaded_file_name} />
                <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate">{doc.uploaded_file_name}</p>{doc.uploaded_at && <p className="text-caption text-muted-foreground">{t("admissionPortal.documents.uploadedOn", { date: formatDate(doc.uploaded_at, { month: "short", day: "numeric" }) })}</p>}</div>
                {!approved && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => toast.info(t("admissionPortal.demo.deleteDemo"))}><Trash size={12} /></Button>}
              </div>
            )}
            {rejected && doc.rejection_reason && (<div className="mt-2 p-2 rounded-lg bg-destructive/5 border border-destructive/20"><p className="text-xs text-destructive flex items-start gap-1.5"><Warning size={12} className="shrink-0 mt-0.5" />{doc.rejection_reason}</p></div>)}
            {(!uploaded || rejected) && (<div className="flex items-center gap-2 mt-3">
              <input ref={ref} type="file" className="hidden" accept={doc.allowed_formats.map(f => `.${f}`).join(",")} onChange={() => toast.success(t("admissionPortal.demo.fileSelectedDemo"))} />
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => ref.current?.click()}><UploadSimple size={12} />{rejected ? t("admissionPortal.documents.reupload") : t("admissionPortal.documents.upload")}</Button>
              <Button variant="ghost" size="sm" className="gap-1.5 h-8 text-xs text-muted-foreground" onClick={() => toast.info(t("admissionPortal.demo.cameraCaptureDemo"))}><Camera size={12} />{t("admissionPortal.documents.camera")}</Button>
              <span className="text-caption text-muted-foreground ms-auto">{t("admissionPortal.documents.maxSizeAndFormats", { size: doc.max_size_mb, formats: doc.allowed_formats.join(", ").toUpperCase() })}</span>
            </div>)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return <FileDashed size={16} className="text-red-500 shrink-0" />;
  if (["jpg","jpeg","png","webp"].includes(ext||"")) return <Image size={16} className="text-blue-500 shrink-0" />;
  return <File size={16} className="text-muted-foreground shrink-0" />;
}

function statusCfg(status: string, t: TFunction) {
  const m: Record<string, { label: string; icon: React.ReactNode; iconBg: string; badgeBg: string; badgeText: string }> = {
    NOT_UPLOADED: { label: t("admissionPortal.documents.status.notUploaded"), icon: <UploadSimple size={18} className="text-muted-foreground" />, iconBg: "bg-muted", badgeBg: "bg-gray-100 dark:bg-gray-800", badgeText: "text-gray-600 dark:text-gray-300" },
    UPLOADED: { label: t("admissionPortal.documents.status.uploaded"), icon: <FileText size={18} className="text-blue-600" />, iconBg: "bg-blue-100 dark:bg-blue-900/30", badgeBg: "bg-blue-100 dark:bg-blue-900/30", badgeText: "text-blue-700 dark:text-blue-300" },
    UNDER_REVIEW: { label: t("admissionPortal.documents.status.underReview"), icon: <Clock size={18} className="text-amber-600" />, iconBg: "bg-amber-100 dark:bg-amber-900/30", badgeBg: "bg-amber-100 dark:bg-amber-900/30", badgeText: "text-amber-700 dark:text-amber-300" },
    APPROVED: { label: t("admissionPortal.documents.status.verified"), icon: <CheckCircle size={18} className="text-emerald-600" />, iconBg: "bg-emerald-100 dark:bg-emerald-900/30", badgeBg: "bg-emerald-100 dark:bg-emerald-900/30", badgeText: "text-emerald-700 dark:text-emerald-300" },
    REJECTED: { label: t("admissionPortal.documents.status.rejected"), icon: <XCircle size={18} className="text-red-600" />, iconBg: "bg-red-100 dark:bg-red-900/30", badgeBg: "bg-red-100 dark:bg-red-900/30", badgeText: "text-red-700 dark:text-red-300" },
  };
  return m[status] || m["NOT_UPLOADED"]!;
}
