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
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.entity.Institute;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
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

        BatchSummaryReportDTO.BatchSummaryReportDTOBuilder out = BatchSummaryReportDTO.builder()
                .packageSessionId(batchId)
                .batchName(request.getBatchName())
                .instituteName(instituteName(instituteId))
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
        String html = renderHtml(instituteId, request, user);
        try (ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            HtmlConverter.convertToPdf(html, outputStream, new ConverterProperties());
            return outputStream.toByteArray();
        } catch (Exception e) {
            log.error("[batch-summary] PDF render failed for batch {}", request.getPackageSessionId(), e);
            throw new VacademyException("Could not create the PDF for this report");
        }
    }

    /**
     * @param child non-null for a parent's copy: sections naming other learners are dropped
     *              and this learner's own results are added.
     */
    String renderHtml(BatchSummaryReportDTO r, BatchSummaryReportDTO.LearnerRow child) {
        StringBuilder h = new StringBuilder(8_000);
        h.append("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><style>")
                .append("body{font-family:Helvetica,Arial,sans-serif;color:#1f2937;font-size:12px;margin:24px;}")
                .append("h1{font-size:20px;margin:0 0 4px 0;}h2{font-size:14px;margin:22px 0 8px 0;color:#111827;}")
                .append(".muted{color:#6b7280;}.note{color:#6b7280;font-size:10px;margin-top:4px;}")
                .append("table{width:100%;border-collapse:collapse;}th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #e5e7eb;}")
                .append("th{background:#f3f4f6;font-size:11px;color:#374151;}td.num,th.num{text-align:right;}")
                .append(".tiles td{border:1px solid #e5e7eb;padding:10px;width:25%;vertical-align:top;}")
                .append(".tile-label{font-size:10px;color:#6b7280;text-transform:uppercase;}.tile-value{font-size:18px;font-weight:bold;}")
                .append(".passed{color:#15803d;font-weight:bold;}.failed{color:#b91c1c;font-weight:bold;}.na{color:#6b7280;}")
                .append("</style></head><body>");

        h.append("<h1>").append(esc(child != null ? "Progress report: " + child.getFullName() : "Batch report"))
                .append("</h1><div class=\"muted\">")
                .append(esc(joinNonBlank(" · ", r.getInstituteName(), r.getBatchName())))
                .append("<br/>").append(esc(dateLabel(r))).append("</div>");

        if (child != null) {
            appendChild(h, r, child);
        }

        List<String> sections = r.getSections() == null ? BatchReportSettingConfig.ALL_SECTIONS : r.getSections();
        for (String section : sections) {
            if (child != null && BatchReportSection.NAMES_LEARNERS.contains(section)) continue;
            switch (section) {
                case BatchReportSection.OVERVIEW -> appendOverview(h, r, child != null);
                case BatchReportSection.RESULTS -> appendResults(h, r);
                case BatchReportSection.SUBJECT_PROGRESS -> appendSubjects(h, r);
                case BatchReportSection.TOP_PERFORMERS -> appendLearnerTable(h, "Top performers",
                        r.getLearners().stream().filter(l -> l.getAvgScorePercent() != null)
                                .limit(HIGHLIGHT_ROWS).toList(), r);
                case BatchReportSection.NEEDS_ATTENTION -> appendLearnerTable(h, "Needs attention",
                        needsAttention(r), r);
                case BatchReportSection.LEARNER_RESULTS -> appendLearnerTable(h, "All learners", r.getLearners(), r);
                case BatchReportSection.ACTIVITY -> appendActivity(h, r);
                default -> {
                }
            }
        }
        h.append("<p class=\"note\">Pass / fail is the learner's average quiz score against a pass mark of ")
                .append(fmt(r.getPassPercentage())).append("%, across every quiz attempt to date. ")
                .append("Course completion, time and concentration are for the dates above.</p>");
        h.append("</body></html>");
        return h.toString();
    }

    private void appendChild(StringBuilder h, BatchSummaryReportDTO r, BatchSummaryReportDTO.LearnerRow c) {
        h.append("<h2>Result</h2><table class=\"tiles\"><tr>")
                .append(tile("Status", statusLabel(c.getStatus())))
                .append(tile("Average quiz score", pct(c.getAvgScorePercent())))
                .append(tile("Quizzes attempted", c.getQuizzesAttempted() + " of " + c.getQuizzesInCourse()))
                .append(tile("Batch average", pct(r.getAvgQuizScore())))
                .append("</tr></table>");
    }

    private void appendOverview(StringBuilder h, BatchSummaryReportDTO r, boolean forParent) {
        h.append("<h2>").append(forParent ? "How the batch is doing" : "Overview").append("</h2>")
                .append("<table class=\"tiles\"><tr>")
                .append(tile("Learners", String.valueOf(r.getEnrolledLearners())))
                .append(tile("Passed", pct(r.getPassRate())))
                .append(tile("Average quiz score", pct(r.getAvgQuizScore())))
                .append(tile("Course completion", pct(r.getAvgCourseCompletion())))
                .append("</tr><tr>")
                .append(tile("Avg time per learner", minutes(r.getAvgTimeSpentMinutes())))
                .append(tile("Avg concentration", pct(r.getAvgConcentration())))
                .append(tile("Quizzes in course", String.valueOf(r.getQuizzesInCourse())))
                .append(tile("Pass mark", fmt(r.getPassPercentage()) + "%"))
                .append("</tr></table>");
    }

    private void appendResults(StringBuilder h, BatchSummaryReportDTO r) {
        long enrolled = Math.max(r.getEnrolledLearners(), 1);
        h.append("<h2>Results</h2><table><tr><th>Result</th><th class=\"num\">Learners</th><th class=\"num\">Share</th></tr>")
                .append(resultRow("Passed", r.getPassedLearners(), enrolled))
                .append(resultRow("Failed", r.getFailedLearners(), enrolled))
                .append(resultRow("Not attempted", r.getNotAttemptedLearners(), enrolled))
                .append("</table>");
    }

    private void appendSubjects(StringBuilder h, BatchSummaryReportDTO r) {
        h.append("<h2>Subject progress</h2>");
        if (r.getSubjects() == null || r.getSubjects().isEmpty()) {
            h.append("<p class=\"muted\">No subject progress yet.</p>");
            return;
        }
        h.append("<table><tr><th>Subject</th><th class=\"num\">Avg completion</th><th class=\"num\">Avg time</th></tr>");
        for (BatchSummaryReportDTO.SubjectRow s : r.getSubjects()) {
            h.append("<tr><td>").append(esc(s.getSubjectName())).append("</td><td class=\"num\">")
                    .append(pct(s.getAvgCompletion())).append("</td><td class=\"num\">")
                    .append(minutes(s.getAvgTimeMinutes())).append("</td></tr>");
        }
        h.append("</table>");
    }

    private void appendLearnerTable(StringBuilder h, String title, List<BatchSummaryReportDTO.LearnerRow> rows,
                                    BatchSummaryReportDTO r) {
        h.append("<h2>").append(esc(title)).append("</h2>");
        if (rows.isEmpty()) {
            h.append("<p class=\"muted\">Nobody to show.</p>");
            return;
        }
        h.append("<table><tr><th>Learner</th><th class=\"num\">Avg quiz score</th><th class=\"num\">Quizzes</th><th>Result</th></tr>");
        for (BatchSummaryReportDTO.LearnerRow l : rows) {
            h.append("<tr><td>").append(esc(l.getFullName())).append("</td><td class=\"num\">")
                    .append(pct(l.getAvgScorePercent())).append("</td><td class=\"num\">")
                    .append(l.getQuizzesAttempted()).append(" / ").append(l.getQuizzesInCourse())
                    .append("</td><td>").append(statusLabel(l.getStatus())).append("</td></tr>");
        }
        h.append("</table>");
        if (r.isLearnersTruncated() && rows == r.getLearners()) {
            h.append("<p class=\"note\">The batch is larger than the report shows; only the first learners are listed.</p>");
        }
    }

    private void appendActivity(StringBuilder h, BatchSummaryReportDTO r) {
        h.append("<h2>Most active learners</h2>");
        if (r.getActivity() == null || r.getActivity().isEmpty()) {
            h.append("<p class=\"muted\">No learning activity in these dates.</p>");
            return;
        }
        h.append("<table><tr><th class=\"num\">#</th><th>Learner</th><th class=\"num\">Total time</th>")
                .append("<th class=\"num\">Daily average</th><th class=\"num\">Concentration</th></tr>");
        for (BatchSummaryReportDTO.ActivityRow a : r.getActivity()) {
            h.append("<tr><td class=\"num\">").append(a.getRank() == null ? "" : a.getRank()).append("</td><td>")
                    .append(esc(a.getFullName())).append("</td><td class=\"num\">")
                    .append(minutes(a.getTotalTimeMinutes())).append("</td><td class=\"num\">")
                    .append(minutes(a.getDailyAvgMinutes())).append("</td><td class=\"num\">")
                    .append(pct(a.getAvgConcentration())).append("</td></tr>");
        }
        h.append("</table>");
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
        String html = renderHtml(report, null);
        String subject = "Batch report: " + subjectSuffix;
        int sent = 0, skipped = 0;
        for (UserDTO teacher : authService.getUsersFromAuthServiceByUserIds(teacherIds)) {
            if (teacher == null || !StringUtils.hasText(teacher.getEmail())) {
                skipped++;
                continue;
            }
            if (sendEmail(teacher.getEmail(), subject, html, instituteId)) sent++;
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
            String html = renderHtml(report, learner);
            String subject = "Progress report for " + learner.getFullName() + ": " + subjectSuffix;
            boolean any = false;
            for (String email : emails) {
                any |= sendEmail(email, subject, html, instituteId);
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

    private boolean sendEmail(String to, String subject, String html, String instituteId) {
        try {
            notificationService.sendHtmlEmailViaUnified(to, subject, html, instituteId, null, null, "UTILITY_EMAIL");
            return true;
        } catch (Exception e) {
            log.warn("[batch-summary] email to {} failed: {}", to, e.getMessage());
            return false;
        }
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

    private String instituteName(String instituteId) {
        try {
            return instituteRepository.findById(instituteId).map(Institute::getInstituteName).orElse(null);
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

    private static String tile(String label, String value) {
        return "<td><div class=\"tile-label\">" + esc(label) + "</div><div class=\"tile-value\">" + value + "</div></td>";
    }

    private static String resultRow(String label, long count, long enrolled) {
        return "<tr><td>" + label + "</td><td class=\"num\">" + count + "</td><td class=\"num\">"
                + pct(round1(count * 100.0 / enrolled)) + "</td></tr>";
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
