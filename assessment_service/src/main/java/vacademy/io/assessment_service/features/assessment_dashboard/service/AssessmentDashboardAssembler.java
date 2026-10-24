package vacademy.io.assessment_service.features.assessment_dashboard.service;

import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.AssessmentRow;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.BatchStats;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.DailyPoint;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.EvaluatorStats;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.HeatCell;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.LearnerStats;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.ScoreBucket;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.Summary;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.TypeSlice;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;

/**
 * Pure arithmetic of the Assessment Dashboard: rows in, numbers out, no I/O, so every
 * definition below is pinned by a unit test.
 *
 * <h3>Definitions (the part people will question)</h3>
 * <ul>
 *   <li><b>Audience</b> of a test = learners ACTIVE in its assigned batches (enrolled on or
 *       before the day it closed) plus everyone registered for it (pre-registered by an
 *       admin, or signed up through the public link). With a batch filter, only learners of
 *       the picked batches count, and only their attempts.</li>
 *   <li><b>Attempted</b> = has a submitted (ENDED) attempt. A preview does not count.</li>
 *   <li><b>Participation</b> = attempted / audience over <i>closed</i> scheduled tests only.
 *       Anytime tests (mocks, practice) never close, so a share of the whole batch over a
 *       few days says little and is kept out of the headline.</li>
 *   <li><b>Score</b> = the learner's latest submitted attempt, marks / the paper's maximum
 *       (sum of its sections). Counted only once evaluated (COMPLETED), with a positive
 *       maximum the learner did not exceed — same rule as the scheduled institute report.
 *       Negative scores are real (negative marking) and are kept.</li>
 *   <li><b>Anytime tests</b> count only attempts started inside the range.</li>
 *   <li><b>Who checked a copy</b> (evaluated submissions only): the teacher on its latest
 *       manual-evaluation log; else AI when an AI evaluation run completed; else
 *       auto-graded when the test is not manually evaluated; else "other" (marks entered
 *       without the checking tool, e.g. offline entry).</li>
 * </ul>
 */
public final class AssessmentDashboardAssembler {

    private AssessmentDashboardAssembler() {
    }

    public static final String LIVE = "LIVE";
    public static final String UPCOMING = "UPCOMING";
    public static final String CLOSED = "CLOSED";
    public static final String OPEN = "OPEN";

    public static final int ASSESSMENTS_LIMIT = 1000;
    public static final int LEARNERS_LIMIT = 300;
    public static final int TOP_LEARNERS = 10;
    public static final double LOW_SCORE_BELOW = 0.4;
    public static final List<Integer> MISSED_THRESHOLDS = List.of(1, 2, 3, 5);

    private static final Set<String> EVALUATED = Set.of("COMPLETED", "AI_EVALUATION_COMPLETED");
    private static final Set<String> BATCH_SOURCES = Set.of("BATCH_PREVIEW_REGISTRATION", "BATCH");

    // ─── Inputs ────────────────────────────────────────────────────────────

    /** {@code end} is null for an anytime test (published with no real closing time). */
    public record TestInfo(String id, String name, String playMode, String evaluationType, String visibility,
                           Instant start, Instant end, Integer durationMinutes, String subjectId,
                           Double maxMarks) {
    }

    /** One registration, with one attempt ({@code attemptId} null when it has none). */
    public record AttemptRow(String assessmentId, String userId, String source, String sourceId,
                             String participantName, String email, String phone,
                             String attemptId, String status, String resultStatus, String releaseStatus,
                             Double totalMarks, Instant startTime, Instant submitTime, Long timeSeconds) {
    }

    public record Enrollment(String userId, String batchId, LocalDate enrolledDate,
                             String name, String email, String mobile) {
    }

    /** The latest manual-evaluation log of an attempt: who checked it and how long it took. */
    public record EvalLog(String authorId, Long timeSeconds, Instant at) {
    }

    /** Inclusive calendar days in {@code zone}. */
    public record Period(LocalDate startDate, LocalDate endDate, ZoneId zone) {
        public Instant start() {
            return startDate.atStartOfDay(zone).toInstant();
        }

        /** Exclusive: midnight after {@code endDate}. */
        public Instant end() {
            return endDate.plusDays(1).atStartOfDay(zone).toInstant();
        }

        boolean contains(Instant instant) {
            return instant != null && !instant.isBefore(start()) && instant.isBefore(end());
        }
    }

    /** Empty sets mean "no filter". Play modes are compared upper-case. */
    public record Filters(Set<String> batchIds, Set<String> playModes) {
        public Filters {
            batchIds = batchIds == null ? Set.of() : batchIds;
            playModes = playModes == null ? Set.of() : playModes;
        }
    }

