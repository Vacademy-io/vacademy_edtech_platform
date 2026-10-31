import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Preferences } from "@capacitor/preferences";
import { DownloadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchFullAttendanceReport,
  type FullAttendanceReportStudent,
} from "@/services/attendance/getFullAttendanceReport";
import { convertHtmlToPdf } from "@/utils/html-to-pdf";
import { getInstituteDetails } from "@/services/signup-api";
import useSidebarStore from "@/components/common/layout-container/sidebar/useSidebar";

interface InstituteBranding {
  name: string;
  logoUrl: string;
  address: string;
}

/**
 * Resolve institute branding (name, logo URL, address).
 *
 * Logo + name come straight from the sidebar's Zustand store — the sidebar
 * already resolved them via getPublicUrl() at app boot, no point re-calling.
 * Address still loads from Preferences / localStorage / API since the sidebar
 * doesn't carry it.
 *
 * The provided sidebarLogoUrl is converted to a base64 data URL before render
 * so the <img crossOrigin="anonymous"> tag (needed for PDF generation via
 * html2canvas) doesn't collide with the non-CORS cached copy the sidebar
 * itself created. Without this, the report page would silently show a blank
 * logo until the user disabled cache.
 */
async function loadInstituteBranding(
  sidebarLogoUrl: string,
  sidebarName: string
): Promise<InstituteBranding | null> {
  let details: Record<string, unknown> | null = null;
  let instituteId: string | undefined;

  // 1. Capacitor Preferences (for address)
  try {
    const stored = await Preferences.get({ key: "InstituteDetails" });
    if (stored.value) details = JSON.parse(stored.value) as Record<string, unknown>;
  } catch (e) {
    console.warn("[Report] Could not read InstituteDetails from Preferences:", e);
  }

  // 2. localStorage fallback (browser context)
  if (!details) {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("InstituteDetails") : null;
      if (raw) details = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      console.warn("[Report] Could not read InstituteDetails from localStorage:", e);
    }
  }

  // 3. API fallback — needs instituteId from Preferences/localStorage or details
  instituteId =
    (details?.id as string | undefined) ??
    (details?.institute_id as string | undefined);
  if (!instituteId) {
    try {
      const idPref = await Preferences.get({ key: "instituteId" });
      instituteId = idPref.value || undefined;
    } catch { /* ignore */ }
    if (!instituteId && typeof window !== "undefined") {
      instituteId = localStorage.getItem("instituteId") || undefined;
    }
  }
  if (!details && instituteId) {
    try {
      const apiResp = await getInstituteDetails(instituteId);
      details = apiResp as unknown as Record<string, unknown>;
    } catch (e) {
      console.warn("[Report] Could not fetch institute details from API:", e);
    }
  }

  // Name: prefer sidebar's value, fall back to details
  const name =
    sidebarName ||
    (details?.institute_name as string) ||
    (details?.name as string) ||
    (details?.instituteName as string) ||
    "";

  // Address: only available from details (sidebar doesn't carry it)
  const addressLine =
    (details?.address as string) ||
    (details?.address_line as string) ||
    "";
  const city = (details?.city as string) || "";
  const state = (details?.state as string) || "";
  const country = (details?.country as string) || "";

  // Convert the sidebar's logo URL into a base64 data URL. This sidesteps the
  // CORS-vs-non-CORS browser-cache mismatch: the sidebar caches the URL without
  // CORS headers, and reusing it here with crossOrigin="anonymous" would fail
  // the CORS check and render nothing.
  let logoUrl = "";
  if (sidebarLogoUrl) {
    try {
      const resp = await fetch(sidebarLogoUrl, { cache: "no-store" });
      if (resp.ok) {
        const blob = await resp.blob();
        logoUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      // Network or CORS failure — fall back to the raw URL so at least
      // something renders; PDF may not include the logo in this case.
      logoUrl = sidebarLogoUrl;
    }
  }

  const addressParts = [addressLine, city, state, country].filter(Boolean);
  if (!name && !logoUrl && addressParts.length === 0) return null;
  return { name, logoUrl, address: addressParts.join(", ") };
}

interface SearchParams {
  from?: string;
  to?: string;
  batchId?: string;
}

