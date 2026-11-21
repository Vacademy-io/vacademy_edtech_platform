package vacademy.io.admin_core_service.features.student_analysis.service.aggregation;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.*;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.collectors.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.TextStyle;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Layer-1 orchestrator: fans out to the SELECTED domain collectors in parallel and
 * assembles the deterministic {@link ComprehensiveStudentReport} (no LLM).
 *
 * <p>Only the modules the admin requested (see {@link ReportModule}) are queried.
 * An excluded module's collector is never invoked and its section is null.
 *
 * <p>Each collector runs in its own CompletableFuture with an independent try/catch;
 * a collector failure yields its section as "unavailable" without failing the rest.
 * The aggregator has a 60-second wall-clock cap.
 *
 * <p>Identity / institute / period are always produced — they are the report header.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ComprehensiveReportAggregator {

    private static final int COLLECTOR_TIMEOUT_SECONDS = 60;

    private final IdentityCollector identityCollector;
    private final AttendanceCollector attendanceCollector;
    private final LiveClassCollector liveClassCollector;
    private final AcademicsCollector academicsCollector;
    private final ActivityCollector activityCollector;
    private final ProgressCollector progressCollector;
    private final CertificateCollector certificateCollector;
    private final AssignmentCollector assignmentCollector;
    private final DoubtCollector doubtCollector;
    private final LoginCollector loginCollector;
    private final OverviewBuilder overviewBuilder;
    private final SubjectMarksCollector subjectMarksCollector;
    private final LearningInsightsCollector learningInsightsCollector;

    /**
     * @param userId      learner ID
     * @param instituteId institute ID
     * @param batchId     batch/package-session scope (nullable — collectors degrade gracefully)
     * @param startDate   report window start
     * @param endDate     report window end
     * @param modules     the modules to include; null/empty → all modules
     */
    public ComprehensiveStudentReport collect(
            String userId, String instituteId, String batchId,
            LocalDate startDate, LocalDate endDate, Set<String> modules) {
        return collect(userId, instituteId, batchId, startDate, endDate, modules, false);
    }

    /**
     * @param strictBatch the admin picked {@code batchId} on purpose (the Reports tab filter):
     *                    assessments, marks, topics and attendance are limited to that batch.
     *                    Otherwise the batch is only context and those sections cover every batch.
     */
    public ComprehensiveStudentReport collect(
            String userId, String instituteId, String batchId,
            LocalDate startDate, LocalDate endDate, Set<String> modules, boolean strictBatch) {

        final boolean scoped = strictBatch && batchId != null;
        final Set<String> batchSlides = scoped ? subjectMarksCollector.batchSlideIds(batchId) : null;

        final Set<String> mods = (modules == null || modules.isEmpty())
                ? ReportModule.ALL_KEYS : modules;

        log.info("[ComprehensiveReportAggregator] Collecting v2 report for userId={} institute={} [{} - {}] modules={}",
                userId, instituteId, startDate, endDate, mods);

        ExecutorService executor = Executors.newFixedThreadPool(Math.max(2, Math.min(10, mods.size() + 1)));

        try {
            // Identity is always collected (report header).
            CompletableFuture<StudentIdentitySection> identityFuture =
                    CompletableFuture.supplyAsync(() -> identityCollector.collect(userId, batchId), executor);

            // Institute is always collected (report header).
            CompletableFuture<InstituteSection> instituteFuture =
                    CompletableFuture.supplyAsync(() -> identityCollector.collectInstitute(instituteId), executor);

            // Selected modules only — excluded ones stay null and are never queried.
            CompletableFuture<AttendanceSection> attendanceFuture = has(mods, ReportModule.ATTENDANCE)
                    ? CompletableFuture.supplyAsync(() -> attendanceCollector.collect(userId, batchId, startDate, endDate, scoped), executor)
                    : null;

            // No `batchId != null` gate: the query treats a null batch as "all of the learner's
            // batches", so gating here skipped the whole section for a learner opened without batch
            // context — reporting no live classes for someone who attended plenty.
            CompletableFuture<LiveClassesSection> liveClassFuture = has(mods, ReportModule.LIVE_CLASSES)
                    ? CompletableFuture.supplyAsync(() -> liveClassCollector.collect(userId, batchId, startDate, endDate), executor)
                    : null;

            CompletableFuture<AcademicsSection> academicsFuture = has(mods, ReportModule.ACADEMICS)
                    ? CompletableFuture.supplyAsync(() -> academicsCollector.collect(
                            userId, instituteId, scoped ? batchId : null, startDate, endDate), executor)
                    : null;

            // "Marks by Subject" is folded under ACADEMICS (no new ReportModule key) and reuses
            // the already-collected AcademicsSection (assessments) to avoid a second HMAC call.
            CompletableFuture<SubjectMarksSection> subjectMarksFuture = academicsFuture != null
                    ? academicsFuture.thenApplyAsync(
                            ac -> subjectMarksCollector.collect(userId, ac, startDate, endDate, batchSlides), executor)
                    : null;

            CompletableFuture<StudyHabitsSection> activityFuture = has(mods, ReportModule.ACTIVITY)
                    ? CompletableFuture.supplyAsync(() -> activityCollector.collect(userId, startDate, endDate), executor)
                    : null;

            CompletableFuture<ProgressSection> progressFuture = has(mods, ReportModule.PROGRESS)
                    ? CompletableFuture.supplyAsync(() -> progressCollector.collect(userId, batchId, startDate, endDate), executor)
                    : null;

            CompletableFuture<List<AchievementItem>> certFuture = has(mods, ReportModule.CERTIFICATES)
                    ? CompletableFuture.supplyAsync(() -> certificateCollector.collect(userId, startDate, endDate), executor)
                    : null;

            CompletableFuture<AssignmentsSection> assignmentFuture = has(mods, ReportModule.ASSIGNMENTS)
                    ? CompletableFuture.supplyAsync(() -> assignmentCollector.collect(userId, batchId, startDate, endDate), executor)
                    : null;

            CompletableFuture<DoubtsAndEngagementSection> doubtFuture = has(mods, ReportModule.DOUBTS)
                    ? CompletableFuture.supplyAsync(() -> doubtCollector.collect(userId, instituteId, startDate, endDate), executor)
                    : null;

            CompletableFuture<LoginSection> loginFuture = has(mods, ReportModule.LOGIN)
                    ? CompletableFuture.supplyAsync(() -> loginCollector.collect(userId, startDate, endDate), executor)
                    : null;

            // Scoped to a batch: only analysed attempts of its assessments and slides count.
            CompletableFuture<LearningInsightsSection> learningInsightsFuture = !has(mods, ReportModule.LEARNING_INSIGHTS)
                    ? null
                    : scoped && academicsFuture != null
                    ? academicsFuture.thenApplyAsync(ac -> learningInsightsCollector.collect(
                            userId, startDate, endDate, batchSources(ac, batchSlides)), executor)
                    : CompletableFuture.supplyAsync(() -> learningInsightsCollector.collect(userId, startDate, endDate), executor);

            // Wait for all active futures
            List<CompletableFuture<?>> active = Stream.of(
                            identityFuture, instituteFuture, attendanceFuture, liveClassFuture,
                            academicsFuture, subjectMarksFuture, activityFuture, progressFuture, certFuture,
                            assignmentFuture, doubtFuture, loginFuture, learningInsightsFuture)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toList());

            // Wait for the slowest collector, but do NOT let it sink the report. Previously a
            // TimeoutException here propagated to the catch-all below, which discarded every section
            // — including the ones that had already returned real data — and emitted a report with
            // everything marked unavailable. One slow query (typically the cross-service assessment
            // fetch) silently erased attendance, activity and progress along with it.
            // Each collector already catches its own errors, so on timeout we simply keep whatever
            // finished: getSafe() below is getNow(fallback), which yields the real value for every
            // completed future and the "unavailable" fallback only for the stragglers.
            try {
                CompletableFuture.allOf(active.toArray(new CompletableFuture[0]))
                        .get(COLLECTOR_TIMEOUT_SECONDS, TimeUnit.SECONDS);
            } catch (TimeoutException te) {
                long done = active.stream().filter(CompletableFuture::isDone).count();
                log.warn("[ComprehensiveReportAggregator] {} of {} collectors finished within {}s for userId={}"
                                + " — proceeding with partial data; the rest are reported as unavailable.",
                        done, active.size(), COLLECTOR_TIMEOUT_SECONDS, userId);
            }

            // Resolve sections
            StudentIdentitySection student = getSafe(identityFuture,
                    StudentIdentitySection.builder().available(false).userId(userId).build());
            InstituteSection institute = getSafe(instituteFuture,
                    InstituteSection.builder().id(instituteId).build());

            AttendanceSection attendance = section(attendanceFuture, AttendanceSection.builder().available(false).build());
            AcademicsSection academics = section(academicsFuture, AcademicsSection.builder().available(false).build());
            SubjectMarksSection subjectMarks = section(subjectMarksFuture, SubjectMarksSection.builder().available(false).build());
            StudyHabitsSection studyHabits = section(activityFuture, StudyHabitsSection.builder().available(false).build());
            ProgressSection courseProgress = section(progressFuture, ProgressSection.builder().available(false).build());
            LiveClassesSection liveClasses = liveClassFuture != null
                    ? getSafe(liveClassFuture, LiveClassesSection.builder().available(false).build())
                    : (has(mods, ReportModule.LIVE_CLASSES) ? LiveClassesSection.builder().available(false).build() : null);
            List<AchievementItem> achievements = buildAchievements(certFuture, studyHabits, startDate, endDate);
            AssignmentsSection assignments = section(assignmentFuture, AssignmentsSection.builder().available(false).build());
            DoubtsAndEngagementSection doubtsAndEngagement = section(doubtFuture, DoubtsAndEngagementSection.builder().available(false).build());
            LoginSection login = section(loginFuture, LoginSection.builder().available(false).build());
            LearningInsightsSection learningInsights = section(learningInsightsFuture, LearningInsightsSection.builder().available(false).build());

            // Build the period section
            ReportPeriodSection period = buildPeriod(startDate, endDate);

            // Build the meta section (name/id are enriched by the processor after the process record is known)
            MetaSection meta = MetaSection.builder()
                    .reportVersion("v2")
                    .reportName(buildReportName(startDate, endDate))
                    .reportId(null) // set by processor using process.getId()
                    .generatedAt(LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME))
                    .language("en")
                    .build();

            // Assemble partial report (without overview — needs all sections)
            ComprehensiveStudentReport report = ComprehensiveStudentReport.builder()
                    .meta(meta)
                    .student(student)
                    .institute(institute)
                    .period(period)
                    .attendance(attendance)
                    .academics(academics)
                    .subjectMarks(subjectMarks)
                    .studyHabits(studyHabits)
                    .courseProgress(courseProgress)
                    .liveClasses(liveClasses)
                    .achievements(achievements)
                    .assignments(assignments)
                    .doubtsAndEngagement(doubtsAndEngagement)
                    .login(login)
                    .learningInsights(learningInsights)
                    .includedModules(new ArrayList<>(mods))
                    .dataNotes(buildDataNotes())
                    .build();

            // Build overview last (needs sections)
            OverviewSection overview = overviewBuilder.build(report);
            report.setOverview(overview);

            return report;

        } catch (Exception e) {
            log.error("[ComprehensiveReportAggregator] Aggregation timed out or failed: {}", e.getMessage());

            // Best-effort partial
            ReportPeriodSection period = buildPeriod(startDate, endDate);
            MetaSection meta = MetaSection.builder()
                    .reportVersion("v2")
                    .reportName(buildReportName(startDate, endDate))
                    .generatedAt(LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME))
                    .language("en")
                    .build();

            return ComprehensiveStudentReport.builder()
                    .meta(meta)
                    .student(StudentIdentitySection.builder().available(false).userId(userId).build())
                    .institute(InstituteSection.builder().id(instituteId).build())
                    .period(period)
                    .attendance(has(mods, ReportModule.ATTENDANCE) ? AttendanceSection.builder().available(false).build() : null)
                    .academics(has(mods, ReportModule.ACADEMICS) ? AcademicsSection.builder().available(false).build() : null)
                    .subjectMarks(has(mods, ReportModule.ACADEMICS) ? SubjectMarksSection.builder().available(false).build() : null)
                    .studyHabits(has(mods, ReportModule.ACTIVITY) ? StudyHabitsSection.builder().available(false).build() : null)
                    .courseProgress(has(mods, ReportModule.PROGRESS) ? ProgressSection.builder().available(false).build() : null)
                    .liveClasses(has(mods, ReportModule.LIVE_CLASSES) ? LiveClassesSection.builder().available(false).build() : null)
                    .achievements(has(mods, ReportModule.CERTIFICATES) ? List.of() : null)
                    .assignments(has(mods, ReportModule.ASSIGNMENTS) ? AssignmentsSection.builder().available(false).build() : null)
                    .doubtsAndEngagement(has(mods, ReportModule.DOUBTS) ? DoubtsAndEngagementSection.builder().available(false).build() : null)
                    .learningInsights(has(mods, ReportModule.LEARNING_INSIGHTS) ? LearningInsightsSection.builder().available(false).build() : null)
                    .includedModules(new ArrayList<>(mods))
                    .dataNotes(buildDataNotes())
                    .build();

        } finally {
            executor.shutdown();
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static boolean has(Set<String> mods, ReportModule module) {
        return mods.contains(module.getKey());
    }

    private <T> T section(CompletableFuture<T> future, T fallback) {
        return future != null ? getSafe(future, fallback) : null;
    }

    private <T> T getSafe(CompletableFuture<T> future, T fallback) {
        return future.getNow(fallback);
    }

    /**
     * Merges certificate achievements with streak badges from ActivityCollector.
     * Streak badge added if longestStreak >= 7 days.
     */
    private List<AchievementItem> buildAchievements(
            CompletableFuture<List<AchievementItem>> certFuture,
            StudyHabitsSection studyHabits,
            LocalDate startDate, LocalDate endDate) {

        List<AchievementItem> achievements = new ArrayList<>();

        if (certFuture != null) {
            List<AchievementItem> certs = getSafe(certFuture, List.of());
            if (certs != null) achievements.addAll(certs);
        }

        // Add streak badge if longestStreakDays >= 7
        if (studyHabits != null && studyHabits.isAvailable()
                && studyHabits.getLongestStreakDays() != null
                && studyHabits.getLongestStreakDays() >= 7) {

            int streak = studyHabits.getLongestStreakDays();
            // Approximate badge issue date as the end of the report period
            String issuedAt = endDate.toString();

            achievements.add(AchievementItem.builder()
                    .title(streak + "-Day Study Streak")
                    .issuedAt(issuedAt)
                    .type("BADGE")
                    .build());
        }

        return achievements.isEmpty() ? List.of() : achievements;
    }

    private ReportPeriodSection buildPeriod(LocalDate startDate, LocalDate endDate) {
        int days = (int) (endDate.toEpochDay() - startDate.toEpochDay()) + 1;
        String label = buildPeriodLabel(startDate, endDate);
        return ReportPeriodSection.builder()
                .startDate(startDate.toString())
                .endDate(endDate.toString())
                .label(label)
                .days(days)
                .generatedAt(LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME))
                .build();
    }

    private String buildPeriodLabel(LocalDate startDate, LocalDate endDate) {
        if (startDate.getMonth() == endDate.getMonth() && startDate.getYear() == endDate.getYear()) {
            // Same month: "1–30 June 2026"
            String month = startDate.getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
            return startDate.getDayOfMonth() + "–" + endDate.getDayOfMonth() + " " + month + " " + startDate.getYear();
        }
        // Different months: "15 May – 14 Jun 2026"
        String sm = startDate.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
        String em = endDate.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
        return startDate.getDayOfMonth() + " " + sm + " – " + endDate.getDayOfMonth() + " " + em + " " + endDate.getYear();
    }

    private String buildReportName(LocalDate startDate, LocalDate endDate) {
        if (startDate.getMonth() == endDate.getMonth()) {
            String month = startDate.getMonth().getDisplayName(TextStyle.FULL, Locale.ENGLISH);
            return month + " " + startDate.getYear() + " Progress Report";
        }
        String sm = startDate.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
        String em = endDate.getMonth().getDisplayName(TextStyle.SHORT, Locale.ENGLISH);
        return sm + "–" + em + " " + endDate.getYear() + " Progress Report";
    }

    private List<String> buildDataNotes() {
        return List.of(
                "Trends compare against the previous report period when available.",
                "Class rank and percentile are within this batch for the selected period.",
                "Learning insights (topic mastery, thinking skills, confidence) are derived from AI analysis of the learner's recent attempts.",
                "Sections the institute did not enable or had no data for are omitted."
        );
    }

    /** Assessment ids the scoped academics returned plus the batch slides. */
    private static Set<String> batchSources(AcademicsSection academics, Set<String> batchSlides) {
        Set<String> out = new java.util.HashSet<>(batchSlides == null ? Set.of() : batchSlides);
        if (academics != null && academics.getAssessments() != null) {
            for (AcademicsSection.AssessmentItem a : academics.getAssessments()) {
                if (a.getAssessmentId() != null) out.add(a.getAssessmentId());
            }
        }
        return out;
    }
}