    /**
     * Everything one period needs. {@code enrollmentsByBatch} is null when batch membership
     * could not be loaded; the audience then falls back to registered learners.
     */
    public record Input(Period period, Instant now, List<TestInfo> tests, Map<String, List<String>> batchesByTest,
                        List<AttemptRow> attempts, Map<String, List<Enrollment>> enrollmentsByBatch,
                        Filters filters, Map<String, EvalLog> evaluationLogs, Set<String> aiCheckedAttempts) {
        public Input {
            evaluationLogs = evaluationLogs == null ? Map.of() : evaluationLogs;
            aiCheckedAttempts = aiCheckedAttempts == null ? Set.of() : aiCheckedAttempts;
        }

        /** Without checking records — who checked what is then unknown. */
        public Input(Period period, Instant now, List<TestInfo> tests, Map<String, List<String>> batchesByTest,
                     List<AttemptRow> attempts, Map<String, List<Enrollment>> enrollmentsByBatch, Filters filters) {
            this(period, now, tests, batchesByTest, attempts, enrollmentsByBatch, filters, Map.of(), Set.of());
        }
    }

    // ─── Per-test evaluation ───────────────────────────────────────────────

    /** A learner as the dashboard shows them, with the batch they are counted under. */
    static final class Person {
        final String userId;
        String name;
        String email;
        String mobile;
        String batchId;

        Person(String userId, String name, String email, String mobile, String batchId) {
            this.userId = userId;
            this.name = name;
            this.email = email;
            this.mobile = mobile;
            this.batchId = batchId;
        }

        void fillFrom(Person other) {
            if (isBlank(name)) name = other.name;
            if (isBlank(email)) email = other.email;
            if (isBlank(mobile)) mobile = other.mobile;
            if (batchId == null) batchId = other.batchId;
        }
    }

    /** One test after filters: who was set it, who sat it, and how it went. */
    static final class TestEval {
        final TestInfo test;
        final String status;
        final boolean inRange;
        final List<String> batches;
        final Map<String, Person> audience = new LinkedHashMap<>();
        final List<AttemptRow> submissions = new ArrayList<>();
        /** Latest submitted attempt per learner. */
        final Map<String, AttemptRow> latest = new LinkedHashMap<>();
        final Set<String> inProgress = new HashSet<>();
        /** Score per learner (latest attempt), only where it is usable. */
        final Map<String, Double> scores = new LinkedHashMap<>();
        /** Evaluated submissions checked by a teacher: attempt id → that teacher's log. */
        final Map<String, EvalLog> teacherChecks = new LinkedHashMap<>();
        int aiChecked;
        int autoGraded;
        int otherEvaluated;

        TestEval(TestInfo test, String status, boolean inRange, List<String> batches) {
            this.test = test;
            this.status = status;
            this.inRange = inRange;
            this.batches = batches;
        }

        boolean countsForParticipation() {
            return inRange && CLOSED.equals(status);
        }

        int attemptedInAudience() {
            int n = 0;
            for (String userId : latest.keySet()) {
                if (audience.containsKey(userId)) n++;
            }
            return n;
        }
    }

    public static String statusOf(TestInfo test, Instant now) {
        if (test.end() == null) return OPEN;
        if (now.isBefore(test.start())) return UPCOMING;
        if (now.isAfter(test.end())) return CLOSED;
        return LIVE;
    }