export default function AttendanceReportPage() {
  const { t } = useTranslation("layoutCommonB");
  const search = useSearch({ from: "/reports/attendance/" }) as SearchParams;
  const [downloading, setDownloading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const daysBack = useMemo(() => {
    if (search.from && search.to) {
      const ms = new Date(search.to).getTime() - new Date(search.from).getTime();
      return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
    }
    return 7;
  }, [search.from, search.to]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["attendance-report", search.batchId, search.from, search.to, daysBack],
    queryFn: () =>
      fetchFullAttendanceReport({
        batchId: search.batchId,
        daysBack,
        from: search.from,
        to: search.to,
      }),
    staleTime: 60 * 1000,
  });

  // Reuse the sidebar's already-resolved logo URL + name. The sidebar populates
  // these into its Zustand store at app boot via getPublicUrl(), so this page
  // doesn't need to redo that work. Including them in the queryKey makes the
  // query refetch automatically when the sidebar finishes loading — replaces
  // the 2-second polling we used to need.
  const sidebarLogoUrl = useSidebarStore((s) => s.instituteLogoFileUrl);
  const sidebarInstituteName = useSidebarStore((s) => s.instituteName);

  const { data: branding } = useQuery({
    // v3 key — invalidates any stale cache from the previous URL-based loader.
    queryKey: [
      "institute-branding-for-report-v3",
      sidebarLogoUrl,
      sidebarInstituteName,
    ],
    queryFn: () => loadInstituteBranding(sidebarLogoUrl, sidebarInstituteName),
    staleTime: 10 * 60 * 1000,
  });

  const student: FullAttendanceReportStudent | undefined = data?.students?.[0];

  const handleDownloadPdf = async () => {
    if (!reportRef.current || !student) return;
    setDownloading(true);
    try {
      const blob = await convertHtmlToPdf(reportRef.current.outerHTML);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-report-${student.startDate}-to-${student.endDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate PDF:", err);
      alert(t("attendanceReport.pdfGenerationFailed"));
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="text-red-600">{t("attendanceReport.loadFailed")}</p>
        <p className="mt-2 text-sm text-gray-500">
          {error instanceof Error ? error.message : t("attendanceReport.unknownError")}
        </p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="text-gray-700">{t("attendanceReport.noData")}</p>
        {data?.message && <p className="mt-2 text-sm text-gray-500">{data.message}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4">
      {/* Action bar — not included in PDF */}
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-800">{t("attendanceReport.title")}</h1>
        <Button
          onClick={handleDownloadPdf}
          disabled={downloading}
          className="gap-2"
        >
          <DownloadSimple size={16} />
          {downloading ? t("attendanceReport.generating") : t("attendanceReport.downloadPdf")}
        </Button>
      </div>

      {/* Report body — what gets exported to PDF */}
      <div
        ref={reportRef}
        style={{
          fontFamily: "Arial, sans-serif",
          maxWidth: 600,
          margin: "0 auto",
          padding: 24,
          background: "#ffffff", // design-lint-ignore: PDF template inline style
        }}
      >
        {/* Branded letterhead — institute logo + name + address.
            Branding is fetched on the frontend (from Preferences + media service)
            so the email response stays lightweight. */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            borderBottom: "2px solid #e2e8f0", // design-lint-ignore: PDF template inline style
            paddingBottom: 16,
            marginBottom: 20,
          }}
        >
          <tbody>
            <tr>
              {branding?.logoUrl && (
                <td style={{ width: 80, verticalAlign: "middle", paddingRight: 16 }}>
                  <img
                    src={branding.logoUrl}
                    alt={branding.name || student.instituteName}
                    crossOrigin="anonymous"
                    style={{
                      width: 64,
                      height: 64,
                      objectFit: "contain",
                      display: "block",
                    }}
                  />
                </td>
              )}
              <td style={{ verticalAlign: "middle" }}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: "bold",
                    color: "#1a1a1a", // design-lint-ignore: PDF template inline style
                    lineHeight: 1.2,
                  }}
                >
                  {branding?.name || student.instituteName}
                </div>
                {branding?.address && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "#64748b", // design-lint-ignore: PDF template inline style
                      marginTop: 4,
                      lineHeight: 1.4,
                    }}
                  >
                    {branding.address}
                  </div>
                )}
              </td>
              <td style={{ textAlign: "right", verticalAlign: "top", fontSize: 11, color: "#94a3b8" }}> {/* design-lint-ignore: PDF template inline style */}
                <div>{t("attendanceReport.generated")}</div>
                <div style={{ marginTop: 2 }}>{new Date().toLocaleDateString()}</div>
              </td>
            </tr>
          </tbody>
        </table>

        <h2 style={{ color: "#1a1a1a", marginTop: 0 }}>{t("attendanceReport.title")}</h2> {/* design-lint-ignore: PDF template inline style */}
        <p style={{ color: "#444", lineHeight: 1.6 }}> {/* design-lint-ignore: PDF template inline style */}
          {t("attendanceReport.greeting.prefix")} <strong>{student.fullName}</strong>{t("attendanceReport.greeting.middle")}{" "}
          <strong>{student.startDate}</strong> {t("attendanceReport.greeting.to")} <strong>{student.endDate}</strong>:
        </p>

        <div
          style={{
            background: "#f0fdf4", // design-lint-ignore: PDF template inline style
            border: "1px solid #bbf7d0", // design-lint-ignore: PDF template inline style
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            margin: "20px 0",
          }}
        >
          <div
            style={{
              fontSize: 44,
              fontWeight: "bold",
              color: "#16a34a", // design-lint-ignore: PDF template inline style
              lineHeight: 1.2,
            }}
          >
            {student.attendancePercentage}%
          </div>
          <div style={{ color: "#444", marginTop: 12, fontSize: 14 }}> {/* design-lint-ignore: PDF template inline style */}
            {t("attendanceReport.attendanceRate")}
          </div>
          <div style={{ color: "#666", marginTop: 6, fontSize: 13 }}> {/* design-lint-ignore: PDF template inline style */}
            {t("attendanceReport.sessionsAttended", { count: student.sessionsAttended })}
            {" · "}
            {t("attendanceReport.minutesTotal", { count: student.totalDurationMinutes })}
          </div>
        </div>

        <h3 style={{ color: "#1e293b", marginTop: 24 }}>{t("attendanceReport.sessionDetails")}</h3> {/* design-lint-ignore: PDF template inline style */}
        {/* Reuse the exact same pre-rendered HTML the backend builds for emails */}
        <div dangerouslySetInnerHTML={{ __html: student.sessionsTableHtml }} />

        {/* Per-session engagement score breakdown — only shown when at least one
            session has score components. Hidden in email; visible only here. */}
        {student.engagementLogs.some((l) => l.engagementScore !== undefined) && (
          <div style={{ marginTop: 24 }}>
            <h3 style={{ color: "#1e293b", marginTop: 0 }}> {/* design-lint-ignore: PDF template inline style */}
              {t("attendanceReport.engagement.breakdownTitle")}
            </h3>
            <p style={{ color: "#64748b", fontSize: 12, lineHeight: 1.5, marginTop: 4 }}> {/* design-lint-ignore: PDF template inline style */}
              {t("attendanceReport.engagement.explanationPrefix")} <strong>{t("attendanceReport.engagement.attendancePts")}</strong>{" "}
              {t("attendanceReport.engagement.explanationMiddle")} <strong>{t("attendanceReport.engagement.interactionPts")}</strong>{" "}
              {t("attendanceReport.engagement.explanationSuffix")}
            </p>
            {student.engagementLogs
              .filter((l) => l.engagementScore !== undefined)
              .map((log) => {
                const sessionTitle =
                  student.sessions.find((s) => s.sessionId === log.sessionId)?.title ??
                  log.sessionId;
                const score = log.engagementScore ?? 0;
                const attPts = log.attendancePoints ?? 0;
                const intPts = log.interactionPoints ?? 0;
                const mtgMins = log.meetingDurationMinutes;
                const joined = log.providerTotalDurationMinutes ?? 0;
                const ib = log.interactionBreakdown;
                const scoreColor =
                  score >= 70 ? "#16a34a" : score >= 40 ? "#ca8a04" : "#dc2626"; // design-lint-ignore: PDF template inline style

                return (
                  <table
                    key={log.sessionId + log.scheduleId}
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      background: "#f8fafc", // design-lint-ignore: PDF template inline style
                      border: "1px solid #e2e8f0", // design-lint-ignore: PDF template inline style
                      borderRadius: 8,
                      marginBottom: 8,
                    }}
                  >
                    <tbody>
                      <tr>
                        <td style={{ padding: "10px 12px" }}>
                          <div
                            style={{
                              fontWeight: 600,
                              color: "#1e293b", // design-lint-ignore: PDF template inline style
                              fontSize: 13,
                              marginBottom: 6,
                            }}
                          >
                            {sessionTitle}
                          </div>
                          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}> {/* design-lint-ignore: PDF template inline style */}
                            <div>
                              <strong style={{ color: "#1e293b" }}>{t("attendanceReport.engagement.attendanceLabel")}</strong>{" "} {/* design-lint-ignore: PDF template inline style */}
                              {attPts}/80
                              {mtgMins !== undefined && joined > 0 && (
                                <span style={{ color: "#94a3b8" }}> {/* design-lint-ignore: PDF template inline style */}
                                  {" "}
                                  {t("attendanceReport.engagement.joinedOf", { joined, total: mtgMins })}
                                </span>
                              )}
                            </div>
                            <div>
                              <strong style={{ color: "#1e293b" }}>{t("attendanceReport.engagement.interactionsLabel")}</strong>{" "} {/* design-lint-ignore: PDF template inline style */}
                              {intPts}/20
                              {ib && (
                                <span style={{ color: "#94a3b8" }}> {/* design-lint-ignore: PDF template inline style */}
                                  {" "}
                                  ({t("attendanceReport.engagement.chats", { count: ib.chats })}
                                  , {t("attendanceReport.engagement.raises", { count: ib.raisehand })}
                                  , {t("attendanceReport.engagement.talkTime", { count: ib.talkTime })}
                                  , {t("attendanceReport.engagement.emojis", { count: ib.emojis })}
                                  , {t("attendanceReport.engagement.polls", { count: ib.pollVotes })})
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                marginTop: 6,
                                paddingTop: 6,
                                borderTop: "1px dashed #e2e8f0", // design-lint-ignore: PDF template inline style
                              }}
                            >
                              <strong style={{ color: scoreColor }}>
                                {t("attendanceReport.engagement.total", { score })}
                              </strong>
                            </div>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })}
          </div>
        )}

        <p style={{ color: "#444", lineHeight: 1.6, marginTop: 16 }}> {/* design-lint-ignore: PDF template inline style */}
          {t("attendanceReport.closingNote")}
        </p>
        <p style={{ color: "#888", fontSize: 13, marginTop: 32 }}> {/* design-lint-ignore: PDF template inline style */}
          {t("attendanceReport.bestRegards")}
          <br />
          {student.instituteName}
        </p>
      </div>
    </div>
  );
}
