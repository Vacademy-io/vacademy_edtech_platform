package vacademy.io.assessment_service.features.assessment.service;

import lombok.Builder;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The ONE AI diagnostic report for a whole assessment — the document behind
 * "Download AI Report" on the assessment page.
 *
 * <p>Its reader is the teacher who just finished marking a paper and has to
 * decide what to do on Monday. So it is ordered as that decision is made:
 *
 * <ol>
 *   <li><b>Did the class get it?</b> — participation, distribution, averages.</li>
 *   <li><b>Where did the marks go?</b> — section, topic and question weakness,
 *       each with its own chart, ordered weakest-first so every table doubles
 *       as a reteaching queue.</li>
 *   <li><b>What do I reteach to everyone?</b> — misconceptions shared across
 *       the cohort, and a prioritised class action plan.</li>
 *   <li><b>Who do I pull aside?</b> — named students under each weak topic,
 *       an intervention list, and the full participant roster.</li>
 * </ol>
 *
 * <p>Deliberately ONE document per assessment, not one per student: the
 * cohort-level view is what makes a weak topic legible as a teaching gap
 * rather than an individual failure, and it costs one AI call instead of N.
 * The per-student detail lives inside it (§4) so a teacher can still act on
 * individuals from the same file.
 *
 * <p>This builder is pure rendering — it takes an already-aggregated
 * {@link Input} and returns HTML. Everything about how that aggregate is
 * computed, cached or charged lives outside it, so the layout can be
 * developed and reviewed without a database or an LLM.
 *
 * <p>Rendering constraints are iText html2pdf's, same as
 * {@link StudentReportHtmlV2Builder}: no JS, no flexbox/grid, no external
 * resources. Layout is tables and percentage-width divs; charts are PNG data
 * URIs from {@link AiReportChartGenerator}.
 */
@Slf4j
@Component
public class ClassAiReportHtmlBuilder {

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

    /** Below this accuracy an area is a P1 "reteach to everyone" item. */
    private static final double WEAK_THRESHOLD = 40.0;
    /** Below this it is a P2 "needs practice"; at or above it is on track. */
    private static final double BORDERLINE_THRESHOLD = 70.0;

    private static final String[] BLOOM_KEYS = {"remember", "understand", "apply", "analyze", "evaluate", "create"};
    private static final String[] BLOOM_NAMES = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"};

    private static final String[] PIE_COLORS = {
            "#1F3864", "#C62828", "#F57F17", "#2E7D32", "#A98467", "#6C5CE7", "#00838F", "#AD1457"};

    /** Keeps one enormous cohort from producing a hundred-page PDF. */
    private static final int MAX_ROSTER_ROWS = 400;
    private static final int MAX_QUESTION_ROWS = 40;
    private static final int MAX_TOPIC_ROWS = 16;
    private static final int MAX_MISCONCEPTIONS = 10;
    /** Names listed under a weak topic before it degrades to "+N more". */
    private static final int MAX_NAMES_PER_TOPIC = 12;

    @Autowired
    private ReportBrandingHelper brandingHelper;

    @Autowired
    private AiReportChartGenerator chartGenerator;

    @Autowired
    private ReportLogoService reportLogoService;

    // ------------------------------------------------------------------ input

    /** Class-wide figures for the paper. Every field is nullable — the report degrades rather than fails. */
    @Getter
    @Builder
    public static class ClassOverview {
        private final Integer totalRegistered;
        private final Integer attempted;
        private final Integer notAttempted;
        private final Double totalMarks;
        private final Double averageMarks;
        private final Double medianMarks;
        private final Double highestMarks;
        private final Double lowestMarks;
        private final Double averageAccuracy;
        /** Pass mark as configured on the assessment; null when none is set. */
        private final Double passMarks;
        private final Integer passedCount;
        private final Long averageDurationSeconds;
        private final Integer durationMinutes;
    }

    /** Provenance of the topic breakdown, so the report can say which it used. */
    public enum TopicSource { TAGS, AI }

    /** One bar of the score distribution, e.g. "40-59" -> 12 students. */
    @Getter
    @Builder
    public static class ScoreBand {
        private final String label;
        private final int studentCount;
    }

    @Getter
    @Builder
    public static class SectionRow {
        private final String name;
        private final Double totalMarks;
        private final Double averageMarks;
        private final Double highestMarks;
        private final Double lowestMarks;
        private final Double averageAccuracy;
        /** How many students scored below {@link #WEAK_THRESHOLD}% in this section. */
        private final Integer strugglingStudents;
    }

    @Getter
    @Builder
    public static class TopicRow {
        private final String topic;
        private final Integer questionCount;
        private final Double classAccuracy;
        private final Integer weakStudentCount;
        private final Integer totalStudents;
        private final String masteryLabel;
    }

    @Getter
    @Builder
    public static class QuestionRow {
        private final Integer number;
        private final String section;
        private final String topic;
        private final Double classCorrectPercent;
        /** The distractor the most students chose, for a question the class failed. */
        private final String topWrongAnswer;
        private final Double topWrongPercent;
        private final Integer skippedCount;
    }

    @Getter
    @Builder
    public static class Misconception {
        private final String questionSummary;
        private final Integer affectedStudents;
        private final String wrongAnswer;
        private final String correctAnswer;
        private final String misconception;
        private final String remediation;
    }

    @Getter
    @Builder
    public static class ActionStep {
        private final Integer priority;
        private final String topic;
        private final String suggestion;
        private final String estimatedTime;
        private final Integer affectedStudents;
    }

    @Getter
    @Builder
    public static class StudentRow {
        private final String name;
        private final String username;
        private final Double marks;
        private final Double percentage;
        private final Integer rank;
        private final boolean attempted;
        private final List<String> weakSections;
        private final List<String> weakTopics;
    }

    @Getter
    @Builder
    public static class Input {
        private final String assessmentName;
        private final String instituteName;
        private final String batchLabel;
        private final Date examDate;
        private final Date generatedAt;
        private final ReportBrandingDto branding;

        private final ClassOverview overview;
        private final List<ScoreBand> distribution;
        private final List<SectionRow> sections;
        private final List<TopicRow> topics;
        private final List<QuestionRow> hardestQuestions;
        /** Bloom's level (lowercase key) -> {correct, total} summed across the cohort. */
        private final Map<String, int[]> blooms;
        private final List<Misconception> misconceptions;
        private final List<ActionStep> actionPlan;
        private final List<StudentRow> roster;
        /** Weak topic -> the students weak in it, for the "who is weak where" section. */
        private final Map<String, List<String>> weakTopicStudents;

        // ---- AI narrative (markdown) ----
        private final String narrative;
        private final String areasOfImprovement;
        private final String bloomsReading;
        /** True when the AI half was unavailable; the footer says so instead of implying analysis. */
        private final boolean aiUnavailable;
        /**
         * Where {@link #topics} came from — {@code TAGS} when the paper's
         * questions are tagged, {@code AI} when the model inferred them from
         * question text. Only ~4% of prod assessments have tagged questions, so
         * both paths are real and the report must not claim the wrong one.
         */
        private final TopicSource topicSource;
    }

