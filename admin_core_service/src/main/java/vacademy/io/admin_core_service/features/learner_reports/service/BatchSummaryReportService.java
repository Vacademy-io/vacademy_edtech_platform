package vacademy.io.admin_core_service.features.learner_reports.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.util.HtmlUtils;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.faculty.entity.FacultySubjectPackageSessionMapping;
import vacademy.io.admin_core_service.features.faculty.repository.FacultySubjectPackageSessionMappingRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute_learner.entity.Student;
import vacademy.io.admin_core_service.features.institute_learner.repository.InstituteStudentRepository;
import vacademy.io.admin_core_service.features.learner_reports.dto.BatchReportSettingConfig;
import vacademy.io.admin_core_service.features.learner_reports.dto.BatchReportSettingConfig.BatchReportSection;
import vacademy.io.admin_core_service.features.learner_reports.dto.BatchSummaryReportDTO;
import vacademy.io.admin_core_service.features.learner_reports.dto.BatchSummaryReportRequest;
import vacademy.io.admin_core_service.features.learner_reports.dto.LearnerActivityDataProjection;
import vacademy.io.admin_core_service.features.learner_reports.dto.ProgressReportDTO;
import vacademy.io.admin_core_service.features.learner_reports.dto.ReportFilterDTO;
import vacademy.io.admin_core_service.features.learner_reports.dto.SubjectProgressDTO;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.packages.repository.PackageSessionRepository;
import vacademy.io.admin_core_service.features.quiz_results.dto.LearnerQuizOverviewResponse;
import vacademy.io.admin_core_service.features.quiz_results.service.QuizResultsService;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ThemeColorResolver;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.common.notification.dto.AttachmentNotificationDTO;
import vacademy.io.common.notification.dto.AttachmentUsersDTO;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Learning Reports → Batch → Overview: the basic batch report, the template-driven document
 * generated from it (HTML for preview and email, PDF for download) and sending it to the
 * batch's teachers or to parents.
 *
 * <p>Built entirely from existing report data — quiz results for pass / fail, the batch report
 * queries for completion, time, concentration, subject progress and the activity leaderboard.
 * Each source is fetched independently, so one failing query leaves its figures empty instead
 * of failing the whole report.
 *
 * <p>A parent only ever receives their own child's results: their copy drops every section that
 * names other learners and adds a "your child" block. Teachers receive the batch report as is,
 * and only teachers mapped to this batch are addressed.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BatchSummaryReportService {

    private static final long MAX_RANGE_DAYS = 366;
    private static final int ACTIVITY_ROWS = 10;
    private static final int HIGHLIGHT_ROWS = 10;
    private static final String DEFAULT_BRAND = "#4f46e5";
    private static final DateTimeFormatter DATE_LABEL = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH);

    public static final String AUDIENCE_TEACHERS = "TEACHERS";
    public static final String AUDIENCE_PARENTS = "PARENTS";

    private final BatchReportService batchReportService;
    private final QuizResultsService quizResultsService;
    private final PackageSessionRepository packageSessionRepository;
    private final InstituteRepository instituteRepository;
    private final InstituteSettingService instituteSettingService;
    private final InstituteStudentRepository studentRepository;
    private final FacultySubjectPackageSessionMappingRepository facultyMappingRepository;
    private final AuthService authService;
    private final NotificationService notificationService;
    private final ObjectMapper objectMapper;

    // ── summary ─────────────────────────────────────────────────────────────────

    public BatchSummaryReportDTO summarize(String instituteId, BatchSummaryReportRequest request,
                                           CustomUserDetails user) {
        validate(instituteId, request);
        BatchReportSettingConfig setting = loadSetting(instituteId);
        double passMark = setting.resolvedPassPercentage();
        String batchId = request.getPackageSessionId();
        Institute institute = institute(instituteId);

        BatchSummaryReportDTO.BatchSummaryReportDTOBuilder out = BatchSummaryReportDTO.builder()
                .packageSessionId(batchId)
                .batchName(request.getBatchName())
                .instituteName(institute == null ? null : institute.getInstituteName())
                .brandColor(institute == null ? null : ThemeColorResolver.resolve(institute.getInstituteThemeCode()))
                .startDate(request.getStartDate())
                .endDate(request.getEndDate())
                .passPercentage(passMark)
                .sections(sectionsFor(request, setting));

        // Pass / fail from quiz results (graded to date).
        List<BatchSummaryReportDTO.LearnerRow> learners = new ArrayList<>();
        try {
            LearnerQuizOverviewResponse quiz = quizResultsService.getLearnerOverview(batchId, user);
            long passed = 0, failed = 0, notAttempted = 0;
            for (LearnerQuizOverviewResponse.LearnerRow row : nonNull(quiz.getLearners())) {
                String status;
                if (row.getQuizzesAttempted() <= 0 || row.getAvgScorePercent() == null) {
                    status = "NOT_ATTEMPTED";
                    notAttempted++;
                } else if (row.getAvgScorePercent() >= passMark) {
                    status = "PASSED";
                    passed++;
                } else {
                    status = "FAILED";
                    failed++;
                }
                learners.add(BatchSummaryReportDTO.LearnerRow.builder()
                        .userId(row.getUserId())
                        .fullName(row.getFullName())
                        .avgScorePercent(round1(row.getAvgScorePercent()))
                        .quizzesAttempted(row.getQuizzesAttempted())
                        .quizzesInCourse(row.getQuizzesInCourse())
                        .status(status)
                        .build());
            }
            long enrolled = quiz.getSummary() != null ? quiz.getSummary().getEnrolledLearners() : learners.size();
            out.enrolledLearners(enrolled)
                    .learnersAttempted(passed + failed)
                    .passedLearners(passed)
                    .failedLearners(failed)
                    .notAttemptedLearners(notAttempted)
                    .passRate(enrolled > 0 ? round1(passed * 100.0 / enrolled) : null)
                    .avgQuizScore(quiz.getSummary() != null ? round1(quiz.getSummary().getAvgScorePercent()) : null)
                    .quizzesInCourse(quiz.getSummary() != null ? quiz.getSummary().getQuizzesInCourse() : 0)
                    .learnersTruncated(quiz.isTruncated());
        } catch (Exception e) {
            log.warn("[batch-summary] quiz results failed for batch {}: {}", batchId, e.getMessage());
        }
        learners.sort(Comparator.comparing(BatchSummaryReportDTO.LearnerRow::getAvgScorePercent,
                Comparator.nullsLast(Comparator.reverseOrder())));
        out.learners(learners);

        ReportFilterDTO filter = new ReportFilterDTO();
        filter.setPackageSessionId(batchId);
        filter.setStartDate(Date.valueOf(request.getStartDate()));
        filter.setEndDate(Date.valueOf(request.getEndDate()));

        try {
            ProgressReportDTO progress = batchReportService.getBatchReport(filter, user);
            out.avgCourseCompletion(round1(progress.getPercentageCourseCompleted()))
                    .avgTimeSpentMinutes(round1(progress.getAvgTimeSpentInMinutes()))
                    .avgConcentration(round1(progress.getPercentageConcentrationScore()));
        } catch (Exception e) {
            log.warn("[batch-summary] batch progress failed for batch {}: {}", batchId, e.getMessage());
        }

        try {
            List<BatchSummaryReportDTO.SubjectRow> subjects = new ArrayList<>();
            for (SubjectProgressDTO s : nonNull(batchReportService.getSubjectProgressReport(batchId, user))) {
                List<SubjectProgressDTO.ModuleProgressDTO> modules = nonNull(s.getModules());
                subjects.add(BatchSummaryReportDTO.SubjectRow.builder()
                        .subjectName(s.getSubjectName())
                        .avgCompletion(round1(average(modules.stream()
                                .map(SubjectProgressDTO.ModuleProgressDTO::getCompletionPercentage).toList())))
                        .avgTimeMinutes(round1(average(modules.stream()
                                .map(SubjectProgressDTO.ModuleProgressDTO::getAvgTimeSpentMinutes).toList())))
                        .modules(modules.size())
                        .build());
            }
            out.subjects(subjects);
        } catch (Exception e) {
            log.warn("[batch-summary] subject progress failed for batch {}: {}", batchId, e.getMessage());
            out.subjects(List.of());
        }

        try {
            List<BatchSummaryReportDTO.ActivityRow> activity = new ArrayList<>();
            for (LearnerActivityDataProjection p :
                    batchReportService.getBatchActivityData(filter, 0, ACTIVITY_ROWS, user).getContent()) {
                activity.add(BatchSummaryReportDTO.ActivityRow.builder()
                        .rank(p.getRank())
                        .userId(p.getUserId())
                        .fullName(p.getFullName())
                        .totalTimeMinutes(round1(p.getTotalTime()))
                        .dailyAvgMinutes(round1(p.getDailyAvgTime()))
                        .avgConcentration(round1(p.getAvgConcentration()))
                        .build());
            }
            out.activity(activity);
        } catch (Exception e) {
            log.warn("[batch-summary] activity leaderboard failed for batch {}: {}", batchId, e.getMessage());
            out.activity(List.of());
        }

        return out.build();
    }

    // ── document ────────────────────────────────────────────────────────────────

    public String renderHtml(String instituteId, BatchSummaryReportRequest request, CustomUserDetails user) {
        return renderHtml(summarize(instituteId, request, user), null);
    }

    public byte[] renderPdf(String instituteId, BatchSummaryReportRequest request, CustomUserDetails user) {
        return toPdf(renderHtml(instituteId, request, user), request.getPackageSessionId());
    }

    private byte[] toPdf(String html, String batchId) {
        try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            HtmlConverter.convertToPdf(html, outputStream, new ConverterProperties());
            return outputStream.toByteArray();
        } catch (Exception e) {
            log.error("[batch-summary] PDF render failed for batch {}", batchId, e);
            throw new VacademyException("Could not create the PDF for this report");
        }
    }

    /**
     * The report document: an institute band, a hero result, stat tiles and one block per
     * enabled section, with inline SVG charts.
     *
     * @param child non-null for a parent copy: sections naming other learners are dropped and
     *              the hero, tiles and score histogram are about this learner.
     */
    String renderHtml(BatchSummaryReportDTO r, BatchSummaryReportDTO.LearnerRow child) {
        String brand = brand(r);
        StringBuilder h = new StringBuilder(16_000);
        h.append("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>").append(css(brand)).append("</style></head><body>");

        h.append("<table class=\"band\"><tr><td class=\"band-logo\"><div class=\"logo\">")
                .append(esc(initials(r.getInstituteName()))).append("</div></td><td><div class=\"band-i1\">")
                .append(esc(r.getInstituteName())).append("</div><div class=\"band-i2\">")
                .append(child != null ? "Progress report" : "Batch report").append("</div></td><td class=\"band-r\"><div class=\"band-r1\">")
                .append(esc(child != null ? child.getFullName() : r.getBatchName())).append("</div><div class=\"band-r2\">")
                .append(esc(child != null ? joinNonBlank(" · ", r.getBatchName(), dateLabel(r)) : dateLabel(r)))
                .append("</div></td></tr></table><div class=\"body\">");

        if (child != null) appendChildHero(h, r, child);
        else appendBatchHero(h, r);

        List<String> sections = r.getSections() == null ? BatchReportSettingConfig.ALL_SECTIONS : r.getSections();
        for (String section : sections) {
            if (child != null && BatchReportSection.NAMES_LEARNERS.contains(section)) continue;
            switch (section) {
                case BatchReportSection.OVERVIEW -> appendTiles(h, r, child);
                case BatchReportSection.RESULTS -> appendResults(h, r, child, brand);
                case BatchReportSection.SUBJECT_PROGRESS -> appendSubjects(h, r, brand);
                case BatchReportSection.TOP_PERFORMERS -> appendTopPerformers(h, r);
                case BatchReportSection.NEEDS_ATTENTION -> appendLearnerTable(h, "Needs attention",
                        "Below the pass mark first, then learners yet to attempt a quiz.", needsAttention(r), r);
                case BatchReportSection.LEARNER_RESULTS -> appendLearnerTable(h, "All learners",
                        "Every learner with their average quiz score.", r.getLearners(), r);
                case BatchReportSection.ACTIVITY -> appendActivity(h, r, brand);
                default -> {
                }
            }
        }
        h.append("</div><div class=\"foot\">").append(esc(joinNonBlank(" · ", r.getInstituteName(), r.getBatchName(), dateLabel(r))))
                .append("</div></body></html>");
        return h.toString();
    }

    private void appendBatchHero(StringBuilder h, BatchSummaryReportDTO r) {
        String headline;
        if (r.getEnrolledLearners() == 0) headline = "No learners in this batch yet";
        else if (r.getLearnersAttempted() == 0) headline = "No quiz attempts yet";
        else headline = r.getPassedLearners() + " of " + r.getEnrolledLearners() + " learners passed";
        String sub = r.getAvgQuizScore() == null ? "" : "Average quiz score " + pct(r.getAvgQuizScore())
                + " across " + r.getQuizzesInCourse() + (r.getQuizzesInCourse() == 1 ? " quiz." : " quizzes.");
        hero(h, esc(r.getBatchName() == null ? "Batch report" : r.getBatchName()), headline, sub,
                r.getPassRate() == null ? "—" : Math.round(r.getPassRate()) + "%", "passed",
                r.getAvgCourseCompletion(), "Course completion " + pct(r.getAvgCourseCompletion()));
    }

    private void appendChildHero(StringBuilder h, BatchSummaryReportDTO r, BatchSummaryReportDTO.LearnerRow c) {
        String headline = switch (c.getStatus() == null ? "" : c.getStatus()) {
            case "PASSED" -> c.getAvgScorePercent() != null && r.getAvgQuizScore() != null
                    && c.getAvgScorePercent() >= r.getAvgQuizScore() ? "Above the batch average" : "Passing, with room to grow";
            case "FAILED" -> "Let us build on this";
            default -> "Yet to attempt a quiz";
        };
        String sub = c.getQuizzesAttempted() + " of " + c.getQuizzesInCourse() + " quizzes attempted"
                + (r.getAvgQuizScore() != null ? " · batch average " + pct(r.getAvgQuizScore()) : "") + ".";
        hero(h, esc(firstName(c.getFullName())) + "&#8217;s progress", headline, sub,
                c.getAvgScorePercent() == null ? "—" : Math.round(c.getAvgScorePercent()) + "%", "average score",
                r.getAvgCourseCompletion(), "Batch course completion " + pct(r.getAvgCourseCompletion()));
    }

    private void hero(StringBuilder h, String kickerHtml, String headline, String sub, String big, String bigLabel,
                      Double track, String trackLabel) {
        h.append("<div class=\"hero\"><table class=\"hero-t\"><tr><td><div class=\"kicker\">").append(kickerHtml)
                .append("</div><div class=\"h1\">").append(esc(headline)).append("</div>");
        if (StringUtils.hasText(sub)) h.append("<div class=\"hero-p\">").append(esc(sub)).append("</div>");
        h.append("</td><td class=\"hero-r\"><div class=\"big\">").append(esc(big)).append("</div><div class=\"big-sub\">")
                .append(esc(bigLabel)).append("</div></td></tr></table>");
        if (track != null) {
            h.append("<div class=\"track-l\">").append(esc(trackLabel)).append("</div><div class=\"track\"><div class=\"track-f\" style=\"width:")
                    .append(Math.max(2, Math.min(100, Math.round(track)))).append("%\"></div></div>");
        }
        h.append("</div>");
    }

    private void appendTiles(StringBuilder h, BatchSummaryReportDTO r, BatchSummaryReportDTO.LearnerRow child) {
        h.append("<table class=\"tiles\"><tr>");
        if (child != null) {
            h.append(tile(pct(child.getAvgScorePercent()), "average quiz score", scoreColor(child.getAvgScorePercent())))
                    .append(tile(child.getQuizzesAttempted() + "/" + child.getQuizzesInCourse(), "quizzes attempted", BatchReportCharts.INK))
                    .append(tile(pct(r.getAvgQuizScore()), "batch average", BatchReportCharts.INK))
                    .append(tile(pct(r.getAvgCourseCompletion()), "batch course completion", BatchReportCharts.INK));
        } else {
            h.append(tile(String.valueOf(r.getEnrolledLearners()), "learners", BatchReportCharts.INK))
                    .append(tile(pct(r.getAvgQuizScore()), "average quiz score", scoreColor(r.getAvgQuizScore())))
                    .append(tile(minutes(r.getAvgTimeSpentMinutes()), "avg time per learner", BatchReportCharts.INK))
                    .append(tile(pct(r.getAvgConcentration()), "concentration", BatchReportCharts.INK));
        }
        h.append("</tr></table>");
    }

    private void appendResults(StringBuilder h, BatchSummaryReportDTO r, BatchSummaryReportDTO.LearnerRow child, String brand) {
        String donut = BatchReportCharts.donut(List.of(
                        new BatchReportCharts.Slice("Passed", r.getPassedLearners(), BatchReportCharts.GOOD),
                        new BatchReportCharts.Slice("Failed", r.getFailedLearners(), BatchReportCharts.BAD),
                        new BatchReportCharts.Slice("Not attempted", r.getNotAttemptedLearners(), BatchReportCharts.NEUTRAL)),
                pct(r.getPassRate()), "passed", 140);
        long enrolled = Math.max(r.getEnrolledLearners(), 1);
        String legend = "<table class=\"legend\">"
                + legendRow("Passed", r.getPassedLearners(), enrolled, BatchReportCharts.GOOD)
                + legendRow("Failed", r.getFailedLearners(), enrolled, BatchReportCharts.BAD)
                + legendRow("Not attempted", r.getNotAttemptedLearners(), enrolled, BatchReportCharts.NEUTRAL)
                + "</table>";

        int[] counts = new int[10];
        for (BatchSummaryReportDTO.LearnerRow l : nonNull(r.getLearners())) {
            if (l.getAvgScorePercent() != null) counts[BatchReportCharts.bucketOf(l.getAvgScorePercent())]++;
        }
        boolean placed = child != null && child.getAvgScorePercent() != null;
        int mine = placed ? BatchReportCharts.bucketOf(child.getAvgScorePercent()) : -1;
        String pill = placed ? firstName(child.getFullName()) + " · " + Math.round(child.getAvgScorePercent()) + "%" : null;
        String histogram = BatchReportCharts.histogram(counts, mine, pill, brand, 330);

        String resultsHead = r.getEnrolledLearners() == 0 ? "No learners yet"
                : pct(r.getPassRate()) + " passed, " + r.getNotAttemptedLearners() + " yet to attempt";
        h.append("<table class=\"cols\"><tr><td class=\"col\">")
                .append(block("Results", esc(resultsHead), "Pass mark: " + fmt(r.getPassPercentage()) + "% average quiz score.",
                        "<table class=\"donut\"><tr><td class=\"donut-c\">" + donut + "</td><td>" + legend + "</td></tr></table>"))
                .append("</td><td class=\"col-gap\"></td><td class=\"col\">")
                .append(block("Where learners stand",
                        child != null ? "Where " + esc(firstName(child.getFullName())) + " stands" : "Spread of quiz scores",
                        child != null ? "Learners in each score range. Other learners are counted, never named."
                                : "Learners in each score range.",
                        histogram))
                .append("</td></tr></table>");
    }

    private void appendSubjects(StringBuilder h, BatchSummaryReportDTO r, String brand) {
        List<BatchSummaryReportDTO.SubjectRow> subjects = nonNull(r.getSubjects());
        if (subjects.isEmpty()) {
            h.append(block("Subject progress", "No subject progress yet", null, ""));
            return;
        }
        BatchSummaryReportDTO.SubjectRow top = subjects.stream()
                .max(Comparator.comparing(BatchSummaryReportDTO.SubjectRow::getAvgCompletion,
                        Comparator.nullsFirst(Comparator.naturalOrder())))
                .orElse(subjects.get(0));
        StringBuilder bars = new StringBuilder();
        for (BatchSummaryReportDTO.SubjectRow s : subjects) {
            bars.append(bar(s.getSubjectName(), esc(minutes(s.getAvgTimeMinutes())) + " · <b>" + pct(s.getAvgCompletion()) + "</b>",
                    s.getAvgCompletion(), 100, brand));
        }
        h.append(block("Subject progress", "Furthest along in " + esc(top.getSubjectName()),
                "Average completion and time per learner in each subject.", bars.toString()));
    }

    private void appendTopPerformers(StringBuilder h, BatchSummaryReportDTO r) {
        List<BatchSummaryReportDTO.LearnerRow> top = nonNull(r.getLearners()).stream()
                .filter(l -> l.getAvgScorePercent() != null).limit(HIGHLIGHT_ROWS).toList();
        if (top.isEmpty()) {
            h.append(block("Top performers", "No quiz scores yet", null, ""));
            return;
        }
        StringBuilder bars = new StringBuilder();
        for (BatchSummaryReportDTO.LearnerRow l : top) {
            bars.append(bar(l.getFullName(), "<b>" + pct(l.getAvgScorePercent()) + "</b>", l.getAvgScorePercent(), 100,
                    scoreColor(l.getAvgScorePercent())));
        }
        h.append(block("Top performers", esc(top.get(0).getFullName()) + " leads with " + pct(top.get(0).getAvgScorePercent()),
                "Highest average quiz scores.", bars.toString()));
    }

    private void appendLearnerTable(StringBuilder h, String title, String lede, List<BatchSummaryReportDTO.LearnerRow> rows,
                                    BatchSummaryReportDTO r) {
        if (rows.isEmpty()) {
            h.append(block(title, "Nobody to show", null, ""));
            return;
        }
        StringBuilder t = new StringBuilder("<table class=\"grid\"><tr><th>Learner</th><th class=\"num\">Avg quiz score</th>")
                .append("<th class=\"num\">Quizzes</th><th>Result</th></tr>");
        for (BatchSummaryReportDTO.LearnerRow l : rows) {
            t.append("<tr><td>").append(esc(l.getFullName())).append("</td><td class=\"num\">")
                    .append(pct(l.getAvgScorePercent())).append("</td><td class=\"num\">")
                    .append(l.getQuizzesAttempted()).append(" / ").append(l.getQuizzesInCourse())
                    .append("</td><td>").append(statusLabel(l.getStatus())).append("</td></tr>");
        }
        t.append("</table>");
        if (r.isLearnersTruncated() && rows == r.getLearners()) {
            t.append("<div class=\"cap\">The batch is larger than the report shows; only the first learners are listed.</div>");
        }
        h.append(block(title, rows.size() + (rows.size() == 1 ? " learner" : " learners"), lede, t.toString()));
    }

    private void appendActivity(StringBuilder h, BatchSummaryReportDTO r, String brand) {
        List<BatchSummaryReportDTO.ActivityRow> rows = nonNull(r.getActivity());
        if (rows.isEmpty()) {
            h.append(block("Most active", "No learning activity in these dates", null, ""));
            return;
        }
        double max = rows.stream().map(BatchSummaryReportDTO.ActivityRow::getTotalTimeMinutes)
                .filter(Objects::nonNull).mapToDouble(Double::doubleValue).max().orElse(1);
        StringBuilder bars = new StringBuilder();
        for (BatchSummaryReportDTO.ActivityRow a : rows) {
            String meta = (a.getAvgConcentration() != null ? Math.round(a.getAvgConcentration()) + "% focus · " : "")
                    + "<b>" + esc(minutes(a.getTotalTimeMinutes())) + "</b>";
            bars.append(bar(a.getFullName(), meta, a.getTotalTimeMinutes(), Math.max(max, 1), brand));
        }
        h.append(block("Most active", esc(rows.get(0).getFullName()) + " spent the most time learning",
                "Time spent learning in the selected dates.", bars.toString()));
    }

    // ── document pieces ──

    private static String block(String tag, String headHtml, String lede, String body) {
        return "<div class=\"block\"><div class=\"tag\">" + esc(tag) + "</div><div class=\"h2\">" + headHtml + "</div>"
                + (lede == null ? "" : "<div class=\"lede\">" + esc(lede) + "</div>") + body + "</div>";
    }

    private static String bar(String label, String metaHtml, Double value, double max, String color) {
        long w = value == null ? 0 : Math.max(2, Math.min(100, Math.round(value * 100 / max)));
        return "<table class=\"brow\"><tr><td class=\"bname\">" + esc(label) + "</td><td class=\"bmeta\">" + metaHtml
                + "</td></tr></table><div class=\"bar\"><div class=\"bar-f\" style=\"width:" + w + "%;background:" + color
                + "\"></div></div>";
    }

    private static String legendRow(String label, long count, long enrolled, String color) {
        return "<tr><td class=\"sw-c\"><div class=\"sw\" style=\"background:" + color + "\"></div></td><td>" + label
                + "</td><td class=\"num\"><b>" + count + "</b></td><td class=\"num muted\">"
                + pct(round1(count * 100.0 / enrolled)) + "</td></tr>";
    }

    private static String tile(String value, String label, String color) {
        return "<td class=\"tile\"><div class=\"tile-v\" style=\"color:" + color + "\">" + esc(value)
                + "</div><div class=\"tile-l\">" + esc(label) + "</div></td>";
    }

    private static String scoreColor(Double v) {
        if (v == null) return BatchReportCharts.MUTED;
        return v >= 60 ? BatchReportCharts.GOOD : v >= 40 ? BatchReportCharts.WARN : BatchReportCharts.BAD;
    }

    private static String css(String brand) {
        String soft = tint(brand, 0.85), softer = tint(brand, 0.94);
        return "@page{size:A4;margin:0;}"
                + "body{font-family:Helvetica,Arial,sans-serif;color:#1f2937;font-size:11px;margin:0;}"
                + "table{border-collapse:collapse;width:100%;}td{vertical-align:top;}"
                + ".band{background:" + brand + ";color:#ffffff;}.band td{padding:18px 0;vertical-align:middle;}"
                + ".band-logo{width:76px;padding-left:32px !important;}"
                + ".logo{width:42px;height:42px;line-height:42px;border-radius:8px;background:#ffffff;color:" + brand
                + ";font-weight:bold;font-size:16px;text-align:center;}"
                + ".band-i1{font-size:14px;font-weight:bold;}.band-i2{font-size:10px;}"
                + ".band-r{text-align:right;padding-right:32px !important;}.band-r1{font-size:15px;font-weight:bold;}.band-r2{font-size:10px;}"
                + ".body{padding:18px 32px 8px 32px;}"
                + ".hero{border:1px solid " + soft + ";background:" + softer + ";border-radius:12px;padding:16px 18px;margin-bottom:12px;}"
                + ".hero-t td{vertical-align:middle;}.hero-r{text-align:right;width:150px;}"
                + ".kicker{font-size:9px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:" + brand + ";}"
                + ".h1{font-size:22px;font-weight:bold;color:#111827;margin-top:2px;}.hero-p{font-size:11px;color:#4b5563;margin-top:3px;}"
                + ".big{font-size:40px;font-weight:bold;color:" + brand + ";line-height:1;}.big-sub{font-size:10px;color:#6b7280;margin-top:3px;}"
                + ".track-l{font-size:10px;color:#4b5563;margin-top:10px;}"
                + ".track{height:7px;background:#ffffff;border:1px solid #e5e7eb;border-radius:4px;margin-top:4px;}"
                + ".track-f{height:7px;background:" + brand + ";border-radius:4px;}"
                + ".tiles{margin-bottom:12px;}.tiles td{border:1px solid #e5e7eb;padding:10px 12px;width:25%;}"
                + ".tile-v{font-size:20px;font-weight:bold;}.tile-l{font-size:10px;color:#6b7280;margin-top:2px;}"
                + ".block{border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:12px;page-break-inside:avoid;}"
                + ".tag{font-size:8.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:" + brand + ";}"
                + ".h2{font-size:14px;font-weight:bold;color:#111827;margin:2px 0 2px 0;}.lede{font-size:10px;color:#6b7280;margin-bottom:8px;}"
                + ".cols .col{width:49%;}.col-gap{width:2%;}.cols .block{min-height:236px;}"
                + ".donut td{vertical-align:middle;}.donut-c{width:150px;}"
                + ".legend td{padding:4px 2px;font-size:11px;}.sw-c{width:16px;}.sw{width:10px;height:10px;border-radius:2px;}"
                + ".num{text-align:right;}.muted{color:#6b7280;}"
                + ".brow td{padding:4px 0 2px 0;font-size:11px;}.bname{color:#374151;}.bmeta{text-align:right;color:#6b7280;white-space:nowrap;}"
                + ".bar{height:7px;background:#f1f5f9;border-radius:4px;margin-bottom:4px;}.bar-f{height:7px;border-radius:4px;}"
                + ".grid th,.grid td{padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:10.5px;}"
                + ".grid th{background:#f8fafc;color:#374151;font-size:10px;}.grid td.num,.grid th.num{text-align:right;}"
                + ".passed{color:#15803d;font-weight:bold;}.failed{color:#b91c1c;font-weight:bold;}.na{color:#6b7280;}"
                + ".cap{font-size:9.5px;color:#6b7280;margin-top:6px;}"
                + ".foot{padding:8px 32px 18px 32px;font-size:9px;color:#9ca3af;}";
    }

    private static String brand(BatchSummaryReportDTO r) {
        String c = r.getBrandColor();
        return c != null && c.matches("#[0-9a-fA-F]{6}") ? c : DEFAULT_BRAND;
    }

    private static String tint(String hex, double amount) {
        int n = Integer.parseInt(hex.substring(1), 16);
        int red = (n >> 16) & 255, green = (n >> 8) & 255, blue = n & 255;
        return String.format("#%02x%02x%02x",
                Math.round(red + (255 - red) * amount),
                Math.round(green + (255 - green) * amount),
                Math.round(blue + (255 - blue) * amount));
    }

    private static String initials(String name) {
        if (!StringUtils.hasText(name)) return "R";
        StringBuilder s = new StringBuilder();
        for (String w : name.trim().split("\\s+")) {
            if (!w.isEmpty() && s.length() < 2) s.append(Character.toUpperCase(w.charAt(0)));
        }
        return s.toString();
    }

    private static String firstName(String full) {
        if (!StringUtils.hasText(full)) return "Your child";
        return full.trim().split("\\s+")[0];
    }

    /** Short email-safe body; the full report with charts travels as the PDF attachment. */
    private String emailBody(BatchSummaryReportDTO r, BatchSummaryReportDTO.LearnerRow child) {
        String brand = brand(r);
        StringBuilder h = new StringBuilder("<div style=\"font-family:Helvetica,Arial,sans-serif;color:#1f2937;font-size:14px;max-width:560px;\">");
        h.append("<div style=\"background:").append(brand).append(";color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0;\">")
                .append("<div style=\"font-size:16px;font-weight:bold;\">").append(esc(r.getInstituteName())).append("</div>")
                .append("<div style=\"font-size:12px;\">").append(esc(joinNonBlank(" · ", r.getBatchName(), dateLabel(r)))).append("</div></div>")
                .append("<div style=\"border:1px solid #e5e7eb;border-top:0;padding:18px 20px;border-radius:0 0 10px 10px;\">");
        if (child != null) {
            h.append("<p>Here is the progress report for <b>").append(esc(child.getFullName())).append("</b>.</p>")
                    .append("<table style=\"border-collapse:collapse;margin:8px 0 14px 0;\"><tr>")
                    .append(emailStat(pct(child.getAvgScorePercent()), "average quiz score", scoreColor(child.getAvgScorePercent())))
                    .append(emailStat(child.getQuizzesAttempted() + "/" + child.getQuizzesInCourse(), "quizzes attempted", BatchReportCharts.INK))
                    .append(emailStat(pct(r.getAvgQuizScore()), "batch average", BatchReportCharts.INK))
                    .append("</tr></table>");
        } else {
            h.append("<p>Here is the batch report for <b>").append(esc(r.getBatchName())).append("</b>.</p>")
                    .append("<table style=\"border-collapse:collapse;margin:8px 0 14px 0;\"><tr>")
                    .append(emailStat(pct(r.getPassRate()), "passed", BatchReportCharts.GOOD))
                    .append(emailStat(pct(r.getAvgQuizScore()), "average quiz score", scoreColor(r.getAvgQuizScore())))
                    .append(emailStat(pct(r.getAvgCourseCompletion()), "course completion", brand))
                    .append("</tr></table>");
        }
        h.append("<p style=\"color:#6b7280;font-size:13px;\">The full report with charts is attached as a PDF.</p></div></div>");
        return h.toString();
    }

    private static String emailStat(String value, String label, String color) {
        return "<td style=\"padding:0 22px 0 0;\"><div style=\"font-size:22px;font-weight:bold;color:" + color + ";\">" + esc(value)
                + "</div><div style=\"font-size:11px;color:#6b7280;\">" + esc(label) + "</div></td>";
    }

    // ── sending ─────────────────────────────────────────────────────────────────

    public BatchSummaryReportDTO.SendResult send(String instituteId, BatchSummaryReportRequest request,
                                                 CustomUserDetails user) {
        String audience = request.getAudience() == null ? "" : request.getAudience().trim().toUpperCase(Locale.ROOT);
        if (!AUDIENCE_TEACHERS.equals(audience) && !AUDIENCE_PARENTS.equals(audience)) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "audience must be TEACHERS or PARENTS");
        }
        BatchSummaryReportDTO report = summarize(instituteId, request, user);
        String subjectSuffix = joinNonBlank(" · ", report.getBatchName(), dateLabel(report));
        return AUDIENCE_TEACHERS.equals(audience)
                ? sendToTeachers(instituteId, report, subjectSuffix)
                : sendToParents(instituteId, report, subjectSuffix);
    }

    private BatchSummaryReportDTO.SendResult sendToTeachers(String instituteId, BatchSummaryReportDTO report,
                                                            String subjectSuffix) {
        List<String> teacherIds = facultyMappingRepository
                .findRealTeachersByPackageSessionId(report.getPackageSessionId()).stream()
                .map(FacultySubjectPackageSessionMapping::getUserId)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
        List<String> notes = new ArrayList<>();
        if (teacherIds.isEmpty()) {
            notes.add("No teachers are assigned to this batch.");
            return BatchSummaryReportDTO.SendResult.builder().audience(AUDIENCE_TEACHERS).notes(notes).build();
        }
        byte[] pdf = toPdf(renderHtml(report, null), report.getPackageSessionId());
        String body = emailBody(report, null);
        String subject = "Batch report: " + subjectSuffix;
        String fileName = fileName(report.getBatchName(), "batch-report");
        int sent = 0, skipped = 0;
        for (UserDTO teacher : authService.getUsersFromAuthServiceByUserIds(teacherIds)) {
            if (teacher == null || !StringUtils.hasText(teacher.getEmail())) {
                skipped++;
                continue;
            }
            if (sendEmail(teacher.getEmail(), teacher.getId(), subject, body, pdf, fileName, instituteId, report)) sent++;
            else skipped++;
        }
        if (skipped > 0) notes.add(skipped + " teacher(s) could not be emailed (no email address or the send failed).");
        return BatchSummaryReportDTO.SendResult.builder()
                .audience(AUDIENCE_TEACHERS).sent(sent).skipped(skipped).notes(notes).build();
    }

    private BatchSummaryReportDTO.SendResult sendToParents(String instituteId, BatchSummaryReportDTO report,
                                                           String subjectSuffix) {
        List<BatchSummaryReportDTO.LearnerRow> learners = nonNull(report.getLearners());
        Map<String, Student> students = new LinkedHashMap<>();
        List<String> ids = learners.stream().map(BatchSummaryReportDTO.LearnerRow::getUserId)
                .filter(Objects::nonNull).toList();
        if (!ids.isEmpty()) {
            for (Student s : studentRepository.findByUserIdIn(ids)) {
                // A learner can have several student rows; keep the one that carries a parent email.
                Student existing = students.get(s.getUserId());
                if (existing == null || parentEmails(existing).isEmpty()) students.put(s.getUserId(), s);
            }
        }
        int sent = 0, noEmail = 0, failed = 0;
        for (BatchSummaryReportDTO.LearnerRow learner : learners) {
            Student student = students.get(learner.getUserId());
            Set<String> emails = student == null ? Set.of() : parentEmails(student);
            if (emails.isEmpty()) {
                noEmail++;
                continue;
            }
            byte[] pdf;
            try {
                pdf = toPdf(renderHtml(report, learner), report.getPackageSessionId());
            } catch (Exception e) {
                failed++;
                continue;
            }
            String body = emailBody(report, learner);
            String subject = "Progress report for " + learner.getFullName() + ": " + subjectSuffix;
            String fileName = fileName(learner.getFullName(), "progress-report");
            boolean any = false;
            for (String email : emails) {
                any |= sendEmail(email, null, subject, body, pdf, fileName, instituteId, report);
            }
            if (any) sent++;
            else failed++;
        }
        List<String> notes = new ArrayList<>();
        if (noEmail > 0) notes.add(noEmail + " learner(s) have no parent email on their profile.");
        if (failed > 0) notes.add(failed + " parent email(s) could not be sent.");
        if (report.isLearnersTruncated()) notes.add("The batch is larger than one report covers; only the first learners were included.");
        return BatchSummaryReportDTO.SendResult.builder()
                .audience(AUDIENCE_PARENTS).sent(sent).skipped(noEmail + failed).notes(notes).build();
    }

    private boolean sendEmail(String to, String userId, String subject, String body, byte[] pdf, String fileName,
                              String instituteId, BatchSummaryReportDTO report) {
        try {
            AttachmentUsersDTO.AttachmentDTO attachment = new AttachmentUsersDTO.AttachmentDTO();
            attachment.setAttachmentName(fileName);
            attachment.setAttachment(Base64.getEncoder().encodeToString(pdf));
            AttachmentUsersDTO recipient = new AttachmentUsersDTO();
            recipient.setChannelId(to);
            recipient.setUserId(userId);
            recipient.setPlaceholders(Map.of("email", to));
            recipient.setAttachments(List.of(attachment));
            notificationService.sendAttachmentEmailViaUnified(List.of(AttachmentNotificationDTO.builder()
                    .subject(subject)
                    .body(body)
                    .notificationType("EMAIL")
                    .emailType("UTILITY_EMAIL")
                    .source("BATCH_REPORT")
                    .sourceId(report.getPackageSessionId())
                    .attachmentName(fileName)
                    .users(List.of(recipient))
                    .build()), instituteId);
            return true;
        } catch (Exception e) {
            log.warn("[batch-summary] email to {} failed: {}", to, e.getMessage());
            return false;
        }
    }

    private static String fileName(String name, String fallback) {
        String base = name == null ? "" : name.replaceAll("[^A-Za-z0-9 _-]", "").trim().replaceAll("\\s+", "-");
        return (base.isEmpty() ? fallback : base + "-" + fallback) + ".pdf";
    }

    private static Set<String> parentEmails(Student s) {
        Set<String> out = new LinkedHashSet<>();
        for (String e : new String[]{s.getParentsEmail(), s.getParentsToMotherEmail(), s.getGuardianEmail()}) {
            if (StringUtils.hasText(e) && e.contains("@")) out.add(e.trim().toLowerCase(Locale.ROOT));
        }
        return out;
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private void validate(String instituteId, BatchSummaryReportRequest r) {
        if (r == null || !StringUtils.hasText(r.getPackageSessionId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Pick a batch");
        }
        if (r.getStartDate() == null || r.getEndDate() == null) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Pick a start and end date");
        }
        if (r.getStartDate().isAfter(r.getEndDate())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "The start date is after the end date");
        }
        if (ChronoUnit.DAYS.between(r.getStartDate(), r.getEndDate()) > MAX_RANGE_DAYS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "Pick a range of at most " + MAX_RANGE_DAYS + " days");
        }
        String owner = packageSessionRepository.findInstituteIdByPackageSessionId(r.getPackageSessionId()).orElse(null);
        if (!instituteId.equals(owner)) {
            throw new VacademyException(HttpStatus.NOT_FOUND, "Batch not found");
        }
    }

    public BatchReportSettingConfig loadSetting(String instituteId) {
        try {
            Object data = instituteSettingService.getSettingByInstituteIdAndKey(instituteId, BatchReportSettingConfig.SETTING_KEY);
            if (data != null) return objectMapper.convertValue(data, BatchReportSettingConfig.class);
        } catch (Exception e) {
            log.debug("[batch-summary] no readable {} for institute {}: {}",
                    BatchReportSettingConfig.SETTING_KEY, instituteId, e.getMessage());
        }
        return new BatchReportSettingConfig();
    }

    private static List<String> sectionsFor(BatchSummaryReportRequest request, BatchReportSettingConfig setting) {
        if (request.getSections() == null || request.getSections().isEmpty()) return setting.resolvedSections();
        BatchReportSettingConfig picked = new BatchReportSettingConfig();
        picked.setSections(request.getSections());
        return picked.resolvedSections();
    }

    private Institute institute(String instituteId) {
        try {
            return instituteRepository.findById(instituteId).orElse(null);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<BatchSummaryReportDTO.LearnerRow> needsAttention(BatchSummaryReportDTO r) {
        List<BatchSummaryReportDTO.LearnerRow> out = new ArrayList<>(r.getLearners().stream()
                .filter(l -> !"PASSED".equals(l.getStatus())).toList());
        // Failed (lowest score first) before not attempted.
        out.sort(Comparator.comparing((BatchSummaryReportDTO.LearnerRow l) -> "NOT_ATTEMPTED".equals(l.getStatus()))
                .thenComparing(BatchSummaryReportDTO.LearnerRow::getAvgScorePercent,
                        Comparator.nullsLast(Comparator.naturalOrder())));
        return out.size() > HIGHLIGHT_ROWS ? out.subList(0, HIGHLIGHT_ROWS) : out;
    }

    private static String dateLabel(BatchSummaryReportDTO r) {
        if (r.getStartDate() == null || r.getEndDate() == null) return "";
        return r.getStartDate().format(DATE_LABEL) + " – " + r.getEndDate().format(DATE_LABEL);
    }

    private static String statusLabel(String status) {
        if ("PASSED".equals(status)) return "<span class=\"passed\">Passed</span>";
        if ("FAILED".equals(status)) return "<span class=\"failed\">Failed</span>";
        return "<span class=\"na\">Not attempted</span>";
    }

    private static String pct(Double v) {
        return v == null ? "—" : fmt(v) + "%";
    }

    private static String minutes(Double v) {
        if (v == null) return "—";
        long m = Math.round(v);
        return m < 60 ? m + " min" : (m / 60) + "h " + String.format("%02d", m % 60) + "m";
    }

    private static String fmt(double v) {
        return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(round1(v));
    }

    private static String esc(String s) {
        return s == null ? "" : HtmlUtils.htmlEscape(s, StandardCharsets.UTF_8.name());
    }

    private static String joinNonBlank(String sep, String... parts) {
        List<String> kept = new ArrayList<>();
        for (String p : parts) if (StringUtils.hasText(p)) kept.add(p.trim());
        return String.join(sep, kept);
    }

    private static Double average(List<Double> values) {
        double sum = 0;
        int n = 0;
        for (Double v : values) {
            if (v != null) {
                sum += v;
                n++;
            }
        }
        return n == 0 ? null : sum / n;
    }

    private static Double round1(Double v) {
        return v == null ? null : Math.round(v * 10.0) / 10.0;
    }

    private static <T> List<T> nonNull(List<T> list) {
        return list == null ? List.of() : list;
    }
}