    static String upper(String s) {
        return s == null ? "" : s.toUpperCase(Locale.ROOT);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /** Usable score (fraction) of an attempt, or null. */
    static Double scoreOf(AttemptRow attempt, Double maxMarks) {
        if (attempt == null || !"COMPLETED".equals(attempt.resultStatus())) return null;
        if (maxMarks == null || maxMarks <= 0 || attempt.totalMarks() == null) return null;
        if (attempt.totalMarks() > maxMarks) return null;
        return attempt.totalMarks() / maxMarks;
    }

    private static Instant submittedAt(AttemptRow a) {
        return a.submitTime() != null ? a.submitTime() : a.startTime();
    }

    /** Batches each learner is enrolled in (any date) — used to attribute registrations. */
    static Map<String, Set<String>> batchesByUser(Map<String, List<Enrollment>> enrollmentsByBatch) {
        Map<String, Set<String>> out = new HashMap<>();
        if (enrollmentsByBatch == null) return out;
        enrollmentsByBatch.forEach((batchId, rows) -> {
            for (Enrollment e : rows) {
                if (e.userId() != null) out.computeIfAbsent(e.userId(), k -> new HashSet<>()).add(batchId);
            }
        });
        return out;
    }

    /** The batch (among {@code candidates}) a registered learner belongs to, or null. */
    static String batchOf(AttemptRow reg, Collection<String> candidates, Map<String, Set<String>> userBatches) {
        Set<String> mine = userBatches.getOrDefault(reg.userId(), Set.of());
        for (String b : candidates) {
            if (mine.contains(b)) return b;
        }
        if (BATCH_SOURCES.contains(upper(reg.source())) && reg.sourceId() != null && candidates.contains(reg.sourceId())) {
            return reg.sourceId();
        }
        return null;
    }

    static boolean userInBatch(String userId, String batchId, Map<String, Set<String>> userBatches,
                               Map<String, AttemptRow> firstRegByUser) {
        if (userBatches.getOrDefault(userId, Set.of()).contains(batchId)) return true;
        AttemptRow reg = firstRegByUser.get(userId);
        return reg != null && BATCH_SOURCES.contains(upper(reg.source())) && batchId.equals(reg.sourceId());
    }

    /** Tests that pass the filters, evaluated. Play modes seen before the mode filter go to {@code modesOut}. */
    static List<TestEval> evaluate(Input in, Set<String> modesOut) {
        Map<String, List<AttemptRow>> byTest = groupByTest(in.attempts());
        Map<String, Set<String>> userBatches = batchesByUser(in.enrollmentsByBatch());
        List<TestEval> out = new ArrayList<>();
        for (TestInfo t : in.tests()) {
            List<String> batches = filteredBatches(t, in);
            if (batches == null) continue;
            boolean inRange = isInRange(t, in.period());
            if (inRange) modesOut.add(upper(t.playMode()));
            if (!in.filters().playModes().isEmpty() && !in.filters().playModes().contains(upper(t.playMode()))) {
                continue;
            }
            TestEval ev = new TestEval(t, statusOf(t, in.now()), inRange, batches);
            List<AttemptRow> regs = byTest.getOrDefault(t.id(), List.of());
            addBatchAudience(ev, in, enrolmentCutoff(t, in));
            addRegisteredAudience(ev, regs, userBatches, !in.filters().batchIds().isEmpty());
            collectAttempts(ev, regs, in.period());
            classifyChecks(ev, in);
            ev.latest.forEach((userId, a) -> {
                Double score = scoreOf(a, t.maxMarks());
                if (score != null) ev.scores.put(userId, score);
            });
            out.add(ev);
        }
        return out;
    }

    private static Map<String, List<AttemptRow>> groupByTest(List<AttemptRow> attempts) {
        Map<String, List<AttemptRow>> byTest = new HashMap<>();
        for (AttemptRow row : attempts) {
            if (row.userId() != null) {
                byTest.computeIfAbsent(row.assessmentId(), k -> new ArrayList<>()).add(row);
            }
        }
        return byTest;
    }

    /** The test's batches narrowed to the batch filter; null when the filter excludes the test. */
    private static List<String> filteredBatches(TestInfo t, Input in) {
        List<String> assigned = in.batchesByTest().getOrDefault(t.id(), List.of());
        Set<String> picked = in.filters().batchIds();
        if (picked.isEmpty()) return assigned;
        List<String> batches = assigned.stream().filter(picked::contains).toList();
        return batches.isEmpty() ? null : batches;
    }

    private static boolean isInRange(TestInfo t, Period period) {
        return t.end() == null || (t.start().isBefore(period.end()) && !t.end().isBefore(period.start()));
    }

    /** Learners who joined a batch after the test closed were never set it. */
    private static LocalDate enrolmentCutoff(TestInfo t, Input in) {
        if (t.end() == null) return in.period().endDate();
        Instant until = t.end().isBefore(in.now()) ? t.end() : in.now();
        return LocalDate.ofInstant(until, in.period().zone());
    }

    private static void addBatchAudience(TestEval ev, Input in, LocalDate cutoff) {
        if (in.enrollmentsByBatch() == null) return;
        for (String b : ev.batches) {
            for (Enrollment e : in.enrollmentsByBatch().getOrDefault(b, List.of())) {
                boolean lateJoiner = e.enrolledDate() != null && e.enrolledDate().isAfter(cutoff);
                if (e.userId() != null && !lateJoiner) {
                    ev.audience.computeIfAbsent(e.userId(), k -> new Person(k, e.name(), e.email(), e.mobile(), b));
                }
            }
        }
    }

    /** Everyone registered is in the audience — with a batch filter, only those of the picked batches. */
    private static void addRegisteredAudience(TestEval ev, List<AttemptRow> regs, Map<String, Set<String>> userBatches,
                                              boolean batchFiltered) {
        for (AttemptRow r : regs) {
            String batch = batchOf(r, ev.batches, userBatches);
            if (batchFiltered && batch == null) continue;
            Person fromReg = new Person(r.userId(), r.participantName(), r.email(), r.phone(), batch);
            Person existing = ev.audience.putIfAbsent(r.userId(), fromReg);
            if (existing != null) existing.fillFrom(fromReg);
        }
    }

    static boolean isEvaluated(AttemptRow a) {
        return EVALUATED.contains(upper(a.resultStatus()));
    }

    /** Who checked each evaluated submission — see the class comment for the order. */
    private static void classifyChecks(TestEval ev, Input in) {
        boolean manualTest = "MANUAL".equals(upper(ev.test.evaluationType()));
        for (AttemptRow a : ev.submissions) {
            if (!isEvaluated(a)) continue;
            EvalLog log = in.evaluationLogs().get(a.attemptId());
            if (log != null) ev.teacherChecks.put(a.attemptId(), log);
            else if (in.aiCheckedAttempts().contains(a.attemptId())) ev.aiChecked++;
            else if (!manualTest) ev.autoGraded++;
            else ev.otherEvaluated++;
        }
    }

    /** Submitted attempts (latest per learner) and who is writing now; anytime tests only count the range. */
    private static void collectAttempts(TestEval ev, List<AttemptRow> regs, Period period) {
        for (AttemptRow r : regs) {
            if (r.attemptId() == null || !ev.audience.containsKey(r.userId())) continue;
            if (ev.test.end() == null && !period.contains(r.startTime())) continue;
            String status = upper(r.status());
            if ("ENDED".equals(status)) {
                ev.submissions.add(r);
                AttemptRow prev = ev.latest.get(r.userId());
                if (prev == null || isAfter(submittedAt(r), submittedAt(prev))) {
                    ev.latest.put(r.userId(), r);
                }
            } else if (LIVE.equals(status)) {
                ev.inProgress.add(r.userId());
            }
        }
    }

    private static boolean isAfter(Instant a, Instant b) {
        if (a == null) return false;
        if (b == null) return true;
        return a.isAfter(b);
    }

    // ─── Summary ───────────────────────────────────────────────────────────

    static Summary summarize(List<TestEval> evals) {
        Summary s = new Summary();
        Set<String> learners = new HashSet<>();
        List<Double> scores = new ArrayList<>();
        double timeSum = 0;
        int timeCount = 0;
        double shareSum = 0;
        int shareCount = 0;
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            s.setTotalAssessments(s.getTotalAssessments() + 1);
            switch (ev.status) {
                case LIVE -> s.setLiveAssessments(s.getLiveAssessments() + 1);
                case UPCOMING -> s.setUpcomingAssessments(s.getUpcomingAssessments() + 1);
                case CLOSED -> s.setClosedAssessments(s.getClosedAssessments() + 1);
                default -> s.setOpenAssessments(s.getOpenAssessments() + 1);
            }
            if (ev.countsForParticipation()) {
                s.setExpectedLearners(s.getExpectedLearners() + ev.audience.size());
                s.setAttemptedLearners(s.getAttemptedLearners() + ev.attemptedInAudience());
            }
            s.setSubmissions(s.getSubmissions() + ev.submissions.size());
            s.setInProgress(s.getInProgress() + ev.inProgress.size());
            s.setCheckedByTeacher(s.getCheckedByTeacher() + ev.teacherChecks.size());
            s.setCheckedByAi(s.getCheckedByAi() + ev.aiChecked);
            s.setAutoGraded(s.getAutoGraded() + ev.autoGraded);
            s.setEvaluatedOther(s.getEvaluatedOther() + ev.otherEvaluated);
            learners.addAll(ev.latest.keySet());
            scores.addAll(ev.scores.values());
            for (AttemptRow a : ev.submissions) {
                if (EVALUATED.contains(upper(a.resultStatus()))) {
                    s.setEvaluated(s.getEvaluated() + 1);
                    if ("PENDING".equals(upper(a.releaseStatus()))) {
                        s.setAwaitingRelease(s.getAwaitingRelease() + 1);
                    }
                } else {
                    s.setAwaitingEvaluation(s.getAwaitingEvaluation() + 1);
                }
                if (a.timeSeconds() != null && a.timeSeconds() > 0) {
                    timeSum += a.timeSeconds() / 60.0;
                    timeCount++;
                    Integer duration = ev.test.durationMinutes();
                    if (duration != null && duration > 0) {
                        shareSum += Math.min(1.0, a.timeSeconds() / (duration * 60.0));
                        shareCount++;
                    }
                }
            }
        }
        s.setNotAttempted(Math.max(0, s.getExpectedLearners() - s.getAttemptedLearners()));
        s.setParticipationRate(ratio(s.getAttemptedLearners(), s.getExpectedLearners()));
        s.setUniqueLearners(learners.size());
        s.setScored(scores.size());
        s.setAvgScore(mean(scores));
        s.setHighestScore(scores.stream().max(Double::compare).map(AssessmentDashboardAssembler::round4).orElse(null));
        s.setAvgTimeMinutes(timeCount == 0 ? null : round4(timeSum / timeCount));
        s.setAvgTimeShare(shareCount == 0 ? null : round4(shareSum / shareCount));
        return s;
    }

