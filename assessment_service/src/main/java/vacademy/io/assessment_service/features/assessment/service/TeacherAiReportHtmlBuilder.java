package vacademy.io.assessment_service.features.assessment.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.ParticipantsQuestionOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportAnswerReviewDto;
import vacademy.io.assessment_service.features.assessment.dto.admin_get_dto.response.StudentReportOverallDetailDto;
import vacademy.io.assessment_service.features.assessment.enums.QuestionResponseEnum;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.SectionComparisonDto;
import vacademy.io.assessment_service.features.learner_assessment.dto.StudentComparisonDto;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The <b>teacher</b> copy of the AI assessment report — the document behind
 * "Download AI Report" on the admin submissions list.
 *
 * <p>It is deliberately NOT the learner's AI report
 * ({@link AiReportHtmlBuilder}). That one is written to the student ("you got
 * this wrong, here is how to fix it") and leads with flashcards and a study
 * plan. This one is written to whoever has to teach the student next, so it
 * leads with <em>where the marks went</em> and what to reteach:
 *
 * <ol>
 *   <li>attempt acknowledgement — the general figures a teacher records
 *       (score, rank, percentile, accuracy, attempt split, time);</li>
 *   <li>section → topic → question weakness, each with its own chart, ordered
 *       weakest-first so the tables double as a remediation queue;</li>
 *   <li>the diagnosis: misconceptions, easy misses (knew it, lost it) vs
 *       concept gaps, and a prioritised teacher action plan.</li>
 * </ol>
 *
 * <p>Data comes from two places and either half may be missing: the assessment
 * itself (marks, sections, per-question rows, class comparison — always
 * present) and admin_core's LLM insight JSON (topics, misconceptions, Bloom's,
 * behaviour — present only once the report has been generated, which is what
 * spends the institute's AI credits). Every AI-sourced block self-skips when
 * its key is absent, so a report built from assessment data alone is still a
 * complete document rather than a page of empty headings.
 *
 * <p>Rendering constraints are iText html2pdf's, same as
 * {@link StudentReportHtmlV2Builder}: no JS, no flexbox/grid, no external
 * resources. Layout is tables and percentage-width divs; charts are PNG data
 * URIs from {@link AiReportChartGenerator}.
 */
@Slf4j
@Component
public class TeacherAiReportHtmlBuilder {

    // ---- palette shared with the v2 student report so both PDFs read as one suite ----
    private static final String NAVY = "#1F3864";
    private static final String INK = "#263238";
    private static final String MUTED = "#546E7A";
    private static final String FAINT = "#8A94A3";
    private static final String BROWN = "#A98467";
    private static final String GREEN = "#2E7D32";
    private static final String GREEN_SOFT = "#E8F5E9";
    private static final String RED = "#C62828";
    private static final String RED_SOFT = "#FDECEA";
    private static final String AMBER = "#F57F17";
    private static final String AMBER_SOFT = "#FFF8E1";
    private static final String BORDER = "#D9DEE7";
    private static final String RULE = "#C9D2E0";
    private static final String PANEL = "#F5F7FA";

    private static final String LEGACY_DEFAULT_PRIMARY = "#FF6B35";
    private static final Pattern SAFE_CSS_COLOR = Pattern.compile("^#[0-9a-fA-F]{3,8}$");

    /** Below this accuracy a topic/section is a P1 "reteach" item. */
    private static final double WEAK_THRESHOLD = 40.0;
    /** Below this it is a P2 "needs practice" item; at or above it is on track. */
    private static final double BORDERLINE_THRESHOLD = 70.0;
    /** A question the class mostly got right but this student missed = recoverable, not a concept gap. */
    private static final double EASY_MISS_CLASS_PERCENT = 60.0;
    /** Keep long tables from swallowing the PDF. */
    private static final int MAX_TOPIC_ROWS = 14;
    private static final int MAX_QUESTION_ROWS = 60;
    private static final int MAX_MISCONCEPTIONS = 12;

    private static final String[] BLOOM_KEYS = {"remember", "understand", "apply", "analyze", "evaluate", "create"};
    private static final String[] BLOOM_NAMES = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"};

    /** Slice colours for the "where the marks were lost" pie, cycled per section. */
    private static final String[] PIE_COLORS = {
            "#1F3864", "#C62828", "#F57F17", "#2E7D32", "#A98467", "#6C5CE7", "#00838F", "#AD1457"};

    @Autowired
    private ReportBrandingHelper brandingHelper;

    @Autowired
    private AiReportChartGenerator chartGenerator;

    @Autowired
    private ObjectMapper objectMapper;

    // ------------------------------------------------------------------ input

    @Getter
    @Builder
    public static class Input {
        private final String assessmentName;
        /** admin_core's LLM insight JSON; null/blank renders the data-only report. */
        private final String processedJson;
        private final StudentReportOverallDetailDto reportDetail;
        private final StudentComparisonDto comparison;
        private final StudentReportAnalyticsService.StudentReportAnalytics analytics;
        private final ReportBrandingDto branding;
        private final String studentName;
        private final String registrationUsername;
        private final String userEmail;
        private final String evaluationType;
        private final Date examDate;
        private final Integer assessmentDurationMinutes;
        /** Rendered in the footer so a teacher can quote the exact attempt in a query. */
        private final String attemptId;
        /** When the AI insights were generated; null when there are none. */
        private final Date insightsGeneratedAt;
        /**
         * questionId -> percentage of the cohort that answered it correctly.
         * Supplied whole so the question table can classify every row, not just
         * the handful the v2 report's easy-miss / expertise cut-offs surface.
         */
        private final Map<String, Double> classCorrectPercentByQuestion;
    }

    // ------------------------------------------------------------------ build

    public String build(Input in) {
        if (in == null) {
            in = Input.builder().build();
        }
        ReportBrandingDto branding = in.getBranding() != null ? in.getBranding() : ReportBrandingDto.builder().build();
        String accent = resolveAccent(branding);
        JsonNode ai = parseAi(in.getProcessedJson());

        StringBuilder sb = new StringBuilder(64 * 1024);
        sb.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">");
        sb.append("<title>Teacher Diagnostic Report</title>");
        appendCss(sb, accent);
        sb.append("</head><body><div class=\"wrap\">");

        appendLetterhead(sb, in, branding, accent);
        appendVerdict(sb, in, ai);
        appendStatCards(sb, in, accent);
        appendAttemptSnapshot(sb, in, accent);
        appendSectionDiagnosis(sb, in, accent);
        appendMarksLost(sb, in);
        appendTopicDiagnosis(sb, ai);
        appendStrengthsAndWeaknesses(sb, ai);
        appendBlooms(sb, ai, accent);
        appendQuestionDiagnosis(sb, in);
        appendMisconceptions(sb, ai);
        appendActionPlan(sb, ai, accent);
        appendBehaviour(sb, ai);
        appendNarrative(sb, ai);
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
        sb.append(".h2 { font-size: 11px; font-weight: 700; color: ").append(NAVY)
                .append("; letter-spacing: 1.5px; border-bottom: 1px solid ").append(RULE)
                .append("; padding-bottom: 4px; margin: 18px 0 8px 0; }");
        sb.append(".hint { font-size: 9.5px; color: ").append(FAINT).append("; margin: -4px 0 9px 0; }");
        sb.append(".sect { page-break-inside: avoid; }");
        sb.append(".cards { width: 100%; border-collapse: separate; border-spacing: 7px 0; margin: 12px 0 4px 0; }");
        sb.append(".cards td { vertical-align: top; width: 25%; }");
        sb.append(".stat { background-color: #ffffff; border: 1px solid ").append(BORDER)
                .append("; border-radius: 6px; padding: 0 0 10px 0; text-align: center; }");
        sb.append(".stat-accent { height: 4px; border-radius: 6px 6px 0 0; }");
        sb.append(".stat-label { font-size: 8px; font-weight: 700; letter-spacing: 1.2px; color: ").append(FAINT)
                .append("; margin: 9px 0 2px 0; }");
        sb.append(".stat-value { font-size: 25px; font-weight: 800; color: ").append(INK).append("; }");
        sb.append(".stat-sub { font-size: 9px; color: ").append(MUTED).append("; margin-top: 2px; }");
        sb.append(".tbl { width: 100%; border-collapse: collapse; font-size: 11px; background-color: #ffffff; }");
        sb.append(".tbl th { background-color: #EEF1F6; text-align: left; padding: 6px 8px; color: ").append(MUTED)
                .append("; font-weight: 700; font-size: 9.5px; letter-spacing: 0.6px; border-bottom: 2px solid ")
                .append(BORDER).append("; }");
        sb.append(".tbl td { padding: 6px 8px; border-bottom: 1px solid #E7EBF1; vertical-align: top; }");
        sb.append(".tbl .total td { border-top: 2px solid ").append(BORDER)
                .append("; border-bottom: none; font-weight: 700; }");
        sb.append(".chart { text-align: center; margin: 4px 0 10px 0; }");
        sb.append(".panel { background-color: ").append(PANEL).append("; border: 1px solid ").append(BORDER)
                .append("; border-radius: 5px; padding: 10px 12px; margin-bottom: 8px; page-break-inside: avoid; }");
        sb.append(".pill { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 8.5px; font-weight: 700; letter-spacing: 0.4px; }");
        sb.append(".banner { border-radius: 6px; padding: 11px 14px; margin: 12px 0 0 0; border-left: 4px solid ").append(accent).append("; }");
        sb.append(".banner-title { font-size: 13px; font-weight: 800; }");
        sb.append(".banner-body { font-size: 10.5px; color: ").append(MUTED).append("; margin-top: 2px; }");
        sb.append(".kv { font-size: 10.5px; }");
        sb.append(".kv td { padding: 3px 0; }");
        sb.append(".kv .k { color: ").append(MUTED).append("; }");
        sb.append(".kv .v { text-align: right; font-weight: 700; color: ").append(INK).append("; }");
        sb.append(".md { font-size: 11px; color: ").append(INK).append("; }");
        sb.append(".step { page-break-inside: avoid; margin-bottom: 9px; }");
        sb.append(".num { width: 22px; height: 22px; border-radius: 11px; color: #ffffff; text-align: center; ")
                .append("line-height: 22px; font-size: 11px; font-weight: 700; }");
        sb.append(".foot { border-top: 1px solid ").append(RULE)
                .append("; margin-top: 18px; padding-top: 7px; font-size: 9px; color: ").append(FAINT).append("; }");
        sb.append("</style>");
    }

    // ------------------------------------------------------------ letterhead

    private void appendLetterhead(StringBuilder sb, Input in, ReportBrandingDto branding, String accent) {
        String logoUrl = brandingHelper.resolveLogoUrl(branding);
        ParticipantsQuestionOverallDetailDto overall = overall(in);

        sb.append("<table style=\"width: 100%;\"><tr>");
        if (logoUrl != null && Boolean.TRUE.equals(branding.getShowLogoInHeader())) {
            sb.append("<td style=\"width: 56px; vertical-align: middle; padding-right: 12px;\">")
                    .append("<div style=\"border: 1px solid ").append(BORDER)
                    .append("; border-radius: 6px; padding: 5px; width: 44px; text-align: center;\">")
                    .append("<img src=\"").append(escAttr(logoUrl))
                    .append("\" style=\"max-height: 40px; max-width: 40px;\" /></div></td>");
        }
        sb.append("<td style=\"vertical-align: middle;\">");
        sb.append("<div style=\"font-size: 19px; font-weight: 800; color: ").append(accent).append(";\">")
                .append(esc(nvl(in.getAssessmentName(), "Assessment"))).append("</div>");
        sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append("; margin-top: 1px;\">")
                .append("Teacher Diagnostic Report &nbsp;&middot;&nbsp; AI-assisted analysis")
                .append("</div></td>");
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

        sb.append("<div style=\"border-bottom: 3px solid ").append(accent).append("; margin: 8px 0 10px 0;\"></div>");
        if (in.getStudentName() != null && !in.getStudentName().isBlank()) {
            sb.append("<div style=\"font-size: 26px; font-weight: 800; color: ").append(accent).append(";\">")
                    .append(esc(in.getStudentName())).append("</div>");
        }
        List<String> meta = new ArrayList<>();
        if (in.getRegistrationUsername() != null && !in.getRegistrationUsername().isBlank()) {
            meta.add("Reg. No: <b style=\"color: " + INK + ";\">" + esc(in.getRegistrationUsername()) + "</b>");
        }
        if (in.getUserEmail() != null && !in.getUserEmail().isBlank()) {
            meta.add(esc(in.getUserEmail()));
        }
        Date attemptDate = overall != null && overall.getStartTime() != null ? overall.getStartTime()
                : (in.getComparison() != null ? in.getComparison().getStartTime() : null);
        if (attemptDate != null) {
            meta.add("Attempted on " + fmtDateTime(attemptDate));
        }
        if (in.getEvaluationType() != null && !in.getEvaluationType().isBlank()) {
            meta.add("Evaluation: " + esc(capitalise(in.getEvaluationType())));
        }
        if (!meta.isEmpty()) {
            sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append("; margin-top: 2px;\">")
                    .append(String.join(" &nbsp;&middot;&nbsp; ", meta)).append("</div>");
        }
    }

    // --------------------------------------------------------------- verdict

    /**
     * One-line answer to "does this student need me?" — the thing a teacher
     * scanning thirty of these reports is actually looking for, so it sits
     * above every chart.
     */
    private void appendVerdict(StringBuilder sb, Input in, JsonNode ai) {
        StudentComparisonDto cmp = in.getComparison();
        Double percentage = scorePercent(in);
        Double percentile = cmp != null ? cmp.getStudentPercentile() : null;

        String tone;
        String title;
        String body;
        if (percentage == null) {
            return;
        } else if (percentage < 40 || (percentile != null && percentile < 25)) {
            tone = RED;
            title = "Needs intervention";
            body = "Scored " + fmt(percentage) + "% and sits in the bottom quarter of the cohort. "
                    + "Work through the P1 topics below before the next assessment.";
        } else if (percentage < 70 || (percentile != null && percentile < 50)) {
            tone = AMBER;
            title = "Needs targeted practice";
            body = "Scored " + fmt(percentage) + "%. The gap is concentrated in a few areas rather than spread out — "
                    + "the section and topic tables below show which.";
        } else {
            tone = GREEN;
            title = "On track";
            body = "Scored " + fmt(percentage) + "%. Keep the pace; the remaining losses are listed below and are mostly recoverable.";
        }
        int weakCount = countWeakTopics(ai);
        if (weakCount > 0) {
            body += " " + weakCount + (weakCount == 1 ? " topic is" : " topics are") + " flagged for reteaching.";
        }

        sb.append("<div class=\"banner\" style=\"background-color: ").append(softOf(tone))
                .append("; border-left-color: ").append(tone).append(";\">");
        sb.append("<div class=\"banner-title\" style=\"color: ").append(tone).append(";\">").append(title).append("</div>");
        sb.append("<div class=\"banner-body\">").append(esc(body)).append("</div>");
        sb.append("</div>");
    }

    // ------------------------------------------------------------ stat cards

    private void appendStatCards(StringBuilder sb, Input in, String accent) {
        ParticipantsQuestionOverallDetailDto overall = overall(in);
        StudentComparisonDto cmp = in.getComparison();
        if (overall == null && cmp == null) {
            return;
        }
        Double marks = overall != null && overall.getAchievedMarks() != null ? overall.getAchievedMarks()
                : (cmp != null ? cmp.getStudentMarks() : null);
        Double totalMarks = cmp != null ? cmp.getTotalMarks() : null;
        Integer rank = overall != null && overall.getRank() != null ? overall.getRank()
                : (cmp != null ? cmp.getStudentRank() : null);
        Long participants = cmp != null ? cmp.getTotalParticipants() : null;
        Double percentile = overall != null && overall.getPercentile() != null ? overall.getPercentile()
                : (cmp != null ? cmp.getStudentPercentile() : null);
        Double accuracy = cmp != null ? cmp.getStudentAccuracy() : null;
        Double classAccuracy = cmp != null ? cmp.getClassAccuracy() : null;

        sb.append("<table class=\"cards\"><tr>");
        appendStatCard(sb, accent, "SCORE", fmt(marks),
                totalMarks != null ? "out of " + fmt(totalMarks) : "");
        appendStatCard(sb, BROWN, "CLASS RANK", rank != null ? String.valueOf(rank) : "-",
                participants != null ? "of " + participants + " students" : "");
        appendStatCard(sb, GREEN, "PERCENTILE", percentile != null ? fmt(percentile) : "-",
                "of class scored below");
        appendStatCard(sb, accuracy != null ? bandColor(accuracy) : FAINT, "ACCURACY",
                accuracy != null ? fmt(accuracy) + "%" : "-",
                classAccuracy != null ? "class " + fmt(classAccuracy) + "%" : "");
        sb.append("</tr></table>");
    }

    private void appendStatCard(StringBuilder sb, String accentColor, String label, String value, String sub) {
        sb.append("<td><div class=\"stat\">");
        sb.append("<div class=\"stat-accent\" style=\"background-color: ").append(accentColor).append(";\"></div>");
        sb.append("<div class=\"stat-label\">").append(label).append("</div>");
        sb.append("<div class=\"stat-value\"")
                .append(value.length() > 8 ? " style=\"font-size: 17px; padding-top: 5px;\"" : "")
                .append(">").append(value).append("</div>");
        sb.append("<div class=\"stat-sub\">").append(sub.isEmpty() ? "&nbsp;" : sub).append("</div>");
        sb.append("</div></td>");
    }

    // ------------------------------------------------------- attempt snapshot

    /**
     * The "general report data" block: the raw acknowledgement of the attempt —
     * how many questions were attempted and how they landed, where the marks
     * came from and went, and how the time compares with the cohort. Donut on
     * the left, figures on the right.
     */
    private void appendAttemptSnapshot(StringBuilder sb, Input in, String accent) {
        ParticipantsQuestionOverallDetailDto overall = overall(in);
        StudentComparisonDto cmp = in.getComparison();
        if (overall == null && cmp == null) {
            return;
        }
        int correct = nz(overall != null ? overall.getCorrectAttempt() : null);
        int partial = nz(overall != null ? overall.getPartialCorrectAttempt() : null);
        int wrong = nz(overall != null ? overall.getWrongAttempt() : null);
        int skipped = nz(overall != null ? overall.getSkippedCount() : null);
        int totalQuestions = correct + partial + wrong + skipped;
        if (totalQuestions == 0) {
            totalQuestions = countAllQuestions(in);
        }

        sb.append("<div class=\"sect\"><div class=\"h2\">ATTEMPT SNAPSHOT</div>");
        sb.append("<div class=\"hint\">What the student actually did with the paper — the figures to record alongside the score.</div>");
        sb.append("<table style=\"width: 100%;\"><tr>");

        // Donut
        sb.append("<td style=\"width: 52%; vertical-align: middle;\">");
        Map<String, Double> slices = new LinkedHashMap<>();
        slices.put("Correct", (double) correct);
        slices.put("Partially correct", (double) partial);
        slices.put("Incorrect", (double) wrong);
        slices.put("Unattempted", (double) skipped);
        String donut = chartGenerator.generateDonutChart(slices,
                new String[]{GREEN, AMBER, RED, FAINT});
        if (donut != null) {
            sb.append("<div class=\"chart\"><img src=\"").append(donut).append("\" style=\"max-width: 340px;\" /></div>");
        } else {
            sb.append("&nbsp;");
        }
        sb.append("</td>");

        // Figures
        sb.append("<td style=\"width: 48%; vertical-align: middle; padding-left: 10px;\">");
        sb.append("<table class=\"kv\" style=\"width: 100%;\">");
        kv(sb, "Questions in paper", String.valueOf(totalQuestions));
        kv(sb, "Attempted", String.valueOf(correct + partial + wrong)
                + (totalQuestions > 0 ? " (" + fmt(pct((double) (correct + partial + wrong), (double) totalQuestions)) + "%)" : ""));
        kv(sb, "Unattempted", String.valueOf(skipped));
        if (overall != null && overall.getTotalCorrectMarks() != null) {
            kv(sb, "Marks earned", fmt(overall.getTotalCorrectMarks())
                    + (overall.getTotalPartialMarks() != null && overall.getTotalPartialMarks() > 0
                    ? " (+" + fmt(overall.getTotalPartialMarks()) + " partial)" : ""));
        }
        if (overall != null && overall.getTotalIncorrectMarks() != null && overall.getTotalIncorrectMarks() != 0) {
            kv(sb, "Negative marking", fmt(overall.getTotalIncorrectMarks()));
        }
        Double lost = marksLost(in);
        if (lost != null) {
            kv(sb, "Marks not scored", fmt(lost));
        }
        Long duration = overall != null ? overall.getCompletionTimeInSeconds() : null;
        if (duration != null && duration > 0) {
            kv(sb, "Time taken", HtmlBuilderService.convertToReadableTime(duration));
        }
        if (cmp != null && cmp.getAverageDuration() != null && cmp.getAverageDuration() > 0) {
            kv(sb, "Class average time", HtmlBuilderService.convertToReadableTime(Math.round(cmp.getAverageDuration())));
        }
        if (cmp != null && cmp.getAverageMarks() != null) {
            kv(sb, "Class average score", fmt(cmp.getAverageMarks())
                    + (cmp.getTotalMarks() != null ? " / " + fmt(cmp.getTotalMarks()) : ""));
        }
        if (cmp != null && cmp.getHighestMarks() != null) {
            kv(sb, "Class highest", fmt(cmp.getHighestMarks()));
        }
        sb.append("</table></td></tr></table></div>");
    }

    private void kv(StringBuilder sb, String key, String value) {
        sb.append("<tr><td class=\"k\">").append(esc(key)).append("</td><td class=\"v\">")
                .append(esc(value)).append("</td></tr>");
    }

    // ------------------------------------------------------ section diagnosis

    private void appendSectionDiagnosis(StringBuilder sb, Input in, String accent) {
        List<SectionComparisonDto> sections = sectionComparisons(in);
        if (sections.isEmpty()) {
            return;
        }

        // Heading + chart in one non-breaking block; the table flows separately so
        // a long section list is not forced onto a page of its own.
        sb.append("<div class=\"sect\"><div class=\"h2\">SECTION-WISE DIAGNOSIS</div>");
        sb.append("<div class=\"hint\">Accuracy against the class on the same section. A negative gap is where this student is losing ground to the cohort.</div>");

        Map<String, Double> student = new LinkedHashMap<>();
        Map<String, Double> classAvg = new LinkedHashMap<>();
        for (SectionComparisonDto s : sections) {
            String name = shortLabel(nvl(s.getSectionName(), "Section"), 16);
            student.put(name, round1(clampPct(s.getStudentAccuracy() != null ? s.getStudentAccuracy() : 0.0)));
            classAvg.put(name, round1(clampPct(s.getClassAccuracy() != null ? s.getClassAccuracy() : 0.0)));
        }
        String chart = chartGenerator.generateComparisonBarChart("Accuracy %", student, classAvg,
                "Student", "Class average", accent, 540, 260);
        if (chart != null) {
            sb.append("<div class=\"chart\"><img src=\"").append(chart).append("\" style=\"max-width: 500px;\" /></div>");
        }
        sb.append("</div><div>");

        sb.append("<table class=\"tbl\">");
        sb.append("<tr><th>SECTION</th><th style=\"text-align: right;\">SCORE</th>")
                .append("<th style=\"text-align: right;\">ACCURACY</th>")
                .append("<th style=\"text-align: right;\">CLASS</th>")
                .append("<th style=\"text-align: right;\">GAP</th>")
                .append("<th style=\"text-align: right;\">CLASS BEST</th>")
                .append("<th>FOCUS</th></tr>");
        for (SectionComparisonDto s : sections) {
            double acc = s.getStudentAccuracy() != null ? s.getStudentAccuracy() : 0.0;
            Double cls = s.getClassAccuracy();
            Double gap = cls != null ? acc - cls : null;
            sb.append("<tr><td><b>").append(esc(nvl(s.getSectionName(), "Section"))).append("</b></td>");
            sb.append("<td style=\"text-align: right;\"><b>").append(fmt(s.getStudentMarks()))
                    .append(s.getSectionTotalMarks() != null ? " / " + fmt(s.getSectionTotalMarks()) : "")
                    .append("</b></td>");
            sb.append("<td style=\"text-align: right; color: ").append(bandColor(acc)).append("; font-weight: 700;\">")
                    .append(fmt(acc)).append("%</td>");
            sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                    .append(cls != null ? fmt(cls) + "%" : "-").append("</td>");
            sb.append("<td style=\"text-align: right; color: ")
                    .append(gap == null ? MUTED : gap < 0 ? RED : GREEN).append("; font-weight: 700;\">")
                    .append(gap == null ? "-" : (gap > 0 ? "+" : "") + fmt(gap)).append("</td>");
            sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                    .append(fmt(s.getSectionHighestMarks())).append("</td>");
            sb.append("<td>").append(priorityPill(acc)).append("</td></tr>");
        }
        sb.append("</table></div>");
    }

    // ---------------------------------------------------------- marks lost pie

    /**
     * Where the marks went, by section. Teachers plan revision around the
     * section that cost the most, which is not always the one with the worst
     * accuracy — a 60%-accuracy 50-mark section loses more than a
     * 20%-accuracy 5-mark one.
     */
    private void appendMarksLost(StringBuilder sb, Input in) {
        List<SectionComparisonDto> sections = sectionComparisons(in);
        if (sections.size() < 2) {
            return;
        }
        Map<String, Double> lostBySection = new LinkedHashMap<>();
        double total = 0;
        for (SectionComparisonDto s : sections) {
            if (s.getSectionTotalMarks() == null) continue;
            double lost = Math.max(0.0, s.getSectionTotalMarks() - (s.getStudentMarks() != null ? s.getStudentMarks() : 0.0));
            if (lost > 0) {
                lostBySection.put(shortLabel(nvl(s.getSectionName(), "Section"), 20), round1(lost));
                total += lost;
            }
        }
        if (lostBySection.size() < 2 || total <= 0) {
            return;
        }
        String pie = chartGenerator.generatePieChart(lostBySection, PIE_COLORS);
        if (pie == null) {
            return;
        }
        String worst = lostBySection.entrySet().stream()
                .max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);

        sb.append("<div class=\"sect\"><div class=\"h2\">WHERE THE MARKS WERE LOST</div>");
        sb.append("<div class=\"hint\">Share of the ").append(fmt(total))
                .append(" unscored marks by section")
                .append(worst != null ? " — the largest single loss is in " + esc(worst) + "." : ".")
                .append("</div>");
        sb.append("<div class=\"chart\"><img src=\"").append(pie).append("\" style=\"max-width: 460px;\" /></div>");
        sb.append("</div>");
    }

    // ------------------------------------------------------- topic diagnosis

    private void appendTopicDiagnosis(StringBuilder sb, JsonNode ai) {
        JsonNode topics = ai != null ? ai.get("topic_analysis") : null;
        if (topics == null || !topics.isArray() || topics.isEmpty()) {
            return;
        }
        // Weakest first: the table doubles as the order to reteach in.
        List<JsonNode> ordered = new ArrayList<>();
        topics.forEach(ordered::add);
        ordered.sort(Comparator.comparingDouble(t -> asDouble(t, "accuracy", 0)));
        if (ordered.size() > MAX_TOPIC_ROWS) {
            ordered = ordered.subList(0, MAX_TOPIC_ROWS);
        }

        sb.append("<div class=\"sect\"><div class=\"h2\">TOPIC-WISE DIAGNOSIS</div>");
        sb.append("<div class=\"hint\">Topics inferred by the model from the question content, ordered weakest first. Red is below ")
                .append((int) WEAK_THRESHOLD).append("% accuracy, amber below ")
                .append((int) BORDERLINE_THRESHOLD).append("%.</div>");

        Map<String, Double> chartData = new LinkedHashMap<>();
        for (JsonNode t : ordered) {
            String topic = text(t, "topic");
            if (!topic.isEmpty()) {
                chartData.put(shortLabel(topic, 26), round1(clampPct(asDouble(t, "accuracy", 0))));
            }
        }
        if (!chartData.isEmpty()) {
            int height = Math.max(180, 34 * chartData.size() + 60);
            String chart = chartGenerator.generateBandedHorizontalBarChart(chartData, height);
            if (chart != null) {
                sb.append("<div class=\"chart\"><img src=\"").append(chart).append("\" style=\"max-width: 500px;\" /></div>");
            }
        }
        sb.append("</div><div>");

        sb.append("<table class=\"tbl\">");
        sb.append("<tr><th>TOPIC</th><th style=\"text-align: right;\">QS</th>")
                .append("<th style=\"text-align: right;\">CORRECT</th>")
                .append("<th style=\"text-align: right;\">ACCURACY</th>")
                .append("<th style=\"text-align: right;\">AVG TIME</th>")
                .append("<th>MASTERY</th><th>ACTION</th></tr>");
        for (JsonNode t : ordered) {
            double acc = asDouble(t, "accuracy", 0);
            String mastery = nvl(text(t, "mastery_level"), "-");
            sb.append("<tr><td><b>").append(esc(text(t, "topic"))).append("</b></td>");
            sb.append("<td style=\"text-align: right;\">").append((int) asDouble(t, "questions_count", 0)).append("</td>");
            sb.append("<td style=\"text-align: right;\">").append((int) asDouble(t, "correct", 0)).append("</td>");
            sb.append("<td style=\"text-align: right; color: ").append(bandColor(acc)).append("; font-weight: 700;\">")
                    .append(fmt(acc)).append("%</td>");
            sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                    .append((int) asDouble(t, "avg_time_seconds", 0)).append("s</td>");
            sb.append("<td>").append(pill(mastery, masteryColor(mastery))).append("</td>");
            sb.append("<td style=\"color: ").append(MUTED).append("; font-size: 10px;\">")
                    .append(esc(topicAction(acc))).append("</td></tr>");
        }
        sb.append("</table></div>");
    }

    /** The teacher-side instruction attached to each topic row. */
    private static String topicAction(double accuracy) {
        if (accuracy < WEAK_THRESHOLD) return "Reteach from basics, then re-test";
        if (accuracy < BORDERLINE_THRESHOLD) return "Assign targeted practice set";
        return "Maintain — spiral revision only";
    }

    // --------------------------------------------- strengths and weaknesses

    private void appendStrengthsAndWeaknesses(StringBuilder sb, JsonNode ai) {
        JsonNode strengths = ai != null ? ai.get("strengths") : null;
        JsonNode weaknesses = ai != null ? ai.get("weaknesses") : null;
        boolean hasS = strengths != null && strengths.isObject() && !strengths.isEmpty();
        boolean hasW = weaknesses != null && weaknesses.isObject() && !weaknesses.isEmpty();
        if (!hasS && !hasW) {
            return;
        }

        sb.append("<div class=\"sect\"><div class=\"h2\">AREAS OF WEAKNESS &amp; WHAT IS WORKING</div>");
        sb.append("<table style=\"width: 100%;\"><tr>");

        sb.append("<td style=\"width: 50%; vertical-align: top; padding-right: 6px;\">");
        sb.append("<div style=\"font-size: 10px; font-weight: 700; color: ").append(RED)
                .append("; letter-spacing: 0.8px; margin-bottom: 6px;\">AREAS OF WEAKNESS</div>");
        if (hasW) {
            appendScoreBars(sb, weaknesses, RED, true);
        } else {
            sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED)
                    .append(";\">No specific weak area stood out in this attempt.</div>");
        }
        sb.append("</td>");

        sb.append("<td style=\"width: 50%; vertical-align: top; padding-left: 6px;\">");
        sb.append("<div style=\"font-size: 10px; font-weight: 700; color: ").append(GREEN)
                .append("; letter-spacing: 0.8px; margin-bottom: 6px;\">STRENGTHS TO BUILD ON</div>");
        if (hasS) {
            appendScoreBars(sb, strengths, GREEN, false);
        } else {
            sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED)
                    .append(";\">Not enough correct answers to identify a reliable strength.</div>");
        }
        sb.append("</td></tr></table></div>");
    }

    /**
     * Both maps in the AI payload score a topic the same way — higher is better —
     * so the bar always shows the score itself. Only the ordering differs: weak
     * areas are listed worst-first, strengths best-first.
     */
    private void appendScoreBars(StringBuilder sb, JsonNode scores, String color, boolean weakness) {
        List<Map.Entry<String, Integer>> rows = new ArrayList<>();
        scores.fields().forEachRemaining(e -> {
            int v = e.getValue().asInt(0);
            if (v > 0) rows.add(Map.entry(e.getKey(), v));
        });
        rows.sort(weakness
                ? Comparator.comparingInt(Map.Entry::getValue)
                : Comparator.<Map.Entry<String, Integer>>comparingInt(Map.Entry::getValue).reversed());
        for (Map.Entry<String, Integer> row : rows) {
            int width = (int) clampPct(row.getValue());
            sb.append("<div style=\"margin-bottom: 7px;\">")
                    .append("<table style=\"width: 100%; font-size: 10px; margin-bottom: 2px;\"><tr>")
                    .append("<td style=\"color: ").append(INK).append(";\">").append(esc(row.getKey())).append("</td>")
                    .append("<td style=\"text-align: right; font-weight: 700; color: ").append(color).append(";\">")
                    .append(row.getValue()).append("%</td></tr></table>")
                    .append("<div style=\"height: 7px; background-color: #ECEFF4; border-radius: 4px;\">")
                    .append("<div style=\"height: 7px; width: ").append(Math.max(width, 3))
                    .append("%; background-color: ").append(color).append("; border-radius: 4px;\"></div>")
                    .append("</div></div>");
        }
    }

    // ---------------------------------------------------------------- blooms

    private void appendBlooms(StringBuilder sb, JsonNode ai, String accent) {
        JsonNode blooms = ai != null ? ai.get("blooms_taxonomy") : null;
        if (blooms == null || !blooms.isObject() || blooms.isEmpty()) {
            return;
        }
        Map<String, Double> accuracy = new LinkedHashMap<>();
        Map<String, int[]> counts = new LinkedHashMap<>();
        for (int i = 0; i < BLOOM_KEYS.length; i++) {
            JsonNode node = blooms.get(BLOOM_KEYS[i]);
            if (node == null) continue;
            int total = node.path("total").asInt(0);
            int correct = node.path("correct").asInt(0);
            if (total <= 0) continue;
            counts.put(BLOOM_NAMES[i], new int[]{correct, total});
            accuracy.put(BLOOM_NAMES[i], round1(clampPct(correct * 100.0 / total)));
        }
        if (counts.isEmpty()) {
            return;
        }

        sb.append("<div class=\"sect\"><div class=\"h2\">COGNITIVE LEVEL PERFORMANCE (BLOOM'S)</div>");
        sb.append("<div class=\"hint\">Whether the loss is recall or reasoning. A high Remember/Understand score with a low Apply/Analyze score means the content is known but not usable yet.</div>");
        String chart = chartGenerator.generateComparisonBarChart("Accuracy %", accuracy, null,
                "Accuracy", null, accent, 540, 250);
        if (chart != null) {
            sb.append("<div class=\"chart\"><img src=\"").append(chart).append("\" style=\"max-width: 500px;\" /></div>");
        }
        sb.append("</div><div>");
        sb.append("<table class=\"tbl\"><tr><th>LEVEL</th><th style=\"text-align: right;\">CORRECT</th>")
                .append("<th style=\"text-align: right;\">ASKED</th><th style=\"text-align: right;\">ACCURACY</th>")
                .append("<th>READING</th></tr>");
        for (Map.Entry<String, int[]> e : counts.entrySet()) {
            int correct = e.getValue()[0];
            int total = e.getValue()[1];
            double acc = correct * 100.0 / total;
            sb.append("<tr><td><b>").append(esc(e.getKey())).append("</b></td>");
            sb.append("<td style=\"text-align: right;\">").append(correct).append("</td>");
            sb.append("<td style=\"text-align: right;\">").append(total).append("</td>");
            sb.append("<td style=\"text-align: right; color: ").append(bandColor(acc)).append("; font-weight: 700;\">")
                    .append(fmt(acc)).append("%</td>");
            sb.append("<td style=\"color: ").append(MUTED).append("; font-size: 10px;\">")
                    .append(esc(bloomReading(e.getKey(), acc))).append("</td></tr>");
        }
        sb.append("</table></div>");
    }

    private static String bloomReading(String level, double accuracy) {
        if (accuracy >= BORDERLINE_THRESHOLD) return "Secure at this level";
        if (accuracy >= WEAK_THRESHOLD) return "Inconsistent — needs practice at this level";
        return switch (level) {
            case "Remember", "Understand" -> "Content not yet learnt — go back to the material";
            case "Apply" -> "Knows the theory, cannot use it — drill worked examples";
            case "Analyze", "Evaluate" -> "Struggles with reasoning — scaffold with guided questions";
            default -> "Open-ended tasks are out of reach for now";
        };
    }

    // ----------------------------------------------------- question diagnosis

    /**
     * Question-by-question, with the one distinction a teacher cares about:
     * a question the class mostly got right and this student missed is a
     * recoverable slip; one the class also struggled with is a teaching gap
     * for the whole batch, not a comment on this student.
     */
    private void appendQuestionDiagnosis(StringBuilder sb, Input in) {
        Map<String, List<StudentReportAnswerReviewDto>> bySection = in.getReportDetail() != null
                && in.getReportDetail().getAllSections() != null
                ? in.getReportDetail().getAllSections() : Collections.emptyMap();
        if (bySection.isEmpty()) {
            return;
        }
        Map<String, Double> classCorrectByQuestion = classCorrectPercentByQuestion(in);
        // Without cohort figures every diagnosis would be a guess and the column
        // a wall of dashes, so both are dropped rather than shown empty.
        boolean hasClassData = !classCorrectByQuestion.isEmpty();

        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">QUESTION-WISE DIAGNOSIS</div>");
        if (hasClassData) {
            sb.append("<div class=\"hint\">\"Recoverable\" = at least ").append((int) EASY_MISS_CLASS_PERCENT)
                    .append("% of the class answered it correctly, so the content was taught and landed for others. ")
                    .append("\"Concept gap\" = the class struggled too — worth reteaching to everyone.</div>");
        } else {
            sb.append("<div class=\"hint\">Cohort comparison is unavailable for this assessment, so questions are listed without a class benchmark.</div>");
        }
        sb.append("<table class=\"tbl\">");
        sb.append("<tr><th>SECTION</th><th style=\"text-align: right;\">Q</th><th>STATUS</th>")
                .append("<th style=\"text-align: right;\">MARKS</th>")
                .append("<th style=\"text-align: right;\">TIME</th>");
        if (hasClassData) {
            sb.append("<th style=\"text-align: right;\">CLASS CORRECT</th><th>DIAGNOSIS</th>");
        }
        sb.append("</tr>");

        int rendered = 0;
        boolean truncated = false;
        for (Map.Entry<String, List<StudentReportAnswerReviewDto>> entry : bySection.entrySet()) {
            List<StudentReportAnswerReviewDto> rows = entry.getValue();
            if (rows == null) continue;
            for (StudentReportAnswerReviewDto row : rows) {
                if (row == null) continue;
                if (rendered >= MAX_QUESTION_ROWS) {
                    truncated = true;
                    break;
                }
                Double classCorrect = classCorrectByQuestion.get(row.getQuestionId());
                String status = row.getAnswerStatus();
                sb.append("<tr><td style=\"color: ").append(MUTED).append(";\">")
                        .append(esc(shortLabel(entry.getKey(), 18))).append("</td>");
                sb.append("<td style=\"text-align: right;\">")
                        .append(row.getQuestionOrder() != null ? row.getQuestionOrder() : "-").append("</td>");
                sb.append("<td style=\"color: ").append(statusColor(status)).append("; font-weight: 700;\">")
                        .append(statusLabel(status)).append("</td>");
                sb.append("<td style=\"text-align: right;\">").append(fmt(row.getMark())).append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                        .append(row.getTimeTakenInSeconds() != null ? row.getTimeTakenInSeconds() + "s" : "-").append("</td>");
                if (hasClassData) {
                    sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                            .append(classCorrect != null ? fmt(classCorrect) + "%" : "-").append("</td>");
                    sb.append("<td style=\"font-size: 10px;\">").append(questionDiagnosis(status, classCorrect)).append("</td>");
                }
                sb.append("</tr>");
                rendered++;
            }
            if (truncated) break;
        }
        sb.append("</table>");
        if (truncated) {
            sb.append("<div class=\"hint\" style=\"margin-top: 6px;\">Showing the first ")
                    .append(MAX_QUESTION_ROWS).append(" questions. Full question-level data is in the standard student report.</div>");
        }
        sb.append("</div>");
    }

    private String questionDiagnosis(String status, Double classCorrectPercent) {
        boolean known = classCorrectPercent != null;
        boolean classGotIt = known && classCorrectPercent >= EASY_MISS_CLASS_PERCENT;
        if (QuestionResponseEnum.CORRECT.name().equals(status)) {
            if (known && classCorrectPercent <= 30) {
                return pill("Strength", GREEN) + " <span style=\"color:" + MUTED + ";\">solved what most of the class missed</span>";
            }
            return "<span style=\"color:" + MUTED + ";\">On track</span>";
        }
        if (QuestionResponseEnum.PARTIAL_CORRECT.name().equals(status)) {
            return pill("Incomplete", AMBER) + " <span style=\"color:" + MUTED + ";\">method started, not finished</span>";
        }
        if (QuestionResponseEnum.INCORRECT.name().equals(status)) {
            return classGotIt
                    ? pill("Recoverable", AMBER) + " <span style=\"color:" + MUTED + ";\">class managed this one</span>"
                    : pill("Concept gap", RED) + " <span style=\"color:" + MUTED + ";\">class struggled too</span>";
        }
        return classGotIt
                ? pill("Skipped", RED) + " <span style=\"color:" + MUTED + ";\">left a scorable question</span>"
                : pill("Skipped", MUTED) + " <span style=\"color:" + MUTED + ";\">hard for the cohort</span>";
    }

    // -------------------------------------------------------- misconceptions

    private void appendMisconceptions(StringBuilder sb, JsonNode ai) {
        JsonNode items = ai != null ? ai.get("misconception_analysis") : null;
        if (items == null || !items.isArray() || items.isEmpty()) {
            return;
        }
        sb.append("<div class=\"sect\" style=\"page-break-inside: auto;\"><div class=\"h2\">MISCONCEPTIONS &amp; REMEDIATION</div>");
        sb.append("<div class=\"hint\">The conceptual error behind each wrong answer, and what to correct it with.</div>");
        int shown = 0;
        for (JsonNode m : items) {
            if (shown++ >= MAX_MISCONCEPTIONS) break;
            sb.append("<div class=\"panel\">");
            sb.append("<div style=\"font-size: 11px; font-weight: 700; color: ").append(NAVY).append("; margin-bottom: 5px;\">")
                    .append(esc(text(m, "question_summary"))).append("</div>");
            sb.append("<table style=\"width: 100%; font-size: 10px; margin-bottom: 6px;\"><tr>");
            sb.append("<td style=\"width: 50%; color: ").append(RED).append(";\"><b>Answered:</b> ")
                    .append(esc(text(m, "student_answer"))).append("</td>");
            sb.append("<td style=\"width: 50%; color: ").append(GREEN).append(";\"><b>Correct:</b> ")
                    .append(esc(text(m, "correct_answer"))).append("</td></tr></table>");
            String misconception = text(m, "misconception");
            if (!misconception.isEmpty()) {
                sb.append("<div style=\"font-size: 10.5px; background-color: ").append(AMBER_SOFT)
                        .append("; border-left: 3px solid ").append(AMBER)
                        .append("; padding: 6px 9px; margin-bottom: 5px;\"><b style=\"color: ").append(AMBER)
                        .append(";\">Why it went wrong: </b>").append(esc(misconception)).append("</div>");
            }
            String remediation = text(m, "remediation");
            if (!remediation.isEmpty()) {
                sb.append("<div style=\"font-size: 10.5px; background-color: ").append(GREEN_SOFT)
                        .append("; border-left: 3px solid ").append(GREEN)
                        .append("; padding: 6px 9px;\"><b style=\"color: ").append(GREEN)
                        .append(";\">Reteach with: </b>").append(esc(remediation)).append("</div>");
            }
            sb.append("</div>");
        }
        sb.append("</div>");
    }

    // ------------------------------------------------------------ action plan

    private void appendActionPlan(StringBuilder sb, JsonNode ai, String accent) {
        JsonNode path = ai != null ? ai.get("recommended_learning_path") : null;
        String areas = ai != null ? text(ai, "areas_of_improvement") : "";
        String improvement = ai != null ? text(ai, "improvement_path") : "";
        boolean hasPath = path != null && path.isArray() && !path.isEmpty();
        if (!hasPath && areas.isEmpty() && improvement.isEmpty()) {
            return;
        }

        sb.append("<div class=\"sect\" style=\"page-break-inside: auto;\"><div class=\"h2\">TEACHER ACTION PLAN</div>");
        sb.append("<div class=\"hint\">Ordered by priority — the first item is what to fix before the next assessment.</div>");
        if (hasPath) {
            for (JsonNode step : path) {
                int priority = step.path("priority").asInt(0);
                sb.append("<div class=\"step\"><table style=\"width: 100%;\"><tr>");
                sb.append("<td style=\"width: 30px; vertical-align: top;\"><div class=\"num\" style=\"background-color: ")
                        .append(priority == 1 ? RED : priority == 2 ? AMBER : accent).append(";\">")
                        .append(priority > 0 ? priority : "&middot;").append("</div></td>");
                sb.append("<td style=\"vertical-align: top; padding-left: 6px;\">");
                sb.append("<div style=\"font-size: 11.5px; font-weight: 700; color: ").append(INK).append(";\">")
                        .append(esc(text(step, "topic"))).append("</div>");
                String from = text(step, "current_level");
                String to = text(step, "target_level");
                if (!from.isEmpty() || !to.isEmpty()) {
                    sb.append("<div style=\"font-size: 9.5px; color: ").append(FAINT).append("; margin-top: 1px;\">")
                            .append(esc(from)).append(" &rarr; ").append(esc(to)).append("</div>");
                }
                sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append("; margin-top: 3px;\">")
                        .append(esc(text(step, "suggestion"))).append("</div>");
                String time = text(step, "estimated_time");
                if (!time.isEmpty()) {
                    sb.append("<div style=\"font-size: 9.5px; font-weight: 700; color: ").append(accent)
                            .append("; margin-top: 3px;\">Est. ").append(esc(time)).append("</div>");
                }
                sb.append("</td></tr></table></div>");
            }
        }
        if (!areas.isEmpty()) {
            sb.append("<div style=\"font-size: 10px; font-weight: 700; color: ").append(MUTED)
                    .append("; letter-spacing: 0.8px; margin: 10px 0 4px 0;\">AREAS OF IMPROVEMENT</div>");
            sb.append("<div class=\"md\">").append(mdToHtml(areas)).append("</div>");
        }
        if (!improvement.isEmpty()) {
            sb.append("<div style=\"font-size: 10px; font-weight: 700; color: ").append(MUTED)
                    .append("; letter-spacing: 0.8px; margin: 10px 0 4px 0;\">SUGGESTED STUDY PLAN</div>");
            sb.append("<div class=\"md\">").append(mdToHtml(improvement)).append("</div>");
        }
        sb.append("</div>");
    }

    // ------------------------------------------------------------- behaviour

    private void appendBehaviour(StringBuilder sb, JsonNode ai) {
        JsonNode bi = ai != null ? ai.get("behavioral_insights") : null;
        JsonNode confidence = ai != null ? ai.get("confidence_estimation") : null;
        boolean hasBi = bi != null && bi.isObject() && !bi.isEmpty();
        boolean hasConf = confidence != null && confidence.isObject() && !confidence.isEmpty();
        if (!hasBi && !hasConf) {
            return;
        }

        sb.append("<div class=\"sect\"><div class=\"h2\">EXAM BEHAVIOUR</div>");
        sb.append("<div class=\"hint\">How the paper was worked through — often the difference between a mark lost to knowledge and one lost to technique.</div>");

        if (hasBi) {
            String[][] cards = {
                    {"time_management", "TIME MANAGEMENT"},
                    {"difficulty_response", "RESPONSE TO DIFFICULTY"},
                    {"fatigue_indicator", "FATIGUE"},
                    {"skip_pattern", "SKIP PATTERN"},
            };
            sb.append("<table style=\"width: 100%;\"><tr>");
            int col = 0;
            for (String[] card : cards) {
                String value = text(bi, card[0]);
                if (value.isEmpty()) continue;
                if (col > 0 && col % 2 == 0) sb.append("</tr><tr>");
                sb.append("<td style=\"width: 50%; vertical-align: top; padding: 3px;\">")
                        .append("<div class=\"panel\" style=\"margin-bottom: 0;\">")
                        .append("<div style=\"font-size: 9px; font-weight: 700; color: ").append(NAVY)
                        .append("; letter-spacing: 0.8px; margin-bottom: 3px;\">").append(card[1]).append("</div>")
                        .append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append(";\">")
                        .append(esc(value)).append("</div></div></td>");
                col++;
            }
            if (col % 2 != 0) sb.append("<td></td>");
            sb.append("</tr></table>");
        }

        if (hasConf) {
            int overall = confidence.path("overall_confidence").asInt(0);
            sb.append("<table style=\"width: 100%; margin-top: 8px;\"><tr>");
            sb.append("<td style=\"width: 90px; text-align: center; vertical-align: middle;\">")
                    .append("<div style=\"font-size: 30px; font-weight: 800; color: ").append(bandColor(overall)).append(";\">")
                    .append(overall).append("%</div>")
                    .append("<div style=\"font-size: 8px; font-weight: 700; letter-spacing: 1px; color: ").append(FAINT)
                    .append(";\">CONFIDENCE</div></td>");
            sb.append("<td style=\"vertical-align: middle; padding-left: 12px;\"><table class=\"kv\" style=\"width: 100%;\">");
            kv(sb, "Confident and correct", String.valueOf(confidence.path("high_confidence_correct").asInt(0)));
            kv(sb, "Confident but wrong", String.valueOf(confidence.path("high_confidence_wrong").asInt(0)));
            kv(sb, "Unsure but correct", String.valueOf(confidence.path("low_confidence_correct").asInt(0)));
            kv(sb, "Likely guessed", String.valueOf(confidence.path("guessed_correct").asInt(0)));
            sb.append("</table></td></tr></table>");
            String insight = text(confidence, "insight");
            if (!insight.isEmpty()) {
                sb.append("<div class=\"panel\" style=\"margin-top: 8px;\"><span style=\"font-weight: 700; color: ")
                        .append(NAVY).append(";\">Reading: </span><span style=\"font-size: 10.5px; color: ")
                        .append(MUTED).append(";\">").append(esc(insight)).append("</span></div>");
            }
        }
        sb.append("</div>");
    }

    // ------------------------------------------------------------- narrative

    private void appendNarrative(StringBuilder sb, JsonNode ai) {
        String narrative = ai != null ? text(ai, "performance_analysis") : "";
        if (narrative.isEmpty()) {
            return;
        }
        sb.append("<div class=\"sect\" style=\"page-break-inside: auto;\"><div class=\"h2\">OVERALL ASSESSMENT</div>");
        sb.append("<div class=\"md\">").append(mdToHtml(narrative)).append("</div></div>");
    }

    // ---------------------------------------------------------------- footer

    private void appendFooter(StringBuilder sb, Input in, ReportBrandingDto branding) {
        String custom = brandingHelper.buildFooterHtml(branding, nvl(in.getAssessmentName(), ""));
        if (custom != null && !custom.isEmpty()) {
            sb.append(custom);
        }
        sb.append("<div class=\"foot\"><table style=\"width: 100%;\"><tr>");
        sb.append("<td>");
        if (in.getProcessedJson() != null && !in.getProcessedJson().isBlank()) {
            sb.append("AI-assisted analysis")
                    .append(in.getInsightsGeneratedAt() != null
                            ? " generated on " + fmtDateTime(in.getInsightsGeneratedAt()) : "")
                    .append(". Review before sharing with a student or parent.");
        } else {
            sb.append("Generated from assessment data. AI insights were not available for this attempt.");
        }
        sb.append("</td>");
        sb.append("<td style=\"text-align: right;\">");
        if (in.getAttemptId() != null && !in.getAttemptId().isBlank()) {
            sb.append("Attempt ").append(esc(in.getAttemptId()));
        }
        sb.append("</td></tr></table></div>");
    }

    // ------------------------------------------------------------- data prep

    private JsonNode parseAi(String processedJson) {
        if (processedJson == null || processedJson.isBlank()) {
            return null;
        }
        try {
            JsonNode node = objectMapper.readTree(processedJson);
            // A 'failed' row stores an error object under the same column; it has
            // none of the report keys, so treat it as "no insights" rather than
            // rendering a report made of empty sections.
            return node != null && node.isObject() && node.has("performance_analysis") ? node : null;
        } catch (Exception e) {
            log.warn("Could not parse AI insight JSON for the teacher report: {}", e.getMessage());
            return null;
        }
    }

    private ParticipantsQuestionOverallDetailDto overall(Input in) {
        return in.getReportDetail() != null ? in.getReportDetail().getQuestionOverallDetailDto() : null;
    }

    private List<SectionComparisonDto> sectionComparisons(Input in) {
        StudentComparisonDto cmp = in.getComparison();
        if (cmp == null || cmp.getSectionWiseComparison() == null) {
            return Collections.emptyList();
        }
        List<SectionComparisonDto> out = new ArrayList<>();
        for (SectionComparisonDto s : cmp.getSectionWiseComparison()) {
            if (s != null) out.add(s);
        }
        return out;
    }

    /**
     * questionId -> percentage of the cohort that answered it correctly. Prefers
     * the full cohort aggregate when the caller supplied one, and otherwise
     * scrapes what it can out of the v2 analytics rows — those only carry the
     * questions that crossed an easy-miss or expertise threshold, so the table
     * degrades to "unclassified" for the rest rather than guessing.
     */
    private Map<String, Double> classCorrectPercentByQuestion(Input in) {
        Map<String, Double> out = new LinkedHashMap<>();
        if (in.getClassCorrectPercentByQuestion() != null && !in.getClassCorrectPercentByQuestion().isEmpty()) {
            out.putAll(in.getClassCorrectPercentByQuestion());
            return out;
        }
        StudentReportAnalyticsService.StudentReportAnalytics analytics = in.getAnalytics();
        if (analytics == null || !analytics.isQuestionInsightsAvailable()) {
            return out;
        }
        collectClassCorrect(out, analytics.getEasyMisses());
        collectClassCorrect(out, analytics.getExpertise());
        return out;
    }

    private void collectClassCorrect(Map<String, Double> out,
                                     List<StudentReportAnalyticsService.QuestionInsightRow> rows) {
        if (rows == null) return;
        for (StudentReportAnalyticsService.QuestionInsightRow row : rows) {
            if (row != null && row.getQuestionId() != null) {
                out.put(row.getQuestionId(), row.getClassCorrectPercent());
            }
        }
    }

    private int countAllQuestions(Input in) {
        if (in.getReportDetail() == null || in.getReportDetail().getAllSections() == null) {
            return 0;
        }
        int total = 0;
        for (List<StudentReportAnswerReviewDto> rows : in.getReportDetail().getAllSections().values()) {
            if (rows != null) total += rows.size();
        }
        return total;
    }

    private Double scorePercent(Input in) {
        StudentComparisonDto cmp = in.getComparison();
        ParticipantsQuestionOverallDetailDto overall = overall(in);
        Double marks = overall != null && overall.getAchievedMarks() != null ? overall.getAchievedMarks()
                : (cmp != null ? cmp.getStudentMarks() : null);
        Double total = cmp != null ? cmp.getTotalMarks() : null;
        if (marks == null || total == null || total <= 0) {
            return null;
        }
        return clampPct(marks / total * 100.0);
    }

    private Double marksLost(Input in) {
        StudentComparisonDto cmp = in.getComparison();
        if (cmp == null || cmp.getTotalMarks() == null) {
            return null;
        }
        double scored = cmp.getStudentMarks() != null ? cmp.getStudentMarks() : 0.0;
        return round1(Math.max(0.0, cmp.getTotalMarks() - scored));
    }

    private int countWeakTopics(JsonNode ai) {
        JsonNode topics = ai != null ? ai.get("topic_analysis") : null;
        if (topics == null || !topics.isArray()) {
            return 0;
        }
        int count = 0;
        for (JsonNode t : topics) {
            if (asDouble(t, "accuracy", 100) < WEAK_THRESHOLD) count++;
        }
        return count;
    }

    // --------------------------------------------------------- small helpers

    private static String priorityPill(double accuracy) {
        if (accuracy < WEAK_THRESHOLD) return pill("P1 · Reteach", RED);
        if (accuracy < BORDERLINE_THRESHOLD) return pill("P2 · Practise", AMBER);
        return pill("On track", GREEN);
    }

    private static String pill(String label, String color) {
        return "<span class=\"pill\" style=\"background-color: " + softOf(color) + "; color: " + color + ";\">"
                + esc(label) + "</span>";
    }

    /** Pale companion of a palette colour, for pill and banner backgrounds. */
    private static String softOf(String color) {
        if (RED.equals(color)) return RED_SOFT;
        if (AMBER.equals(color)) return AMBER_SOFT;
        if (GREEN.equals(color)) return GREEN_SOFT;
        return "#EEF1F6";
    }

    private static String bandColor(double accuracyPercent) {
        if (accuracyPercent < WEAK_THRESHOLD) return RED;
        if (accuracyPercent < BORDERLINE_THRESHOLD) return AMBER;
        return GREEN;
    }

    private static String masteryColor(String mastery) {
        if (mastery == null) return MUTED;
        return switch (mastery.trim().toLowerCase()) {
            case "expert" -> GREEN;
            case "proficient" -> NAVY;
            case "developing" -> AMBER;
            case "beginner" -> RED;
            default -> MUTED;
        };
    }

    private static String statusLabel(String status) {
        if (QuestionResponseEnum.CORRECT.name().equals(status)) return "Correct";
        if (QuestionResponseEnum.INCORRECT.name().equals(status)) return "Incorrect";
        if (QuestionResponseEnum.PARTIAL_CORRECT.name().equals(status)) return "Partial";
        return "Not answered";
    }

    private static String statusColor(String status) {
        if (QuestionResponseEnum.CORRECT.name().equals(status)) return GREEN;
        if (QuestionResponseEnum.INCORRECT.name().equals(status)) return RED;
        if (QuestionResponseEnum.PARTIAL_CORRECT.name().equals(status)) return AMBER;
        return MUTED;
    }

    private static String resolveAccent(ReportBrandingDto branding) {
        String configured = branding.getPrimaryColor() != null ? branding.getPrimaryColor().trim() : null;
        if (configured == null || configured.isEmpty()
                || LEGACY_DEFAULT_PRIMARY.equalsIgnoreCase(configured)
                || !SAFE_CSS_COLOR.matcher(configured).matches()) {
            return NAVY;
        }
        return configured;
    }

    private static double asDouble(JsonNode node, String field, double fallback) {
        if (node == null || !node.has(field) || node.get(field).isNull()) return fallback;
        return node.get(field).asDouble(fallback);
    }

    private static String text(JsonNode node, String field) {
        if (node == null || !node.has(field) || node.get(field).isNull()) return "";
        return node.get(field).asText("");
    }

    private static int nz(Integer value) {
        return value != null ? value : 0;
    }

    private static double pct(Double value, Double outOf) {
        if (value == null || outOf == null || outOf <= 0) return 0.0;
        return clampPct(value / outOf * 100.0);
    }

    private static double clampPct(double value) {
        return Math.max(0.0, Math.min(100.0, value));
    }

    private static double round1(double value) {
        return Math.round(value * 10.0) / 10.0;
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

    private static String capitalise(String value) {
        if (value == null || value.isEmpty()) return "";
        String lower = value.trim().toLowerCase();
        return Character.toUpperCase(lower.charAt(0)) + lower.substring(1);
    }

    /** Chart axes and narrow table cells cannot carry a full topic name. */
    private static String shortLabel(String value, int max) {
        if (value == null) return "";
        String trimmed = value.trim();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, Math.max(1, max - 1)) + "…";
    }

    private static String mdToHtml(String md) {
        if (md == null || md.isEmpty()) return "";
        String t = esc(md);
        t = t.replaceAll("(?m)^### (.+)$", "<div style=\"font-size:11.5px; font-weight:700; margin:8px 0 3px;\">$1</div>");
        t = t.replaceAll("(?m)^## (.+)$", "<div style=\"font-size:12px; font-weight:700; margin:10px 0 4px;\">$1</div>");
        t = t.replaceAll("\\*\\*(.+?)\\*\\*", "<b>$1</b>");
        t = t.replaceAll("(?m)^(\\d+)\\.\\s+(.+)$", "<div style=\"margin:3px 0 3px 14px;\"><b>$1.</b> $2</div>");
        t = t.replaceAll("(?m)^[-•]\\s+(.+)$", "<div style=\"margin:3px 0 3px 14px;\">• $1</div>");
        t = t.replace("\\n", "<br/>").replace("\n", "<br/>");
        // Block-level replacements above already end the line; the newline that
        // followed them would otherwise render as a second, empty line.
        t = t.replace("</div><br/>", "</div>").replace("<br/><div style=\"margin:", "<div style=\"margin:");
        return t;
    }

    private static String esc(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String escAttr(String url) {
        if (url == null) return "";
        return url.trim().replace("&amp;", "&").replace("&", "&amp;").replace("\"", "&quot;");
    }
}