    // ------------------------------------------------------------------ build

    public String build(Input in) {
        if (in == null) {
            in = Input.builder().build();
        }
        ReportBrandingDto branding = in.getBranding() != null ? in.getBranding() : ReportBrandingDto.builder().build();
        String accent = resolveAccent(branding);

        StringBuilder sb = new StringBuilder(96 * 1024);
        sb.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\">");
        sb.append("<title>Assessment AI Diagnostic Report</title>");
        appendCss(sb, accent);
        sb.append("</head><body>");
        appendWatermark(sb, branding, accent);
        sb.append("<div class=\"wrap\">");

        appendLetterhead(sb, in, branding, accent);
        appendVerdict(sb, in);
        appendStatCards(sb, in, accent);
        appendPaperOverview(sb, in, accent);
        appendSectionAnalysis(sb, in, accent);
        appendMarksLost(sb, in);
        appendTopicAnalysis(sb, in);
        appendHardestQuestions(sb, in);
        appendBlooms(sb, in, accent);
        appendMisconceptions(sb, in);
        appendActionPlan(sb, in, accent);
        appendInterventionList(sb, in);
        appendWeakTopicStudents(sb, in);
        appendRoster(sb, in);
        appendNarrative(sb, in);
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
        // Roster runs long, so it gets its own tighter metrics.
        sb.append(".roster { font-size: 9.5px; }");
        sb.append(".roster th { padding: 5px 6px; font-size: 8.5px; }");
        sb.append(".roster td { padding: 4px 6px; }");
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
        sb.append(".names { font-size: 10px; color: ").append(INK).append("; line-height: 1.7; }");
        sb.append(".wm { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; }");
        sb.append(".wm-text { position: absolute; top: 360pt; left: 100pt; font-size: 60px; font-weight: bold; white-space: nowrap; transform: rotate(-35deg); }");
        sb.append(".foot { border-top: 1px solid ").append(RULE)
                .append("; margin-top: 18px; padding-top: 7px; font-size: 9px; color: ").append(FAINT).append("; }");
        sb.append("</style>");
    }

    // ------------------------------------------------------------ letterhead

    /**
     * Honours the institute's {@code showWatermark} branding, same as the v2
     * student report — an institute that watermarks one report expects the
     * other to match.
     */
    private void appendWatermark(StringBuilder sb, ReportBrandingDto branding, String accent) {
        if (!Boolean.TRUE.equals(branding.getShowWatermark())
                || branding.getWatermarkText() == null || branding.getWatermarkText().isBlank()) {
            return;
        }
        double opacity = branding.getWatermarkOpacity() != null ? branding.getWatermarkOpacity() : 0.05;
        sb.append("<div class=\"wm\"><div class=\"wm-text\" style=\"color: ").append(accent)
                .append("; opacity: ").append(opacity).append(";\">")
                .append(esc(branding.getWatermarkText()))
                .append("</div></div>");
    }

    private void appendLetterhead(StringBuilder sb, Input in, ReportBrandingDto branding, String accent) {
        // Inlined (trimmed + downscaled) asset first; the raw presigned URL is
        // the fallback, which is what every other report still uses.
        String logoSrc = reportLogoService.resolveInlineLogo(branding.getLogoFileId());
        boolean inlined = logoSrc != null;
        if (logoSrc == null) {
            logoSrc = brandingHelper.resolveLogoUrl(branding);
        }

        sb.append("<table style=\"width: 100%;\"><tr>");
        if (logoSrc != null && Boolean.TRUE.equals(branding.getShowLogoInHeader())) {
            // A trimmed logo has no padding of its own, so it can fill a larger
            // box; an untrimmed fallback keeps the conservative 40px so its own
            // whitespace does not push the mark into illegibility.
            int box = inlined ? 52 : 40;
            sb.append("<td style=\"width: ").append(box + 16).append("px; vertical-align: middle; padding-right: 12px;\">")
                    .append("<div style=\"border: 1px solid ").append(BORDER)
                    .append("; border-radius: 6px; padding: 5px; width: ").append(box)
                    .append("px; text-align: center;\">")
                    .append("<img src=\"").append(inlined ? logoSrc : escAttr(logoSrc))
                    .append("\" style=\"max-height: ").append(box).append("px; max-width: ")
                    .append(box).append("px;\" /></div></td>");
        }
        sb.append("<td style=\"vertical-align: middle;\">");
        sb.append("<div style=\"font-size: 12px; font-weight: 700; letter-spacing: 1.4px; color: ").append(MUTED).append(";\">")
                .append("ASSESSMENT AI DIAGNOSTIC REPORT</div>");
        sb.append("<div style=\"font-size: 22px; font-weight: 800; color: ").append(accent).append("; margin-top: 2px;\">")
                .append(esc(nvl(in.getAssessmentName(), "Assessment"))).append("</div>");
        sb.append("</td>");
        sb.append("<td style=\"vertical-align: middle; text-align: right; font-size: 10px; color: ")
                .append(MUTED).append("; white-space: nowrap;\">");
        if (in.getExamDate() != null) {
            sb.append("<div>Test date: <b style=\"color: ").append(INK).append(";\">")
                    .append(fmtDate(in.getExamDate())).append("</b></div>");
        }
        ClassOverview o = in.getOverview();
        if (o != null && o.getDurationMinutes() != null && o.getDurationMinutes() > 0) {
            sb.append("<div>Duration: <b style=\"color: ").append(INK).append(";\">")
                    .append(o.getDurationMinutes()).append(" min</b></div>");
        }
        if (in.getGeneratedAt() != null) {
            sb.append("<div>Generated: <b style=\"color: ").append(INK).append(";\">")
                    .append(fmtDate(in.getGeneratedAt())).append("</b></div>");
        }
        sb.append("</td></tr></table>");

        sb.append("<div style=\"border-bottom: 3px solid ").append(accent).append("; margin: 8px 0 8px 0;\"></div>");

        List<String> meta = new ArrayList<>();
        if (in.getInstituteName() != null && !in.getInstituteName().isBlank()) {
            meta.add("<b style=\"color: " + INK + ";\">" + esc(in.getInstituteName()) + "</b>");
        }
        if (in.getBatchLabel() != null && !in.getBatchLabel().isBlank()) {
            meta.add(esc(in.getBatchLabel()));
        }
        if (o != null && o.getAttempted() != null) {
            meta.add(o.getAttempted() + " of "
                    + (o.getTotalRegistered() != null ? o.getTotalRegistered() : o.getAttempted())
                    + " students attempted");
        }
        if (!meta.isEmpty()) {
            sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append(";\">")
                    .append(String.join(" &nbsp;&middot;&nbsp; ", meta)).append("</div>");
        }
    }

    // --------------------------------------------------------------- verdict

    /**
     * The one-line answer to "how did my class do, and is the problem the class
     * or the paper?" — the first thing a teacher looks for, so it sits above
     * every chart.
     */
    private void appendVerdict(StringBuilder sb, Input in) {
        ClassOverview o = in.getOverview();
        if (o == null || o.getAverageMarks() == null || o.getTotalMarks() == null || o.getTotalMarks() <= 0) {
            return;
        }
        double avgPct = clampPct(o.getAverageMarks() / o.getTotalMarks() * 100.0);
        int weakTopics = countWeak(in.getTopics());
        int weakSections = 0;
        if (in.getSections() != null) {
            for (SectionRow s : in.getSections()) {
                if (s.getAverageAccuracy() != null && s.getAverageAccuracy() < WEAK_THRESHOLD) weakSections++;
            }
        }

        String tone;
        String title;
        StringBuilder body = new StringBuilder();
        if (avgPct < 40) {
            tone = RED;
            title = "The class did not get this paper";
            body.append("Class average is ").append(fmt(avgPct))
                    .append("%. At this level the gap is usually the teaching sequence or the paper's difficulty, not the students");
            body.append(hasBreakdown(in)
                    ? " — check the hardest-questions table before assuming otherwise."
                    : ".");
        } else if (avgPct < 70) {
            tone = AMBER;
            title = "Mixed — the loss is concentrated, not spread";
            body.append("Class average is ").append(fmt(avgPct)).append("%.");
            if (hasBreakdown(in)) {
                body.append(" Most of the shortfall sits in a few areas rather than across the paper;"
                        + " the section and topic tables below show which.");
            }
        } else {
            tone = GREEN;
            title = "The class is on track";
            body.append("Class average is ").append(fmt(avgPct))
                    .append("%. What remains is a short list of recoverable areas and a handful of students who need pulling up.");
        }
        if (weakTopics > 0) {
            body.append(" ").append(weakTopics).append(weakTopics == 1 ? " topic is" : " topics are")
                    .append(" below ").append((int) WEAK_THRESHOLD).append("% and flagged for reteaching");
            if (weakSections > 0) {
                body.append(", across ").append(weakSections)
                        .append(weakSections == 1 ? " section" : " sections");
            }
            body.append(".");
        }
        if (!hasBreakdown(in)) {
            // A PDF/OMR paper carries no per-question record, so there is no
            // section or topic table below to send the reader to. Saying so is
            // the difference between an honest report and one that looks broken.
            body.append(" This paper has no per-question record, so the breakdown below is limited to "
                    + "totals and the participant roster.");
        }

        sb.append("<div class=\"banner\" style=\"background-color: ").append(softOf(tone))
                .append("; border-left-color: ").append(tone).append(";\">");
        sb.append("<div class=\"banner-title\" style=\"color: ").append(tone).append(";\">").append(title).append("</div>");
        sb.append("<div class=\"banner-body\">").append(esc(body.toString())).append("</div>");
        sb.append("</div>");
    }

    // ------------------------------------------------------------ stat cards

    private void appendStatCards(StringBuilder sb, Input in, String accent) {
        ClassOverview o = in.getOverview();
        if (o == null) return;

        Double avgPct = o.getAverageMarks() != null && o.getTotalMarks() != null && o.getTotalMarks() > 0
                ? clampPct(o.getAverageMarks() / o.getTotalMarks() * 100.0) : null;
        Double passRate = o.getPassedCount() != null && o.getAttempted() != null && o.getAttempted() > 0
                ? clampPct(o.getPassedCount() * 100.0 / o.getAttempted()) : null;

        sb.append("<table class=\"cards\"><tr>");
        appendStatCard(sb, accent, "ATTEMPTED",
                o.getAttempted() != null ? String.valueOf(o.getAttempted()) : "-",
                o.getTotalRegistered() != null ? "of " + o.getTotalRegistered() + " registered" : "");
        appendStatCard(sb, avgPct != null ? bandColor(avgPct) : BROWN, "CLASS AVERAGE",
                o.getAverageMarks() != null ? fmt(o.getAverageMarks()) : "-",
                o.getTotalMarks() != null ? "out of " + fmt(o.getTotalMarks())
                        + (avgPct != null ? " · " + fmt(avgPct) + "%" : "") : "");
        appendStatCard(sb, GREEN, "HIGHEST",
                o.getHighestMarks() != null ? fmt(o.getHighestMarks()) : "-",
                o.getLowestMarks() != null ? "lowest " + fmt(o.getLowestMarks()) : "");
        if (passRate != null) {
            appendStatCard(sb, bandColor(passRate), "PASS RATE", fmt(passRate) + "%",
                    o.getPassMarks() != null ? "pass mark " + fmt(o.getPassMarks()) : "");
        } else {
            appendStatCard(sb, BROWN, "MEDIAN",
                    o.getMedianMarks() != null ? fmt(o.getMedianMarks()) : "-", "middle of the class");
        }
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

    // -------------------------------------------------------- paper overview

    private void appendPaperOverview(StringBuilder sb, Input in, String accent) {
        ClassOverview o = in.getOverview();
        List<ScoreBand> bands = in.getDistribution();
        if (o == null && (bands == null || bands.isEmpty())) return;

        sb.append("<div class=\"sect\"><div class=\"h2\">PAPER OVERVIEW</div>");
        sb.append("<div class=\"hint\">How the marks fell across the cohort — a flat spread means the paper discriminated; a cliff at one end usually means it did not.</div>");
        sb.append("<table style=\"width: 100%;\"><tr>");

        sb.append("<td style=\"width: 56%; vertical-align: middle;\">");
        if (bands != null && !bands.isEmpty()) {
            Map<String, Double> counts = new LinkedHashMap<>();
            for (ScoreBand b : bands) counts.put(b.getLabel(), (double) b.getStudentCount());
            String chart = chartGenerator.generateCountBarChart("Students", counts, accent, 540, 250);
            if (chart != null) {
                sb.append("<div class=\"chart\"><img src=\"").append(chart).append("\" style=\"max-width: 400px;\" /></div>");
            }
        } else {
            sb.append("&nbsp;");
        }
        sb.append("</td>");

        sb.append("<td style=\"width: 44%; vertical-align: middle; padding-left: 10px;\">");
        sb.append("<table class=\"kv\" style=\"width: 100%;\">");
        if (o != null) {
            if (o.getTotalRegistered() != null) kv(sb, "Registered", String.valueOf(o.getTotalRegistered()));
            if (o.getAttempted() != null) kv(sb, "Attempted", String.valueOf(o.getAttempted()));
            if (o.getNotAttempted() != null && o.getNotAttempted() > 0) {
                kv(sb, "Did not attempt", String.valueOf(o.getNotAttempted()));
            }
            if (o.getTotalMarks() != null) kv(sb, "Paper total", fmt(o.getTotalMarks()));
            if (o.getAverageMarks() != null) kv(sb, "Class average", fmt(o.getAverageMarks()));
            if (o.getMedianMarks() != null) kv(sb, "Median", fmt(o.getMedianMarks()));
            if (o.getHighestMarks() != null) kv(sb, "Highest", fmt(o.getHighestMarks()));
            if (o.getLowestMarks() != null) kv(sb, "Lowest", fmt(o.getLowestMarks()));
            if (o.getAverageAccuracy() != null) kv(sb, "Average accuracy", fmt(o.getAverageAccuracy()) + "%");
            if (o.getPassMarks() != null && o.getPassedCount() != null) {
                kv(sb, "Passed (" + fmt(o.getPassMarks()) + "+)", o.getPassedCount()
                        + (o.getAttempted() != null ? " of " + o.getAttempted() : ""));
            }
            if (o.getAverageDurationSeconds() != null && o.getAverageDurationSeconds() > 0) {
                kv(sb, "Average time taken", HtmlBuilderService.convertToReadableTime(o.getAverageDurationSeconds()));
            }
        }
        sb.append("</table></td></tr></table></div>");
    }

    private void kv(StringBuilder sb, String key, String value) {
        sb.append("<tr><td class=\"k\">").append(esc(key)).append("</td><td class=\"v\">")
                .append(esc(value)).append("</td></tr>");
    }

    // ------------------------------------------------------ section analysis

    private void appendSectionAnalysis(StringBuilder sb, Input in, String accent) {
        List<SectionRow> sections = in.getSections();
        if (sections == null || sections.isEmpty()) return;

        sb.append("<div class=\"sect\"><div class=\"h2\">SECTION-WISE CLASS PERFORMANCE</div>");
        sb.append("<div class=\"hint\">Class average accuracy against the best score achieved in each section. A wide gap means the section was learnable but most of the class did not get there.</div>");

        Map<String, Double> avg = new LinkedHashMap<>();
        Map<String, Double> best = new LinkedHashMap<>();
        for (SectionRow s : sections) {
            String label = shortLabel(nvl(s.getName(), "Section"), 16);
            avg.put(label, round1(clampPct(s.getAverageAccuracy() != null ? s.getAverageAccuracy() : 0.0)));
            double bestPct = s.getHighestMarks() != null && s.getTotalMarks() != null && s.getTotalMarks() > 0
                    ? clampPct(s.getHighestMarks() / s.getTotalMarks() * 100.0) : 0.0;
            best.put(label, round1(bestPct));
        }
        String chart = chartGenerator.generateComparisonBarChart("Accuracy %", avg, best,
                "Class average", "Best in class", accent, 540, 260);
        if (chart != null) {
            sb.append("<div class=\"chart\"><img src=\"").append(chart).append("\" style=\"max-width: 500px;\" /></div>");
        }
        sb.append("</div><div>");

        sb.append("<table class=\"tbl\">");
        sb.append("<tr><th>SECTION</th><th style=\"text-align: right;\">OUT OF</th>")
                .append("<th style=\"text-align: right;\">CLASS AVG</th>")
                .append("<th style=\"text-align: right;\">ACCURACY</th>")
                .append("<th style=\"text-align: right;\">BEST</th>")
                .append("<th style=\"text-align: right;\">LOWEST</th>")
                .append("<th style=\"text-align: right;\">STRUGGLING</th>")
                .append("<th>FOCUS</th></tr>");
        for (SectionRow s : sections) {
            double acc = s.getAverageAccuracy() != null ? s.getAverageAccuracy() : 0.0;
            sb.append("<tr><td><b>").append(esc(nvl(s.getName(), "Section"))).append("</b></td>");
            sb.append("<td style=\"text-align: right;\">").append(fmt(s.getTotalMarks())).append("</td>");
            sb.append("<td style=\"text-align: right;\"><b>").append(fmt(s.getAverageMarks())).append("</b></td>");
            sb.append("<td style=\"text-align: right; color: ").append(bandColor(acc)).append("; font-weight: 700;\">")
                    .append(fmt(acc)).append("%</td>");
            sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                    .append(fmt(s.getHighestMarks())).append("</td>");
            sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                    .append(fmt(s.getLowestMarks())).append("</td>");
            sb.append("<td style=\"text-align: right; color: ")
                    .append(s.getStrugglingStudents() != null && s.getStrugglingStudents() > 0 ? RED : MUTED)
                    .append(";\">").append(s.getStrugglingStudents() != null ? s.getStrugglingStudents() : 0)
                    .append("</td>");
            sb.append("<td>").append(priorityPill(acc)).append("</td></tr>");
        }
        sb.append("</table></div>");
    }

    // ---------------------------------------------------------- marks lost pie

    private void appendMarksLost(StringBuilder sb, Input in) {
        List<SectionRow> sections = in.getSections();
        if (sections == null || sections.size() < 2) return;

        Map<String, Double> lost = new LinkedHashMap<>();
        double total = 0;
        for (SectionRow s : sections) {
            if (s.getTotalMarks() == null) continue;
            double gap = Math.max(0.0, s.getTotalMarks() - (s.getAverageMarks() != null ? s.getAverageMarks() : 0.0));
            if (gap > 0) {
                lost.put(shortLabel(nvl(s.getName(), "Section"), 20), round1(gap));
                total += gap;
            }
        }
        if (lost.size() < 2 || total <= 0) return;

        String pie = chartGenerator.generatePieChart(lost, PIE_COLORS);
        if (pie == null) return;
        String worst = lost.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);

        sb.append("<div class=\"sect\"><div class=\"h2\">WHERE THE CLASS LOST MARKS</div>");
        sb.append("<div class=\"hint\">Share of the ").append(fmt(total))
                .append(" marks the average student did not score")
                .append(worst != null ? " — the biggest single loss is in " + esc(worst) + "." : ".")
                .append(" Revision time is best spent in proportion to this, not to accuracy alone: a large section at 60% costs more than a small one at 20%.</div>");
        sb.append("<div class=\"chart\"><img src=\"").append(pie).append("\" style=\"max-width: 460px;\" /></div>");
        sb.append("</div>");
    }

    // -------------------------------------------------------- topic analysis

    private void appendTopicAnalysis(StringBuilder sb, Input in) {
        List<TopicRow> topics = in.getTopics();
        if (topics == null || topics.isEmpty()) return;

        List<TopicRow> ordered = new ArrayList<>(topics);
        ordered.sort((a, b) -> Double.compare(nz(a.getClassAccuracy()), nz(b.getClassAccuracy())));
        if (ordered.size() > MAX_TOPIC_ROWS) {
            log.info("Class AI report: showing {} of {} topics", MAX_TOPIC_ROWS, ordered.size());
            ordered = ordered.subList(0, MAX_TOPIC_ROWS);
        }

        sb.append("<div class=\"sect\"><div class=\"h2\">TOPIC-WISE CLASS WEAKNESS</div>");
        sb.append("<div class=\"hint\">")
                .append(in.getTopicSource() == TopicSource.TAGS
                        ? "Topics taken from this paper's question tags"
                        : "Topics inferred by the model from the question content")
                .append(", weakest first. Red is below ")
                .append((int) WEAK_THRESHOLD).append("% class accuracy, amber below ")
                .append((int) BORDERLINE_THRESHOLD).append("%.</div>");

        Map<String, Double> chartData = new LinkedHashMap<>();
        for (TopicRow t : ordered) {
            if (t.getTopic() != null && !t.getTopic().isBlank()) {
                chartData.put(shortLabel(t.getTopic(), 26), round1(clampPct(nz(t.getClassAccuracy()))));
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
                .append("<th style=\"text-align: right;\">CLASS ACCURACY</th>")
                .append("<th style=\"text-align: right;\">STUDENTS WEAK</th>")
                .append("<th>LEVEL</th><th>WHAT TO DO</th></tr>");
        for (TopicRow t : ordered) {
            double acc = nz(t.getClassAccuracy());
            String mastery = nvl(t.getMasteryLabel(), "-");
            sb.append("<tr><td><b>").append(escContent(nvl(t.getTopic(), ""))).append("</b></td>");
            sb.append("<td style=\"text-align: right;\">").append(t.getQuestionCount() != null ? t.getQuestionCount() : 0).append("</td>");
            sb.append("<td style=\"text-align: right; color: ").append(bandColor(acc)).append("; font-weight: 700;\">")
                    .append(fmt(acc)).append("%</td>");
            sb.append("<td style=\"text-align: right; color: ")
                    .append(t.getWeakStudentCount() != null && t.getWeakStudentCount() > 0 ? RED : MUTED).append(";\">")
                    .append(t.getWeakStudentCount() != null ? t.getWeakStudentCount() : 0)
                    .append(t.getTotalStudents() != null ? " / " + t.getTotalStudents() : "").append("</td>");
            sb.append("<td>").append(pill(mastery, masteryColor(mastery))).append("</td>");
            sb.append("<td style=\"color: ").append(MUTED).append("; font-size: 10px;\">")
                    .append(esc(topicAction(acc))).append("</td></tr>");
        }
        sb.append("</table></div>");
    }

    /** The class-level instruction attached to each topic row. */
    private static String topicAction(double accuracy) {
        if (accuracy < WEAK_THRESHOLD) return "Reteach to the whole class, then re-test";
        if (accuracy < BORDERLINE_THRESHOLD) return "Targeted practice set; revisit in class";
        return "Secure — spiral revision only";
    }

    // ------------------------------------------------------ hardest questions

    private void appendHardestQuestions(StringBuilder sb, Input in) {
        List<QuestionRow> questions = in.getHardestQuestions();
        if (questions == null || questions.isEmpty()) return;

        List<QuestionRow> ordered = new ArrayList<>(questions);
        ordered.sort((a, b) -> Double.compare(nz(a.getClassCorrectPercent()), nz(b.getClassCorrectPercent())));
        boolean truncated = ordered.size() > MAX_QUESTION_ROWS;
        if (truncated) ordered = ordered.subList(0, MAX_QUESTION_ROWS);

        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">HARDEST QUESTIONS</div>");
        sb.append("<div class=\"hint\">Questions ordered by how few of the class got them right. Below ")
                .append((int) WEAK_THRESHOLD).append("% is a teaching gap, not a hard question — and the most-chosen wrong answer usually names the misconception.</div>");
        sb.append("<table class=\"tbl\">");
        sb.append("<tr><th style=\"text-align: right;\">Q</th><th>SECTION</th><th>TOPIC</th>")
                .append("<th style=\"text-align: right;\">CLASS CORRECT</th>")
                .append("<th style=\"text-align: right;\">SKIPPED</th>")
                .append("<th>MOST-CHOSEN WRONG ANSWER</th><th>VERDICT</th></tr>");
        for (QuestionRow q : ordered) {
            double pct = nz(q.getClassCorrectPercent());
            sb.append("<tr><td style=\"text-align: right;\"><b>").append(q.getNumber() != null ? q.getNumber() : "-").append("</b></td>");
            sb.append("<td style=\"color: ").append(MUTED).append(";\">").append(esc(shortLabel(nvl(q.getSection(), "-"), 16))).append("</td>");
            sb.append("<td style=\"color: ").append(MUTED).append(";\">").append(esc(shortLabel(nvl(q.getTopic(), "-"), 22))).append("</td>");
            sb.append("<td style=\"text-align: right; color: ").append(bandColor(pct)).append("; font-weight: 700;\">")
                    .append(fmt(pct)).append("%</td>");
            sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                    .append(q.getSkippedCount() != null ? q.getSkippedCount() : 0).append("</td>");
            sb.append("<td style=\"font-size: 10px;\">");
            if (q.getTopWrongAnswer() != null && !q.getTopWrongAnswer().isBlank()) {
                sb.append("<span style=\"color: ").append(RED).append(";\">")
                        .append(escContent(q.getTopWrongAnswer())).append("</span>");
                if (q.getTopWrongPercent() != null) {
                    sb.append(" <span style=\"color: ").append(FAINT).append(";\">(")
                            .append(fmt(q.getTopWrongPercent())).append("%)</span>");
                }
            } else {
                sb.append("<span style=\"color: ").append(FAINT).append(";\">-</span>");
            }
            sb.append("</td>");
            sb.append("<td style=\"font-size: 10px;\">").append(questionVerdict(pct)).append("</td></tr>");
        }
        sb.append("</table>");
        if (truncated) {
            sb.append("<div class=\"hint\" style=\"margin-top: 6px;\">Showing the ")
                    .append(MAX_QUESTION_ROWS).append(" hardest of ").append(questions.size())
                    .append(" questions. The full question breakdown is in the Question Insights export.</div>");
        }
        sb.append("</div>");
    }

    private static String questionVerdict(double classCorrectPercent) {
        if (classCorrectPercent < 25) {
            return pill("Reteach to all", RED) + " <span style=\"color:" + MUTED + ";\">almost nobody got it</span>";
        }
        if (classCorrectPercent < WEAK_THRESHOLD) {
            return pill("Teaching gap", RED) + " <span style=\"color:" + MUTED + ";\">most of the class missed it</span>";
        }
        if (classCorrectPercent < BORDERLINE_THRESHOLD) {
            return pill("Revisit", AMBER) + " <span style=\"color:" + MUTED + ";\">split the class</span>";
        }
        return "<span style=\"color:" + MUTED + ";\">Well answered</span>";
    }

    // ---------------------------------------------------------------- blooms

    private void appendBlooms(StringBuilder sb, Input in, String accent) {
        Map<String, int[]> blooms = in.getBlooms();
        if (blooms == null || blooms.isEmpty()) return;

        Map<String, Double> accuracy = new LinkedHashMap<>();
        Map<String, int[]> counts = new LinkedHashMap<>();
        for (int i = 0; i < BLOOM_KEYS.length; i++) {
            int[] v = blooms.get(BLOOM_KEYS[i]);
            if (v == null || v.length < 2 || v[1] <= 0) continue;
            counts.put(BLOOM_NAMES[i], v);
            accuracy.put(BLOOM_NAMES[i], round1(clampPct(v[0] * 100.0 / v[1])));
        }
        if (counts.isEmpty()) return;

        sb.append("<div class=\"sect\"><div class=\"h2\">COGNITIVE LEVEL PROFILE (BLOOM'S)</div>");
        sb.append("<div class=\"hint\">Where the class sits between recall and reasoning. Strong Remember/Understand with weak Apply/Analyze is the classic sign that content is being learnt but not used.</div>");
        String chart = chartGenerator.generateComparisonBarChart("Class accuracy %", accuracy, null,
                "Class accuracy", null, accent, 540, 250);
        if (chart != null) {
            sb.append("<div class=\"chart\"><img src=\"").append(chart).append("\" style=\"max-width: 500px;\" /></div>");
        }
        sb.append("</div><div>");
        sb.append("<table class=\"tbl\"><tr><th>LEVEL</th><th style=\"text-align: right;\">CORRECT</th>")
                .append("<th style=\"text-align: right;\">ASKED</th><th style=\"text-align: right;\">CLASS ACCURACY</th>")
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
        sb.append("</table>");
        if (in.getBloomsReading() != null && !in.getBloomsReading().isBlank()) {
            sb.append("<div class=\"panel\" style=\"margin-top: 8px;\"><span style=\"font-weight: 700; color: ")
                    .append(NAVY).append(";\">What this means for teaching: </span><span style=\"font-size: 10.5px; color: ")
                    .append(MUTED).append(";\">").append(esc(in.getBloomsReading())).append("</span></div>");
        }
        sb.append("</div>");
    }

    private static String bloomReading(String level, double accuracy) {
        if (accuracy >= BORDERLINE_THRESHOLD) return "Secure across the class";
        if (accuracy >= WEAK_THRESHOLD) return "Split class — reteach to the lower half";
        return switch (level) {
            case "Remember", "Understand" -> "Content did not land — reteach the material itself";
            case "Apply" -> "Theory known, not usable — drill worked examples in class";
            case "Analyze", "Evaluate" -> "Reasoning not developed — scaffold with guided questions";
            default -> "Open-ended tasks are beyond the class for now";
        };
    }

    // -------------------------------------------------------- misconceptions

    private void appendMisconceptions(StringBuilder sb, Input in) {
        List<Misconception> items = in.getMisconceptions();
        if (items == null || items.isEmpty()) return;

        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">SHARED MISCONCEPTIONS</div>");
        sb.append("<div class=\"hint\">Wrong answers many students gave for the same reason. These are worth one class explanation each — they are the highest-yield thing on this report.</div>");
        int shown = 0;
        for (Misconception m : items) {
            if (shown++ >= MAX_MISCONCEPTIONS) break;
            sb.append("<div class=\"panel\">");
            sb.append("<table style=\"width: 100%; margin-bottom: 5px;\"><tr>");
            sb.append("<td style=\"font-size: 11px; font-weight: 700; color: ").append(NAVY).append(";\">")
                    .append(escContent(nvl(m.getQuestionSummary(), ""))).append("</td>");
            if (m.getAffectedStudents() != null) {
                sb.append("<td style=\"width: 110px; text-align: right;\">")
                        .append(pill(m.getAffectedStudents() + " students", RED)).append("</td>");
            }
            sb.append("</tr></table>");
            sb.append("<table style=\"width: 100%; font-size: 10px; margin-bottom: 6px;\"><tr>");
            sb.append("<td style=\"width: 50%; color: ").append(RED).append(";\"><b>They answered:</b> ")
                    .append(escContent(nvl(m.getWrongAnswer(), "-"))).append("</td>");
            sb.append("<td style=\"width: 50%; color: ").append(GREEN).append(";\"><b>Correct:</b> ")
                    .append(escContent(nvl(m.getCorrectAnswer(), "-"))).append("</td></tr></table>");
            if (m.getMisconception() != null && !m.getMisconception().isBlank()) {
                sb.append("<div style=\"font-size: 10.5px; background-color: ").append(AMBER_SOFT)
                        .append("; border-left: 3px solid ").append(AMBER)
                        .append("; padding: 6px 9px; margin-bottom: 5px;\"><b style=\"color: ").append(AMBER)
                        .append(";\">Why the class went wrong: </b>").append(esc(m.getMisconception())).append("</div>");
            }
            if (m.getRemediation() != null && !m.getRemediation().isBlank()) {
                sb.append("<div style=\"font-size: 10.5px; background-color: ").append(GREEN_SOFT)
                        .append("; border-left: 3px solid ").append(GREEN)
                        .append("; padding: 6px 9px;\"><b style=\"color: ").append(GREEN)
                        .append(";\">Reteach with: </b>").append(esc(m.getRemediation())).append("</div>");
            }
            sb.append("</div>");
        }
        sb.append("</div>");
    }

    // ------------------------------------------------------------ action plan

    private void appendActionPlan(StringBuilder sb, Input in, String accent) {
        List<ActionStep> steps = in.getActionPlan();
        String areas = in.getAreasOfImprovement();
        boolean hasSteps = steps != null && !steps.isEmpty();
        if (!hasSteps && (areas == null || areas.isBlank())) return;

        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">WHAT TO RETEACH — CLASS ACTION PLAN</div>");
        sb.append("<div class=\"hint\">Ordered by how many marks it would recover across the cohort. Work down this list, not down the syllabus.</div>");
        if (hasSteps) {
            for (ActionStep step : steps) {
                int priority = step.getPriority() != null ? step.getPriority() : 0;
                sb.append("<div class=\"step\"><table style=\"width: 100%;\"><tr>");
                sb.append("<td style=\"width: 30px; vertical-align: top;\"><div class=\"num\" style=\"background-color: ")
                        .append(priority == 1 ? RED : priority == 2 ? AMBER : accent).append(";\">")
                        .append(priority > 0 ? priority : "&middot;").append("</div></td>");
                sb.append("<td style=\"vertical-align: top; padding-left: 6px;\">");
                sb.append("<table style=\"width: 100%;\"><tr>");
                sb.append("<td style=\"font-size: 11.5px; font-weight: 700; color: ").append(INK).append(";\">")
                        .append(esc(nvl(step.getTopic(), ""))).append("</td>");
                if (step.getAffectedStudents() != null) {
                    sb.append("<td style=\"width: 120px; text-align: right; font-size: 9.5px; color: ").append(RED).append(";\">")
                            .append(step.getAffectedStudents()).append(" students affected</td>");
                }
                sb.append("</tr></table>");
                sb.append("<div style=\"font-size: 10.5px; color: ").append(MUTED).append("; margin-top: 3px;\">")
                        .append(esc(nvl(step.getSuggestion(), ""))).append("</div>");
                if (step.getEstimatedTime() != null && !step.getEstimatedTime().isBlank()) {
                    sb.append("<div style=\"font-size: 9.5px; font-weight: 700; color: ").append(accent)
                            .append("; margin-top: 3px;\">Est. ").append(esc(step.getEstimatedTime())).append("</div>");
                }
                sb.append("</td></tr></table></div>");
            }
        }
        if (areas != null && !areas.isBlank()) {
            sb.append("<div style=\"font-size: 10px; font-weight: 700; color: ").append(MUTED)
                    .append("; letter-spacing: 0.8px; margin: 10px 0 4px 0;\">ALSO WORTH ADDRESSING</div>");
            sb.append("<div class=\"md\">").append(mdToHtml(areas)).append("</div>");
        }
        sb.append("</div>");
    }

    // ------------------------------------------------------ intervention list

    private void appendInterventionList(StringBuilder sb, Input in) {
        List<StudentRow> roster = in.getRoster();
        if (roster == null || roster.isEmpty()) return;

        List<StudentRow> atRisk = new ArrayList<>();
        List<StudentRow> absent = new ArrayList<>();
        for (StudentRow s : roster) {
            if (!s.isAttempted()) {
                absent.add(s);
            } else if (s.getPercentage() != null && s.getPercentage() < WEAK_THRESHOLD) {
                atRisk.add(s);
            }
        }
        if (atRisk.isEmpty() && absent.isEmpty()) return;
        atRisk.sort((a, b) -> Double.compare(nz(a.getPercentage()), nz(b.getPercentage())));

        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">STUDENTS NEEDING INTERVENTION</div>");
        sb.append("<div class=\"hint\">Below ").append((int) WEAK_THRESHOLD)
                .append("% overall — these are the students a class-wide reteach will not reach on its own.</div>");

        if (!atRisk.isEmpty()) {
            sb.append("<table class=\"tbl\">");
            sb.append("<tr><th>STUDENT</th><th style=\"text-align: right;\">SCORE</th>")
                    .append("<th style=\"text-align: right;\">RANK</th><th>WEAKEST AREAS</th></tr>");
            for (StudentRow s : atRisk) {
                sb.append("<tr><td><b>").append(esc(nvl(s.getName(), "-"))).append("</b>");
                if (s.getUsername() != null && !s.getUsername().isBlank()) {
                    sb.append("<div style=\"font-size: 9px; color: ").append(FAINT).append(";\">")
                            .append(esc(s.getUsername())).append("</div>");
                }
                sb.append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(RED).append("; font-weight: 700;\">")
                        .append(fmt(s.getMarks())).append(s.getPercentage() != null ? " (" + fmt(s.getPercentage()) + "%)" : "")
                        .append("</td>");
                sb.append("<td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                        .append(s.getRank() != null ? s.getRank() : "-").append("</td>");
                sb.append("<td style=\"font-size: 10px; color: ").append(MUTED).append(";\">")
                        .append(esc(joinOrDash(s.getWeakTopics(), s.getWeakSections()))).append("</td></tr>");
            }
            sb.append("</table>");
        }

        if (!absent.isEmpty()) {
            sb.append("<div class=\"panel\" style=\"margin-top: 10px;\">");
            sb.append("<div style=\"font-size: 10px; font-weight: 700; color: ").append(NAVY)
                    .append("; letter-spacing: 0.8px; margin-bottom: 4px;\">DID NOT ATTEMPT (")
                    .append(absent.size()).append(")</div>");
            List<String> names = new ArrayList<>();
            for (StudentRow s : absent) names.add(nvl(s.getName(), "-"));
            sb.append("<div class=\"names\" style=\"color: ").append(MUTED).append(";\">")
                    .append(esc(String.join(" · ", names))).append("</div></div>");
        }
        sb.append("</div>");
    }

    // ---------------------------------------------------- who is weak where

    private void appendWeakTopicStudents(StringBuilder sb, Input in) {
        Map<String, List<String>> byTopic = in.getWeakTopicStudents();
        if (byTopic == null || byTopic.isEmpty()) return;

        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">WHO IS WEAK, TOPIC BY TOPIC</div>");
        sb.append("<div class=\"hint\">The named students behind each weak topic — for pairing, groupwork, or targeted homework.</div>");
        for (Map.Entry<String, List<String>> e : byTopic.entrySet()) {
            List<String> students = e.getValue();
            if (students == null || students.isEmpty()) continue;
            sb.append("<div class=\"panel\">");
            sb.append("<table style=\"width: 100%; margin-bottom: 4px;\"><tr>");
            sb.append("<td style=\"font-size: 11px; font-weight: 700; color: ").append(NAVY).append(";\">")
                    .append(esc(e.getKey())).append("</td>");
            sb.append("<td style=\"width: 90px; text-align: right;\">")
                    .append(pill(students.size() + " students", students.size() > 10 ? RED : AMBER))
                    .append("</td></tr></table>");
            List<String> shown = students.size() > MAX_NAMES_PER_TOPIC
                    ? students.subList(0, MAX_NAMES_PER_TOPIC) : students;
            sb.append("<div class=\"names\">").append(esc(String.join(" · ", shown)));
            if (students.size() > shown.size()) {
                sb.append(" <span style=\"color: ").append(FAINT).append(";\">+")
                        .append(students.size() - shown.size()).append(" more</span>");
            }
            sb.append("</div></div>");
        }
        sb.append("</div>");
    }

    // ---------------------------------------------------------------- roster

    private void appendRoster(StringBuilder sb, Input in) {
        List<StudentRow> roster = in.getRoster();
        if (roster == null || roster.isEmpty()) return;

        List<StudentRow> ordered = new ArrayList<>(roster);
        ordered.sort((a, b) -> {
            if (a.getRank() != null && b.getRank() != null) return Integer.compare(a.getRank(), b.getRank());
            if (a.getRank() != null) return -1;
            if (b.getRank() != null) return 1;
            return 0;
        });
        boolean truncated = ordered.size() > MAX_ROSTER_ROWS;
        if (truncated) {
            log.info("Class AI report: roster truncated to {} of {} students", MAX_ROSTER_ROWS, ordered.size());
            ordered = ordered.subList(0, MAX_ROSTER_ROWS);
        }

        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">PARTICIPANT ROSTER — WEAK AREAS PER STUDENT</div>");
        sb.append("<div class=\"hint\">Every participant, best first, with the sections and topics each one is weak in.</div>");
        sb.append("<table class=\"tbl roster\">");
        sb.append("<tr><th style=\"text-align: right;\">#</th><th>STUDENT</th>")
                .append("<th style=\"text-align: right;\">SCORE</th>")
                .append("<th style=\"text-align: right;\">%</th>")
                .append("<th>BAND</th><th>WEAK SECTIONS</th><th>WEAK TOPICS</th></tr>");
        for (StudentRow s : ordered) {
            if (!s.isAttempted()) {
                sb.append("<tr><td style=\"text-align: right; color: ").append(FAINT).append(";\">-</td>");
                sb.append("<td><b>").append(esc(nvl(s.getName(), "-"))).append("</b></td>");
                sb.append("<td colspan=\"5\" style=\"color: ").append(FAINT).append("; font-style: italic;\">Did not attempt</td></tr>");
                continue;
            }
            double pct = nz(s.getPercentage());
            sb.append("<tr><td style=\"text-align: right; color: ").append(MUTED).append(";\">")
                    .append(s.getRank() != null ? s.getRank() : "-").append("</td>");
            sb.append("<td><b>").append(esc(nvl(s.getName(), "-"))).append("</b>");
            if (s.getUsername() != null && !s.getUsername().isBlank()) {
                sb.append(" <span style=\"color: ").append(FAINT).append("; font-size: 8.5px;\">")
                        .append(esc(s.getUsername())).append("</span>");
            }
            sb.append("</td>");
            sb.append("<td style=\"text-align: right;\">").append(fmt(s.getMarks())).append("</td>");
            sb.append("<td style=\"text-align: right; color: ").append(bandColor(pct)).append("; font-weight: 700;\">")
                    .append(fmt(pct)).append("</td>");
            sb.append("<td>").append(bandPill(pct)).append("</td>");
            sb.append("<td style=\"color: ").append(MUTED).append(";\">")
                    .append(esc(joinOrDash(s.getWeakSections(), null))).append("</td>");
            sb.append("<td style=\"color: ").append(MUTED).append(";\">")
                    .append(esc(joinOrDash(s.getWeakTopics(), null))).append("</td></tr>");
        }
        sb.append("</table>");
        if (truncated) {
            sb.append("<div class=\"hint\" style=\"margin-top: 6px;\">Showing ").append(MAX_ROSTER_ROWS)
                    .append(" of ").append(roster.size())
                    .append(" participants. Export the results CSV for the complete list.</div>");
        }
        sb.append("</div>");
    }

    // ------------------------------------------------------------- narrative

    private void appendNarrative(StringBuilder sb, Input in) {
        String narrative = in.getNarrative();
        if (narrative == null || narrative.isBlank()) return;
        sb.append("<div style=\"page-break-inside: auto;\"><div class=\"h2\">OVERALL READING OF THIS PAPER</div>");
        sb.append("<div class=\"md\">").append(mdToHtml(narrative)).append("</div></div>");
    }

    // ---------------------------------------------------------------- footer

    private void appendFooter(StringBuilder sb, Input in, ReportBrandingDto branding) {
        String custom = brandingHelper.buildFooterHtml(branding, nvl(in.getAssessmentName(), ""));
        if (custom != null && !custom.isEmpty()) {
            sb.append(custom);
        }
        sb.append("<div class=\"foot\"><table style=\"width: 100%;\"><tr><td>");
        if (in.isAiUnavailable()) {
            sb.append("Generated from assessment data only — AI analysis was not available, so topic inference, "
                    + "misconceptions and the action plan are absent from this copy.");
        } else {
            sb.append("AI-assisted analysis")
                    .append(in.getGeneratedAt() != null ? " generated on " + fmtDateTime(in.getGeneratedAt()) : "")
                    .append(". One analysis per assessment — review before acting on it or sharing it.");
        }
        sb.append("</td><td style=\"text-align: right;\">");
        ClassOverview o = in.getOverview();
        if (o != null && o.getAttempted() != null) {
            sb.append("Based on ").append(o.getAttempted()).append(" attempts");
        }
        sb.append("</td></tr></table></div>");
    }

    // --------------------------------------------------------- small helpers

    /**
     * Whether this report actually contains a per-question breakdown. False for
     * PDF/OMR papers, where question-level data was never captured — the
     * majority of high-participation papers in prod.
     */
    private static boolean hasBreakdown(Input in) {
        boolean topics = in.getTopics() != null && !in.getTopics().isEmpty();
        boolean questions = in.getHardestQuestions() != null && !in.getHardestQuestions().isEmpty();
        boolean multiSection = in.getSections() != null && in.getSections().size() > 1;
        return topics || questions || multiSection;
    }

    private static int countWeak(List<TopicRow> topics) {
        if (topics == null) return 0;
        int n = 0;
        for (TopicRow t : topics) {
            if (nz(t.getClassAccuracy()) < WEAK_THRESHOLD) n++;
        }
        return n;
    }

    private static String joinOrDash(List<String> primary, List<String> fallback) {
        List<String> use = primary != null && !primary.isEmpty() ? primary : fallback;
        if (use == null || use.isEmpty()) return "—";
        return String.join(", ", use);
    }

    private static String priorityPill(double accuracy) {
        if (accuracy < WEAK_THRESHOLD) return pill("P1 · Reteach", RED);
        if (accuracy < BORDERLINE_THRESHOLD) return pill("P2 · Practise", AMBER);
        return pill("On track", GREEN);
    }

    private static String bandPill(double percentage) {
        if (percentage < WEAK_THRESHOLD) return pill("At risk", RED);
        if (percentage < BORDERLINE_THRESHOLD) return pill("Developing", AMBER);
        if (percentage < 85) return pill("Secure", GREEN);
        return pill("Excelling", NAVY);
    }

    private static String pill(String label, String color) {
        return "<span class=\"pill\" style=\"background-color: " + softOf(color) + "; color: " + color + ";\">"
                + esc(label) + "</span>";
    }

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

    private static String resolveAccent(ReportBrandingDto branding) {
        String configured = branding.getPrimaryColor() != null ? branding.getPrimaryColor().trim() : null;
        if (configured == null || configured.isEmpty()
                || LEGACY_DEFAULT_PRIMARY.equalsIgnoreCase(configured)
                || !SAFE_CSS_COLOR.matcher(configured).matches()) {
            return NAVY;
        }
        return configured;
    }

    private static double nz(Double value) {
        return value != null ? value : 0.0;
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
        t = t.replace("</div><br/>", "</div>");
        return t;
    }

    /**
     * Escapes text that originated in question or option content.
     *
     * <p>Such text arrives already carrying HTML entities — option bodies are
     * authored in a rich-text editor, so "angle of incidence &gt; angle of
     * refraction" is stored with a literal {@code &gt;}. Running plain
     * {@link #esc} over it escapes the ampersand a second time and the reader
     * sees the raw entity. Decoding first, then escaping once, renders the
     * character the author meant.
     */
    private static String escContent(String text) {
        if (text == null) return "";
        String decoded = text
                .replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'")
                .replace("&nbsp;", " ")
                // Ampersand LAST: decoding it first would let "&amp;lt;" become "<".
                .replace("&amp;", "&");
        return esc(decoded);
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