    // ─── Breakdowns ────────────────────────────────────────────────────────

    static List<DailyPoint> daily(List<TestEval> evals, Period period) {
        ZoneId zone = period.zone();
        Map<LocalDate, int[]> counts = new TreeMap<>();
        Map<LocalDate, Set<String>> learners = new HashMap<>();
        Map<LocalDate, List<Double>> scores = new HashMap<>();
        for (LocalDate d = period.startDate(); !d.isAfter(period.endDate()); d = d.plusDays(1)) {
            counts.put(d, new int[2]);
        }
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            int[] opening = counts.get(LocalDate.ofInstant(ev.test.start(), zone));
            if (opening != null) opening[0]++;
            for (AttemptRow a : ev.submissions) {
                Instant at = submittedAt(a);
                if (at == null) continue;
                LocalDate day = LocalDate.ofInstant(at, zone);
                int[] c = counts.get(day);
                if (c == null) continue;
                c[1]++;
                learners.computeIfAbsent(day, k -> new HashSet<>()).add(a.userId());
            }
            ev.scores.forEach((userId, score) -> {
                Instant at = submittedAt(ev.latest.get(userId));
                if (at == null) return;
                LocalDate day = LocalDate.ofInstant(at, zone);
                if (counts.containsKey(day)) scores.computeIfAbsent(day, k -> new ArrayList<>()).add(score);
            });
        }
        List<DailyPoint> out = new ArrayList<>();
        counts.forEach((day, c) -> out.add(DailyPoint.builder()
                .date(day.toString())
                .assessments(c[0])
                .submissions(c[1])
                .learners(learners.getOrDefault(day, Set.of()).size())
                .avgScore(mean(scores.getOrDefault(day, List.of())))
                .build()));
        return out;
    }

    static List<ScoreBucket> scoreDistribution(List<TestEval> evals) {
        int[] buckets = new int[10];
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            for (double score : ev.scores.values()) {
                buckets[Math.min(9, Math.max(0, (int) Math.floor(score * 10)))]++;
            }
        }
        List<ScoreBucket> out = new ArrayList<>();
        for (int i = 0; i < 10; i++) out.add(new ScoreBucket(i * 10, buckets[i]));
        return out;
    }

    static List<HeatCell> heatmap(List<TestEval> evals, ZoneId zone) {
        Map<Integer, int[]> cells = new TreeMap<>();
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            for (AttemptRow a : ev.submissions) {
                Instant at = submittedAt(a);
                if (at == null) continue;
                ZonedDateTime z = at.atZone(zone);
                int weekday = z.getDayOfWeek().getValue() - 1;
                cells.computeIfAbsent(weekday * 24 + z.getHour(), k -> new int[1])[0]++;
            }
        }
        List<HeatCell> out = new ArrayList<>();
        cells.forEach((key, c) -> out.add(new HeatCell(key / 24, key % 24, c[0])));
        return out;
    }

    static List<TypeSlice> types(List<TestEval> evals) {
        Map<String, TypeSlice> byMode = new LinkedHashMap<>();
        Map<String, List<Double>> scores = new HashMap<>();
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            String mode = upper(ev.test.playMode());
            TypeSlice slice = byMode.computeIfAbsent(mode, k -> TypeSlice.builder().playMode(k).build());
            slice.setAssessments(slice.getAssessments() + 1);
            slice.setSubmissions(slice.getSubmissions() + ev.submissions.size());
            scores.computeIfAbsent(mode, k -> new ArrayList<>()).addAll(ev.scores.values());
        }
        byMode.forEach((mode, slice) -> slice.setAvgScore(mean(scores.get(mode))));
        return byMode.values().stream()
                .sorted(Comparator.comparingInt(TypeSlice::getAssessments).reversed())
                .toList();
    }

    static List<BatchStats> batches(List<TestEval> evals, Map<String, List<Enrollment>> enrollmentsByBatch) {
        Map<String, Set<String>> userBatches = batchesByUser(enrollmentsByBatch);
        Map<String, BatchStats> byBatch = new LinkedHashMap<>();
        Map<String, List<Double>> scores = new HashMap<>();
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            Map<String, AttemptRow> firstReg = new HashMap<>();
            for (AttemptRow a : ev.submissions) firstReg.putIfAbsent(a.userId(), a);
            for (String b : ev.batches) {
                BatchStats stats = byBatch.computeIfAbsent(b, k -> BatchStats.builder().packageSessionId(k).build());
                List<Double> batchScores = scores.computeIfAbsent(b, k -> new ArrayList<>());
                addToBatch(stats, batchScores, ev, userId -> belongsTo(ev, userId, b, userBatches, firstReg));
            }
        }
        byBatch.forEach((b, stats) -> {
            stats.setParticipationRate(ratio(stats.getAttempted(), stats.getExpected()));
            stats.setAvgScore(mean(scores.get(b)));
        });
        return new ArrayList<>(byBatch.values());
    }

    /** A learner counts under a batch they were counted into, or are enrolled / registered in. */
    private static boolean belongsTo(TestEval ev, String userId, String batchId, Map<String, Set<String>> userBatches,
                                     Map<String, AttemptRow> firstReg) {
        Person p = ev.audience.get(userId);
        return (p != null && batchId.equals(p.batchId)) || userInBatch(userId, batchId, userBatches, firstReg);
    }

    private static void addToBatch(BatchStats stats, List<Double> batchScores, TestEval ev,
                                   java.util.function.Predicate<String> inBatch) {
        stats.setAssessments(stats.getAssessments() + 1);
        if (ev.countsForParticipation()) {
            for (String userId : ev.audience.keySet()) {
                if (!inBatch.test(userId)) continue;
                stats.setExpected(stats.getExpected() + 1);
                if (ev.latest.containsKey(userId)) stats.setAttempted(stats.getAttempted() + 1);
            }
        }
        for (AttemptRow a : ev.submissions) {
            if (!inBatch.test(a.userId())) continue;
            stats.setSubmissions(stats.getSubmissions() + 1);
            if (isEvaluated(a)) stats.setEvaluated(stats.getEvaluated() + 1);
            else stats.setAwaitingEvaluation(stats.getAwaitingEvaluation() + 1);
        }
        ev.scores.forEach((userId, score) -> {
            if (inBatch.test(userId)) batchScores.add(score);
        });
    }

    static AssessmentRow row(TestEval ev) {
        TestInfo t = ev.test;
        int attempted = ev.attemptedInAudience();
        Set<String> started = new HashSet<>(ev.latest.keySet());
        started.addAll(ev.inProgress);
        started.retainAll(ev.audience.keySet());
        boolean upcoming = UPCOMING.equals(ev.status);
        int evaluated = 0;
        int awaitingEvaluation = 0;
        int awaitingRelease = 0;
        double timeSum = 0;
        int timeCount = 0;
        for (AttemptRow a : ev.submissions) {
            if (EVALUATED.contains(upper(a.resultStatus()))) {
                evaluated++;
                if ("PENDING".equals(upper(a.releaseStatus()))) awaitingRelease++;
            } else {
                awaitingEvaluation++;
            }
            if (a.timeSeconds() != null && a.timeSeconds() > 0) {
                timeSum += a.timeSeconds() / 60.0;
                timeCount++;
            }
        }
        Collection<Double> scores = ev.scores.values();
        return AssessmentRow.builder()
                .assessmentId(t.id())
                .name(t.name())
                .playMode(upper(t.playMode()))
                .visibility(t.visibility())
                .evaluationType(t.evaluationType())
                .status(ev.status)
                .startTime(t.start() == null ? null : t.start().toString())
                .endTime(t.end() == null ? null : t.end().toString())
                .durationMinutes(t.durationMinutes())
                .subjectId(t.subjectId())
                .batchIds(ev.batches)
                .maxMarks(t.maxMarks())
                .expected(ev.audience.size())
                .attempted(attempted)
                .inProgress(ev.inProgress.size())
                .notAttempted(upcoming ? 0 : Math.max(0, ev.audience.size() - started.size()))
                .participationRate(upcoming ? null : ratio(attempted, ev.audience.size()))
                .submissions(ev.submissions.size())
                .scored(scores.size())
                .avgScore(mean(scores))
                .highestScore(scores.stream().max(Double::compare).map(AssessmentDashboardAssembler::round4).orElse(null))
                .lowestScore(scores.stream().min(Double::compare).map(AssessmentDashboardAssembler::round4).orElse(null))
                .avgTimeMinutes(timeCount == 0 ? null : round4(timeSum / timeCount))
                .evaluated(evaluated)
                .awaitingEvaluation(awaitingEvaluation)
                .awaitingRelease(awaitingRelease)
                .checkedByTeacher(ev.teacherChecks.size())
                .checkedByAi(ev.aiChecked)
                .evaluatorIds(ev.teacherChecks.values().stream().map(EvalLog::authorId).distinct().toList())
                .build();
    }

    // ─── Evaluators ────────────────────────────────────────────────────────

    static final class EvaluatorAcc {
        int copies;
        final Set<String> tests = new HashSet<>();
        long seconds;
        int timed;
        Instant last;
    }

    /** Copies each teacher checked across the range's tests, most copies first. Names are filled in later. */
    static List<EvaluatorStats> evaluators(List<TestEval> evals) {
        Map<String, EvaluatorAcc> byTeacher = new LinkedHashMap<>();
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            for (EvalLog log : ev.teacherChecks.values()) {
                EvaluatorAcc acc = byTeacher.computeIfAbsent(log.authorId(), k -> new EvaluatorAcc());
                acc.copies++;
                acc.tests.add(ev.test.id());
                if (log.timeSeconds() != null && log.timeSeconds() > 0) {
                    acc.seconds += log.timeSeconds();
                    acc.timed++;
                }
                if (isAfter(log.at(), acc.last)) acc.last = log.at();
            }
        }
        List<EvaluatorStats> out = new ArrayList<>();
        byTeacher.forEach((userId, acc) -> out.add(EvaluatorStats.builder()
                .userId(userId)
                .copiesChecked(acc.copies)
                .tests(acc.tests.size())
                .avgMinutesPerCopy(acc.timed == 0 ? null : round4(acc.seconds / 60.0 / acc.timed))
                .lastCheckedAt(acc.last == null ? null : acc.last.toString())
                .build()));
        out.sort(Comparator.comparingInt(EvaluatorStats::getCopiesChecked).reversed());
        return out;
    }

    // ─── Learners ──────────────────────────────────────────────────────────

    static final class LearnerAcc {
        final Person person;
        int expected;
        int attempted;
        final List<Double> scores = new ArrayList<>();
        Instant lastSubmitted;

        LearnerAcc(Person person) {
            this.person = new Person(person.userId, person.name, person.email, person.mobile, person.batchId);
        }

        LearnerStats toStats() {
            return LearnerStats.builder()
                    .userId(person.userId)
                    .name(person.name)
                    .email(person.email)
                    .mobile(person.mobile)
                    .packageSessionId(person.batchId)
                    .expectedTests(expected)
                    .attemptedTests(attempted)
                    .missedTests(Math.max(0, expected - attempted))
                    .attemptRate(ratio(attempted, expected))
                    .scoredTests(scores.size())
                    .avgScore(mean(scores))
                    .bestScore(scores.stream().max(Double::compare).map(AssessmentDashboardAssembler::round4).orElse(null))
                    .lastSubmittedAt(lastSubmitted == null ? null : lastSubmitted.toString())
                    .build();
        }
    }

    static Map<String, LearnerAcc> learners(List<TestEval> evals) {
        Map<String, LearnerAcc> out = new LinkedHashMap<>();
        for (TestEval ev : evals) {
            if (!ev.inRange) continue;
            for (Person p : ev.audience.values()) {
                boolean counts = ev.countsForParticipation();
                boolean sat = ev.latest.containsKey(p.userId);
                if (!counts && !sat) continue;
                LearnerAcc acc = out.computeIfAbsent(p.userId, k -> new LearnerAcc(p));
                acc.person.fillFrom(p);
                if (counts) {
                    acc.expected++;
                    if (sat) acc.attempted++;
                }
                Double score = ev.scores.get(p.userId);
                if (score != null) acc.scores.add(score);
                AttemptRow latest = ev.latest.get(p.userId);
                if (latest != null && isAfter(submittedAt(latest), acc.lastSubmitted)) {
                    acc.lastSubmitted = submittedAt(latest);
                }
            }
        }
        return out;
    }

    private static final Comparator<LearnerStats> BY_NAME =
            Comparator.comparing(l -> Objects.toString(l.getName(), "").toLowerCase(Locale.ROOT));

    static List<LearnerStats> missed(Collection<LearnerStats> all) {
        return all.stream()
                .filter(l -> l.getMissedTests() > 0)
                .sorted(Comparator.comparingInt(LearnerStats::getMissedTests).reversed()
                        .thenComparing(l -> l.getAttemptRate() == null ? 0.0 : l.getAttemptRate())
                        .thenComparing(BY_NAME))
                .limit(LEARNERS_LIMIT)
                .toList();
    }

    static Map<Integer, Integer> missedCounts(Collection<LearnerStats> all) {
        Map<Integer, Integer> out = new LinkedHashMap<>();
        for (int n : MISSED_THRESHOLDS) {
            out.put(n, (int) all.stream().filter(l -> l.getMissedTests() >= n).count());
        }
        return out;
    }

    static List<LearnerStats> top(Collection<LearnerStats> all) {
        int minTests = all.stream().anyMatch(l -> l.getScoredTests() >= 2) ? 2 : 1;
        return all.stream()
                .filter(l -> l.getScoredTests() >= minTests && l.getAvgScore() != null)
                .sorted(Comparator.comparingDouble((LearnerStats l) -> l.getAvgScore()).reversed()
                        .thenComparing(Comparator.comparingInt(LearnerStats::getScoredTests).reversed())
                        .thenComparing(BY_NAME))
                .limit(TOP_LEARNERS)
                .toList();
    }

    static List<LearnerStats> lowScorers(Collection<LearnerStats> all) {
        return all.stream()
                .filter(l -> l.getAvgScore() != null && l.getAvgScore() < LOW_SCORE_BELOW)
                .sorted(Comparator.comparingDouble((LearnerStats l) -> l.getAvgScore())
                        .thenComparing(BY_NAME))
                .toList();
    }

    // ─── Assembly ──────────────────────────────────────────────────────────

    /** Everything the response carries for the current period. */
    public record Result(Summary summary, List<DailyPoint> daily, List<ScoreBucket> scoreDistribution,
                         List<HeatCell> heatmap, List<TypeSlice> types, List<BatchStats> batches,
                         List<EvaluatorStats> evaluators,
                         List<AssessmentRow> assessments, boolean assessmentsTruncated,
                         List<AssessmentRow> liveNow, List<LearnerStats> missedLearners,
                         Map<Integer, Integer> missedCounts, List<LearnerStats> topLearners,
                         List<LearnerStats> lowScorers, int lowScorersTotal, List<String> modeOptions) {
    }

    public static Result assemble(Input in) {
        Set<String> modes = new LinkedHashSet<>();
        List<TestEval> evals = evaluate(in, modes);
        List<TestEval> inRange = evals.stream().filter(e -> e.inRange).toList();

        List<AssessmentRow> rows = inRange.stream()
                .sorted(Comparator.comparing((TestEval e) -> e.test.start(),
                        Comparator.nullsLast(Comparator.<Instant>naturalOrder())).reversed())
                .map(AssessmentDashboardAssembler::row)
                .toList();
        boolean truncated = rows.size() > ASSESSMENTS_LIMIT;
        if (truncated) rows = rows.subList(0, ASSESSMENTS_LIMIT);

        List<AssessmentRow> liveNow = evals.stream()
                .filter(e -> LIVE.equals(e.status))
                .sorted(Comparator.comparing(e -> e.test.end()))
                .map(AssessmentDashboardAssembler::row)
                .toList();

        List<LearnerStats> learnerStats = learners(evals).values().stream().map(LearnerAcc::toStats).toList();
        List<LearnerStats> low = lowScorers(learnerStats);

        return new Result(
                summarize(evals),
                daily(evals, in.period()),
                scoreDistribution(evals),
                heatmap(evals, in.period().zone()),
                types(evals),
                batches(evals, in.enrollmentsByBatch()),
                evaluators(evals),
                rows,
                truncated,
                liveNow,
                missed(learnerStats),
                missedCounts(learnerStats),
                top(learnerStats),
                low.size() > LEARNERS_LIMIT ? low.subList(0, LEARNERS_LIMIT) : low,
                low.size(),
                modes.stream().filter(m -> !m.isEmpty()).sorted().toList());
    }

    /** Summary only — for the previous period's comparison. */
    public static Summary summaryOnly(Input in) {
        return summarize(evaluate(in, new HashSet<>()));
    }

    // ─── Numbers ───────────────────────────────────────────────────────────

    static Double ratio(int numerator, int denominator) {
        return denominator <= 0 ? null : round4((double) numerator / denominator);
    }

    static Double mean(Collection<Double> values) {
        if (values == null || values.isEmpty()) return null;
        double sum = 0;
        for (double v : values) sum += v;
        return round4(sum / values.size());
    }

    static double round4(double v) {
        return Math.round(v * 10_000d) / 10_000d;
    }
}
