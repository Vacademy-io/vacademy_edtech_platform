package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.LeaderBoardDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.ParticipantsQuestionOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.SectionComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.SmartLeaderboardDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.context.SectionSnapshot;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Redesigned (v2) student assessment report — replaces
 * {@link HtmlBuilderService#generateStudentReportHtml} behind the
 * {@code assessment.report.v2.enabled} flag (wired in
 * {@link ReportPdfRenderService}).
 *
 * <p>Design system mirrors the institute reference report (ICEP/Elevate
 * style): white letterhead header with a strong rule and a very large student
 * name; four stat cards with thin colored top-accent bars; letter-spaced
 * small-caps section headings with a thin bottom rule; a marks-axis band
 * chart (P25–P75 shading + vertical marker lines) for "where you stand";
 * vertical grouped bar charts for section comparison; reference-styled
 * tables with a bold total row; a right-aligned footer meta line.
 *
 * <p>Rendering constraints (iText html2pdf): no JavaScript, no external
 * resources, no flexbox/grid — tables, inline-block divs, absolutely
 * positioned divs inside relative containers, and percentage-width div bars
 * only. All CSS inline in one &lt;style&gt; block.
 *
 * <p>Two layouts share this builder:
 * <ul>
 *   <li>AUTO-evaluated: full report — stat cards, band chart, performance
 *       summary, section comparison, easy misses, expertise, potential
 *       projection, leaderboard, compact answer review.</li>
 *   <li>MANUAL (pen-and-paper): header, stat cards (no time anywhere), band
 *       chart, section comparison (marks-based), section table (score/class
 *       stats only), leaderboard and an evaluated-answer-sheet note. No
 *       per-question blocks.</li>
 * </ul>
 */
@Slf4j
@Component
public class StudentReportHtmlV2Builder {

    // ---- reference palette ----
    private static final String NAVY = "#1F3864";        // headings, primary marks
    private static final String INK = "#263238";
    private static final String MUTED = "#546E7A";
    private static final String FAINT = "#8A94A3";
    private static final String BROWN = "#A98467";       // class-average series
    private static final String GREEN = "#2E7D32";       // topper series / positive
    private static final String GREEN_SOFT = "#E8F5E9";
    private static final String RED = "#C62828";
    private static final String AMBER = "#F57F17";
    private static final String BORDER = "#D9DEE7";
    private static final String RULE = "#C9D2E0";        // heading underline
    private static final String TRACK = "#E8ECF3";       // chart track
    private static final String BAND = "#CBD8EA";        // P25-P75 shading
    private static final String HL_BG = "#EAEFF7";       // leaderboard "you" row

    /** Stock default primary of {@link ReportBrandingDto} — i.e. "institute never customized". */
    private static final String LEGACY_DEFAULT_PRIMARY = "#FF6B35";
    private static final Pattern SAFE_CSS_COLOR = Pattern.compile("^#[0-9a-fA-F]{3,8}$");

    // Only glyphs that survive iText's standard fonts; question-status markers
    // are CSS dots (see {@link #dot}) because ✓ / ✗ silently vanish there.
    private static final String SYM_DOWN = "▼";

    // Vertical grouped bar chart geometry (px)
    private static final int VBAR_MAX_H = 150;   // tallest bar (100%)
    private static final int VBAR_LABEL_H = 13;  // value label strip above each bar
    private static final int VBAR_W = 32;        // single bar width

    /**
     * Band chart width in px. iText html2pdf does NOT support `left`/`width`
     * in PERCENT on absolutely positioned elements (PositionApplierUtil logs
     * "Css property left in percents is not supported"), so the chart uses a
     * fixed pixel canvas and every marker/tick/band offset is computed in px.
     * 690px ≈ the A4 content width at the report's 12mm side margins.
     */
    private static final int BAND_W = 690;

    /** Longest question / answer text rendered before truncation, so one essay cannot eat the report. */
    private static final int MAX_TEXT_CHARS = 1200;

    @Autowired
    private ReportBrandingHelper reportBrandingHelper;

    /**
     * Reused purely for per-question answer content: response/correct-option
     * extraction (both need OptionRepository to resolve option text) and the
     * CODING submission block. No layout comes from it — v2 owns the styling.
     * Safe from a Spring cycle: HtmlBuilderService's dependency graph never
     * reaches this builder.
     */
    @Autowired
    private HtmlBuilderService htmlBuilderService;

    /** Everything the builder needs — assembled by {@link ReportPdfRenderService}. */
    @Getter
    @Builder
    public static class Input {
        private final String assessmentName;
        private final StudentReportOverallDetailDto reportDetail;
        private final StudentComparisonDto comparison;
        private final ReportBrandingDto branding;
        /** Assessment.evaluationType — 'MANUAL' switches to the pen-and-paper layout. */
        private final String evaluationType;
        /** Assessment.boundStartTime — shown as the test date. */
        private final Date examDate;
        /** Assessment.duration (minutes) — the allotted time. */
        private final Integer assessmentDurationMinutes;
        /** Registration participant name, falling back to the cohort leaderboard; nullable. */
        private final String studentName;
        /** Registration username — the learner's login / enrollment id; nullable. */
        private final String registrationUsername;
        /** Registration email; nullable. */
        private final String userEmail;
        /** Not resolvable to a display name in this service today; nullable. */
        private final String batchName;
        /** Full cohort rows (ReportClassContext.fullLeaderboard); nullable. */
        private final List<LeaderBoardDto> fullLeaderboard;
        /** Section id -> name/order source (ReportClassContext.sections); nullable. */
        private final List<SectionSnapshot> sections;
        private final StudentReportAnalyticsService.StudentReportAnalytics analytics;
        /** Report option: leave out easy misses, expertise, answer review and question-wise detail. */
        private final boolean hideQuestionWise;
    }

    // ------------------------------------------------------------------ entry

    public String build(Input in) {
        if (in == null) {
            in = Input.builder().build();
        }
        boolean manual = "MANUAL".equalsIgnoreCase(in.getEvaluationType());
        ReportBrandingDto branding = in.getBranding() != null ? in.getBranding() : ReportBrandingDto.builder().build();
        String accent = resolveAccent(branding);

        StringBuilder sb = new StringBuilder(64 * 1024);
        sb.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">");
        sb.append("<title>Student Assessment Report</title>");
        appendCss(sb, accent);
        sb.append("</head><body>");

        appendWatermark(sb, branding, accent);

        sb.append("<div class=\"wrap\">");
        appendLetterhead(sb, in, branding, accent, manual);
        appendStatCards(sb, in, accent);
        appendBandChart(sb, in, accent);
        if (!manual) {
            appendPerformanceSummary(sb, in);
        }
        appendSectionComparison(sb, in, accent, manual);
        boolean questionWise = !in.isHideQuestionWise();
        if (!manual) {
            if (questionWise) {
                appendEasyMisses(sb, in);
                appendExpertise(sb, in);
            }
            appendPotential(sb, in, accent);
        }
        appendLeaderboard(sb, in);
        if (manual) {
            appendEvaluatedSheetNote(sb, in);
        } else if (questionWise) {
            appendAnswerReview(sb, in);
        }
        // The student's own attempt, question by question. Rendered for MANUAL
        // too — it self-skips when no per-question rows exist, which is the
        // usual pen-and-paper case, so the evaluated-sheet note still stands
        // alone there.
        if (questionWise) {
            appendQuestionDetail(sb, in, manual);
        }
        appendFooter(sb, in, branding);
        sb.append("</div></body></html>");
        return sb.toString();
    }

    // -------------------------------------------------------------------- css

    private void appendCss(StringBuilder sb, String accent) {
        sb.append("<style>");
        sb.append("@page { size: A4; margin: 13mm 12mm; }");
        sb.append("body { font-family: Helvetica, Arial, sans-serif; margin: 0; padding: 0; color: ")
                .append(INK).append("; font-size: 11.5px; line-height: 1.5; background: #ffffff; }");
        sb.append(".wrap { max-width: 800px; margin: 0 auto; }");
        // Letter-spaced small-caps section heading with thin bottom rule
        sb.append(".h2 { font-size: 11px; font-weight: 700; color: ").append(NAVY)
                .append("; letter-spacing: 1.5px; border-bottom: 1px solid ").append(RULE)
                .append("; padding-bottom: 4px; margin: 18px 0 10px 0; }");
        sb.append(".sect { page-break-inside: avoid; }");
        // Stat cards: white, thin colored top accent
        sb.append(".cards { width: 100%; border-collapse: separate; border-spacing: 7px 0; margin: 14px 0 4px 0; }");
        sb.append(".cards td { vertical-align: top; width: 25%; }");
        sb.append(".stat { background-color: #ffffff; border: 1px solid ").append(BORDER)
                .append("; border-radius: 6px; padding: 0 0 10px 0; text-align: center; }");
        sb.append(".stat-accent { height: 4px; border-radius: 6px 6px 0 0; }");
        sb.append(".stat-label { font-size: 8px; font-weight: 700; letter-spacing: 1.2px; color: ").append(FAINT)
                .append("; margin: 9px 0 2px 0; }");
        sb.append(".stat-value { font-size: 26px; font-weight: 800; color: ").append(INK).append("; }");
        sb.append(".stat-sub { font-size: 9px; color: ").append(MUTED).append("; margin-top: 2px; }");
        // Tables
        sb.append(".tbl { width: 100%; border-collapse: collapse; font-size: 11px; background-color: #ffffff; }");
        sb.append(".tbl th { background-color: #EEF1F6; text-align: left; padding: 6px 8px; color: ").append(MUTED)
                .append("; font-weight: 700; font-size: 9.5px; letter-spacing: 0.6px; border-bottom: 2px solid ")
                .append(BORDER).append("; }");
        sb.append(".tbl td { padding: 6px 8px; border-bottom: 1px solid #E7EBF1; }");
        sb.append(".tbl .total td { border-top: 2px solid ").append(BORDER)
                .append("; border-bottom: none; font-weight: 700; }");
        sb.append(".hl { background-color: ").append(HL_BG).append("; font-weight: 700; }");
        sb.append(".note { background-color: #E3F2FD; color: #0D47A1; padding: 8px 12px; border-radius: 4px; font-size: 11px; margin: 12px 0; }");
        sb.append(".good { background-color: ").append(GREEN_SOFT).append("; color: ").append(GREEN)
                .append("; padding: 8px 12px; border-radius: 4px; font-size: 11px; }");
        sb.append(".bullet { font-size: 11px; color: ").append(INK).append("; padding: 3px 0; }");
        sb.append(".legend { font-size: 9px; color: ").append(MUTED).append("; margin-top: 6px; }");
        // Per-question detail cards (question text, response, correct answer)
        sb.append(".qcard { border: 1px solid ").append(BORDER)
                .append("; border-radius: 5px; padding: 9px 11px; margin-bottom: 8px; page-break-inside: avoid; }");
        sb.append(".qhead { width: 100%; margin-bottom: 5px; font-size: 10.5px; }");
        sb.append(".qnum { font-weight: 700; color: ").append(NAVY).append("; }");
        sb.append(".qtype { color: ").append(FAINT).append("; font-weight: 400; }");
        sb.append(".qtext { font-size: 11px; color: ").append(INK).append("; margin: 2px 0 7px 0; }");
        sb.append(".qrow { font-size: 10.5px; margin-bottom: 3px; }");
        // 120px matches the label column the CODING block hardcodes inline, so
        // every "Your Answer:" lines up regardless of question type.
        sb.append(".qlabel { color: ").append(MUTED)
                .append("; font-weight: 700; width: 120px; vertical-align: top; padding-right: 6px; }");
        sb.append(".qfoot { font-size: 9.5px; color: ").append(FAINT).append("; margin-top: 6px; }");
        sb.append(".qexp { font-size: 10px; color: ").append(MUTED).append("; background-color: #F5F7FA; border-left: 2px solid ")
                .append(RULE).append("; padding: 5px 8px; margin-top: 6px; }");
        sb.append(".wm { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; }");
        sb.append(".wm-text { position: absolute; top: 360pt; left: 100pt; font-size: 60px; font-weight: bold; white-space: nowrap; transform: rotate(-35deg); }");
        sb.append("</style>");
    }

    private void appendWatermark(StringBuilder sb, ReportBrandingDto branding, String accent) {
        if (Boolean.TRUE.equals(branding.getShowWatermark())
                && branding.getWatermarkText() != null && !branding.getWatermarkText().isEmpty()) {
            double opacity = branding.getWatermarkOpacity() != null ? branding.getWatermarkOpacity() : 0.05;
            sb.append("<div class=\"wm\"><div class=\"wm-text\" style=\"color: ").append(accent)
                    .append("; opacity: ").append(opacity).append(";\">")
                    .append(esc(branding.getWatermarkText()))
                    .append("</div></div>");
        }
    }

    // -------------------------------------------------- 1. letterhead header

    private void appendLetterhead(StringBuilder sb, Input in, ReportBrandingDto branding, String accent, boolean manual) {
        String logoUrl = reportBrandingHelper.resolveLogoUrl(branding);
        ParticipantsQuestionOverallDetailDto detail = overall(in);

        sb.append("<table style=\"width: 100%;\"><tr>");
        // Logo tile
        if (logoUrl != null && Boolean.TRUE.equals(branding.getShowLogoInHeader())) {
            sb.append("<td style=\"width: 56px; vertical-align: middle; padding-right: 12px;\">")
                    .append("<div style=\"border: 1px solid ").append(BORDER)
                    .append("; border-radius: 6px; padding: 5px; width: 44px; text-align: center;\">")
                    .append("<img src=\"").append(escAttr(logoUrl))
                    .append("\" style=\"max-height: 40px; max-width: 40px;\" /></div></td>");
        }
        // Title block
        sb.append("<td style=\"vertical-align: middle;\">");
        sb.append("<div style=\"font-size: 19px; font-weight: 800; color: ").append(accent).append(";\">")
                .append(esc(nvl(in.getAssessmentName(), "Assessment Report"))).append("</div>");
        sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append("; margin-top: 1px;\">")
                .append("Integrated Student Performance Report").append(manual ? " · Pen &amp; Paper" : "")
                .append("</div>");
        sb.append("</td>");
        // Right-aligned test meta
        sb.append("<td style=\"vertical-align: middle; text-align: right; font-size: 10px; color: ")
                .append(MUTED).append("; white-space: nowrap;\">");
        if (in.getExamDate() != null) {
            sb.append("<div>Test date: <b style=\"color: ").append(INK).append(";\">")
                    .append(fmtDate(in.getExamDate())).append("</b></div>");
        }
        if (in.getAssessmentDurationMinutes() != null && in.getAssessmentDurationMinutes() > 0) {
            sb.append("<div>Duration: <b style=\"color: ").append(INK).append(";\">")
                    .append(in.getAssessmentDurationMinutes()).append(" min</b></div>");
        }
        sb.append("</td></tr></table>");

        // Strong rule, then the very large student name + meta line
        sb.append("<div style=\"border-bottom: 3px solid ").append(accent).append("; margin: 8px 0 10px 0;\"></div>");
        if (in.getStudentName() != null && !in.getStudentName().isBlank()) {
            sb.append("<div style=\"font-size: 27px; font-weight: 800; color: ").append(accent).append(";\">")
                    .append(esc(in.getStudentName())).append("</div>");
        }
        List<String> meta = new ArrayList<>();
        // Identity first (reference style: "SR No: 5709 · Batch: …") — a report
        // without who-it-belongs-to reads as anonymous boilerplate to parents.
        if (in.getRegistrationUsername() != null && !in.getRegistrationUsername().isBlank()) {
            meta.add("Reg. No: <b style=\"color: " + INK + ";\">" + esc(in.getRegistrationUsername()) + "</b>");
        }
        if (in.getUserEmail() != null && !in.getUserEmail().isBlank()) {
            meta.add(esc(in.getUserEmail()));
        }
        if (in.getBatchName() != null && !in.getBatchName().isBlank()) {
            meta.add("Batch: " + esc(in.getBatchName()));
        }
        Date attemptDate = detail != null && detail.getStartTime() != null ? detail.getStartTime()
                : (in.getComparison() != null ? in.getComparison().getStartTime() : null);
        if (attemptDate != null) {
            meta.add("Attempted on " + fmtDateTime(attemptDate));
        }
        Long timeTaken = detail != null ? detail.getCompletionTimeInSeconds() : null;
        if (!manual && timeTaken != null && timeTaken > 0) {
            meta.add("Time taken " + HtmlBuilderService.convertToReadableTime(timeTaken));
        }
        if (!meta.isEmpty()) {
            sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append("; margin-top: 2px;\">")
                    .append(String.join(" &nbsp;&middot;&nbsp; ", meta)).append("</div>");
        }
    }

    // ------------------------------------------------------ 2. stat cards

    private void appendStatCards(StringBuilder sb, Input in, String accent) {
        ParticipantsQuestionOverallDetailDto detail = overall(in);
        StudentComparisonDto cmp = in.getComparison();
        if (detail == null && cmp == null) {
            return;
        }
        Double marks = detail != null && detail.getAchievedMarks() != null ? detail.getAchievedMarks()
                : (cmp != null ? cmp.getStudentMarks() : null);
        Double totalMarks = cmp != null && cmp.getTotalMarks() != null ? cmp.getTotalMarks() : null;
        Integer rank = detail != null && detail.getRank() != null ? detail.getRank()
                : (cmp != null ? cmp.getStudentRank() : null);
        Long participants = cmp != null && cmp.getTotalParticipants() != null ? cmp.getTotalParticipants()
                : (in.getFullLeaderboard() != null && !in.getFullLeaderboard().isEmpty()
                        ? (long) in.getFullLeaderboard().size() : null);
        Double percentile = detail != null && detail.getPercentile() != null ? detail.getPercentile()
                : (cmp != null ? cmp.getStudentPercentile() : null);

        sb.append("<table class=\"cards\"><tr>");
        appendStatCard(sb, accent, "YOUR SCORE", fmt(marks),
                totalMarks != null ? "out of " + fmt(totalMarks) : "");
        appendStatCard(sb, BROWN, "CLASS RANK", rank != null ? String.valueOf(rank) : "-",
                participants != null ? "out of " + participants + " students" : "");
        appendStatCard(sb, GREEN, "PERCENTILE", percentile != null ? fmt(percentile) : "-",
                "of class scored below you");
        String tag = performanceTag(percentile);
        appendStatCard(sb, performanceColor(percentile), "PERFORMANCE", tag, "based on percentile");
        sb.append("</tr></table>");
    }

    private void appendStatCard(StringBuilder sb, String accentColor, String label, String value, String sub) {
        sb.append("<td><div class=\"stat\">");
        sb.append("<div class=\"stat-accent\" style=\"background-color: ").append(accentColor).append(";\"></div>");
        sb.append("<div class=\"stat-label\">").append(label).append("</div>");
        sb.append("<div class=\"stat-value\"").append(value.length() > 8 ? " style=\"font-size: 17px; padding-top: 5px;\"" : "")
                .append(">").append(value).append("</div>");
        sb.append("<div class=\"stat-sub\">").append(sub.isEmpty() ? "&nbsp;" : sub).append("</div>");
        sb.append("</div></td>");
    }

    /**
     * Performance tag banding (documented per spec): percentile &ge; 75 —
     * "Excellent"; 50–74.9 — "On Track"; 25–49.9 — "Needs Push"; below 25 —
     * "Needs Attention". Null percentile renders a dash.
     */
    private static String performanceTag(Double percentile) {
        if (percentile == null) return "-";
        if (percentile >= 75) return "Excellent";
        if (percentile >= 50) return "On Track";
        if (percentile >= 25) return "Needs Push";
        return "Needs Attention";
    }

    private static String performanceColor(Double percentile) {
        if (percentile == null) return FAINT;
        if (percentile >= 75) return GREEN;
        if (percentile >= 50) return NAVY;
        if (percentile >= 25) return AMBER;
        return RED;
    }

    // ------------------------------------------- 3. band chart (where you stand)

    private void appendBandChart(StringBuilder sb, Input in, String accent) {
        StudentComparisonDto cmp = in.getComparison();
        StudentReportAnalyticsService.ClassDistribution dist = in.getAnalytics() != null
                ? in.getAnalytics().getDistribution() : null;

        Double totalMarks = cmp != null ? cmp.getTotalMarks() : null;
        if (totalMarks == null || totalMarks <= 0) {
            totalMarks = dist != null && dist.getTopper() != null && dist.getTopper() > 0 ? dist.getTopper() : 100.0;
        }
        ParticipantsQuestionOverallDetailDto detail = overall(in);
        Double you = detail != null && detail.getAchievedMarks() != null ? detail.getAchievedMarks()
                : (cmp != null ? cmp.getStudentMarks() : null);
        Double mean = dist != null && dist.getMean() != null ? dist.getMean()
                : (cmp != null ? cmp.getAverageMarks() : null);
        Double median = dist != null ? dist.getMedian() : null;
        Double topper = dist != null && dist.getTopper() != null ? dist.getTopper()
                : (cmp != null ? cmp.getHighestMarks() : null);
        if (you == null && mean == null && topper == null) {
            return;
        }
        double[] quartiles = cohortQuartiles(in.getFullLeaderboard());

        sb.append("<div class=\"sect\">");
        sb.append("<div class=\"h2\">WHERE YOU STAND — OVERALL (OUT OF ").append(fmt(totalMarks)).append(")</div>");

        // Chart canvas: relative container with a fixed px width — every
        // track/band/marker/tick offset is computed in px because iText does
        // not honour percent-based `left`/`width` on absolute elements.
        // Rows: 0-13 "You" label | 16-44 marker lines | 22-38 track+band | 46-56 ticks
        sb.append("<div style=\"position: relative; height: 60px; width: ").append(BAND_W)
                .append("px; margin: 4px 0 0 0;\">");
        // Track
        sb.append("<div style=\"position: absolute; top: 22px; left: 0; width: ").append(BAND_W)
                .append("px; height: 16px; background-color: ").append(TRACK).append("; border-radius: 3px;\"></div>");
        // P25-P75 band
        if (quartiles != null && quartiles[1] > quartiles[0]) {
            int x25 = bandX(quartiles[0], totalMarks);
            int x75 = bandX(quartiles[1], totalMarks);
            sb.append("<div style=\"position: absolute; top: 22px; left: ").append(x25)
                    .append("px; width: ").append(Math.max(1, x75 - x25)).append("px; height: 16px; background-color: ")
                    .append(BAND).append(";\"></div>");
        }
        // Marker lines (solid = div bg; dotted/dashed = border-left)
        if (mean != null) {
            appendMarkerLine(sb, bandX(mean, totalMarks), "border-left: 2px dotted " + BROWN + ";");
        }
        if (median != null) {
            appendMarkerLine(sb, bandX(median, totalMarks), "border-left: 2px dashed " + MUTED + ";");
        }
        if (topper != null) {
            appendMarkerLine(sb, bandX(topper, totalMarks), "width: 3px; background-color: " + GREEN + ";");
        }
        if (you != null) {
            int yx = bandX(you, totalMarks);
            appendMarkerLine(sb, yx, "width: 3px; background-color: " + accent + ";");
            // "You" label above the marker, kept inside the canvas
            int labelLeft = Math.max(0, Math.min(BAND_W - 70, yx - 24));
            sb.append("<div style=\"position: absolute; top: 0; left: ").append(labelLeft)
                    .append("px; font-size: 9.5px; font-weight: 700; color: ").append(accent).append(";\">")
                    .append(SYM_DOWN).append(" You ").append(fmt(you)).append("</div>");
        }
        // Ticks
        for (double tick : ticks(totalMarks)) {
            int tx = Math.min(bandX(tick, totalMarks), BAND_W - 22);
            sb.append("<div style=\"position: absolute; top: 44px; left: ").append(tx)
                    .append("px; font-size: 8px; color: ").append(FAINT).append(";\">")
                    .append(fmt(tick)).append("</div>");
        }
        sb.append("</div>");

        // Legend line, reference style
        sb.append("<div class=\"legend\">");
        if (you != null) {
            sb.append(legendBar(accent)).append(" You ").append(fmt(you)).append(" &nbsp;&nbsp;");
        }
        if (mean != null) {
            sb.append("<span style=\"color: ").append(BROWN).append("; font-weight: 700;\">&middot;&middot;&middot;&middot;</span> Mean ")
                    .append(fmt(mean)).append(" &nbsp;&nbsp;");
        }
        if (median != null) {
            sb.append("<span style=\"color: ").append(MUTED).append("; font-weight: 700;\">&ndash; &ndash;</span> Median ")
                    .append(fmt(median)).append(" &nbsp;&nbsp;");
        }
        if (topper != null) {
            sb.append(legendBar(GREEN)).append(" Class topper ").append(fmt(topper));
        }
        if (quartiles != null && quartiles[1] > quartiles[0]) {
            sb.append(" &nbsp;&nbsp;<span style=\"display: inline-block; width: 10px; height: 9px; background-color: ")
                    .append(BAND).append(";\"></span> Middle half of class");
        }
        sb.append("</div></div>");
    }

    private void appendMarkerLine(StringBuilder sb, int leftPx, String strokeCss) {
        sb.append("<div style=\"position: absolute; top: 16px; height: 28px; left: ")
                .append(leftPx).append("px; ").append(strokeCss).append("\"></div>");
    }

    /** Marks value -> x offset on the fixed-width band canvas. */
    private static int bandX(Double value, Double outOf) {
        return (int) Math.round(clampPct(pct(value, outOf)) / 100.0 * BAND_W);
    }

    /** Small solid vertical bar for the legend (glyph ▎ is not in iText's standard fonts). */
    private static String legendBar(String color) {
        return "<span style=\"display: inline-block; width: 3px; height: 10px; background-color: " + color + ";\"></span>";
    }

    /** Tick values 0..total on a readable step, always ending at the total. */
    private static List<Double> ticks(double total) {
        double step = total <= 60 ? 10 : total <= 200 ? 20 : 50;
        List<Double> out = new ArrayList<>();
        for (double t = 0; t < total; t += step) {
            if (total - t >= step * 0.4) {
                out.add(t);
            }
        }
        out.add(total);
        return out;
    }

    /** [P25, P75] of cohort marks, or null when fewer than 4 scores exist. */
    private static double[] cohortQuartiles(List<LeaderBoardDto> cohort) {
        if (cohort == null) return null;
        List<Double> marks = cohort.stream()
                .map(LeaderBoardDto::getAchievedMarks)
                .filter(Objects::nonNull)
                .sorted()
                .toList();
        if (marks.size() < 4) return null;
        int n = marks.size();
        return new double[]{marks.get((int) Math.floor(0.25 * (n - 1))), marks.get((int) Math.floor(0.75 * (n - 1)))};
    }

    // -------------------------------------- 4. summary of your performance

    private void appendPerformanceSummary(StringBuilder sb, Input in) {
        StudentComparisonDto cmp = in.getComparison();
        if (cmp == null || cmp.getSectionWiseComparison() == null || cmp.getSectionWiseComparison().isEmpty()) {
            return;
        }
        List<SectionComparisonDto> rated = cmp.getSectionWiseComparison().stream()
                .filter(s -> s.getStudentAccuracy() != null && s.getClassAccuracy() != null && s.getSectionName() != null)
                .toList();
        if (rated.isEmpty()) {
            return;
        }
        SectionComparisonDto best = Collections.max(rated,
                Comparator.comparingDouble(s -> s.getStudentAccuracy() - s.getClassAccuracy()));
        SectionComparisonDto weakest = Collections.min(rated,
                Comparator.comparingDouble(s -> s.getStudentAccuracy() - s.getClassAccuracy()));

        sb.append("<div class=\"sect\">");
        sb.append("<div class=\"h2\">SUMMARY OF YOUR PERFORMANCE</div>");
        sb.append("<div class=\"bullet\">&bull;&nbsp; <b>Your Strengths.</b> Strongest section: <b>")
                .append(esc(best.getSectionName())).append("</b> &mdash; ")
                .append(fmt(best.getStudentAccuracy())).append("% against a class average of ")
                .append(fmt(best.getClassAccuracy())).append("%.</div>");
        if (rated.size() > 1 && weakest != best) {
            boolean belowClass = weakest.getStudentAccuracy() < weakest.getClassAccuracy();
            if (belowClass) {
                sb.append("<div class=\"bullet\">&bull;&nbsp; <b>Key Areas to Work On.</b> <b>")
                        .append(esc(weakest.getSectionName())).append("</b> needs attention &mdash; ")
                        .append(fmt(weakest.getStudentAccuracy())).append("% against a class average of ")
                        .append(fmt(weakest.getClassAccuracy())).append("%.</div>");
            } else {
                // Smallest lead, but still ahead — don't frame it as a weakness.
                sb.append("<div class=\"bullet\">&bull;&nbsp; <b>Key Areas to Work On.</b> You are above the class average in every section; the smallest lead is in <b>")
                        .append(esc(weakest.getSectionName())).append("</b> (")
                        .append(fmt(weakest.getStudentAccuracy())).append("% vs ")
                        .append(fmt(weakest.getClassAccuracy())).append("%).</div>");
            }
        }
        sb.append("</div>");
    }

    // ---------------------- 5+6. section comparison (vertical bars) + table

    private void appendSectionComparison(StringBuilder sb, Input in, String accent, boolean manual) {
        StudentComparisonDto cmp = in.getComparison();
        List<SectionComparisonDto> comparisons = cmp != null && cmp.getSectionWiseComparison() != null
                ? cmp.getSectionWiseComparison() : Collections.emptyList();
        Map<String, List<StudentReportAnswerReviewDto>> reviews = reviewsBySection(in);
        if (comparisons.isEmpty() && reviews.isEmpty()) {
            return;
        }
        Map<String, SectionComparisonDto> comparisonById = new LinkedHashMap<>();
        for (SectionComparisonDto c : comparisons) {
            if (c != null && c.getSectionId() != null) {
                comparisonById.put(c.getSectionId(), c);
            }
        }
        List<SectionView> sections = orderedSections(in, comparisonById, reviews);
        if (sections.isEmpty()) {
            return;
        }

        // ---- Vertical grouped bar chart ----
        boolean anyChartable = sections.stream().anyMatch(s -> {
            SectionComparisonDto c = comparisonById.get(s.id());
            return c != null && c.getSectionTotalMarks() != null && c.getSectionTotalMarks() > 0;
        });
        if (anyChartable) {
            sb.append("<div class=\"sect\">");
            sb.append("<div class=\"h2\">SECTION COMPARISON — YOU VS CLASS AVERAGE VS SECTION TOPPER</div>");
            // Legend row above the chart
            sb.append("<div style=\"font-size: 9px; color: ").append(MUTED).append("; margin-bottom: 6px;\">")
                    .append(legendSwatch(accent)).append(" You &nbsp;&nbsp;")
                    .append(legendSwatch(BROWN)).append(" Class average &nbsp;&nbsp;")
                    .append(legendSwatch(GREEN)).append(" Section topper</div>");
            // Table-cell chart: iText collapses empty spacer divs and does not
            // bottom-align inline-blocks reliably, so each bar lives in a
            // fixed-height cell with vertical-align:bottom (spec fallback).
            List<SectionView> chartSections = sections.stream()
                    .filter(s -> {
                        SectionComparisonDto c = comparisonById.get(s.id());
                        return c != null && c.getSectionTotalMarks() != null && c.getSectionTotalMarks() > 0;
                    })
                    .toList();
            sb.append("<table style=\"border-collapse: collapse; margin: 0 auto;\"><tr>");
            for (int i = 0; i < chartSections.size(); i++) {
                SectionComparisonDto c = comparisonById.get(chartSections.get(i).id());
                double outOf = c.getSectionTotalMarks();
                appendVBarCell(sb, c.getStudentMarks(), outOf, accent);
                appendVBarCell(sb, c.getSectionAverageMarks(), outOf, BROWN);
                appendVBarCell(sb, c.getSectionHighestMarks(), outOf, GREEN);
                if (i < chartSections.size() - 1) {
                    sb.append("<td style=\"width: 30px; border-bottom: 2px solid ").append(RULE).append(";\"></td>");
                }
            }
            sb.append("</tr><tr>");
            for (int i = 0; i < chartSections.size(); i++) {
                sb.append("<td colspan=\"3\" style=\"text-align: center; font-size: 9.5px; font-weight: 700; color: ")
                        .append(INK).append("; padding-top: 4px;\">")
                        .append(esc(sectionName(chartSections.get(i)))).append("</td>");
                if (i < chartSections.size() - 1) {
                    sb.append("<td></td>");
                }
            }
            sb.append("</tr></table></div>");
        }

        // ---- Section-wise performance table ----
        sb.append("<div class=\"sect\" style=\"page-break-inside: auto;\">");
        sb.append("<div class=\"h2\">SECTION-WISE PERFORMANCE</div>");
        sb.append("<table class=\"tbl\">");
        sb.append("<tr><th>SECTION</th>");
        if (!manual) {
            sb.append("<th style=\"text-align: right;\">CORRECT</th>")
                    .append("<th style=\"text-align: right;\">PARTIAL</th>")
                    .append("<th style=\"text-align: right;\">INCORRECT</th>")
                    .append("<th style=\"text-align: right;\">NOT ANSWERED</th>");
        }
        sb.append("<th style=\"text-align: right;\">SCORE</th>")
                .append("<th style=\"text-align: right;\">CLASS MAX</th>")
                .append("<th style=\"text-align: right;\">CLASS AVG</th></tr>");
        int tCorrect = 0, tPartial = 0, tIncorrect = 0, tNotAnswered = 0;
        boolean anyRow = false;
        for (SectionView section : sections) {
            SectionComparisonDto c = comparisonById.get(section.id());
            List<StudentReportAnswerReviewDto> rows = reviews.getOrDefault(section.id(), Collections.emptyList());
            if (c == null && rows.isEmpty()) {
                continue;
            }
            anyRow = true;
            sb.append("<tr><td><b>").append(esc(sectionName(section))).append("</b></td>");
            if (!manual) {
                SectionCounts counts = countStatuses(rows);
                tCorrect += counts.correct();
                tPartial += counts.partial();
                tIncorrect += counts.incorrect();
                tNotAnswered += counts.notAnswered();
                sb.append("<td style=\"text-align: right; color: ").append(GREEN).append(";\">").append(counts.correct()).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(AMBER).append(";\">").append(counts.partial()).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(RED).append(";\">").append(counts.incorrect()).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">").append(counts.notAnswered()).append("</td>");
            }
            String score = c != null ? fmt(c.getStudentMarks())
                    + (c.getSectionTotalMarks() != null ? " / " + fmt(c.getSectionTotalMarks()) : "") : "-";
            sb.append("<td style=\"text-align: right;\"><b>").append(score).append("</b></td>");
            sb.append("<td style=\"text-align: right;\">").append(c != null ? fmt(c.getSectionHighestMarks()) : "-").append("</td>");
            sb.append("<td style=\"text-align: right;\">").append(c != null ? fmt(c.getSectionAverageMarks()) : "-").append("</td>");
            sb.append("</tr>");
        }
        // Bold total row (overall figures, not per-section sums, for max/avg)
        if (anyRow && cmp != null) {
            sb.append("<tr class=\"total\"><td>TOTAL</td>");
            if (!manual) {
                sb.append("<td style=\"text-align: right; color: ").append(GREEN).append(";\">").append(tCorrect).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(AMBER).append(";\">").append(tPartial).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(RED).append(";\">").append(tIncorrect).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">").append(tNotAnswered).append("</td>");
            }
            sb.append("<td style=\"text-align: right;\">").append(fmt(cmp.getStudentMarks()))
                    .append(cmp.getTotalMarks() != null ? " / " + fmt(cmp.getTotalMarks()) : "").append("</td>");
            sb.append("<td style=\"text-align: right;\">").append(fmt(cmp.getHighestMarks())).append("</td>");
            sb.append("<td style=\"text-align: right;\">").append(fmt(cmp.getAverageMarks())).append("</td>");
            sb.append("</tr>");
        }
        sb.append("</table></div>");
    }

    /**
     * One vertical bar as a fixed-height, bottom-aligned table cell: value
     * label sits directly on top of the colored bar; the cell's bottom
     * border is the chart baseline.
     */
    private void appendVBarCell(StringBuilder sb, Double value, double outOf, String color) {
        double p = clampPct(pct(value != null ? value : 0.0, outOf));
        int barH = (int) Math.round(p / 100.0 * VBAR_MAX_H);
        if (p > 0 && barH < 2) barH = 2;
        sb.append("<td style=\"width: ").append(VBAR_W).append("px; height: ").append(VBAR_MAX_H + VBAR_LABEL_H)
                .append("px; vertical-align: bottom; padding: 0 3px; border-bottom: 2px solid ").append(RULE).append(";\">");
        sb.append("<div style=\"font-size: 8.5px; text-align: center; color: ").append(INK).append(";\">")
                .append(fmt(p)).append("%</div>");
        sb.append("<div style=\"height: ").append(barH).append("px; background-color: ").append(color)
                .append("; border-radius: 2px 2px 0 0;\"></div>");
        sb.append("</td>");
    }

    private static String legendSwatch(String color) {
        return "<span style=\"display: inline-block; width: 9px; height: 9px; background-color: " + color + "; border-radius: 2px;\"></span>";
    }

    // ------------------------------------------------------ 6. easy misses

    private void appendEasyMisses(StringBuilder sb, Input in) {
        StudentReportAnalyticsService.StudentReportAnalytics analytics = in.getAnalytics();
        if (analytics == null || !analytics.isQuestionInsightsAvailable()) {
            return;
        }
        sb.append("<div class=\"sect\"><div class=\"h2\">EASY MISSES</div>");
        List<StudentReportAnalyticsService.QuestionInsightRow> rows = analytics.getEasyMisses();
        if (rows == null || rows.isEmpty()) {
            sb.append("<div class=\"good\">").append(dot(GREEN))
                    .append("No easy misses &mdash; you converted every question that most of the class got right.</div>");
        } else {
            sb.append("<div class=\"legend\" style=\"margin: 0 0 6px 0;\">Questions at least 60% of the class answered correctly, but you did not.</div>");
            appendInsightTable(sb, in, rows);
        }
        sb.append("</div>");
    }

    // -------------------------------------------------------- 7. expertise

    private void appendExpertise(StringBuilder sb, Input in) {
        StudentReportAnalyticsService.StudentReportAnalytics analytics = in.getAnalytics();
        if (analytics == null || !analytics.isQuestionInsightsAvailable()
                || analytics.getExpertise() == null || analytics.getExpertise().isEmpty()) {
            return;
        }
        sb.append("<div class=\"sect\"><div class=\"h2\">YOUR EXPERTISE</div>");
        sb.append("<div class=\"legend\" style=\"margin: 0 0 6px 0;\">Questions 30% or less of the class answered correctly &mdash; and you did.</div>");
        appendInsightTable(sb, in, analytics.getExpertise());
        sb.append("</div>");
    }

    private void appendInsightTable(StringBuilder sb, Input in,
                                    List<StudentReportAnalyticsService.QuestionInsightRow> rows) {
        Map<String, String> sectionNames = sectionNamesById(in);
        boolean multiSection = sectionNames.size() > 1;
        sb.append("<table class=\"tbl\"><tr><th>QUESTION</th>");
        if (multiSection) {
            sb.append("<th>SECTION</th>");
        }
        sb.append("<th style=\"text-align: right;\">CLASS ANSWERED CORRECTLY</th>")
                .append("<th style=\"text-align: right;\">YOUR RESULT</th></tr>");
        for (StudentReportAnalyticsService.QuestionInsightRow row : rows) {
            sb.append("<tr><td>Q").append(row.getQuestionNumber() != null ? row.getQuestionNumber() : "-").append("</td>");
            if (multiSection) {
                sb.append("<td>").append(esc(sectionNames.getOrDefault(row.getSectionId(), "-"))).append("</td>");
            }
            sb.append("<td style=\"text-align: right;\">").append(fmt(row.getClassCorrectPercent())).append("%</td>");
            sb.append("<td style=\"text-align: right; color: ").append(statusColor(row.getStudentStatus()))
                    .append("; font-weight: 700;\">").append(dot(statusColor(row.getStudentStatus())))
                    .append(statusLabel(row.getStudentStatus())).append("</td></tr>");
        }
        sb.append("</table>");
    }

    // -------------------------------------------------------- 8. potential

    private void appendPotential(StringBuilder sb, Input in, String accent) {
        StudentReportAnalyticsService.StudentReportAnalytics analytics = in.getAnalytics();
        StudentReportAnalyticsService.PotentialProjection potential = analytics != null ? analytics.getPotential() : null;
        if (analytics == null || !analytics.isQuestionInsightsAvailable() || potential == null) {
            return;
        }
        sb.append("<div class=\"sect\"><div class=\"h2\">YOUR POTENTIAL</div>");
        sb.append("<table class=\"cards\" style=\"margin: 6px 0 4px 0;\"><tr>");
        appendPotentialCell(sb, accent, "SCORE", fmt(potential.getCurrentScore()), fmt(potential.getPotentialScore()));
        if (potential.getCurrentRank() != null && potential.getPotentialRank() != null) {
            appendPotentialCell(sb, accent, "RANK", "#" + potential.getCurrentRank(), "#" + potential.getPotentialRank());
        }
        if (potential.getPotentialPercentile() != null) {
            appendPotentialCell(sb, accent, "PERCENTILE",
                    potential.getCurrentPercentile() != null ? fmt(potential.getCurrentPercentile()) : "-",
                    fmt(potential.getPotentialPercentile()));
        }
        sb.append("</tr></table>");
        sb.append("<div class=\"legend\">Based on the ").append(potential.getSkippedQuestionsConsidered())
                .append(" question(s) you left unanswered: had you attempted them with the class's average success rate, ")
                .append("your score could have reached ").append(fmt(potential.getPotentialScore())).append(".</div>");
        sb.append("</div>");
    }

    private void appendPotentialCell(StringBuilder sb, String accent, String label, String from, String to) {
        sb.append("<td><div class=\"stat\">");
        sb.append("<div class=\"stat-accent\" style=\"background-color: ").append(accent).append(";\"></div>");
        sb.append("<div class=\"stat-label\">").append(label).append("</div>");
        sb.append("<div style=\"font-size: 18px; font-weight: 800; padding: 2px 0;\">")
                .append("<span style=\"color: ").append(MUTED).append(";\">").append(from).append("</span>")
                .append("<span style=\"color: ").append(FAINT).append("; font-weight: 400;\"> &rarr; </span>")
                .append("<span style=\"color: ").append(accent).append(";\">").append(to).append("</span></div>");
        sb.append("</div></td>");
    }

    // ------------------------------------------------------ 9. leaderboard

    private void appendLeaderboard(StringBuilder sb, Input in) {
        List<LeaderBoardDto> rows = leaderboardRows(in);
        if (rows.isEmpty()) {
            return;
        }
        String studentAttemptId = overall(in) != null ? overall(in).getAttemptId() : null;
        int topCount = Math.min(8, rows.size());
        int[] displayRanks = displayRanks(rows);

        sb.append("<div class=\"sect\"><div class=\"h2\">LEADERBOARD</div>");
        sb.append("<table class=\"tbl\"><tr><th style=\"width: 12%;\">RANK</th><th>NAME</th>")
                .append("<th style=\"text-align: right;\">MARKS</th>")
                .append("<th style=\"text-align: right;\">PERCENTILE</th></tr>");
        boolean studentShown = false;
        for (int i = 0; i < topCount; i++) {
            LeaderBoardDto row = rows.get(i);
            boolean isStudent = studentAttemptId != null && studentAttemptId.equals(row.getAttemptId());
            studentShown |= isStudent;
            appendLeaderboardRow(sb, row, displayRanks[i], isStudent);
        }
        if (!studentShown && studentAttemptId != null) {
            for (int i = topCount; i < rows.size(); i++) {
                if (studentAttemptId.equals(rows.get(i).getAttemptId())) {
                    sb.append("<tr><td colspan=\"4\" style=\"text-align: center; color: ").append(FAINT)
                            .append(";\">&middot;&middot;&middot;</td></tr>");
                    appendLeaderboardRow(sb, rows.get(i), displayRanks[i], true);
                    break;
                }
            }
        }
        sb.append("</table></div>");
    }

    private void appendLeaderboardRow(StringBuilder sb, LeaderBoardDto row, int displayRank, boolean isStudent) {
        Double marks = row.getAchievedMarks();
        sb.append("<tr").append(isStudent ? " class=\"hl\"" : "").append(">");
        sb.append("<td>#").append(displayRank).append("</td>");
        sb.append("<td>").append(esc(nvl(row.getStudentName(), "-")))
                .append(isStudent ? " <span style=\"font-size: 9px; color: " + NAVY + ";\">(You)</span>" : "")
                .append("</td>");
        sb.append("<td style=\"text-align: right;\">").append(fmt(marks)).append("</td>");
        // A percentile among a block of zero-mark rows is noise — show a dash there.
        String pctl = marks != null && marks == 0.0 ? "-"
                : (row.getPercentile() != null ? fmt(row.getPercentile()) : "-");
        sb.append("<td style=\"text-align: right;\">").append(pctl).append("</td>");
        sb.append("</tr>");
    }

    /**
     * Reference-style tie handling: rows with equal marks share the same
     * displayed rank (the first row's position), e.g. two students on 35
     * both show #4.
     */
    private static int[] displayRanks(List<LeaderBoardDto> rows) {
        int[] out = new int[rows.size()];
        for (int i = 0; i < rows.size(); i++) {
            Double marks = rows.get(i).getAchievedMarks();
            Double prev = i > 0 ? rows.get(i - 1).getAchievedMarks() : null;
            if (i > 0 && marks != null && prev != null && Math.abs(marks - prev) < 0.0001) {
                out[i] = out[i - 1];
            } else {
                Integer r = rows.get(i).getRank();
                out[i] = r != null ? r : i + 1;
            }
        }
        return out;
    }

    /** Full cohort rows when available; otherwise merged SmartLeaderboardDto rows. */
    private List<LeaderBoardDto> leaderboardRows(Input in) {
        if (in.getFullLeaderboard() != null && !in.getFullLeaderboard().isEmpty()) {
            return in.getFullLeaderboard();
        }
        SmartLeaderboardDto smart = in.getComparison() != null ? in.getComparison().getLeaderboard() : null;
        if (smart == null) {
            return Collections.emptyList();
        }
        Map<String, LeaderBoardDto> byAttempt = new LinkedHashMap<>();
        for (List<LeaderBoardDto> part : List.of(
                smart.getTopRanks() != null ? smart.getTopRanks() : Collections.<LeaderBoardDto>emptyList(),
                smart.getSurroundingRanks() != null ? smart.getSurroundingRanks() : Collections.<LeaderBoardDto>emptyList())) {
            for (LeaderBoardDto row : part) {
                if (row != null && row.getAttemptId() != null) {
                    byAttempt.putIfAbsent(row.getAttemptId(), row);
                }
            }
        }
        List<LeaderBoardDto> merged = new ArrayList<>(byAttempt.values());
        merged.sort(Comparator.comparing(LeaderBoardDto::getRank, Comparator.nullsLast(Integer::compareTo)));
        return merged;
    }

    // -------------------------------------------------- 10. answer review

    private void appendAnswerReview(StringBuilder sb, Input in) {
        Map<String, List<StudentReportAnswerReviewDto>> reviews = reviewsBySection(in);
        if (reviews.isEmpty()) {
            return;
        }
        List<SectionView> sections = orderedSections(in, Collections.emptyMap(), reviews);

        sb.append("<div style=\"page-break-before: always;\"></div>");
        sb.append("<div>");
        sb.append("<div class=\"h2\">ANSWER REVIEW</div>");
        for (SectionView section : sections) {
            List<StudentReportAnswerReviewDto> rows = reviews.getOrDefault(section.id(), Collections.emptyList());
            if (rows.isEmpty()) {
                continue;
            }
            List<StudentReportAnswerReviewDto> sorted = new ArrayList<>(rows);
            sorted.sort(Comparator.comparing(StudentReportAnswerReviewDto::getQuestionOrder,
                    Comparator.nullsLast(Integer::compareTo)));

            sb.append("<div style=\"font-size: 11px; font-weight: 700; color: ").append(INK)
                    .append("; padding: 8px 0 4px 0;\">").append(esc(sectionName(section))).append("</div>");
            sb.append("<table class=\"tbl\"><tr><th style=\"width: 12%;\">Q. NO.</th>")
                    .append("<th>RESULT</th>")
                    .append("<th style=\"text-align: right;\">MARKS</th>")
                    .append("<th style=\"text-align: right;\">TIME</th></tr>");
            int fallbackNumber = 1;
            for (StudentReportAnswerReviewDto row : sorted) {
                Integer number = row.getQuestionOrder();
                sb.append("<tr><td>Q").append(number != null ? number : fallbackNumber).append("</td>");
                sb.append("<td style=\"color: ").append(statusColor(row.getAnswerStatus()))
                        .append("; font-weight: 700;\">").append(dot(statusColor(row.getAnswerStatus())))
                        .append(statusLabel(row.getAnswerStatus())).append("</td>");
                sb.append("<td style=\"text-align: right;\">").append(fmt(row.getMark())).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                        .append(row.getTimeTakenInSeconds() != null && row.getTimeTakenInSeconds() > 0
                                ? HtmlBuilderService.convertToReadableTime(row.getTimeTakenInSeconds()) : "-")
                        .append("</td></tr>");
                fallbackNumber++;
            }
            sb.append("</table>");
        }
        sb.append("</div>");
    }

    // ------------------------------- 10b. question-wise detail (responses)

    /**
     * The student's actual attempt, question by question: question text, the
     * response they submitted, the correct answer when they missed it, the
     * coding submission, evaluator/AI feedback and the explanation.
     *
     * <p>This is the detail the compact ANSWER REVIEW table above summarizes.
     * v2 originally shipped with the summary table alone, which silently
     * dropped every response from the PDF once the download paths moved onto
     * this builder — restored here in the v2 design language.
     *
     * <p>Answer content is extracted by {@link HtmlBuilderService} (option ids
     * need resolving against OptionRepository, and the CODING block is a
     * self-contained renderer); the layout is v2's.
     */
    private void appendQuestionDetail(StringBuilder sb, Input in, boolean manual) {
        Map<String, List<StudentReportAnswerReviewDto>> reviews = reviewsBySection(in);
        if (reviews.isEmpty()) {
            return;
        }
        List<SectionView> sections = orderedSections(in, Collections.emptyMap(), reviews);

        // Build into a scratch buffer first: only emit the page break and the
        // heading if at least one card actually rendered.
        StringBuilder body = new StringBuilder(16 * 1024);
        boolean anyRendered = false;
        for (SectionView section : sections) {
            List<StudentReportAnswerReviewDto> rows = reviews.getOrDefault(section.id(), Collections.emptyList());
            if (rows.isEmpty()) {
                continue;
            }
            List<StudentReportAnswerReviewDto> sorted = new ArrayList<>(rows);
            sorted.sort(Comparator.comparing(StudentReportAnswerReviewDto::getQuestionOrder,
                    Comparator.nullsLast(Integer::compareTo)));

            body.append("<div style=\"font-size: 11px; font-weight: 700; color: ").append(INK)
                    .append("; padding: 10px 0 5px 0;\">").append(esc(sectionName(section))).append("</div>");
            int fallbackNumber = 1;
            for (StudentReportAnswerReviewDto row : sorted) {
                if (row == null) {
                    continue;
                }
                Integer number = row.getQuestionOrder();
                appendQuestionCard(body, row, number != null ? number : fallbackNumber, manual);
                fallbackNumber++;
                anyRendered = true;
            }
        }
        if (!anyRendered) {
            return;
        }

        sb.append("<div style=\"page-break-before: always;\"></div>");
        sb.append("<div>");
        sb.append("<div class=\"h2\">QUESTION-WISE DETAIL</div>");
        sb.append(body);
        sb.append("</div>");
    }

    private void appendQuestionCard(StringBuilder sb, StudentReportAnswerReviewDto row, int number, boolean manual) {
        String status = row.getAnswerStatus();
        String color = statusColor(status);

        sb.append("<div class=\"qcard\" style=\"border-left: 3px solid ").append(color).append(";\">");

        // Header: "Q3. MCQ Single" on the left, status on the right.
        sb.append("<table class=\"qhead\"><tr><td><span class=\"qnum\">Q").append(number).append(".</span>");
        String type = HtmlBuilderService.formatQuestionType(row.getQuestionType());
        if (!type.isEmpty()) {
            sb.append(" <span class=\"qtype\">").append(esc(type)).append("</span>");
        }
        sb.append("</td><td style=\"text-align: right; color: ").append(color).append("; font-weight: 700;\">")
                .append(dot(color)).append(statusLabel(status)).append("</td></tr></table>");

        String questionText = HtmlBuilderService.stripHtmlTags(row.getQuestionName());
        if (!questionText.isBlank()) {
            sb.append("<div class=\"qtext\">").append(esc(truncate(questionText))).append("</div>");
        }

        appendStudentAnswer(sb, row, status);
        appendCorrectAnswer(sb, row, status);

        // Evaluator remark / AI copy-check feedback — the same per-question
        // feedback the learner dashboard's answer review shows.
        String feedback = row.getEvaluatorFeedback() != null && !row.getEvaluatorFeedback().isBlank()
                ? row.getEvaluatorFeedback()
                : row.getAiFeedback();
        if (feedback != null && !feedback.isBlank()) {
            appendQuestionRow(sb, "Feedback", HtmlBuilderService.stripHtmlTags(feedback), MUTED);
        }
        appendAiCriteriaBreakdown(sb, row.getAiCriteriaBreakdown());

        // Marks, and time only where time is meaningful (never on MANUAL).
        StringBuilder foot = new StringBuilder();
        boolean scored = QuestionResponseEnum.CORRECT.name().equals(status)
                || QuestionResponseEnum.PARTIAL_CORRECT.name().equals(status);
        foot.append(scored && row.getMark() > 0 ? "+" : "").append(fmt(row.getMark())).append(" marks");
        if (!manual && row.getTimeTakenInSeconds() != null && row.getTimeTakenInSeconds() > 0) {
            foot.append(" &nbsp;|&nbsp; ").append(HtmlBuilderService.convertToReadableTime(row.getTimeTakenInSeconds()));
        }
        sb.append("<div class=\"qfoot\">").append(foot).append("</div>");

        String explanation = HtmlBuilderService.stripHtmlTags(row.getExplanation());
        if (!explanation.isBlank()) {
            sb.append("<div class=\"qexp\"><b>Explanation:</b> ").append(esc(truncate(explanation))).append("</div>");
        }

        sb.append("</div>");
    }

    /** "Your Answer" — mirrors the legacy branches, including the direct-marks and not-attempted cases. */
    private void appendStudentAnswer(StringBuilder sb, StudentReportAnswerReviewDto row, String status) {
        String response = row.getStudentResponseOptions();
        if (response != null && "CODING".equals(row.getQuestionType())) {
            // Self-contained renderer: summary line, test-case breakdown,
            // runtime metrics and the submitted source in a monospace block.
            htmlBuilderService.appendCodingAnswerBlock(sb, response, row.getCorrectOptions(), status);
            return;
        }
        if (response != null) {
            List<String> answers = htmlBuilderService.extractResponseContent(response);
            if (!answers.isEmpty()) {
                String color = QuestionResponseEnum.CORRECT.name().equals(status) ? GREEN
                        : (QuestionResponseEnum.INCORRECT.name().equals(status) ? RED : INK);
                appendQuestionRow(sb, "Your Answer", String.join(", ", answers), color);
                return;
            }
        }
        if (row.getMark() != 0) {
            // Direct marks entry — no response JSON, but marks were awarded.
            appendQuestionRow(sb, "Your Answer", "Marks awarded directly (" + fmt(row.getMark()) + ")",
                    row.getMark() > 0 ? GREEN : RED);
            return;
        }
        appendQuestionRow(sb, "Your Answer", "Not attempted", FAINT);
    }

    /** The correct answer, shown only when the student did not get full credit. */
    private void appendCorrectAnswer(StringBuilder sb, StudentReportAnswerReviewDto row, String status) {
        if (row.getCorrectOptions() == null || QuestionResponseEnum.CORRECT.name().equals(status)) {
            return;
        }
        List<String> correct = htmlBuilderService.extractContent(row.getCorrectOptions());
        if (correct.isEmpty()) {
            return;
        }
        appendQuestionRow(sb, "CODING".equals(row.getQuestionType()) ? "Graded On" : "Correct Answer",
                String.join(", ", correct), GREEN);
    }

    private void appendQuestionRow(StringBuilder sb, String label, String value, String color) {
        sb.append("<table class=\"qrow\"><tr><td class=\"qlabel\">").append(label).append(":</td>")
                .append("<td style=\"color: ").append(color).append(";\">")
                .append(esc(truncate(value))).append("</td></tr></table>");
    }

    /**
     * Renders the rubric returned by copy-check AI.  It is stored as JSON on
     * question_wise_marks, so it needs to be decoded before a PDF is created;
     * otherwise the report shows the awarded score but hides why it was given.
     */
    private void appendAiCriteriaBreakdown(StringBuilder sb, String rawBreakdown) {
        if (rawBreakdown == null || rawBreakdown.isBlank()) {
            return;
        }
        try {
            JsonNode criteria = new ObjectMapper().readTree(rawBreakdown);
            if (!criteria.isArray() || criteria.isEmpty()) {
                return;
            }
            sb.append("<div style=\"margin: 7px 0 4px 0; padding: 7px 9px; background: #F6F8FB; border-left: 2px solid ")
                    .append(NAVY).append("; font-size: 10px;\">")
                    .append("<div style=\"font-weight: 700; color: ").append(NAVY)
                    .append("; margin-bottom: 4px;\">AI EVALUATION</div>");
            for (JsonNode criterion : criteria) {
                String name = criterion.path("criteria_name").asText("Criterion");
                String marks = criterion.has("marks") && !criterion.get("marks").isNull()
                        ? criterion.get("marks").asText() : "-";
                String reason = criterion.path("reason").asText("");
                sb.append("<div style=\"margin-top: 3px;\"><b>").append(esc(name)).append(" (")
                        .append(esc(marks)).append(" marks):</b>");
                if (!reason.isBlank()) {
                    sb.append(" ").append(esc(truncate(HtmlBuilderService.stripHtmlTags(reason))));
                }
                sb.append("</div>");
            }
            sb.append("</div>");
        } catch (Exception ignored) {
            // An older or malformed stored AI result must never prevent a report download.
        }
    }

    /** One long essay answer must not push the rest of the report off the page. */
    private static String truncate(String text) {
        if (text == null) {
            return "";
        }
        String trimmed = text.trim();
        return trimmed.length() > MAX_TEXT_CHARS ? trimmed.substring(0, MAX_TEXT_CHARS) + " ..." : trimmed;
    }

    // ------------------------------------------- manual: evaluated sheet

    private void appendEvaluatedSheetNote(StringBuilder sb, Input in) {
        if (in.getReportDetail() != null && in.getReportDetail().getEvaluatedFileId() != null
                && !in.getReportDetail().getEvaluatedFileId().isBlank()) {
            sb.append("<div class=\"note\">Your evaluated answer sheet is available in the app.</div>");
        }
    }

    // ------------------------------------------------------- 11. footer

    private void appendFooter(StringBuilder sb, Input in, ReportBrandingDto branding) {
        String footerText = branding.getFooterText() != null && !branding.getFooterText().isEmpty()
                ? branding.getFooterText()
                : "This report is auto-generated. For queries, contact your institute administrator.";
        StringBuilder meta = new StringBuilder();
        if (in.getStudentName() != null && !in.getStudentName().isBlank()) {
            meta.append(esc(in.getStudentName())).append(" &middot; ");
        }
        meta.append(esc(nvl(in.getAssessmentName(), "Assessment")))
                .append(" &mdash; ").append(fmtDateTime(new Date()))
                .append(" | ID: ").append(generateReportId());

        sb.append("<div style=\"margin-top: 18px; border-top: 1px solid ").append(BORDER).append("; padding-top: 6px;\">");
        sb.append("<div style=\"font-size: 9px; color: ").append(FAINT).append("; text-align: right;\">")
                .append(meta).append("</div>");
        sb.append("<div style=\"font-size: 9px; color: ").append(FAINT).append("; margin-top: 2px;\">")
                .append(esc(footerText)).append("</div>");
        sb.append("</div>");
    }

    // -------------------------------------------------------- section utils

    private record SectionView(String id, String name) {
    }

    private record SectionCounts(int correct, int partial, int incorrect, int notAnswered) {
    }

    private Map<String, List<StudentReportAnswerReviewDto>> reviewsBySection(Input in) {
        if (in.getReportDetail() == null || in.getReportDetail().getAllSections() == null) {
            return Collections.emptyMap();
        }
        return in.getReportDetail().getAllSections();
    }

    /**
     * Sections in display order: snapshot order first (by sectionOrder), then
     * any comparison-only sections, then any review-map-only section ids —
     * the allSections map is keyed by section id.
     */
    private List<SectionView> orderedSections(Input in,
                                              Map<String, SectionComparisonDto> comparisonById,
                                              Map<String, List<StudentReportAnswerReviewDto>> reviews) {
        LinkedHashMap<String, SectionView> ordered = new LinkedHashMap<>();
        if (in.getSections() != null) {
            in.getSections().stream()
                    .filter(s -> s != null && s.id() != null)
                    .sorted(Comparator.comparing(SectionSnapshot::sectionOrder, Comparator.nullsLast(Integer::compareTo)))
                    .forEach(s -> ordered.put(s.id(), new SectionView(s.id(), s.name())));
        }
        comparisonById.forEach((id, c) -> ordered.putIfAbsent(id, new SectionView(id, c.getSectionName())));
        for (String id : reviews.keySet()) {
            if (id != null) {
                ordered.putIfAbsent(id, new SectionView(id, null));
            }
        }
        return new ArrayList<>(ordered.values());
    }

    private Map<String, String> sectionNamesById(Input in) {
        Map<String, String> names = new LinkedHashMap<>();
        if (in.getSections() != null) {
            for (SectionSnapshot s : in.getSections()) {
                if (s != null && s.id() != null && s.name() != null) {
                    names.put(s.id(), s.name());
                }
            }
        }
        if (in.getComparison() != null && in.getComparison().getSectionWiseComparison() != null) {
            for (SectionComparisonDto c : in.getComparison().getSectionWiseComparison()) {
                if (c != null && c.getSectionId() != null && c.getSectionName() != null) {
                    names.putIfAbsent(c.getSectionId(), c.getSectionName());
                }
            }
        }
        return names;
    }

    private String sectionName(SectionView section) {
        return section.name() != null && !section.name().isBlank() ? section.name() : "Section";
    }

    private static SectionCounts countStatuses(List<StudentReportAnswerReviewDto> rows) {
        int correct = 0, partial = 0, incorrect = 0, notAnswered = 0;
        for (StudentReportAnswerReviewDto row : rows) {
            if (row == null) continue;
            String status = row.getAnswerStatus();
            if (QuestionResponseEnum.CORRECT.name().equals(status)) correct++;
            else if (QuestionResponseEnum.PARTIAL_CORRECT.name().equals(status)) partial++;
            else if (QuestionResponseEnum.INCORRECT.name().equals(status)) incorrect++;
            else notAnswered++; // PENDING or null => not answered
        }
        return new SectionCounts(correct, partial, incorrect, notAnswered);
    }

    // ------------------------------------------------------- small helpers

    private ParticipantsQuestionOverallDetailDto overall(Input in) {
        return in.getReportDetail() != null ? in.getReportDetail().getQuestionOverallDetailDto() : null;
    }

    /**
     * V2 keeps the reference navy palette unless the institute genuinely
     * customized its primary color: the stock {@link ReportBrandingDto}
     * default (#FF6B35, the legacy report's orange) is treated as
     * "not customized". Values that are not simple hex colors are rejected
     * (they would be injected into CSS).
     */
    private static String resolveAccent(ReportBrandingDto branding) {
        String configured = branding.getPrimaryColor() != null ? branding.getPrimaryColor().trim() : null;
        if (configured == null || configured.isEmpty()
                || LEGACY_DEFAULT_PRIMARY.equalsIgnoreCase(configured)
                || !SAFE_CSS_COLOR.matcher(configured).matches()) {
            return NAVY;
        }
        return configured;
    }

    /** Colored CSS dot — renders reliably in iText regardless of font glyph coverage. */
    private static String dot(String color) {
        return "<span style=\"display: inline-block; width: 7px; height: 7px; border-radius: 4px; background-color: "
                + color + "; margin-right: 5px;\"></span>";
    }

    private static String statusLabel(String status) {
        if (QuestionResponseEnum.CORRECT.name().equals(status)) return "Correct";
        if (QuestionResponseEnum.INCORRECT.name().equals(status)) return "Incorrect";
        if (QuestionResponseEnum.PARTIAL_CORRECT.name().equals(status)) return "Partial";
        return "Not answered"; // PENDING or null
    }

    private static String statusColor(String status) {
        if (QuestionResponseEnum.CORRECT.name().equals(status)) return GREEN;
        if (QuestionResponseEnum.INCORRECT.name().equals(status)) return RED;
        if (QuestionResponseEnum.PARTIAL_CORRECT.name().equals(status)) return AMBER;
        return MUTED;
    }

    private static double pct(Double value, Double outOf) {
        if (value == null || outOf == null || outOf <= 0) return 0.0;
        return (value / outOf) * 100.0;
    }

    private static double clampPct(double pct) {
        return Math.max(0.0, Math.min(100.0, pct));
    }

    private static String fmtPct(double pct) {
        return fmt(Math.max(0.0, Math.min(100.0, pct)));
    }

    private static String fmt(Double value) {
        if (value == null) return "-";
        if (value == Math.floor(value) && !Double.isInfinite(value)) {
            return String.valueOf((long) value.doubleValue());
        }
        return String.format("%.1f", value);
    }

    private static String fmt(double value) {
        return fmt(Double.valueOf(value));
    }

    private static String fmtDate(Date date) {
        return date != null ? new SimpleDateFormat("dd MMM yyyy").format(date) : "-";
    }

    private static String fmtDateTime(Date date) {
        return date != null ? new SimpleDateFormat("dd MMM yyyy, HH:mm").format(date) : "-";
    }

    private static String nvl(String value, String fallback) {
        return value != null && !value.isBlank() ? value : fallback;
    }

    private static String generateReportId() {
        return "RPT-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
    }

    private static String esc(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** Presigned URLs carry raw '&' in the query string — escape for attribute use. */
    private static String escAttr(String url) {
        if (url == null) return "";
        return url.trim().replace("&amp;", "&").replace("&", "&amp;").replace("\"", "&quot;");
    }
}
