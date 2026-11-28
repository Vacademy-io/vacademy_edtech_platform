package vacademy.io.admin_core_service.features.student_analysis.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.credits.client.CreditClient;
import vacademy.io.admin_core_service.features.credits.client.MeteringFields;
import vacademy.io.admin_core_service.features.student_analysis.dto.StudentAnalysisData;
import vacademy.io.admin_core_service.features.student_analysis.dto.StudentReportData;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.AiInsightsSection;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.ComprehensiveStudentReport;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.NarrativeSection;
import vacademy.io.admin_core_service.features.student_analysis.dto.comprehensive.TopicConfidence;

import java.util.stream.Collectors;
import vacademy.io.admin_core_service.features.student_analysis.entity.StudentAnalysisProcess;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ComprehensiveReportAggregator;
import vacademy.io.admin_core_service.features.student_analysis.service.aggregation.ReportModule;

import java.time.Duration;
import java.util.Set;

/**
 * Async service to process student analysis requests.
 *
 * <p>v1 path (existing, UNCHANGED): uses StudentAnalysisDataService + StudentReportLLMService.
 * <p>v2 path (new): uses ComprehensiveReportAggregator (Layer-1) + ComprehensiveReportLLMService (Layer-2).
 * The branch is determined by {@code process.reportVersion}.
 *
 * <h3>Transaction strategy</h3>
 * <p>This method is {@code @Async} and intentionally NOT {@code @Transactional}.
 * Running a 150-second aggregation+LLM chain inside a single transaction would hold
 * a DB connection for that entire duration, exhausting the pool and making the
 * intermediate PROCESSING status write invisible to pollers until the final commit.
 *
 * <p>Instead, every DB write is delegated to {@link StudentAnalysisPersistenceService},
 * whose short {@code @Transactional} methods each acquire, use, and release a connection
 * independently:
 * <ol>
 *   <li>{@code markProcessing} — commits PROCESSING before the long work starts.
 *   <li>{@code updateUserLinkedData} — commits strengths/weaknesses after LLM returns.
 *   <li>{@code saveCompletedReport} — commits report JSON + COMPLETED atomically.
 *   <li>{@code markFailed} — commits FAILED + error message on any exception.
 * </ol>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StudentAnalysisProcessorService {

        private final StudentAnalysisDataService dataService;
        private final StudentReportLLMService llmService;
        private final ObjectMapper objectMapper;

        // v2 dependencies (injected alongside v1, no removal of existing fields)
        private final ComprehensiveReportAggregator comprehensiveAggregator;
        private final ComprehensiveReportLLMService comprehensiveLLMService;

        // Transactional persistence — separate bean so @Transactional proxy applies
        private final StudentAnalysisPersistenceService persistenceService;

        // Read-only access to prior reports for trend/change computation (B3).
        private final vacademy.io.admin_core_service.features.student_analysis.repository.StudentAnalysisProcessRepository processRepository;

        // Learner notification (best-effort; never affects report generation)
        private final StudentReportNotificationService studentReportNotificationService;

        // Wallet check before the paid AI calls
        private final vacademy.io.admin_core_service.features.credits.client.CreditClient creditClient;

        /**
         * Process student analysis asynchronously.
         *
         * <p>NOT @Transactional — see class-level javadoc for the rationale.
         * Each DB write is handled by {@link StudentAnalysisPersistenceService}.
         */
        @Async
        public void processStudentAnalysis(String processId, String actorUserId) {
                log.info("[Student-Analysis-Processor] Starting async processing for process ID: {}", processId);

                // Commit PROCESSING immediately so pollers see it before the long work starts.
                StudentAnalysisProcess process = persistenceService.markProcessing(processId);

                try {
                        boolean isV2 = "v2".equalsIgnoreCase(process.getReportVersion());

                        if (isV2) {
                                processV2(process, actorUserId);
                        } else {
                                processV1(process);
                        }

                } catch (Exception e) {
                        log.error("[Student-Analysis-Processor] Failed to process analysis for process ID: {}",
                                        processId, e);
                        persistenceService.markFailed(processId, e.getMessage());
                }
        }

        // ── v1 path (UNCHANGED from original) ────────────────────────────────────
        private void processV1(StudentAnalysisProcess process) throws Exception {
                // Step 1: Collect all student data
                log.info("[Student-Analysis-Processor] [v1] Collecting student data");
                StudentAnalysisData data = dataService.collectStudentData(
                                process.getUserId(),
                                process.getStartDateIso(),
                                process.getEndDateIso());

                // Step 2: Generate LLM report
                log.info("[Student-Analysis-Processor] [v1] Generating LLM report");
                StudentReportData report = llmService.generateStudentReport(data, process.getInstituteId())
                                .blockOptional(Duration.ofSeconds(70))
                                .orElseThrow(() -> new RuntimeException("LLM timeout or returned null report"));

                // Step 3: Save report as JSON
                String reportJson = objectMapper.writeValueAsString(report);

                // Step 4: Update user_linked_data with strengths and weaknesses
                // (runs in its own @Transactional method so flush() has a live persistence context)
                log.info("[Student-Analysis-Processor] [v1] Updating user linked data");
                persistenceService.updateUserLinkedData(process.getUserId(), report.getStrengths(), report.getWeaknesses());

                // Step 5: Persist completed report + mark COMPLETED atomically
                StudentAnalysisProcess completed = persistenceService.saveCompletedReport(process.getId(), reportJson);

                log.info("[Student-Analysis-Processor] [v1] Successfully completed for processId={}", process.getId());

                // Step 6: Notify the learner (best-effort) — runs AFTER COMPLETED is committed
                notifyLearnerSafe(completed);
        }

        /** Rough prompt + reply estimate of one comprehensive-report narration, for the plan pre-check. */
        static final int NARRATIVE_ESTIMATED_TOKENS = 8000;

        /**
         * The v2 narrative's affordability: today's rule (a known balance must be positive; an
         * unreadable one does not block), plus, only for a known empty wallet, the institute's
         * LIVE AI plan.
         */
        static boolean aiAffordable(CreditClient credits, String instituteId, String learnerUserId,
                        String actorUserId) {
                java.util.Optional<Double> balance = credits.readBalance(instituteId);
                if (balance.isEmpty() || balance.get() > 0) {
                        return true; // today's rule, unchanged
                }
                // planCovers never throws; no LIVE plan = false at once (no HTTP call).
                MeteringFields.MeteringFieldsBuilder m = actorUserId != null
                                ? MeteringFields.user("student_report", MeteringFields.SURFACE_ADMIN_APP)
                                : MeteringFields.system("student_report");
                return credits.planCovers(instituteId, "analytics", null, NARRATIVE_ESTIMATED_TOKENS,
                                actorUserId, m.subjectUserId(learnerUserId).build());
        }

        // ── v2 path (new comprehensive report) ───────────────────────────────────
        private void processV2(StudentAnalysisProcess process, String actorUserId) throws Exception {
                log.info("[Student-Analysis-Processor] [v2] Collecting comprehensive data");

                // Step 1: Layer-1 deterministic aggregation — only the admin-selected modules are queried
                Set<String> modules = ReportModule.resolveCsv(process.getIncludedModules());
                log.info("[Student-Analysis-Processor] [v2] Including modules: {}", modules);
                // BUG-13: if batchId is absent but packageSessionId is provided, use it as the
                // effective batch id so attendance/live-class/progress collectors still run.
                String effectiveBatchId = process.getBatchId() != null
                                ? process.getBatchId()
                                : process.getPackageSessionId();
                ComprehensiveStudentReport report = comprehensiveAggregator.collect(
                                process.getUserId(),
                                process.getInstituteId(),
                                effectiveBatchId,
                                process.getStartDateIso(),
                                process.getEndDateIso(),
                                modules);

                // Step 1.5: Enrich headline-metric trends from the most recent prior report (best-effort).
                // Done before narration so the LLM also sees the trend context.
                enrichTrends(report, process);

                // Every AI charge below is attributed to this report, its learner and the admin who ran it.
                ComprehensiveReportLLMService.ChargeContext charge = new ComprehensiveReportLLMService.ChargeContext(
                                process.getInstituteId(), process.getUserId(), actorUserId, process.getId());

                // Affordability: an institute whose wallet is known to be empty gets the deterministic
                // report without AI text — the same outcome as a model failure — instead of being
                // charged into a negative balance (charges are allow_negative). An unreadable
                // balance does not block: the report behaves as it always has. An empty wallet is
                // asked once more about the institute's LIVE AI plan (learner reports can be
                // included); no LIVE plan = no extra call, any failure there = today's answer.
                boolean aiAffordable = aiAffordable(creditClient, process.getInstituteId(), process.getUserId(),
                                actorUserId);
                if (!aiAffordable) {
                        log.warn("[Student-Analysis-Processor] [v2] Institute {} has no AI credits; skipping AI narrative for processId={}",
                                        process.getInstituteId(), process.getId());
                }

                // Step 2: Layer-2 AI narrative (best-effort; failure → report without ai_insights)
                log.info("[Student-Analysis-Processor] [v2] Generating AI narrative");
                try {
                        // Must exceed the per-request timeout in ComprehensiveReportLLMService
                        // (RESPONSE_TIMEOUT_SECONDS) so a slow free-tier model gets one full attempt
                        // instead of being cut off here at the blocking read. Background @Async job.
                        AiInsightsSection insights = !aiAffordable ? null : comprehensiveLLMService.narrate(report, charge)
                                        .blockOptional(Duration.ofSeconds(180))
                                        .orElse(null);

                        if (insights != null) {
                                report.setAiInsights(insights);

                                // Lift @JsonIgnore fields from the AI section to their canonical report-top-level homes
                                if (insights.getParentSummary() != null) {
                                        report.setParentSummary(insights.getParentSummary());
                                }
                                if (insights.getOverviewOneLine() != null && report.getOverview() != null) {
                                        report.getOverview().setOneLine(insights.getOverviewOneLine());
                                }

                                // Lift the v1-style deep Markdown narrative to the report top level.
                                if (insights.getNarrative() != null) {
                                        report.setNarrative(insights.getNarrative());
                                }

                                // Convert LLM strength/weakness maps (topic→confidence) to TopicConfidence lists
                                // at report top level so they appear in the serialized report_json.
                                if (insights.getStrengthsMap() != null && !insights.getStrengthsMap().isEmpty()) {
                                        report.setStrengths(insights.getStrengthsMap().entrySet().stream()
                                                .map(e -> TopicConfidence.builder()
                                                        .topic(e.getKey()).confidence(e.getValue()).build())
                                                .collect(Collectors.toList()));
                                }
                                if (insights.getWeaknessesMap() != null && !insights.getWeaknessesMap().isEmpty()) {
                                        report.setAreasToImprove(insights.getWeaknessesMap().entrySet().stream()
                                                .map(e -> TopicConfidence.builder()
                                                        .topic(e.getKey()).confidence(e.getValue()).build())
                                                .collect(Collectors.toList()));
                                }

                                // Merge strengths/weaknesses into user_linked_data (same as v1).
                                // Runs in its own @Transactional method so flush() has a live persistence context.
                                persistenceService.updateUserLinkedData(
                                        process.getUserId(), insights.getStrengthsMap(), insights.getWeaknessesMap());
                        } else {
                                log.warn("[Student-Analysis-Processor] [v2] AI narrative timed out; report will have no ai_insights.");
                        }
                } catch (Exception llmEx) {
                        log.error("[Student-Analysis-Processor] [v2] AI narrative failed (non-fatal): {}", llmEx.getMessage());
                        // Report is still saved without ai_insights — deterministic data is preserved
                }

                // Step 2b: Deterministic fallback — guarantee strengths / areas-to-improve /
                // improvement-path are present even if the LLM returned empty or timed out.
                ensureInsightsFromFacts(report);

                // Step 2c: "Marks by Subject" LLM clustering (best-effort). The aggregator already
                // populated report.subjectMarks with a deterministic (DB-subject-hint) grouping;
                // here we try to upgrade it to LLM-clustered subjects and, on ANY failure or empty
                // result, silently keep the deterministic grouping already in place — this codebase
                // has learned the LLM can be unreliable, so the fallback is mandatory, not optional.
                if (aiAffordable) clusterSubjectMarksSafe(report, charge);

                // Step 3: Persist completed report + mark COMPLETED atomically
                String reportJson = objectMapper.writeValueAsString(report);
                StudentAnalysisProcess completed = persistenceService.saveCompletedReport(process.getId(), reportJson);

                log.info("[Student-Analysis-Processor] [v2] Successfully completed for processId={}", process.getId());

                // Notify the learner (best-effort) — runs AFTER COMPLETED is committed
                notifyLearnerSafe(completed);
        }

        /**
         * B3: Enrich {@code overview.headline_metrics} with trend/change vs the most recent prior
         * COMPLETED v2 report for the same user + package-session. Best-effort and READ-ONLY — any
         * failure (no prior report, unparseable JSON) simply leaves trends null, exactly as before.
         */
        private void enrichTrends(ComprehensiveStudentReport report, StudentAnalysisProcess process) {
                try {
                        if (report.getOverview() == null || report.getOverview().getHeadlineMetrics() == null
                                        || report.getOverview().getHeadlineMetrics().isEmpty()) {
                                return;
                        }
                        String packageSessionId = process.getPackageSessionId() != null
                                        ? process.getPackageSessionId()
                                        : process.getBatchId();
                        if (packageSessionId == null) {
                                return; // can't scope a comparable prior report
                        }

                        var priorOpt = processRepository.findMostRecentPriorV2Report(
                                        process.getUserId(), packageSessionId, process.getEndDateIso());
                        if (priorOpt.isEmpty() || priorOpt.get().getReportJson() == null) {
                                return;
                        }

                        ComprehensiveStudentReport prior = objectMapper.readValue(
                                        priorOpt.get().getReportJson(), ComprehensiveStudentReport.class);
                        if (prior.getOverview() == null || prior.getOverview().getHeadlineMetrics() == null) {
                                return;
                        }

                        // Map prior metrics by key → numeric value (skip non-numeric like "3 / 5").
                        java.util.Map<String, Double> priorByKey = new java.util.HashMap<>();
                        prior.getOverview().getHeadlineMetrics().forEach(m -> {
                                Double v = numericValue(m.getValue());
                                if (m.getKey() != null && v != null) priorByKey.put(m.getKey(), v);
                        });
                        if (priorByKey.isEmpty()) return;

                        for (var metric : report.getOverview().getHeadlineMetrics()) {
                                // A count over a different-length window, or a label ("Hindi 2"), has no
                                // meaningful "vs last" delta.
                                if (metric.getKey() != null && NO_TREND_METRICS.contains(metric.getKey())) continue;
                                Double cur = numericValue(metric.getValue());
                                Double prev = metric.getKey() != null ? priorByKey.get(metric.getKey()) : null;
                                if (cur == null || prev == null) continue;

                                double delta = cur - prev;
                                double rounded = Math.round(delta * 10.0) / 10.0;
                                metric.setTrend(rounded > 0.5 ? "up" : (rounded < -0.5 ? "down" : "steady"));
                                // Only set a change label when the metric doesn't already carry one
                                // (e.g. study_time uses change for "~N min/day").
                                if (metric.getChange() == null) {
                                        String unit = metric.getUnit() != null ? metric.getUnit() : "";
                                        String num = (rounded == Math.floor(rounded))
                                                        ? String.valueOf((long) rounded) : String.valueOf(rounded);
                                        metric.setChange((rounded >= 0 ? "+" : "") + num + unit + " vs last");
                                }
                        }
                        log.info("[Student-Analysis-Processor] [v2] Enriched headline-metric trends from prior report {}",
                                        priorOpt.get().getId());
                } catch (Exception e) {
                        log.warn("[Student-Analysis-Processor] [v2] Trend enrichment skipped (non-fatal): {}", e.getMessage());
                }
        }

        private static final Set<String> NO_TREND_METRICS = Set.of("assessments_taken", "above_class_average", "best_subject");

        /** Best-effort numeric coercion of a HeadlineMetric value (Number or numeric String). */
        private Double numericValue(Object value) {
                if (value == null) return null;
                if (value instanceof Number n) return n.doubleValue();
                try {
                        String s = value.toString().trim();
                        // Ignore composite values like "3 / 5" — not a single comparable number.
                        if (s.contains("/")) return null;
                        return Double.parseDouble(s.replaceAll("[^0-9.\\-]", ""));
                } catch (Exception e) {
                        return null;
                }
        }

        /**
         * Deterministic safety net for the "insight" sections. The LLM is the primary author,
         * but if it returned empty strengths/areas (or timed out entirely), we derive them from
         * the Layer-1 facts so the report is never missing strengths, areas-to-improve, or an
         * improvement path — restoring v1's reliability, which computed these from learner data.
         *
         * <p>Only fills what's blank; anything the LLM already produced is left untouched.
         */
        private void ensureInsightsFromFacts(ComprehensiveStudentReport report) {
                try {
                        // Candidate (topic, score) pairs. Priority: assessment subject score %, then course
                        // completion %, then individual assessment names (last resort so we always have topics).
                        java.util.LinkedHashMap<String, Integer> topicScores = new java.util.LinkedHashMap<>();
                        // Highest priority: per-topic mastery parsed from processed_json (real accuracy per topic).
                        if (report.getLearningInsights() != null && report.getLearningInsights().isAvailable()
                                        && report.getLearningInsights().getTopicMastery() != null) {
                                report.getLearningInsights().getTopicMastery().forEach(tm -> {
                                        if (tm.getTopic() != null && tm.getAccuracy() != null) {
                                                topicScores.putIfAbsent(tm.getTopic(), (int) Math.round(tm.getAccuracy()));
                                        }
                                });
                        }
                        if (report.getAcademics() != null && report.getAcademics().getSubjectPerformance() != null) {
                                report.getAcademics().getSubjectPerformance().forEach(sp -> {
                                        if (sp.getSubject() != null && sp.getScorePercentage() != null) {
                                                topicScores.putIfAbsent(sp.getSubject(), (int) Math.round(sp.getScorePercentage()));
                                        }
                                });
                        }
                        if (report.getCourseProgress() != null && report.getCourseProgress().getSubjects() != null) {
                                report.getCourseProgress().getSubjects().forEach(s -> {
                                        if (s.getSubject() != null && s.getCompletionPercentage() != null) {
                                                topicScores.putIfAbsent(s.getSubject(), (int) Math.round(s.getCompletionPercentage()));
                                        }
                                });
                        }
                        if (topicScores.isEmpty() && report.getAcademics() != null
                                        && report.getAcademics().getAssessments() != null) {
                                report.getAcademics().getAssessments().forEach(a -> {
                                        if (a.getName() != null && a.getPercentage() != null) {
                                                topicScores.putIfAbsent(a.getName(), (int) Math.round(a.getPercentage()));
                                        }
                                });
                        }

                        // Holistic (non-subject) signals — so a learner with no academics/progress data
                        // still yields real strengths/areas (attendance, engagement, habits, timeliness).
                        if (report.getAttendance() != null && report.getAttendance().isAvailable()
                                        && report.getAttendance().getOverallPercentage() != null) {
                                topicScores.putIfAbsent("Class Attendance",
                                                (int) Math.round(report.getAttendance().getOverallPercentage()));
                        }
                        if (report.getLiveClasses() != null && report.getLiveClasses().isAvailable()
                                        && report.getLiveClasses().getAttendancePercentage() != null) {
                                topicScores.putIfAbsent("Live Class Attendance",
                                                (int) Math.round(report.getLiveClasses().getAttendancePercentage()));
                        }
                        if (report.getStudyHabits() != null && report.getStudyHabits().isAvailable()
                                        && report.getStudyHabits().getActiveDays() != null
                                        && report.getStudyHabits().getTotalDays() != null
                                        && report.getStudyHabits().getTotalDays() > 0) {
                                int consistency = (int) Math.round(
                                                report.getStudyHabits().getActiveDays() * 100.0
                                                                / report.getStudyHabits().getTotalDays());
                                topicScores.putIfAbsent("Study Consistency", consistency);
                        }
                        if (report.getAssignments() != null && report.getAssignments().isAvailable()
                                        && report.getAssignments().getSubmitted() != null
                                        && report.getAssignments().getSubmitted() > 0
                                        && report.getAssignments().getOnTime() != null) {
                                int timeliness = (int) Math.round(
                                                report.getAssignments().getOnTime() * 100.0
                                                                / report.getAssignments().getSubmitted());
                                topicScores.putIfAbsent("Assignment Timeliness", timeliness);
                        }
                        if (report.getCourseProgress() != null && report.getCourseProgress().isAvailable()
                                        && report.getCourseProgress().getOverallCompletionPercentage() != null) {
                                topicScores.putIfAbsent("Course Completion",
                                                (int) Math.round(report.getCourseProgress().getOverallCompletionPercentage()));
                        }

                        resolveStrengthAreaOverlap(report, topicScores);

                        // ── Strengths (>=60) / areas-to-improve (<60): single split, so every topic is
                        // classified and there is never a "gap band". Only fill what the LLM left blank.
                        // The fallbacks below must not re-add a topic the other list already holds —
                        // that would undo resolveStrengthAreaOverlap.
                        java.util.Set<String> inAreas = topicKeys(report.getAreasToImprove());
                        if (report.getStrengths() == null || report.getStrengths().isEmpty()) {
                                java.util.List<TopicConfidence> strengths = topicScores.entrySet().stream()
                                                .filter(e -> !inAreas.contains(topicKey(e.getKey())))
                                                .filter(e -> e.getValue() >= 60)
                                                .sorted((a, b) -> Integer.compare(b.getValue(), a.getValue()))
                                                .limit(6)
                                                .map(e -> topic(e.getKey(), e.getValue()))
                                                .collect(Collectors.toList());
                                // Guarantee at least one relative strength when a decent topic exists.
                                if (strengths.isEmpty()) {
                                        topicScores.entrySet().stream()
                                                        .filter(e -> !inAreas.contains(topicKey(e.getKey())))
                                                        .max(java.util.Map.Entry.comparingByValue())
                                                        .filter(e -> e.getValue() >= 45)
                                                        .ifPresent(e -> strengths.add(topic(e.getKey(), e.getValue())));
                                }
                                if (!strengths.isEmpty()) report.setStrengths(strengths);
                        }
                        java.util.Set<String> inStrengths = topicKeys(report.getStrengths());
                        if (report.getAreasToImprove() == null || report.getAreasToImprove().isEmpty()) {
                                java.util.List<TopicConfidence> areas = topicScores.entrySet().stream()
                                                .filter(e -> !inStrengths.contains(topicKey(e.getKey())))
                                                .filter(e -> e.getValue() < 60)
                                                .sorted(java.util.Map.Entry.comparingByValue())
                                                .limit(6)
                                                .map(e -> topic(e.getKey(), e.getValue()))
                                                .collect(Collectors.toList());
                                // Guarantee at least one improvement target unless everything is already strong.
                                if (areas.isEmpty()) {
                                        topicScores.entrySet().stream()
                                                        .filter(e -> !inStrengths.contains(topicKey(e.getKey())))
                                                        .min(java.util.Map.Entry.comparingByValue())
                                                        .filter(e -> e.getValue() < 85)
                                                        .ifPresent(e -> areas.add(topic(e.getKey(), e.getValue())));
                                }
                                if (!areas.isEmpty()) report.setAreasToImprove(areas);
                        }

                        // ── Improvement path (recommendations) — always produce at least one when any data exists.
                        AiInsightsSection ai = report.getAiInsights();
                        boolean noRecs = ai == null || ai.getRecommendations() == null || ai.getRecommendations().isEmpty();
                        if (noRecs) {
                                java.util.List<AiInsightsSection.RecommendationItem> recs = new java.util.ArrayList<>();
                                topicScores.entrySet().stream()
                                                .filter(e -> e.getValue() < 60)
                                                .sorted(java.util.Map.Entry.comparingByValue())
                                                .limit(3)
                                                .forEach(e -> recs.add(rec(e.getValue() < 40 ? "HIGH" : "MEDIUM", e.getKey(),
                                                                "Focus extra practice on " + e.getKey()
                                                                                + " to lift it from " + e.getValue() + "%.")));
                                if (report.getAttendance() != null && report.getAttendance().isAvailable()
                                                && report.getAttendance().getOverallPercentage() != null
                                                && report.getAttendance().getOverallPercentage() < 75) {
                                        recs.add(rec("HIGH", "Attendance", "Improve class attendance — it is currently "
                                                        + Math.round(report.getAttendance().getOverallPercentage()) + "%."));
                                }
                                if (report.getAssignments() != null && report.getAssignments().isAvailable()
                                                && report.getAssignments().getLate() != null && report.getAssignments().getLate() > 0) {
                                        recs.add(rec("MEDIUM", "Assignments", "Submit assignments on time — "
                                                        + report.getAssignments().getLate() + " were late this period."));
                                }
                                // Nothing weak flagged but we do have topic data → give a "keep advancing" nudge on the lowest.
                                if (recs.isEmpty() && !topicScores.isEmpty()) {
                                        topicScores.entrySet().stream()
                                                        .min(java.util.Map.Entry.comparingByValue())
                                                        .ifPresent(e -> recs.add(rec("LOW", e.getKey(),
                                                                        "Keep advancing " + e.getKey()
                                                                                        + " and aim for full mastery.")));
                                }
                                if (!recs.isEmpty()) {
                                        if (ai == null) {
                                                ai = AiInsightsSection.builder().recommendations(recs).build();
                                                report.setAiInsights(ai);
                                        } else {
                                                ai.setRecommendations(recs);
                                        }
                                }
                        }

                        // ── Narrative floor: a plain parent_summary / summary when the LLM gave none,
                        // built only from values already in the report (no invented numbers).
                        String topStrength = (report.getStrengths() != null && !report.getStrengths().isEmpty())
                                        ? report.getStrengths().get(0).getTopic() : null;
                        String topArea = (report.getAreasToImprove() != null && !report.getAreasToImprove().isEmpty())
                                        ? report.getAreasToImprove().get(0).getTopic() : null;
                        String status = report.getOverview() != null ? report.getOverview().getOverallStatus() : null;
                        String grade = report.getOverview() != null ? report.getOverview().getOverallGrade() : null;

                        if (report.getParentSummary() == null || report.getParentSummary().isBlank()) {
                                StringBuilder sb = new StringBuilder();
                                String name = (report.getStudent() != null && report.getStudent().getName() != null)
                                                ? report.getStudent().getName() : "The student";
                                // "<name>'s overall status is Needs Attention, with an overall grade of B." — the
                                // old template read "<name> is currently needs attention with …".
                                if (status != null) {
                                        sb.append(name).append("'s overall status is ").append(status)
                                                        .append(grade != null ? ", with an overall grade of " + grade + "." : ".");
                                } else {
                                        sb.append(name).append(" is progressing")
                                                        .append(grade != null ? ", with an overall grade of " + grade + "." : ".");
                                }
                                if (topStrength != null) sb.append(" Strongest area: ").append(topStrength).append(".");
                                if (topArea != null) sb.append(" Main focus area: ").append(topArea)
                                                .append(" — see the recommended next steps below.");
                                report.setParentSummary(sb.toString());
                        }
                        if ((report.getAiInsights() == null || report.getAiInsights().getSummary() == null
                                        || report.getAiInsights().getSummary().isBlank())) {
                                String line = (topStrength != null && topArea != null)
                                                ? "Doing well in " + topStrength + "; focus next on " + topArea + "."
                                                : (status != null ? "Overall status: " + status + "." : null);
                                if (line != null) {
                                        if (report.getAiInsights() == null) {
                                                report.setAiInsights(AiInsightsSection.builder().summary(line).build());
                                        } else {
                                                report.getAiInsights().setSummary(line);
                                        }
                                }
                        }

                        // ── Cross-domain insights floor: observations connecting two sections, when the LLM gave none.
                        AiInsightsSection aiNow = report.getAiInsights();
                        boolean noCross = aiNow == null || aiNow.getCrossDomainInsights() == null
                                        || aiNow.getCrossDomainInsights().isEmpty();
                        if (noCross) {
                                java.util.List<String> cross = buildCrossDomainInsights(report);
                                if (!cross.isEmpty()) {
                                        if (aiNow == null) {
                                                report.setAiInsights(AiInsightsSection.builder().crossDomainInsights(cross).build());
                                        } else {
                                                aiNow.setCrossDomainInsights(cross);
                                        }
                                }
                        }

                        // ── Narrative floor: guarantee the "Detailed analysis" panel is never blank when the
                        // LLM timed out or returned no narrative. Built ONLY from values already in the report
                        // (no invented numbers) and reuses the strengths / areas / recommendations set above.
                        if (report.getNarrative() == null) {
                                NarrativeSection nf = buildDeterministicNarrative(report);
                                if (nf != null) report.setNarrative(nf);
                        }
                } catch (Exception e) {
                        log.warn("[Student-Analysis-Processor] [v2] ensureInsightsFromFacts fallback failed (non-fatal): {}", e.getMessage());
                }
        }

        /**
         * Best-effort upgrade of {@code report.subjectMarks.subjects} from the deterministic
         * DB-subject-hint grouping (already set by {@code SubjectMarksCollector}) to LLM-clustered
         * subject domains. On any exception, timeout, or empty LLM result, the deterministic
         * grouping already on the report is left untouched — never fails report generation.
         */
        private void clusterSubjectMarksSafe(ComprehensiveStudentReport report,
                        ComprehensiveReportLLMService.ChargeContext charge) {
                try {
                        var subjectMarks = report.getSubjectMarks();
                        if (subjectMarks == null || !subjectMarks.isAvailable()
                                        || subjectMarks.getItems() == null || subjectMarks.getItems().isEmpty()) {
                                return;
                        }

                        var clustered = comprehensiveLLMService.clusterSubjectMarks(subjectMarks.getItems(), charge)
                                        .blockOptional(Duration.ofSeconds(60))
                                        .orElse(null);

                        // Only trust the LLM clustering when every subject is arithmetically sane
                        // (0 < obtained <= total). The model can mis-sum or hallucinate marks, which
                        // would render an impossible >100% donut; in that case keep the deterministic
                        // grouping (already correct) instead.
                        boolean allValid = clustered != null && !clustered.isEmpty()
                                        && clustered.stream().allMatch(s ->
                                                s.getMarksObtained() != null && s.getTotalMarks() != null
                                                        && s.getTotalMarks() > 0
                                                        && s.getMarksObtained() <= s.getTotalMarks() + 0.01);
                        if (allValid) {
                                subjectMarks.setSubjects(clustered);
                                log.info("[Student-Analysis-Processor] [v2] Subject-marks LLM clustering applied ({} subjects)",
                                                clustered.size());
                        } else {
                                log.info("[Student-Analysis-Processor] [v2] Subject-marks LLM clustering empty/invalid; keeping deterministic grouping.");
                        }
                } catch (Exception e) {
                        log.warn("[Student-Analysis-Processor] [v2] Subject-marks LLM clustering failed (non-fatal), keeping deterministic grouping: {}",
                                        e.getMessage());
                }
        }

        /**
         * Deterministic cross-domain observations — each connects two sections and only fires when
         * both sides have data. Uses only values already in the report (no invented numbers). Capped at 4.
         */
        private java.util.List<String> buildCrossDomainInsights(ComprehensiveStudentReport report) {
                java.util.List<String> out = new java.util.ArrayList<>();

                Double attendance = (report.getAttendance() != null && report.getAttendance().isAvailable())
                                ? report.getAttendance().getOverallPercentage() : null;
                Double avgScore = (report.getAcademics() != null && report.getAcademics().isAvailable())
                                ? report.getAcademics().getAveragePercentage() : null;
                Double completion = (report.getCourseProgress() != null && report.getCourseProgress().isAvailable())
                                ? report.getCourseProgress().getOverallCompletionPercentage() : null;
                Integer late = (report.getAssignments() != null && report.getAssignments().isAvailable())
                                ? report.getAssignments().getLate() : null;
                Integer submitted = (report.getAssignments() != null && report.getAssignments().isAvailable())
                                ? report.getAssignments().getSubmitted() : null;
                Double consistency = null;
                if (report.getStudyHabits() != null && report.getStudyHabits().isAvailable()
                                && report.getStudyHabits().getActiveDays() != null
                                && report.getStudyHabits().getTotalDays() != null
                                && report.getStudyHabits().getTotalDays() > 0) {
                        consistency = report.getStudyHabits().getActiveDays() * 100.0
                                        / report.getStudyHabits().getTotalDays();
                }
                Integer doubtsAsked = (report.getDoubtsAndEngagement() != null
                                && report.getDoubtsAndEngagement().isAvailable())
                                ? report.getDoubtsAndEngagement().getQuestionsAsked() : null;

                // Attendance vs marks
                if (attendance != null && avgScore != null) {
                        if (attendance >= 80 && avgScore < 50) {
                                out.add("Attendance is strong (" + Math.round(attendance) + "%) but assessment scores are low ("
                                                + Math.round(avgScore) + "%) — being present isn't yet translating into marks.");
                        } else if (attendance < 60 && avgScore >= 70) {
                                out.add("Scores are good (" + Math.round(avgScore) + "%) despite lower attendance ("
                                                + Math.round(attendance) + "%) — attending more classes could push results even higher.");
                        } else if (attendance >= 80 && avgScore >= 70) {
                                out.add("Consistent attendance (" + Math.round(attendance) + "%) is reflected in strong scores ("
                                                + Math.round(avgScore) + "%).");
                        }
                }
                // Study consistency vs marks
                if (consistency != null && avgScore != null) {
                        if (consistency >= 70 && avgScore < 50) {
                                out.add("Study time is consistent but scores lag — the focus may need to shift to targeted practice.");
                        } else if (consistency < 40 && avgScore >= 70) {
                                out.add("Strong scores on limited active days — a steadier study routine could compound results.");
                        }
                }
                // Course progress vs assignment timeliness
                if (completion != null && late != null && late > 0 && completion >= 70) {
                        out.add("Course progress is on track (" + Math.round(completion) + "%) but " + late
                                        + " assignment(s) were submitted late — tighter deadlines would help.");
                }
                // Help-seeking vs marks
                if (doubtsAsked != null && avgScore != null) {
                        if (doubtsAsked == 0 && avgScore < 50) {
                                out.add("No doubts were raised despite lower scores — encouraging questions could help close gaps.");
                        }
                }
                // Assignment engagement vs marks
                if (submitted != null && submitted == 0 && avgScore != null && avgScore < 60) {
                        out.add("No assignments were submitted this period, which may be holding scores back.");
                }

                return out.size() > 4 ? out.subList(0, 4) : out;
        }

        /**
         * A topic can't be both a strength and an area to improve, but the model sometimes rates
         * one good test and one bad test of the same subject separately (Accountancy 72 in
         * strengths, Accountancy 40 in areas). Keep each such topic once, on the side its overall
         * fact score supports (the average of the two model ratings when there is no fact score),
         * then order strengths best-first and areas weakest-first.
         */
        private void resolveStrengthAreaOverlap(ComprehensiveStudentReport report,
                        java.util.Map<String, Integer> topicScores) {
                java.util.List<TopicConfidence> strengths = report.getStrengths();
                java.util.List<TopicConfidence> areas = report.getAreasToImprove();
                if (strengths == null || areas == null || strengths.isEmpty() || areas.isEmpty()) return;

                java.util.Map<String, Integer> factByKey = new java.util.HashMap<>();
                topicScores.forEach((k, v) -> factByKey.putIfAbsent(topicKey(k), v));

                java.util.List<TopicConfidence> keptStrengths = new java.util.ArrayList<>();
                java.util.List<TopicConfidence> keptAreas = new java.util.ArrayList<>(areas);
                for (TopicConfidence s : strengths) {
                        TopicConfidence twin = keptAreas.stream()
                                        .filter(a -> topicKey(a.getTopic()).equals(topicKey(s.getTopic())))
                                        .findFirst().orElse(null);
                        if (twin == null) {
                                keptStrengths.add(s);
                                continue;
                        }
                        keptAreas.remove(twin);
                        Integer fact = factByKey.get(topicKey(s.getTopic()));
                        int score = fact != null ? fact
                                        : (int) Math.round((nz(s.getConfidence()) + nz(twin.getConfidence())) / 2.0);
                        if (score >= 60) keptStrengths.add(topic(s.getTopic(), score));
                        else keptAreas.add(topic(s.getTopic(), score));
                }
                keptStrengths.sort((a, b) -> Integer.compare(nz(b.getConfidence()), nz(a.getConfidence())));
                keptAreas.sort((a, b) -> Integer.compare(nz(a.getConfidence()), nz(b.getConfidence())));
                report.setStrengths(keptStrengths);
                report.setAreasToImprove(keptAreas);
        }

        private static java.util.Set<String> topicKeys(java.util.List<TopicConfidence> topics) {
                java.util.Set<String> keys = new java.util.HashSet<>();
                if (topics != null) topics.forEach(t -> keys.add(topicKey(t.getTopic())));
                return keys;
        }

        private static String topicKey(String topic) {
                return topic == null ? "" : topic.trim().toLowerCase(java.util.Locale.ROOT);
        }

        private static int nz(Integer v) {
                return v == null ? 0 : v;
        }

        private static TopicConfidence topic(String name, int confidence) {
                return TopicConfidence.builder().topic(name).confidence(confidence).build();
        }

        private static AiInsightsSection.RecommendationItem rec(String priority, String area, String suggestion) {
                return AiInsightsSection.RecommendationItem.builder()
                                .priority(priority).area(area).suggestion(suggestion).build();
        }

        /**
         * Builds a plain, facts-only {@link NarrativeSection} so the "Detailed analysis" panel is never
         * blank when the Layer-2 LLM timed out or returned no narrative. Uses ONLY values already on the
         * report — attendance, study habits, academics, course progress, assignments, and the
         * strengths / areas / recommendations that {@link #ensureInsightsFromFacts} derived just above —
         * and invents no numbers. Returns null only when there is genuinely nothing to say.
         */
        private NarrativeSection buildDeterministicNarrative(ComprehensiveStudentReport report) {
                String name = (report.getStudent() != null && report.getStudent().getName() != null)
                                ? report.getStudent().getName() : "The student";

                NarrativeSection.NarrativeSectionBuilder b = NarrativeSection.builder();
                boolean any = false;

                var sh = report.getStudyHabits();
                var att = report.getAttendance();
                var ac = report.getAcademics();
                var cp = report.getCourseProgress();
                var asg = report.getAssignments();

                // learning_frequency — study habits + attendance
                if ((sh != null && sh.isAvailable()) || (att != null && att.isAvailable())) {
                        StringBuilder md = new StringBuilder("### Learning frequency\n\n");
                        if (sh != null && sh.isAvailable() && sh.getActiveDays() != null && sh.getTotalDays() != null) {
                                md.append(name).append(" was active on **").append(sh.getActiveDays())
                                                .append(" of ").append(sh.getTotalDays()).append(" days**");
                                if (sh.getConsistencyRating() != null)
                                        md.append(" (").append(sh.getConsistencyRating().toLowerCase()).append(" consistency)");
                                if (sh.getAvgMinutesPerDay() != null)
                                        md.append(", averaging **").append(sh.getAvgMinutesPerDay()).append(" min/day**");
                                if (sh.getLongestStreakDays() != null)
                                        md.append(", with a longest streak of **").append(sh.getLongestStreakDays()).append(" day(s)**");
                                md.append(".");
                        }
                        if (att != null && att.isAvailable() && att.getOverallPercentage() != null) {
                                md.append(" Class attendance was **").append(Math.round(att.getOverallPercentage())).append("%**");
                                if (att.getPresent() != null && att.getAbsent() != null && att.getTotalSessions() != null)
                                        md.append(" (").append(att.getPresent()).append(" present / ")
                                                        .append(att.getAbsent()).append(" absent of ")
                                                        .append(att.getTotalSessions()).append(" sessions)");
                                md.append(".");
                        }
                        b.learningFrequency(md.toString());
                        any = true;
                }

                // progress — overview + academics + course completion
                var ov = report.getOverview();
                if (ov != null || (ac != null && ac.isAvailable()) || (cp != null && cp.isAvailable())) {
                        StringBuilder md = new StringBuilder("### Progress\n\n");
                        if (ov != null && ov.getOverallStatus() != null) {
                                md.append(name).append("'s overall status is **").append(ov.getOverallStatus()).append("**");
                                if (ov.getOverallGrade() != null)
                                        md.append(" with an overall grade of **").append(ov.getOverallGrade()).append("**");
                                md.append(".");
                        }
                        if (ac != null && ac.isAvailable() && ac.getAveragePercentage() != null) {
                                md.append(" Average score was **").append(Math.round(ac.getAveragePercentage())).append("%**");
                                if (ac.getClassAveragePercentage() != null)
                                        md.append(" against a class average of **")
                                                        .append(Math.round(ac.getClassAveragePercentage())).append("%**");
                                md.append(".");
                        }
                        if (cp != null && cp.isAvailable() && cp.getOverallCompletionPercentage() != null)
                                md.append(" Course completion stands at **")
                                                .append(Math.round(cp.getOverallCompletionPercentage())).append("%**.");
                        b.progress(md.toString());
                        any = true;
                }

                // student_efforts — small table of effort signals
                java.util.List<String[]> rows = new java.util.ArrayList<>();
                if (sh != null && sh.isAvailable()) {
                        if (sh.getTotalStudyHours() != null)
                                rows.add(new String[] { "Study time", fmt1(sh.getTotalStudyHours()) + " hrs" });
                        if (sh.getActiveDays() != null && sh.getTotalDays() != null)
                                rows.add(new String[] { "Active days", sh.getActiveDays() + "/" + sh.getTotalDays() });
                }
                if (ac != null && ac.isAvailable() && ac.getAveragePercentage() != null)
                        rows.add(new String[] { "Avg. score", Math.round(ac.getAveragePercentage()) + "%" });
                if (asg != null && asg.isAvailable() && asg.getSubmitted() != null)
                        rows.add(new String[] { "Assignments submitted", String.valueOf(asg.getSubmitted()) });
                if (!rows.isEmpty()) {
                        StringBuilder md = new StringBuilder("### Effort vs. output\n\n| Signal | Value |\n| --- | --- |\n");
                        for (String[] r : rows) md.append("| ").append(r[0]).append(" | ").append(r[1]).append(" |\n");
                        b.studentEfforts(md.toString());
                        any = true;
                }

                // topics_of_improvement — strengths
                if (report.getStrengths() != null && !report.getStrengths().isEmpty()) {
                        StringBuilder md = new StringBuilder("### Topics improving\n\n");
                        for (TopicConfidence t : report.getStrengths())
                                md.append("- **").append(t.getTopic()).append("**")
                                                .append(t.getConfidence() != null ? " — " + t.getConfidence() + "%" : "").append("\n");
                        b.topicsOfImprovement(md.toString());
                        any = true;
                }

                // topics_of_degradation — areas to improve
                if (report.getAreasToImprove() != null && !report.getAreasToImprove().isEmpty()) {
                        StringBuilder md = new StringBuilder("### Topics needing attention\n\n");
                        for (TopicConfidence t : report.getAreasToImprove())
                                md.append("- ⚠️ **").append(t.getTopic()).append("**")
                                                .append(t.getConfidence() != null ? " — " + t.getConfidence() + "%" : "").append("\n");
                        b.topicsOfDegradation(md.toString());
                        any = true;
                }

                // remedial_points — checklist from recommendations (fallback: areas-to-improve)
                java.util.List<String> actions = new java.util.ArrayList<>();
                if (report.getAiInsights() != null && report.getAiInsights().getRecommendations() != null)
                        report.getAiInsights().getRecommendations().forEach(r -> {
                                if (r.getSuggestion() != null) actions.add(r.getSuggestion());
                        });
                if (actions.isEmpty() && report.getAreasToImprove() != null)
                        report.getAreasToImprove().forEach(t ->
                                        actions.add("Strengthen " + t.getTopic() + " with focused practice."));
                if (!actions.isEmpty()) {
                        StringBuilder md = new StringBuilder("### Action checklist\n\n");
                        for (String a : actions) md.append("- [ ] ").append(a).append("\n");
                        b.remedialPoints(md.toString());
                        any = true;
                }

                return any ? b.build() : null;
        }

        /** Formats a double as an integer when whole, else one decimal (US locale). */
        private static String fmt1(double d) {
                return d == Math.floor(d) ? String.valueOf((long) d) : String.format(java.util.Locale.US, "%.1f", d);
        }

        /** Fire learner notifications without ever affecting report generation. */
        private void notifyLearnerSafe(StudentAnalysisProcess process) {
                try {
                        studentReportNotificationService.notifyLearner(process);
                } catch (Exception e) {
                        log.error("[Student-Analysis-Processor] Learner notification failed for processId={} (non-fatal): {}",
                                        process.getId(), e.getMessage());
                }
        }
}
