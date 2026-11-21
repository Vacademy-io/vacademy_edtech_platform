package vacademy.io.assessment_service.features.assessment.service;

import lombok.Builder;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportDataService;
import vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette;
import vacademy.io.assessment_service.features.learner_assessment.dto.ReportBrandingDto;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.AMBER;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.AMBER_50;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.BAD;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.BAD_50;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.INK;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.LINE;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.MUTED;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.OK;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.OK_50;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.SOFT;

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
 *       ordered weakest-first so every table doubles as a reteaching queue.</li>
 *   <li><b>What do I reteach to everyone?</b> — misconceptions shared across
 *       the cohort, and a prioritised class action plan.</li>
 *   <li><b>Who do I pull aside?</b> — named students under each weak topic,
 *       an intervention list, and the full participant roster.</li>
 * </ol>
 *
 * <p>Deliberately ONE document per assessment, not one per student: the
 * cohort-level view is what makes a weak topic legible as a teaching gap
 * rather than an individual failure, and it costs one AI call instead of N.
 *
 * <p>It shares the look of the student AI report ({@code AiReportHtmlBuilderV2}): the
 * institute's colour band and hero, white stat tiles, a tag + plain-language headline
 * over each block, inline SVG charts and the same Mukta / Baloo 2 fonts, so a teacher
 * holding both PDFs reads them as one set. The caller converts with
 * {@code AiReportFonts}; without it the PDF falls back to the standard fonts.
 *
 * <p>This builder is pure rendering — it takes an already-aggregated
 * {@link Input} and returns HTML. Rendering constraints are iText html2pdf's: no JS,
 * no flexbox/grid, no rgba/var, no external resources except the logo.
 */
@Slf4j
@Component
public class ClassAiReportHtmlBuilder {

    private static final int CONTENT_W = 722;
    private static final String DEFAULT_BRAND = "#0F9A83";
    private static final String DEFAULT_ACCENT = "#FFC531";

    /** Below this accuracy an area is a P1 "reteach to everyone" item. */
    private static final double WEAK_THRESHOLD = 40.0;
    /** Below this it is a P2 "needs practice"; at or above it is on track. */
    private static final double BORDERLINE_THRESHOLD = 70.0;

    private static final String[] BLOOM_KEYS = {"remember", "understand", "apply", "analyze", "evaluate", "create"};
    private static final String[] BLOOM_NAMES = {"Remember", "Understand", "Apply", "Analyse", "Evaluate", "Create"};
    private static final String[] BLOOM_VERBS = {
            "recalling facts", "explaining ideas", "applying methods", "analysing", "evaluating", "creating"};
    private static final String[] BLOOM_NOTES = {
            "recalling facts and names", "explaining ideas", "solving with methods and formulas",
            "reading figures, data and set-ups", "judging and justifying", "designing something new"};

    /** Keeps one enormous cohort from producing a hundred-page PDF. */
    private static final int MAX_ROSTER_ROWS = 400;
    private static final int MAX_QUESTION_ROWS = 40;
    private static final int MAX_TOPIC_ROWS = 16;
    private static final int MAX_MISCONCEPTIONS = 10;
    /** Names listed under a weak topic before it degrades to "+N more". */
    private static final int MAX_NAMES_PER_TOPIC = 12;
    /** The AI narrative is shown whole on page 1 up to this length; longer ones move to the end. */
    private static final int SUMMARY_MAX = 900;

    @Autowired
    private ReportBrandingHelper brandingHelper;

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
        ReportPalette p = new ReportPalette(brandOf(branding), accentOf(branding));

