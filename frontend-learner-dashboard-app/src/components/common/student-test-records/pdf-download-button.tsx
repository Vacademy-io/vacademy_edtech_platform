import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DownloadSimple, SpinnerGap } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { EXPORT_ASSESSMENT_REPORT } from "@/constants/urls";

interface PdfDownloadButtonProps {
  assessmentId: string;
  attemptId: string;
  instituteId: string;
  assessmentName?: string;
}

export function PdfDownloadButton({
  assessmentId,
  attemptId,
  instituteId,
  assessmentName,
}: PdfDownloadButtonProps) {
  const { t } = useTranslation("testRecords");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setError(false);
      const response = await authenticatedAxiosInstance({
        method: "GET",
        url: EXPORT_ASSESSMENT_REPORT,
        params: { assessmentId, attemptId, instituteId },
        responseType: "blob",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${assessmentName || "assessment"}-report.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading PDF report:", err);
      setError(true);
      setTimeout(() => setError(false), 3000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDownload}
      disabled={downloading}
      className={`gap-2 ${error ? "border-destructive text-destructive" : ""}`}
    >
      {downloading ? (
        <SpinnerGap className="h-4 w-4 animate-spin" />
      ) : (
        <DownloadSimple className="h-4 w-4" />
      )}
      {downloading
        ? t("pdfDownloadButton.downloading")
        : error
          ? t("pdfDownloadButton.downloadFailed")
          : t("pdfDownloadButton.downloadPdf")}
    </Button>
  );
}