        StringBuilder sb = new StringBuilder(96 * 1024);
        sb.append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"/>");
        sb.append("<title>Assessment AI Diagnostic Report</title>");
        sb.append("<style>").append(css(in, p)).append("</style>");
        sb.append("</head><body>");
        appendWatermark(sb, branding, p);
        appendBand(sb, in, branding, p);
        appendHero(sb, in, p);

        sb.append("<div class=\"body\">");
        appendSummary(sb, in, p);
        appendDistribution(sb, in, p);
        appendSections(sb, in, p);
        appendMarksLost(sb, in);
        appendTopics(sb, in, p);
        appendHardestQuestions(sb, in);
        appendBlooms(sb, in, p);
        appendMisconceptions(sb, in, p);
        appendActionPlan(sb, in, p);
        appendInterventionList(sb, in);
        appendWeakTopicStudents(sb, in);
        appendRoster(sb, in);
        appendNarrative(sb, in);
        appendFooter(sb, in, branding);
        sb.append("</div></body></html>");
        return sb.toString();
    }

    // ------------------------------------------------------------ band + hero

    /**
     * Honours the institute's {@code showWatermark} branding, same as the student
     * report — an institute that watermarks one report expects the other to match.
     */
    private void appendWatermark(StringBuilder sb, ReportBrandingDto branding, ReportPalette p) {
        if (!Boolean.TRUE.equals(branding.getShowWatermark())
                || branding.getWatermarkText() == null || branding.getWatermarkText().isBlank()) {
            return;
        }
        double opacity = branding.getWatermarkOpacity() != null ? branding.getWatermarkOpacity() : 0.05;
        sb.append("<div class=\"wm\"><div class=\"wm-text\" style=\"color:").append(p.brand)
                .append(";opacity:").append(opacity).append(";\">")
                .append(esc(branding.getWatermarkText()))
                .append("</div></div>");
    }

    private void appendBand(StringBuilder sb, Input in, ReportBrandingDto branding, ReportPalette p) {
        String inst = nvl(in.getInstituteName(), "");
        String logoSrc = logoOf(branding);

        String logo = null;
        int cellW = 58;
        if (logoSrc != null) {
            // Fixed-size cell sized from the logo's own proportions, as in the student report.
            Double a = AiReportDataService.aspect(logoSrc);
            String src = logoSrc.startsWith("data:") ? logoSrc.replace("\"", "%22") : escAttr(logoSrc);
            if (a != null) {
                double aspect = Math.max(0.5, Math.min(5.0, a));
                int h = 38, w = (int) Math.round(h * aspect);
                cellW = w + 14;
                logo = "<table class=\"logo-img\"><tr><td style=\"width:" + w + "px;height:" + h + "px;\"><img src=\""
                        + src + "\" style=\"width:" + w + "px;height:" + h + "px;\"/></td></tr></table>";
            } else {
                // A presigned URL (SVG, oversized or unfetchable logo): its shape is unknown here, so
                // cap both sides and let the image keep its own proportions, as the old report did.
                cellW = 204;
                logo = "<table class=\"logo-img\"><tr><td><img src=\"" + src
                        + "\" style=\"max-height:38px;max-width:190px;\"/></td></tr></table>";
            }
        } else if (!inst.isBlank()) {
            logo = "<div class=\"logo\"><span class=\"logo-t\">" + esc(initials(inst)) + "</span></div>";
        }

        String assessment = nvl(in.getAssessmentName(), "Assessment");
        sb.append("<table class=\"band\"><tr>");
        if (logo != null) {
            sb.append("<td class=\"band-logo\" style=\"width:").append(cellW + 36).append("px;\">").append(logo).append("</td>");
        } else {
            sb.append("<td class=\"band-logo\" style=\"width:36px;\"></td>");
        }
        sb.append("<td>");
        if (!inst.isBlank()) {
            sb.append("<div class=\"band-i1\">").append(esc(inst)).append("</div>");
            sb.append("<div class=\"band-i2\">").append(esc(assessment)).append("</div>");
        } else {
            sb.append("<div class=\"band-i1\">").append(esc(assessment)).append("</div>");
        }
        sb.append("</td><td class=\"band-right\"><div class=\"band-r1\">Class AI report</div><div class=\"band-r2\">");
        List<String> bits = new ArrayList<>();
        if (in.getExamDate() != null) bits.add("Test " + fmtDate(in.getExamDate()));
        ClassOverview o = in.getOverview();
        if (o != null && o.getDurationMinutes() != null && o.getDurationMinutes() > 0) {
            bits.add(o.getDurationMinutes() + " min");
        }
        if (in.getBatchLabel() != null && !in.getBatchLabel().isBlank()) bits.add(in.getBatchLabel());
        sb.append(esc(String.join(" · ", bits))).append("</div></td></tr></table>");
    }

    private void appendHero(StringBuilder sb, Input in, ReportPalette p) {
        ClassOverview o = in.getOverview();
        String[] verdict = verdict(in);

        sb.append("<div class=\"hero\"><table class=\"hero-t\"><tr><td class=\"hero-l\">");
        sb.append("<div class=\"kicker\">Class result</div>");
        sb.append("<div class=\"h1\">").append(esc(verdict[0])).append("</div>");
        if (!verdict[1].isEmpty()) {
            sb.append("<div class=\"hero-p\">").append(esc(verdict[1])).append("</div>");
        }
        sb.append("</td><td class=\"hero-r\">");
        Double avgPct = avgPct(o);
        if (o != null && o.getAverageMarks() != null) {
            sb.append("<div class=\"big\">").append(fmt(o.getAverageMarks()));
            if (o.getTotalMarks() != null) {
                sb.append("<span class=\"big-of\">/").append(fmt(o.getTotalMarks())).append("</span>");
            }
            sb.append("</div><div class=\"big-sub\">Class average</div>");
        }
        sb.append("</td></tr></table>");

        if (avgPct != null) {
            sb.append("<table class=\"pct-top\"><tr><td>The average student scored <b>").append(fmt(avgPct))
                    .append("%</b> of the paper</td><td style=\"text-align:right\">");
            List<String> range = new ArrayList<>();
            if (o.getHighestMarks() != null) range.add("Highest " + fmt(o.getHighestMarks()));
            if (o.getMedianMarks() != null) range.add("Median " + fmt(o.getMedianMarks()));
            if (o.getLowestMarks() != null) range.add("Lowest " + fmt(o.getLowestMarks()));
            sb.append(esc(String.join(" · ", range))).append("</td></tr></table>");
            sb.append("<div class=\"pct-track\"><div class=\"pct-fill\" style=\"width:")
                    .append(Math.max(2, Math.min(100, Math.round(avgPct)))).append("%\"></div></div>");
        }

        if (o != null) {
            sb.append("<table class=\"tiles\"><tr>");
            String attempted = o.getAttempted() != null ? String.valueOf(o.getAttempted()) : "-";
            String attemptedSub = o.getTotalRegistered() != null
                    ? "attempted · " + o.getTotalRegistered() + " registered" : "students attempted";
            if (o.getNotAttempted() != null && o.getNotAttempted() > 0) {
                attemptedSub += " · " + o.getNotAttempted() + " did not attempt";
            }
            sb.append(tile(attempted, attemptedSub, INK));
            sb.append(tile(o.getHighestMarks() != null ? fmt(o.getHighestMarks()) : "-",
                    "highest score" + (o.getLowestMarks() != null ? " · lowest " + fmt(o.getLowestMarks()) : ""), OK));
            Double passRate = o.getPassedCount() != null && o.getAttempted() != null && o.getAttempted() > 0
                    ? clampPct(o.getPassedCount() * 100.0 / o.getAttempted()) : null;
            if (passRate != null) {
                sb.append(tile(fmt(passRate) + "%",
                        "passed" + (o.getPassMarks() != null ? " · pass mark " + fmt(o.getPassMarks()) : ""), bandColor(passRate)));
            } else if (o.getAverageAccuracy() != null) {
                sb.append(tile(fmt(o.getAverageAccuracy()) + "%", "average accuracy", bandColor(o.getAverageAccuracy())));
            } else {
                sb.append(tile(o.getMedianMarks() != null ? fmt(o.getMedianMarks()) : "-", "median score", INK));
            }
            if (o.getAverageDurationSeconds() != null && o.getAverageDurationSeconds() > 0) {
                sb.append(tile(mmss(o.getAverageDurationSeconds()), "average time"
                        + (o.getDurationMinutes() != null && o.getDurationMinutes() > 0 ? " · of " + o.getDurationMinutes() + " min" : ""), INK));
            } else {
                // Not the median again: the third tile already falls back to it.
                sb.append(o.getTotalMarks() != null
                        ? tile(fmt(o.getTotalMarks()), "marks in the paper", INK)
                        : tile(o.getMedianMarks() != null ? fmt(o.getMedianMarks()) : "-", "median score", INK));
            }
            sb.append("</tr></table>");
        }
        sb.append("</div>");
    }

    private static String tile(String value, String label, String color) {
        return "<td class=\"tile\"><div class=\"tile-v\" style=\"color:" + color + "\">" + esc(value)
                + "</div><div class=\"tile-l\">" + esc(label) + "</div></td>";
    }

    /**
     * The one-line answer to "how did my class do, and is the problem the class or the
     * paper?" — {title, body}. It is the hero headline, so it sits above every chart.
     */
    private static String[] verdict(Input in) {
        ClassOverview o = in.getOverview();
        Double avgPct = avgPct(o);
        if (avgPct == null) {
            return new String[]{"How the class did", ""};
        }
        int weakTopics = countWeak(in.getTopics());
        int weakSections = 0;
        if (in.getSections() != null) {
            for (SectionRow s : in.getSections()) {
                if (s.getAverageAccuracy() != null && s.getAverageAccuracy() < WEAK_THRESHOLD) weakSections++;
            }
        }

        String title;
        StringBuilder body = new StringBuilder();
        if (avgPct < 40) {
            title = "The class did not get this paper";
            body.append("At this level the gap is usually the teaching sequence or the paper's difficulty, not the students");
            body.append(hasBreakdown(in) ? " — check the hardest areas below before assuming otherwise." : ".");
        } else if (avgPct < 70) {
            title = "Mixed — the loss is concentrated";
            if (hasBreakdown(in)) {
                body.append("Most of the shortfall sits in a few areas rather than across the paper.");
            }
        } else {
            title = "The class is on track";
            body.append("What remains is a short list of recoverable areas and a few students who need pulling up.");
        }
        if (weakTopics > 0) {
            if (body.length() > 0) body.append(" ");
            body.append(weakTopics).append(weakTopics == 1 ? " topic is" : " topics are")
                    .append(" below ").append((int) WEAK_THRESHOLD).append("% and flagged for reteaching");
            if (weakSections > 0) {
                body.append(", across ").append(weakSections).append(weakSections == 1 ? " section" : " sections");
            }
            body.append(".");
        }
        if (!hasBreakdown(in)) {
            // A PDF/OMR paper carries no per-question record, so there is no section or
            // topic breakdown to send the reader to. Saying so keeps the report honest.
            if (body.length() > 0) body.append(" ");
            body.append("This paper has no per-question record, so the report is limited to totals and the roster.");
        }
        return new String[]{title, body.toString()};
    }

    // ---------------------------------------------------------------- summary

    private void appendSummary(StringBuilder sb, Input in, ReportPalette p) {
        String summary = plain(in.getNarrative(), SUMMARY_MAX);
        if (summary.isEmpty()) return;
        sb.append("<table class=\"note\"><tr><td class=\"note-q\"><div class=\"quote\">&#8220;</div></td><td>")
                .append("<div class=\"note-l\">Summary</div><div class=\"note-t\">").append(esc(summary))
                .append("</div></td></tr></table>");
    }

    // ----------------------------------------------------------- distribution

    private void appendDistribution(StringBuilder sb, Input in, ReportPalette p) {
        List<ScoreBand> bands = in.getDistribution();
        ClassOverview o = in.getOverview();
        if (bands == null || bands.isEmpty()) return;
        int students = bands.stream().mapToInt(ScoreBand::getStudentCount).sum();
        if (students == 0) return;

        String head = o != null && o.getMedianMarks() != null
                ? "Half the class scored " + fmt(o.getMedianMarks()) + " or less"
                : "How the marks fell across the class";
        String lede = "How many of the " + students + " students scored in each range."
                + (o != null && o.getAverageMarks() != null ? " The dashed line is the class average." : "")
                + " A flat spread means the paper separated strong from weak; a cliff at one end means it did not.";
        sb.append(block("Where the class stands", head, lede,
                distributionChart(bands, o != null ? o.getAverageMarks() : null, o != null ? o.getTotalMarks() : null, p, CONTENT_W)));
    }

    private static String distributionChart(List<ScoreBand> bands, Double avg, Double total, ReportPalette p, int w) {
        int n = bands.size();
        int h = 246;
        double x0 = 8, x1 = w - 8, band = (x1 - x0) / n, barW = band * 0.74, base = 196, maxBar = 136;
        int top = 1;
        for (ScoreBand b : bands) top = Math.max(top, b.getStudentCount());
        StringBuilder s = new StringBuilder();
        s.append(line(x0, base, x1, base, LINE, 1.5, null));
        // The bands split [0, total] into equal widths, so the average maps straight onto the axis.
        // Drawn first so the bars sit on top of it.
        if (avg != null && total != null && total > 0) {
            double xa = x0 + Math.max(0, Math.min(1, avg / total)) * (x1 - x0);
            s.append(line(xa, 34, xa, base, INK, 1.5, "4 4"));
            boolean left = xa > w - 170;
            s.append(svgText(left ? xa - 6 : xa + 6, 30, "Class average " + fmt(avg), 12.5, false, INK, left ? "end" : "start"));
        }
        for (int i = 0; i < n; i++) {
            ScoreBand b = bands.get(i);
            int c = b.getStudentCount();
            double bh = c == 0 ? 0 : Math.max(3, c * maxBar / (double) top);
            double bx = x0 + i * band + (band - barW) / 2;
            boolean peak = c == top && c > 0;
            if (bh > 0) s.append(rect(bx, base - bh, barW, bh, 4, peak ? p.brand : p.brand100));
            s.append(svgText(bx + barW / 2, base - bh - 6, String.valueOf(c), 12, peak, peak ? p.brandInk : MUTED, "middle"));
            s.append(svgText(bx + barW / 2, base + 17, nvl(b.getLabel(), "").replace("-", "–"), n > 10 ? 10 : 11.5, false, MUTED, "middle"));
        }
        s.append(svgText(x0, h - 6, (total != null ? "Marks out of " + fmt(total) + " · " : "") + "students in each range",
                12, false, MUTED, "start"));
        return svg(w, h, s);
    }

    // --------------------------------------------------------------- sections

    private void appendSections(StringBuilder sb, Input in, ReportPalette p) {
        List<SectionRow> sections = in.getSections();
        if (sections == null || sections.isEmpty()) return;

        long aboveHalf = sections.stream().filter(s -> sectionPct(s) >= 50).count();
        SectionRow weakest = null;
        for (SectionRow s : sections) {
            if (weakest == null || sectionPct(s) < sectionPct(weakest)) weakest = s;
        }
        String head;
        if (sections.size() == 1) {
            head = "Class average " + fmt(sectionPct(sections.get(0))) + "% in " + nvl(sections.get(0).getName(), "the paper");
        } else {
            head = "Above half marks in " + aboveHalf + " of " + sections.size() + " sections";
            if (weakest != null && sectionPct(weakest) < 50) {
                head += " — " + nvl(weakest.getName(), "one section") + " is the weakest";
            }
        }

        StringBuilder body = new StringBuilder();
        body.append("<div class=\"legend\">").append(key(p.brand, "Class average"))
                .append("<span class=\"key\"><span class=\"tick\" style=\"background:").append(INK)
                .append("\"></span> Best in class</span></div>");
        body.append(sectionChart(sections, p, CONTENT_W));

        body.append("<table class=\"tbl\" style=\"margin-top:10px;\">");
        body.append("<tr><th>Section</th><th class=\"r\">Out of</th><th class=\"r\">Class avg</th>")
                .append("<th class=\"r\">Accuracy</th><th class=\"r\">Best</th><th class=\"r\">Lowest</th>")
                .append("<th class=\"r\">Struggling</th><th>Focus</th></tr>");
        for (int i = 0; i < sections.size(); i++) {
            SectionRow s = sections.get(i);
            double acc = s.getAverageAccuracy() != null ? s.getAverageAccuracy() : sectionPct(s);
            int struggling = s.getStrugglingStudents() != null ? s.getStrugglingStudents() : 0;
            body.append("<tr><td><span class=\"dot\" style=\"background:").append(ReportPalette.section(i))
                    .append("\"></span> <b>").append(esc(nvl(s.getName(), "Section"))).append("</b></td>");
            body.append("<td class=\"r\">").append(fmt(s.getTotalMarks())).append("</td>");
            body.append("<td class=\"r\"><b>").append(fmt(s.getAverageMarks())).append("</b></td>");
            body.append("<td class=\"r\" style=\"color:").append(bandColor(acc)).append(";\"><b>")
                    .append(fmt(acc)).append("%</b></td>");
            body.append("<td class=\"r m\">").append(fmt(s.getHighestMarks())).append("</td>");
            body.append("<td class=\"r m\">").append(fmt(s.getLowestMarks())).append("</td>");
            body.append("<td class=\"r\" style=\"color:").append(struggling > 0 ? BAD : MUTED).append(";\">")
                    .append(struggling).append("</td>");
            body.append("<td>").append(priorityChip(acc)).append("</td></tr>");
        }
        body.append("</table>");

        sb.append(block("Marks by section", head,
                "Each bar is the class average as a share of that section's marks. The dark tick is the best score in the class.",
                body.toString()));
    }

    private static String sectionChart(List<SectionRow> rows, ReportPalette p, int w) {
        int rowH = 44, top = 8;
        int h = top + rows.size() * rowH + 30;
        double nameW = 176, rightW = 150, trackX = nameW, trackW = w - nameW - rightW;
        java.util.function.DoubleUnaryOperator x = v -> trackX + Math.max(0, Math.min(100, v)) / 100.0 * trackW;

        StringBuilder s = new StringBuilder();
        double gridBottom = top + rows.size() * rowH;
        s.append(line(x.applyAsDouble(0), top, x.applyAsDouble(0), gridBottom, LINE, 1.5, null));
        s.append(line(x.applyAsDouble(50), top, x.applyAsDouble(50), gridBottom, LINE, 1, "3 4"));
        s.append(line(x.applyAsDouble(100), top, x.applyAsDouble(100), gridBottom, LINE, 1, "3 4"));
        s.append(svgText(x.applyAsDouble(0), gridBottom + 18, "0", 12, false, MUTED, "middle"));
        s.append(svgText(x.applyAsDouble(50), gridBottom + 18, "Half marks", 12, false, MUTED, "middle"));
        s.append(svgText(x.applyAsDouble(100), gridBottom + 18, "Full marks", 12, false, MUTED, "middle"));

        for (int i = 0; i < rows.size(); i++) {
            SectionRow r = rows.get(i);
            double cy = top + i * rowH + 22;
            double pc = sectionPct(r);
            s.append(circle(6, cy, 5, ReportPalette.section(i)));
            s.append(svgText(18, cy + 5, clip(nvl(r.getName(), "Section"), 21), 13.5, true, INK, "start"));
            s.append(rect(trackX, cy - 8, trackW, 16, 8, SOFT));
            double x0 = x.applyAsDouble(0), x1 = x.applyAsDouble(pc);
            if (x1 - x0 > 0.5) s.append(rect(x0, cy - 8, Math.max(8, x1 - x0), 16, 8, p.brand));
            if (r.getHighestMarks() != null && r.getTotalMarks() != null && r.getTotalMarks() > 0) {
                double bx = x.applyAsDouble(r.getHighestMarks() / r.getTotalMarks() * 100.0);
                s.append(rect(bx - 1.5, cy - 13, 3, 26, 0, INK));
            }
            double tx = trackX + trackW + 16;
            s.append(svgText(tx, cy + 1, fmt(r.getAverageMarks()) + " / " + fmt(r.getTotalMarks()), 15, true, INK, "start"));
            String sub = fmt(pc) + "%" + (r.getHighestMarks() != null ? " · best " + fmt(r.getHighestMarks()) : "");
            s.append(svgText(tx, cy + 17, sub, 11.5, false, MUTED, "start"));
        }
        return svg(w, h, s);
    }

    /** The class average as a share of the section's marks; the stored accuracy when marks are missing. */
    private static double sectionPct(SectionRow s) {
        if (s.getAverageMarks() != null && s.getTotalMarks() != null && s.getTotalMarks() > 0) {
            return clampPct(s.getAverageMarks() / s.getTotalMarks() * 100.0);
        }
        return clampPct(nz(s.getAverageAccuracy()));
    }

    // ------------------------------------------------------------- marks lost

    private void appendMarksLost(StringBuilder sb, Input in) {
        List<SectionRow> sections = in.getSections();
        if (sections == null || sections.size() < 2) return;

        Map<Integer, Double> lost = new LinkedHashMap<>();
        double total = 0;
        for (int i = 0; i < sections.size(); i++) {
            SectionRow s = sections.get(i);
            if (s.getTotalMarks() == null) continue;
            double gap = Math.max(0.0, s.getTotalMarks() - nz(s.getAverageMarks()));
            if (gap > 0) {
                lost.put(i, gap);
                total += gap;
            }
        }
        if (lost.size() < 2 || total <= 0) return;

        int worst = lost.entrySet().stream().max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(0);
        double worstShare = lost.get(worst) / total * 100.0;

        StringBuilder bar = new StringBuilder();
        double x = 0;
        int w = CONTENT_W;
        for (Map.Entry<Integer, Double> e : lost.entrySet()) {
            double segW = e.getValue() / total * w;
            bar.append(rect(x, 0, segW, 30, 0, ReportPalette.section(e.getKey())));
            if (segW > 44) {
                bar.append(svgText(x + segW / 2, 20, Math.round(e.getValue() / total * 100) + "%", 12.5, true, "#ffffff", "middle"));
            }
            x += segW;
        }

        StringBuilder body = new StringBuilder(svg(w, 30, bar));
        body.append("<table class=\"lost\">");
        for (Map.Entry<Integer, Double> e : lost.entrySet()) {
            SectionRow s = sections.get(e.getKey());
            body.append("<tr><td class=\"lost-n\"><span class=\"dot\" style=\"background:")
                    .append(ReportPalette.section(e.getKey())).append("\"></span> ")
                    .append(esc(nvl(s.getName(), "Section"))).append("</td><td class=\"lost-v\">")
                    .append(fmt(round1(e.getValue()))).append(" marks lost · <b>")
                    .append(Math.round(e.getValue() / total * 100)).append("%</b></td></tr>");
        }
        body.append("</table>");

        String head = worstShare >= 40
                ? "Most of the lost marks are in " + nvl(sections.get(worst).getName(), "one section")
                : "Lost marks are spread across the sections";
        sb.append(block("Where the class lost marks", head,
                "Share of the " + fmt(round1(total)) + " marks the average student did not score. Spend revision time in "
                        + "proportion to this, not to accuracy alone: a big section at 60% costs more than a small one at 20%.",
                body.toString()));
    }

    // ----------------------------------------------------------------- topics

    private void appendTopics(StringBuilder sb, Input in, ReportPalette p) {
        List<TopicRow> topics = in.getTopics();
        if (topics == null || topics.isEmpty()) return;

        List<TopicRow> ordered = new ArrayList<>(topics);
        ordered.sort((a, b) -> Double.compare(nz(a.getClassAccuracy()), nz(b.getClassAccuracy())));
        if (ordered.size() > MAX_TOPIC_ROWS) {
            log.info("Class AI report: showing {} of {} topics", MAX_TOPIC_ROWS, ordered.size());
            ordered = ordered.subList(0, MAX_TOPIC_ROWS);
        }

        int weak = countWeak(topics);
        long borderline = topics.stream()
                .filter(t -> nz(t.getClassAccuracy()) >= WEAK_THRESHOLD && nz(t.getClassAccuracy()) < BORDERLINE_THRESHOLD).count();
        String head = weak > 0
                ? (weak == 1 ? "1 topic" : weak + " topics") + " below " + (int) WEAK_THRESHOLD + "% — reteach these first"
                : borderline > 0 ? borderline + (borderline == 1 ? " topic needs" : " topics need") + " more practice"
                : "Every topic is secure";
        String lede = (in.getTopicSource() == TopicSource.TAGS
                ? "Topics from this paper's question tags"
                : "Topics inferred by the AI from the question content")
                + ", weakest first. Red is below " + (int) WEAK_THRESHOLD + "% class accuracy, amber below "
                + (int) BORDERLINE_THRESHOLD + "%.";

        String header = "<tr><th>Topic</th><th class=\"r\">Qs</th><th>Class accuracy</th>"
                + "<th class=\"r\">Students weak</th><th>Level</th></tr>";
        List<String> rows = new ArrayList<>();
        for (TopicRow t : ordered) {
            double acc = clampPct(nz(t.getClassAccuracy()));
            String color = bandColor(acc);
            StringBuilder body = new StringBuilder();
            body.append("<tr><td><div class=\"t-name\">").append(escContent(nvl(t.getTopic(), ""))).append("</div>")
                    .append("<div class=\"t-do\">").append(esc(topicAction(acc))).append("</div></td>");
            body.append("<td class=\"r\">").append(t.getQuestionCount() != null ? t.getQuestionCount() : 0).append("</td>");
            body.append("<td><table class=\"barrow\"><tr><td><div class=\"bar\"><div class=\"bar-f\" style=\"width:")
                    .append(Math.max(3, Math.round(acc))).append("%;background:").append(color)
                    .append("\"></div></div></td><td class=\"bar-v\" style=\"color:").append(color).append("\">")
                    .append(fmt(acc)).append("%</td></tr></table></td>");
            int weakCount = t.getWeakStudentCount() != null ? t.getWeakStudentCount() : 0;
            body.append("<td class=\"r\" style=\"color:").append(weakCount > 0 ? BAD : MUTED).append(";\">")
                    .append(weakCount).append(t.getTotalStudents() != null ? " / " + t.getTotalStudents() : "").append("</td>");
            body.append("<td class=\"nw\">").append(pips(t.getMasteryLabel(), p)).append("</td></tr>");
            rows.add(body.toString());
        }
        sb.append(flowTable("Topic-wise weakness", head, lede, "tbl", new int[]{36, 6, 28, 12, 18}, header, rows, ""));
    }

    /** The class-level instruction attached to each topic row. */
    private static String topicAction(double accuracy) {
        if (accuracy < WEAK_THRESHOLD) return "Reteach to the whole class, then re-test";
        if (accuracy < BORDERLINE_THRESHOLD) return "Targeted practice set; revisit in class";
        return "Secure — spiral revision only";
    }

    private static String pips(String level, ReportPalette p) {
        String l = level == null ? "" : level.trim();
        int n = switch (l.toLowerCase(Locale.ROOT)) {
            case "expert" -> 4;
            case "proficient" -> 3;
            case "developing" -> 2;
            case "beginner" -> 1;
            default -> 0;
        };
        if (n == 0) return "<span class=\"m\">" + esc(l.isEmpty() ? "-" : l) + "</span>";
        StringBuilder s = new StringBuilder();
        for (int i = 1; i <= 4; i++) {
            s.append("<span class=\"pip\" style=\"background:").append(i <= n ? p.brand : LINE).append("\"></span>");
        }
        return s.append(" <span class=\"pip-l\">").append(esc(l)).append("</span>").toString();
    }

    // ------------------------------------------------------- hardest questions

    private void appendHardestQuestions(StringBuilder sb, Input in) {
        List<QuestionRow> questions = in.getHardestQuestions();
        if (questions == null || questions.isEmpty()) return;

        List<QuestionRow> ordered = new ArrayList<>(questions);
        ordered.sort((a, b) -> Double.compare(nz(a.getClassCorrectPercent()), nz(b.getClassCorrectPercent())));
        boolean truncated = ordered.size() > MAX_QUESTION_ROWS;
        if (truncated) ordered = ordered.subList(0, MAX_QUESTION_ROWS);
        long gaps = ordered.stream().filter(q -> nz(q.getClassCorrectPercent()) < WEAK_THRESHOLD).count();

        String header = "<tr><th class=\"r\">Q</th><th>Section</th><th>Topic</th><th class=\"r\">Class correct</th>"
                + "<th class=\"r\">Skipped</th><th>Most-chosen wrong answer</th><th>Verdict</th></tr>";
        List<String> rows = new ArrayList<>();
        for (QuestionRow q : ordered) {
            double pct = nz(q.getClassCorrectPercent());
            StringBuilder body = new StringBuilder();
            body.append("<tr><td class=\"r\"><b>").append(q.getNumber() != null ? q.getNumber() : "-").append("</b></td>");
            body.append("<td class=\"m\">").append(esc(clip(nvl(q.getSection(), "-"), 16))).append("</td>");
            body.append("<td class=\"m\">").append(esc(clip(nvl(q.getTopic(), "-"), 22))).append("</td>");
            body.append("<td class=\"r\" style=\"color:").append(bandColor(pct)).append(";\"><b>").append(fmt(pct)).append("%</b></td>");
            body.append("<td class=\"r m\">").append(q.getSkippedCount() != null ? q.getSkippedCount() : 0).append("</td>");
            body.append("<td class=\"sm\">");
            if (q.getTopWrongAnswer() != null && !q.getTopWrongAnswer().isBlank()) {
                body.append("<span style=\"color:").append(BAD).append(";\">").append(escContent(q.getTopWrongAnswer())).append("</span>");
                if (q.getTopWrongPercent() != null) {
                    body.append(" <span class=\"m\">(").append(fmt(q.getTopWrongPercent())).append("%)</span>");
                }
            } else {
                body.append("<span class=\"m\">-</span>");
            }
            body.append("</td><td class=\"nw\">").append(questionVerdict(pct)).append("</td></tr>");
            rows.add(body.toString());
        }
        String after = truncated
                ? "<div class=\"cap\">Showing the " + MAX_QUESTION_ROWS + " hardest of " + questions.size()
                + " questions. The full breakdown is in the Question Insights export.</div>"
                : "";
        String head = gaps > 0
                ? gaps + (gaps == 1 ? " question" : " questions") + " most of the class got wrong"
                : "No question was missed by most of the class";
        sb.append(flowTable("Hardest questions", head,
                "Ordered by how few got them right. Below " + (int) WEAK_THRESHOLD
                        + "% is a teaching gap, not a hard question — the most-chosen wrong answer usually names the misconception.",
                "tbl", new int[]{6, 15, 19, 11, 9, 24, 16}, header, rows, after));
    }

    private static String questionVerdict(double classCorrectPercent) {
        if (classCorrectPercent < 25) return chip("Reteach to all", BAD) + "<div class=\"t-do\">almost nobody got it</div>";
        if (classCorrectPercent < WEAK_THRESHOLD) return chip("Teaching gap", BAD) + "<div class=\"t-do\">most of the class missed it</div>";
        if (classCorrectPercent < BORDERLINE_THRESHOLD) return chip("Revisit", AMBER) + "<div class=\"t-do\">split the class</div>";
        return chip("Well answered", OK);
    }

    // ----------------------------------------------------------------- blooms

    private void appendBlooms(StringBuilder sb, Input in, ReportPalette p) {
        Map<String, int[]> blooms = in.getBlooms();
        if (blooms == null || blooms.isEmpty()) return;

        List<Integer> levels = new ArrayList<>();
        for (int i = 0; i < BLOOM_KEYS.length; i++) {
            int[] v = blooms.get(BLOOM_KEYS[i]);
            if (v != null && v.length >= 2 && v[1] > 0) levels.add(i);
        }
        if (levels.isEmpty()) return;

        Integer best = null, worst = null;
        for (int i : levels) {
            int[] v = blooms.get(BLOOM_KEYS[i]);
            double acc = v[0] * 100.0 / v[1];
            // One question is not a pattern: 3 to headline as a strength, 2 as a weakness.
            if (v[1] >= 3 && (best == null || acc > bloomPct(blooms, best))) best = i;
            if (v[1] >= 2 && (worst == null || acc < bloomPct(blooms, worst))) worst = i;
        }
        String head = best != null && worst != null && !best.equals(worst)
                && bloomPct(blooms, best) - bloomPct(blooms, worst) >= 20
                ? "Strong at " + BLOOM_VERBS[best] + ", weaker at " + BLOOM_VERBS[worst]
                : "Thinking skills across the class";

        StringBuilder body = new StringBuilder("<table class=\"tbl\">");
        body.append("<tr><th>Level</th><th style=\"width:190px;\">Class accuracy</th><th class=\"r\">Correct</th>")
                .append("<th>Reading</th></tr>");
        for (int i : levels) {
            int[] v = blooms.get(BLOOM_KEYS[i]);
            double acc = clampPct(v[0] * 100.0 / v[1]);
            String color = bandColor(acc);
            body.append("<tr><td><div class=\"t-name\">").append(BLOOM_NAMES[i]).append("</div><div class=\"t-do\">")
                    .append(BLOOM_NOTES[i]).append("</div></td>");
            body.append("<td><table class=\"barrow\"><tr><td><div class=\"bar\"><div class=\"bar-f\" style=\"width:")
                    .append(Math.max(3, Math.round(acc))).append("%;background:").append(color)
                    .append("\"></div></div></td><td class=\"bar-v\" style=\"color:").append(color).append("\">")
                    .append(fmt(acc)).append("%</td></tr></table></td>");
            body.append("<td class=\"r\">").append(v[0]).append(" / ").append(v[1]).append("</td>");
            body.append("<td class=\"sm m\">").append(esc(bloomReading(BLOOM_NAMES[i], acc))).append("</td></tr>");
        }
        body.append("</table>");
        if (in.getBloomsReading() != null && !in.getBloomsReading().isBlank()) {
            body.append("<div class=\"callout\" style=\"background:").append(p.brand50).append(";\"><b style=\"color:")
                    .append(p.brandInk).append(";\">What this means for teaching: </b>")
                    .append(esc(in.getBloomsReading())).append("</div>");
        }
        sb.append(block("Bloom's taxonomy", head,
                "Strong Remember/Understand with weak Apply/Analyse is the classic sign that content is learnt but not used.",
                body.toString()));
    }

    private static double bloomPct(Map<String, int[]> blooms, int index) {
        int[] v = blooms.get(BLOOM_KEYS[index]);
        return v[0] * 100.0 / v[1];
    }

    private static String bloomReading(String level, double accuracy) {
        if (accuracy >= BORDERLINE_THRESHOLD) return "Secure across the class";
        if (accuracy >= WEAK_THRESHOLD) return "Split class — reteach to the lower half";
        return switch (level) {
            case "Remember", "Understand" -> "Content did not land — reteach the material itself";
            case "Apply" -> "Theory known, not usable — drill worked examples in class";
            case "Analyse", "Evaluate" -> "Reasoning not developed — scaffold with guided questions";
            default -> "Open-ended tasks are beyond the class for now";
        };
    }

    // --------------------------------------------------------- misconceptions

    private void appendMisconceptions(StringBuilder sb, Input in, ReportPalette p) {
        List<Misconception> items = in.getMisconceptions();
        if (items == null || items.isEmpty()) return;

        List<String> cards = new ArrayList<>();
        for (Misconception m : items) {
            if (cards.size() >= MAX_MISCONCEPTIONS) break;
            StringBuilder c = new StringBuilder();
            c.append("<table class=\"fix\"><tr><td colspan=\"2\" class=\"fix-h\"><table class=\"fix-ht\"><tr><td>")
                    .append(escContent(nvl(m.getQuestionSummary(), ""))).append("</td>");
            if (m.getAffectedStudents() != null) {
                c.append("<td class=\"fix-n\"><span class=\"fix-c\">").append(m.getAffectedStudents())
                        .append(m.getAffectedStudents() == 1 ? " student" : " students").append("</span></td>");
            }
            c.append("</tr></table></td></tr>");
            c.append("<tr><td class=\"fix-you\"><div class=\"lbl\" style=\"color:").append(BAD).append("\">They answered</div>")
                    .append(escContent(nvl(m.getWrongAnswer(), "-"))).append("</td>");
            c.append("<td class=\"fix-right\"><div class=\"lbl\" style=\"color:").append(OK).append("\">Right answer</div>")
                    .append(escContent(nvl(m.getCorrectAnswer(), "-"))).append("</td></tr>");
            boolean why = m.getMisconception() != null && !m.getMisconception().isBlank();
            boolean fix = m.getRemediation() != null && !m.getRemediation().isBlank();
            if (why || fix) {
                c.append("<tr><td colspan=\"2\" class=\"fix-w\">");
                if (why) c.append("<b>Why the class went wrong:</b> ").append(esc(m.getMisconception()));
                if (fix) {
                    c.append("<div class=\"fix-try\" style=\"color:").append(p.brandInk).append("\"><b>Reteach with:</b> ")
                            .append(esc(m.getRemediation())).append("</div>");
                }
                c.append("</td></tr>");
            }
            c.append("</table>");
            cards.add(c.toString());
        }
        int count = cards.size();
        sb.append(flowItems("Shared misconceptions",
                count == 1 ? "1 wrong idea shared across the class" : count + " wrong ideas shared across the class",
                "Wrong answers many students gave for the same reason. One class explanation each — the highest-yield items on this report.",
                cards, ""));
    }

    // ------------------------------------------------------------ action plan

    private void appendActionPlan(StringBuilder sb, Input in, ReportPalette p) {
        List<ActionStep> steps = in.getActionPlan();
        String areas = in.getAreasOfImprovement();
        boolean hasSteps = steps != null && !steps.isEmpty();
        if (!hasSteps && (areas == null || areas.isBlank())) return;

        // One table per step, so a page can break between steps but never inside one.
        List<String> items = new ArrayList<>();
        if (hasSteps) {
            int n = 0;
            for (ActionStep step : steps) {
                n++;
                int priority = step.getPriority() != null && step.getPriority() > 0 ? step.getPriority() : n;
                String color = priority == 1 ? BAD : priority == 2 ? AMBER : p.brand;
                StringBuilder c = new StringBuilder("<table class=\"plan\"><tr>");
                c.append("<td class=\"plan-box\"><div class=\"num\" style=\"background:").append(color).append(";\">")
                        .append(priority).append("</div></td>");
                c.append("<td class=\"plan-t\"><div class=\"plan-h\">").append(esc(nvl(step.getTopic(), ""))).append("</div>")
                        .append("<div class=\"plan-s\">").append(esc(nvl(step.getSuggestion(), ""))).append("</div></td>");
                c.append("<td class=\"plan-time\">");
                if (step.getEstimatedTime() != null && !step.getEstimatedTime().isBlank()) {
                    c.append("<div class=\"plan-est\" style=\"color:").append(p.brandInk).append(";\">")
                            .append(esc(step.getEstimatedTime())).append("</div>");
                }
                if (step.getAffectedStudents() != null) {
                    c.append("<div class=\"plan-a\">").append(step.getAffectedStudents())
                            .append(step.getAffectedStudents() == 1 ? " student" : " students").append(" affected</div>");
                }
                c.append("</td></tr></table>");
                items.add(c.toString());
            }
        }
        String after = "";
        if (areas != null && !areas.isBlank()) {
            after = "<div class=\"sub-h\">Also worth addressing</div><div class=\"md\">" + mdToHtml(areas) + "</div>";
        }
        int count = items.size();
        String head = count > 0
                ? (count == 1 ? "1 thing to reteach" : count + " things to reteach, in this order")
                : "What to reteach";
        sb.append(flowItems("Class action plan", head,
                "Ordered by how many marks it would recover across the class. Work down this list, not down the syllabus.",
                items, after));
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

        String header = "<tr><th>Student</th><th class=\"r\">Score</th><th class=\"r\">Rank</th><th>Weakest areas</th></tr>";
        List<String> rows = new ArrayList<>();
        for (StudentRow s : atRisk) {
            StringBuilder r = new StringBuilder();
            r.append("<tr><td><b>").append(esc(nvl(s.getName(), "-"))).append("</b>");
            if (s.getUsername() != null && !s.getUsername().isBlank()) {
                r.append("<div class=\"t-do\">").append(esc(s.getUsername())).append("</div>");
            }
            r.append("</td><td class=\"r\" style=\"color:").append(BAD).append(";\"><b>").append(fmt(s.getMarks()))
                    .append("</b>").append(s.getPercentage() != null ? " <span class=\"m\">(" + fmt(s.getPercentage()) + "%)</span>" : "")
                    .append("</td>");
            r.append("<td class=\"r m\">").append(s.getRank() != null ? s.getRank() : "-").append("</td>");
            r.append("<td class=\"sm m\">").append(esc(joinOrDash(s.getWeakTopics(), s.getWeakSections()))).append("</td></tr>");
            rows.add(r.toString());
        }
        String absentPanel = "";
        if (!absent.isEmpty()) {
            List<String> names = new ArrayList<>();
            for (StudentRow s : absent) names.add(nvl(s.getName(), "-"));
            absentPanel = "<div class=\"panel\"><div class=\"sub-h\" style=\"margin-top:0;\">Did not attempt ("
                    + absent.size() + ")</div><div class=\"names m\">" + esc(String.join(" · ", names)) + "</div></div>";
        }
        String head = !atRisk.isEmpty()
                ? (atRisk.size() == 1 ? "1 student" : atRisk.size() + " students") + " below " + (int) WEAK_THRESHOLD + "% overall"
                : absent.size() + (absent.size() == 1 ? " student" : " students") + " did not attempt";
        String lede = "These are the students a class-wide reteach will not reach on its own.";
        if (rows.isEmpty()) {
            sb.append(flowItems("Students needing intervention", head, lede, List.of(absentPanel), ""));
        } else {
            sb.append(flowTable("Students needing intervention", head, lede, "tbl", new int[]{34, 16, 10, 40},
                    header, rows, absentPanel));
        }
    }

    // ---------------------------------------------------- who is weak where

    private void appendWeakTopicStudents(StringBuilder sb, Input in) {
        Map<String, List<String>> byTopic = in.getWeakTopicStudents();
        if (byTopic == null || byTopic.isEmpty()) return;

        List<String> panels = new ArrayList<>();
        for (Map.Entry<String, List<String>> e : byTopic.entrySet()) {
            List<String> students = e.getValue();
            if (students == null || students.isEmpty()) continue;
            StringBuilder c = new StringBuilder();
            c.append("<div class=\"panel\"><table class=\"panel-h\"><tr><td class=\"t-name\">").append(esc(e.getKey()))
                    .append("</td><td class=\"r\">").append(chip(students.size() + " students", students.size() > 10 ? BAD : AMBER))
                    .append("</td></tr></table>");
            List<String> shown = students.size() > MAX_NAMES_PER_TOPIC ? students.subList(0, MAX_NAMES_PER_TOPIC) : students;
            c.append("<div class=\"names\">").append(esc(String.join(" · ", shown)));
            if (students.size() > shown.size()) {
                c.append(" <span class=\"m\">+").append(students.size() - shown.size()).append(" more</span>");
            }
            c.append("</div></div>");
            panels.add(c.toString());
        }
        if (panels.isEmpty()) return;
        sb.append(flowItems("Who is weak, topic by topic", "Named students behind each weak topic",
                "For pairing, group work or targeted homework.", panels, ""));
    }

    // ----------------------------------------------------------------- roster

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

        String header = "<tr><th class=\"r\">#</th><th>Student</th><th class=\"r\">Score</th><th class=\"r\">%</th>"
                + "<th>Band</th><th>Weak sections</th><th>Weak topics</th></tr>";
        List<String> rows = new ArrayList<>();
        for (StudentRow s : ordered) {
            if (!s.isAttempted()) {
                rows.add("<tr><td class=\"r m\">-</td><td><b>" + esc(nvl(s.getName(), "-")) + "</b></td>"
                        + "<td colspan=\"5\" class=\"m\"><i>Did not attempt</i></td></tr>");
                continue;
            }
            double pct = nz(s.getPercentage());
            StringBuilder r = new StringBuilder();
            r.append("<tr><td class=\"r m\">").append(s.getRank() != null ? s.getRank() : "-").append("</td>");
            r.append("<td><b>").append(esc(nvl(s.getName(), "-"))).append("</b>");
            if (s.getUsername() != null && !s.getUsername().isBlank()) {
                r.append(" <span class=\"m\" style=\"font-size:9px;\">").append(esc(s.getUsername())).append("</span>");
            }
            r.append("</td><td class=\"r\">").append(fmt(s.getMarks())).append("</td>");
            r.append("<td class=\"r\" style=\"color:").append(bandColor(pct)).append(";\"><b>").append(fmt(pct)).append("</b></td>");
            r.append("<td>").append(bandChip(pct)).append("</td>");
            r.append("<td class=\"m\">").append(esc(joinOrDash(s.getWeakSections(), null))).append("</td>");
            r.append("<td class=\"m\">").append(esc(joinOrDash(s.getWeakTopics(), null))).append("</td></tr>");
            rows.add(r.toString());
        }
        String after = truncated
                ? "<div class=\"cap\">Showing " + MAX_ROSTER_ROWS + " of " + roster.size()
                + " participants. Export the results CSV for the complete list.</div>"
                : "";
        sb.append(flowTable("Participant roster", "Every participant, best first",
                "With the sections and topics each one is weak in.", "tbl roster", new int[]{5, 25, 9, 8, 13, 20, 20},
                header, rows, after));
    }

    // -------------------------------------------------------------- narrative

    /** The full, formatted AI reading, when the page-1 summary could not show it as written. */
    private void appendNarrative(StringBuilder sb, Input in) {
        String narrative = in.getNarrative();
        if (narrative == null || narrative.isBlank()) return;
        // Shown whole when it was cut on page 1, or when it has headings / lists / bold that
        // the one-paragraph summary flattens.
        boolean cut = plain(narrative, Integer.MAX_VALUE).length() > SUMMARY_MAX;
        boolean structured = narrative.matches("(?s).*(^|\\n|\\\\n)\\s*(#{1,6}\\s|[-•*]\\s|\\d+\\.\\s).*")
                || narrative.contains("**");
        if (!cut && !structured) return;
        sb.append(blockFlow("Overall reading", "The full reading of this paper", null,
                "<div class=\"md\">" + mdToHtml(narrative) + "</div>"));
    }

    // ----------------------------------------------------------------- footer

    private void appendFooter(StringBuilder sb, Input in, ReportBrandingDto branding) {
        String custom = brandingHelper.buildFooterHtml(branding, nvl(in.getAssessmentName(), ""));
        if (custom != null && !custom.isEmpty()) {
            sb.append(custom);
        }
        sb.append("<table class=\"foot\"><tr><td>");
        if (in.isAiUnavailable()) {
            sb.append(in.getGeneratedAt() != null ? "Generated on " + fmtDateTime(in.getGeneratedAt()) + " from" : "Generated from")
                    .append(" assessment data only — AI analysis was not available, so topic inference, "
                    + "misconceptions and the action plan are absent from this copy.");
        } else {
            sb.append("AI-assisted analysis")
                    .append(in.getGeneratedAt() != null ? " generated on " + fmtDateTime(in.getGeneratedAt()) : "")
                    .append(". One analysis per assessment — review before acting on it or sharing it.");
        }
        sb.append("</td><td class=\"r\" style=\"width:140px;\">");
        ClassOverview o = in.getOverview();
        if (o != null && o.getAttempted() != null) {
            sb.append("Based on ").append(o.getAttempted()).append(o.getAttempted() == 1 ? " attempt" : " attempts");
        }
        sb.append("</td></tr></table>");
    }

    // ------------------------------------------------------- building blocks

    /** A block that must not split across pages (chart + short table). */
    private static String block(String tag, String head, String lede, String body) {
        return "<div class=\"block\">" + titled(tag, head, lede, body) + "</div>";
    }

    /** A block that may run over pages (long text); only its heading is kept together. */
    private static String blockFlow(String tag, String head, String lede, String body) {
        return "<div class=\"block-flow\"><div class=\"keep\">" + titledHead(tag, head, lede) + "</div>" + body + "</div>";
    }

    /**
     * A list of cards that may run over pages. The heading is kept on the same page as the
     * first card (iText ignores page-break-after:avoid, so a heading alone at the foot of a
     * page cannot be prevented any other way); every card stays whole.
     */
    private static String flowItems(String tag, String head, String lede, List<String> items, String after) {
        StringBuilder s = new StringBuilder("<div class=\"block-flow\"><div class=\"keep\">").append(titledHead(tag, head, lede));
        if (!items.isEmpty()) s.append(items.get(0));
        s.append("</div>");
        for (int i = 1; i < items.size(); i++) s.append(items.get(i));
        return s.append(after).append("</div>").toString();
    }

    /**
     * A long table that may run over pages, with its heading kept beside the header row
     * and first rows. The rows are split into two tables with the same fixed column widths
     * ({@code widths} in percent), so they line up as one.
     */
    private static String flowTable(String tag, String head, String lede, String cls, int[] widths,
                                    String header, List<String> rows, String after) {
        StringBuilder cols = new StringBuilder("<colgroup>");
        for (int w : widths) cols.append("<col style=\"width:").append(w).append("%\"/>");
        cols.append("</colgroup>");
        int keep = Math.min(rows.size(), 3);
        StringBuilder s = new StringBuilder("<div class=\"block-flow\"><div class=\"keep\">").append(titledHead(tag, head, lede));
        s.append("<table class=\"").append(cls).append(" fixed\">").append(cols).append(header);
        for (int i = 0; i < keep; i++) s.append(rows.get(i));
        s.append("</table></div>");
        if (rows.size() > keep) {
            s.append("<table class=\"").append(cls).append(" fixed\">").append(cols);
            for (int i = keep; i < rows.size(); i++) s.append(rows.get(i));
            s.append("</table>");
        }
        return s.append(after).append("</div>").toString();
    }

    private static String titled(String tag, String head, String lede, String body) {
        return titledHead(tag, head, lede) + body;
    }

    private static String titledHead(String tag, String head, String lede) {
        return "<div class=\"tag\">" + esc(tag) + "</div><div class=\"h3\">" + esc(head) + "</div>"
                + (lede == null ? "" : "<div class=\"lede\">" + esc(lede) + "</div>");
    }

    private static String key(String color, String label) {
        return "<span class=\"key\"><span class=\"sw\" style=\"background:" + color + "\"></span> " + esc(label) + "</span>";
    }

    private static String chip(String label, String color) {
        return "<span class=\"chip\" style=\"background:" + softOf(color) + ";color:" + color + ";\">" + esc(label) + "</span>";
    }

    private static String priorityChip(double accuracy) {
        if (accuracy < WEAK_THRESHOLD) return chip("P1 · Reteach", BAD);
        if (accuracy < BORDERLINE_THRESHOLD) return chip("P2 · Practise", AMBER);
        return chip("On track", OK);
    }

    private static String bandChip(double percentage) {
        if (percentage < WEAK_THRESHOLD) return chip("At risk", BAD);
        if (percentage < BORDERLINE_THRESHOLD) return chip("Developing", AMBER);
        if (percentage < 85) return chip("Secure", OK);
        return chip("Excelling", OK);
    }

    private static String softOf(String color) {
        if (BAD.equals(color)) return BAD_50;
        if (AMBER.equals(color)) return AMBER_50;
        if (OK.equals(color)) return OK_50;
        return SOFT;
    }

    private static String bandColor(double accuracyPercent) {
        if (accuracyPercent < WEAK_THRESHOLD) return BAD;
        if (accuracyPercent < BORDERLINE_THRESHOLD) return AMBER;
        return OK;
    }

    // -------------------------------------------------------------------- css

    /** iText subset: no flex/grid/rgba/var. Mirrors the student report's classes where they overlap. */
    private static String css(Input in, ReportPalette p) {
        String footLeft = cssString(nvl(in.getInstituteName(), "").isBlank()
                ? "Class AI report · " + nvl(in.getAssessmentName(), "Assessment")
                : in.getInstituteName() + " · Class AI report");
        return "@page{size:A4;margin:28px 0 30px 0;"
                + "@bottom-left{content:\"" + footLeft + "\";font-family:Mukta;font-size:9px;color:" + MUTED + ";padding-left:36px;vertical-align:top;}"
                + "@bottom-right{content:\"Page \" counter(page) \" of \" counter(pages);font-family:Mukta;font-size:9px;color:" + MUTED + ";padding-right:36px;vertical-align:top;}}"
                + "@page :first{margin-top:0;}"
                + "body{margin:0;font-family:Mukta,sans-serif;font-size:12.5px;line-height:1.45;color:" + INK + ";}"
                + "table{border-collapse:collapse;}"
                + ".wm{position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;}"
                + ".wm-text{position:absolute;top:360pt;left:100pt;font-size:60px;font-weight:bold;white-space:nowrap;transform:rotate(-35deg);}"
                + ".band{width:100%;background:" + p.brand + ";color:" + p.onBrand + ";}"
                + ".band td{padding:12px 0;vertical-align:middle;}"
                + ".band-logo{padding-left:36px !important;padding-right:0 !important;}"
                + ".logo-img{background:#ffffff;border-radius:9px;border-collapse:separate;}"
                + ".logo-img td{padding:5px 7px !important;line-height:0;}"
                + ".logo{width:40px;height:40px;background:#ffffff;border-radius:10px;text-align:center;line-height:40px;}"
                + ".logo-t{font-family:'Baloo 2';font-weight:800;font-size:16px;color:" + p.brandInk + ";}"
                + ".band-i1{font-family:'Baloo 2';font-weight:700;font-size:15px;line-height:1.1;}"
                + ".band-i2{font-size:11.5px;line-height:1.3;}"
                + ".band-right{text-align:right;padding-right:36px !important;}"
                + ".band-r1{font-family:'Baloo 2';font-weight:700;font-size:15px;line-height:1.1;}"
                + ".band-r2{font-size:11.5px;line-height:1.3;}"
                + ".hero{background:" + p.brand + ";color:" + p.onBrand + ";padding:2px 36px 22px 36px;border-top:1px solid " + p.brandDeep + ";}"
                + ".hero-t{width:100%;}"
                + ".hero-l{vertical-align:bottom;padding-right:20px;}"
                + ".hero-r{vertical-align:bottom;text-align:right;width:230px;}"
                + ".kicker{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:bold;margin-top:12px;}"
                + ".h1{font-family:'Baloo 2';font-weight:800;font-size:32px;line-height:1.05;margin:4px 0 8px 0;}"
                + ".hero-p{font-size:13.5px;line-height:1.4;}"
                + ".big{font-family:'Baloo 2';font-weight:800;font-size:80px;line-height:0.95;}"
                + ".big-of{font-size:28px;font-weight:700;}"
                + ".big-sub{font-family:'Baloo 2';font-weight:700;font-size:16px;line-height:1.2;}"
                + ".pct-top{width:100%;margin-top:16px;font-size:12.5px;}"
                + ".pct-top b{font-family:'Baloo 2';font-weight:800;font-size:16px;}"
                + ".pct-track{height:14px;background:" + p.brandDeep + ";border-radius:7px;margin-top:4px;}"
                + ".pct-fill{height:14px;background:" + p.accent + ";border-radius:7px;}"
                + ".tiles{width:100%;border-collapse:separate;border-spacing:8px 0;margin:16px -8px 0 -8px;table-layout:fixed;}"
                + ".tile{background:#ffffff;border-radius:12px;padding:9px 12px;vertical-align:top;}"
                + ".tile-v{font-family:'Baloo 2';font-weight:800;font-size:26px;line-height:1.05;}"
                + ".tile-l{font-size:11.5px;color:" + MUTED + ";line-height:1.3;}"
                + ".body{padding:20px 36px 0 36px;}"
                + ".block{margin-bottom:24px;page-break-inside:avoid;}"
                + ".block-flow{margin-bottom:24px;}"
                + ".keep{page-break-inside:avoid;page-break-after:avoid;}"
                + ".tag{display:inline-block;font-weight:bold;font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:" + p.brandInk
                + ";background:" + p.brand50 + ";padding:4px 8px;border-radius:5px;}"
                + ".h3{font-family:'Baloo 2';font-weight:800;font-size:20px;line-height:1.15;margin:6px 0 2px 0;color:" + INK + ";}"
                + ".lede{color:" + MUTED + ";font-size:12px;margin:0 0 8px 0;}"
                + ".cap{color:" + MUTED + ";font-size:11px;line-height:1.4;margin-top:6px;}"
                + ".legend{font-size:11.5px;color:" + MUTED + ";margin:2px 0 6px 0;}"
                + ".key{margin-right:14px;}"
                + ".sw{display:inline-block;width:10px;height:10px;border-radius:3px;}"
                + ".tick{display:inline-block;width:3px;height:11px;}"
                + ".dot{display:inline-block;width:9px;height:9px;border-radius:5px;}"
                + ".note{width:100%;background:" + p.brand50 + ";border-radius:14px;margin-bottom:24px;}"
                + ".note td{padding:14px 16px 14px 0;vertical-align:top;}"
                + ".note-q{width:56px;padding-left:16px !important;}"
                + ".quote{width:40px;height:40px;border-radius:20px;background:" + p.brand + ";color:" + p.onBrand
                + ";text-align:center;font-family:'Baloo 2';font-weight:800;font-size:30px;line-height:48px;}"
                + ".note-l{font-weight:bold;font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;color:" + p.brandInk + ";}"
                + ".note-t{font-size:13px;line-height:1.5;margin-top:3px;}"
                + ".tbl{width:100%;font-size:11.5px;}"
                + ".fixed{table-layout:fixed;}"
                + ".tbl th{background:" + SOFT + ";text-align:left;padding:7px 8px;color:" + MUTED
                + ";font-weight:bold;font-size:9.5px;letter-spacing:0.8px;text-transform:uppercase;border-bottom:1.5px solid " + LINE + ";}"
                + ".tbl td{padding:7px 8px;border-bottom:1px solid " + LINE + ";vertical-align:middle;}"
                + ".roster{font-size:10.5px;}"
                + ".roster th{padding:6px 6px;font-size:8.5px;}"
                + ".roster td{padding:5px 6px;}"
                + ".r{text-align:right;}"
                + ".m{color:" + MUTED + ";}"
                + ".sm{font-size:10.5px;}"
                + ".nw{white-space:nowrap;}"
                + ".t-name{font-weight:bold;font-size:12px;line-height:1.3;}"
                + ".t-do{font-size:10.5px;color:" + MUTED + ";line-height:1.3;}"
                + ".barrow{width:100%;}"
                + ".barrow td{padding:0 !important;border:none !important;vertical-align:middle;}"
                + ".bar{height:10px;background:" + SOFT + ";border-radius:5px;}"
                + ".bar-f{height:10px;border-radius:5px;}"
                + ".bar-v{width:48px;text-align:right;font-weight:bold;font-size:11.5px;}"
                + ".pip{display:inline-block;width:10px;height:5px;border-radius:2px;margin-left:2px;}"
                + ".pip-l{font-size:10.5px;color:" + MUTED + ";}"
                + ".chip{display:inline-block;padding:2px 8px;border-radius:9px;font-size:9.5px;font-weight:bold;letter-spacing:0.3px;white-space:nowrap;}"
                + ".lost{width:100%;margin-top:8px;}"
                + ".lost td{padding:4px 0;font-size:12px;}"
                + ".lost-n{font-weight:bold;}"
                + ".lost-v{text-align:right;color:" + MUTED + ";}"
                + ".lost-v b{color:" + INK + ";}"
                + ".callout{border-radius:10px;padding:10px 14px;margin-top:10px;font-size:12px;line-height:1.45;}"
                + ".fix{width:100%;margin-bottom:12px;border:1.5px solid " + LINE + ";page-break-inside:avoid;}"
                + ".fix-h{background:" + INK + ";color:#ffffff;padding:9px 14px;}"
                + ".fix-ht{width:100%;}"
                + ".fix-ht td{font-family:'Baloo 2';font-weight:700;font-size:14px;line-height:1.25;vertical-align:middle;}"
                + ".fix-n{text-align:right;width:110px;}"
                + ".fix-c{font-family:Mukta;font-weight:bold;font-size:10.5px;background:" + BAD + ";color:#ffffff;padding:3px 9px;border-radius:9px;}"
                + ".fix-you{background:" + BAD_50 + ";padding:9px 14px;width:50%;vertical-align:top;font-size:12px;}"
                + ".fix-right{background:" + OK_50 + ";padding:9px 14px;width:50%;vertical-align:top;font-size:12px;}"
                + ".lbl{font-size:9.5px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;}"
                + ".fix-w{padding:9px 14px 11px 14px;font-size:12px;line-height:1.45;}"
                + ".fix-try{margin-top:4px;}"
                + ".plan{width:100%;border-collapse:separate;border-spacing:0;margin-bottom:8px;page-break-inside:avoid;}"
                + ".plan td{background:" + SOFT + ";vertical-align:top;padding:11px 0;}"
                + ".plan-box{width:46px;padding-left:14px !important;border-radius:12px 0 0 12px;}"
                + ".num{width:24px;height:24px;border-radius:12px;color:#ffffff;text-align:center;line-height:25px;"
                + "font-family:'Baloo 2';font-weight:800;font-size:13px;}"
                + ".plan-h{font-family:'Baloo 2';font-weight:700;font-size:14.5px;line-height:1.25;}"
                + ".plan-s{font-size:12px;color:" + MUTED + ";line-height:1.4;}"
                + ".plan-time{width:150px;text-align:right;padding-right:14px !important;border-radius:0 12px 12px 0;}"
                + ".plan-est{font-weight:bold;font-size:11px;line-height:1.3;}"
                + ".plan-a{font-size:10.5px;color:" + BAD + ";margin-top:5px;}"
                + ".pill{display:inline-block;background:" + p.brand + ";color:" + p.onBrand + ";font-weight:bold;font-size:10.5px;padding:4px 9px;border-radius:10px;}"
                + ".sub-h{font-weight:bold;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:" + MUTED + ";margin:12px 0 4px 0;}"
                + ".md{font-size:12px;line-height:1.5;}"
                + ".panel{background:" + SOFT + ";border-radius:10px;padding:10px 14px;margin-top:8px;page-break-inside:avoid;}"
                + ".panel-h{width:100%;margin-bottom:4px;}"
                + ".names{font-size:11px;line-height:1.7;}"
                + ".foot{width:100%;border-top:1px solid " + LINE + ";margin-top:8px;font-size:9.5px;color:" + MUTED + ";}"
                + ".foot td{padding-top:7px;vertical-align:top;}";
    }

    // ------------------------------------------------------------------- svg

    private static String svg(int w, int h, CharSequence body) {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + w + "\" height=\"" + h + "\" viewBox=\"0 0 " + w + " " + h
                + "\">" + body + "</svg>";
    }

    private static String rect(double x, double y, double w, double h, double rx, String fill) {
        double r = Math.min(rx, Math.min(w, h) / 2);
        return "<rect x=\"" + f(x) + "\" y=\"" + f(y) + "\" width=\"" + f(w) + "\" height=\"" + f(h) + "\""
                + (r > 0 ? " rx=\"" + f(r) + "\"" : "") + " fill=\"" + fill + "\"/>";
    }

    private static String line(double x1, double y1, double x2, double y2, String stroke, double width, String dash) {
        return "<line x1=\"" + f(x1) + "\" y1=\"" + f(y1) + "\" x2=\"" + f(x2) + "\" y2=\"" + f(y2) + "\" stroke=\"" + stroke
                + "\" stroke-width=\"" + f(width) + "\"" + (dash != null ? " stroke-dasharray=\"" + dash + "\"" : "") + "/>";
    }

    private static String circle(double cx, double cy, double r, String fill) {
        return "<circle cx=\"" + f(cx) + "\" cy=\"" + f(cy) + "\" r=\"" + f(r) + "\" fill=\"" + fill + "\"/>";
    }

    private static String svgText(double x, double y, String t, double size, boolean bold, String fill, String anchor) {
        return "<text x=\"" + f(x) + "\" y=\"" + f(y) + "\" font-family=\"Mukta\" font-size=\"" + f(size)
                + "\" font-weight=\"" + (bold ? "bold" : "normal") + "\" fill=\"" + fill + "\" text-anchor=\"" + anchor + "\">"
                + escPlain(t) + "</text>";
    }

    private static String f(double v) {
        if (Math.abs(v - Math.rint(v)) < 0.005) return String.valueOf((long) Math.rint(v));
        return String.format(Locale.ROOT, "%.1f", v);
    }

    // --------------------------------------------------------- small helpers

    /**
     * Whether this report actually contains a per-question breakdown. False for
     * PDF/OMR papers, where question-level data was never captured.
     */
    private static boolean hasBreakdown(Input in) {
        boolean topics = in.getTopics() != null && !in.getTopics().isEmpty();
        boolean questions = in.getHardestQuestions() != null && !in.getHardestQuestions().isEmpty();
        boolean multiSection = in.getSections() != null && in.getSections().size() > 1;
        return topics || questions || multiSection;
    }

    private static Double avgPct(ClassOverview o) {
        if (o == null || o.getAverageMarks() == null || o.getTotalMarks() == null || o.getTotalMarks() <= 0) return null;
        return clampPct(o.getAverageMarks() / o.getTotalMarks() * 100.0);
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

    /** Same colour rule as the student report: the institute's primary, else the platform teal. */
    private static String brandOf(ReportBrandingDto branding) {
        String v = branding.getPrimaryColor();
        return v != null && v.trim().matches("#[0-9a-fA-F]{6}") ? v.trim() : DEFAULT_BRAND;
    }

    /** The institute's secondary colour; the stock purple default counts as "not chosen". */
    private static String accentOf(ReportBrandingDto branding) {
        String v = branding.getSecondaryColor();
        if (v == null || "#6C5CE7".equalsIgnoreCase(v.trim()) || !v.trim().matches("#[0-9a-fA-F]{6}")) return DEFAULT_ACCENT;
        return v.trim();
    }

    /** Inlined (trimmed + downscaled) logo first; the presigned URL is the fallback. */
    private String logoOf(ReportBrandingDto branding) {
        if (!Boolean.TRUE.equals(branding.getShowLogoInHeader())) return null;
        try {
            String inline = branding.getLogoFileId() != null ? reportLogoService.resolveInlineLogo(branding.getLogoFileId()) : null;
            if (inline != null) return inline;
            String url = brandingHelper.resolveLogoUrl(branding);
            return url != null && !url.isBlank() ? url : null;
        } catch (Exception e) {
            log.debug("Class AI report: logo unavailable: {}", e.getMessage());
            return null;
        }
    }

    private static String initials(String inst) {
        StringBuilder b = new StringBuilder();
        for (String w : inst.trim().split("\\s+")) {
            if (!w.isEmpty() && Character.isLetterOrDigit(w.charAt(0))) b.append(Character.toUpperCase(w.charAt(0)));
            if (b.length() == 2) break;
        }
        return b.toString();
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
        return String.format(Locale.ROOT, "%.1f", value);
    }

    private static String fmt(double value) {
        return fmt(Double.valueOf(value));
    }

    private static String mmss(long seconds) {
        return (seconds / 60) + ":" + String.format(Locale.ROOT, "%02d", seconds % 60);
    }

    private static String fmtDate(Date date) {
        SimpleDateFormat f = new SimpleDateFormat("d MMM yyyy", Locale.ENGLISH);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return f.format(date);
    }

    private static String fmtDateTime(Date date) {
        SimpleDateFormat f = new SimpleDateFormat("d MMM yyyy, HH:mm", Locale.ENGLISH);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return f.format(date);
    }

    private static String nvl(String value, String fallback) {
        return value != null && !value.isBlank() ? value : fallback;
    }

    private static String clip(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() <= max ? t : t.substring(0, Math.max(1, max - 1)).trim() + "…";
    }

    /** Markdown-ish AI text to one plain paragraph, cut at a sentence near {@code max}. */
    private static String plain(String md, int max) {
        if (md == null || md.isBlank()) return "";
        String t = md.replaceAll("(?m)^#{1,6}\\s*", "")
                .replaceAll("\\*\\*(.+?)\\*\\*", "$1").replaceAll("(?<![\\w*])\\*(?!\\s)(.+?)\\*", "$1")
                .replaceAll("(?m)^\\s*(?:[-•*]|\\d+\\.)\\s+", "")
                .replace("\\n", " ").replaceAll("\\s+", " ").trim();
        if (t.length() <= max) return t;
        int cut = t.lastIndexOf(". ", max);
        return cut > max / 2 ? t.substring(0, cut + 1) : t.substring(0, max).trim() + "…";
    }

    private static String mdToHtml(String md) {
        if (md == null || md.isEmpty()) return "";
        String t = esc(md);
        t = t.replaceAll("(?m)^### (.+)$", "<div style=\"font-size:12.5px;font-weight:bold;margin:8px 0 3px;\">$1</div>");
        t = t.replaceAll("(?m)^## (.+)$", "<div style=\"font-size:13px;font-weight:bold;margin:10px 0 4px;\">$1</div>");
        t = t.replaceAll("\\*\\*(.+?)\\*\\*", "<b>$1</b>");
        t = t.replaceAll("(?m)^(\\d+)\\.\\s+(.+)$", "<div style=\"margin:3px 0 3px 14px;\"><b>$1.</b> $2</div>");
        t = t.replaceAll("(?m)^[-•]\\s+(.+)$", "<div style=\"margin:3px 0 3px 14px;\">• $1</div>");
        t = t.replace("\\n", "<br/>").replace("\n", "<br/>");
        t = t.replace("</div><br/>", "</div>");
        return t;
    }

    /**
     * Escapes text that originated in question or option content, which arrives already
     * carrying HTML entities (rich-text editor). Decoding first, then escaping once, renders
     * the character the author meant instead of a raw {@code &gt;}.
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

    /**
     * HTML-escapes text and wraps symbols the body fonts lack (Greek, arrows, maths) in
     * Noto Sans Math, as the student report does — otherwise iText switches the rest of
     * the run to whichever font has the symbol (Ω, →, ≤ are common in AI text).
     */
    private static String esc(String text) {
        if (text == null || text.isEmpty()) return "";
        StringBuilder out = new StringBuilder(text.length() + 16);
        boolean inSym = false;
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            boolean sym = isSymbol(cp);
            if (sym && !inSym) { out.append("<span style=\"font-family:'Noto Sans Math'\">"); inSym = true; }
            if (!sym && inSym) { out.append("</span>"); inSym = false; }
            switch (cp) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                default -> out.appendCodePoint(cp);
            }
        }
        if (inSym) out.append("</span>");
        return out.toString();
    }

    private static boolean isSymbol(int cp) {
        return (cp >= 0x0370 && cp <= 0x03FF)
                || (cp >= 0x2032 && cp <= 0x2037)
                || (cp >= 0x2100 && cp <= 0x214F)
                || (cp >= 0x2190 && cp <= 0x22FF)
                || (cp >= 0x25A0 && cp <= 0x25FF)
                || (cp >= 0x27C0 && cp <= 0x27FF)
                || (cp >= 0x2900 && cp <= 0x2AFF);
    }

    /** Escaping for SVG text nodes, where a styled span is not allowed. */
    private static String escPlain(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String escAttr(String url) {
        if (url == null) return "";
        return url.trim().replace("&amp;", "&").replace("&", "&amp;").replace("\"", "&quot;");
    }

    private static String cssString(String s) {
        return s.replace("\\", "").replace("\"", "'").replace("\n", " ").replace("<", "").replace(">", "");
    }
}
