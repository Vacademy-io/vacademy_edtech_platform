package vacademy.io.assessment_service.features.assessment_dashboard.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardRequest;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.AssessmentDashboardResponse.EvaluatorStats;
import vacademy.io.assessment_service.features.assessment_dashboard.dto.BatchEnrollmentRow;
import vacademy.io.assessment_service.features.assessment_dashboard.repository.AssessmentDashboardQueries;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.AttemptRow;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Enrollment;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.EvalLog;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Filters;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Input;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Period;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.Result;
import vacademy.io.assessment_service.features.assessment_dashboard.service.AssessmentDashboardAssembler.TestInfo;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Assessment Dashboard: loads one or two periods (the range, and the equally long one
 * before it for ▲/▼ deltas) and hands the rows to {@link AssessmentDashboardAssembler}.
 *
 * <p>Read-only. Per period: tests, their batches, their registrations + attempts — three
 * queries, each bounded by the tests in range. Batch membership comes from admin_core in
 * one call for both periods, because batch learners get no row in this database until
 * they start a test.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AssessmentDashboardService {

    static final int MAX_RANGE_DAYS = 366;
    /** Deltas are offered up to a quarter; beyond that the "previous period" is a different year. */
    static final int MAX_COMPARE_DAYS = 92;
    private static final ZoneId DEFAULT_ZONE = ZoneId.of("Asia/Kolkata");

    private final AssessmentDashboardQueries queries;
    private final AdminCoreServiceClient adminCoreServiceClient;
    private final AuthService authService;

    public AssessmentDashboardResponse getDashboard(AssessmentDashboardRequest request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("institute_id is required");
        }
        ZoneId zone = zoneOf(request.getTimezone());
        LocalDate start = parseDate(request.getStartDate(), "start_date");
        LocalDate end = parseDate(request.getEndDate(), "end_date");
        if (end.isBefore(start)) {
            throw new VacademyException("end_date must not be before start_date");
        }
        long days = ChronoUnit.DAYS.between(start, end) + 1;
        if (days > MAX_RANGE_DAYS) {
            throw new VacademyException("The date range can be at most " + MAX_RANGE_DAYS + " days");
        }

        String instituteId = request.getInstituteId();
        Filters filters = new Filters(normalise(request.getBatchIds(), false), normalise(request.getPlayModes(), true));
        Instant now = Instant.now();

        Period period = new Period(start, end, zone);
        Period previous = days <= MAX_COMPARE_DAYS
                ? new Period(start.minusDays(days), start.minusDays(1), zone)
                : null;

        Loaded current = load(instituteId, period, now, true);
        Loaded before = previous == null ? null : load(instituteId, previous, now, false);

        Set<String> batchIds = new TreeSet<>(current.batchIds());
        if (before != null) batchIds.addAll(before.batchIds());
        if (!filters.batchIds().isEmpty()) batchIds.retainAll(filters.batchIds());
        Map<String, List<Enrollment>> enrollments = loadEnrollments(instituteId, new ArrayList<>(batchIds));

        Result result = AssessmentDashboardAssembler.assemble(new Input(
                period, now, current.tests(), current.batchesByTest(), current.attempts(), enrollments, filters,
                current.evaluationLogs(), current.aiCheckedAttempts()));
        fillEvaluatorNames(result.evaluators());

        AssessmentDashboardResponse.AssessmentDashboardResponseBuilder out = AssessmentDashboardResponse.builder()
                .startDate(start.toString())
                .endDate(end.toString())
                .timezone(zone.getId())
                .generatedAt(now.toString())
                .summary(result.summary())
                .daily(result.daily())
                .scoreDistribution(result.scoreDistribution())
                .submissionHeatmap(result.heatmap())
                .types(result.types())
                .batches(result.batches())
                .evaluators(result.evaluators())
                .assessments(result.assessments())
                .assessmentsLimit(AssessmentDashboardAssembler.ASSESSMENTS_LIMIT)
                .assessmentsTruncated(result.assessmentsTruncated() || current.truncated())
                .liveNow(result.liveNow())
                .missedLearners(result.missedLearners())
                .missedCounts(result.missedCounts())
                .topLearners(result.topLearners())
                .lowScorers(result.lowScorers())
                .lowScorersTotal(result.lowScorersTotal())
                .lowScoreBelow(AssessmentDashboardAssembler.LOW_SCORE_BELOW)
                .learnersLimit(AssessmentDashboardAssembler.LEARNERS_LIMIT)
                .modeOptions(result.modeOptions())
                .enrollmentAvailable(enrollments != null);

        if (before != null) {
            out.previousSummary(AssessmentDashboardAssembler.summaryOnly(new Input(
                            previous, now, before.tests(), before.batchesByTest(), before.attempts(),
                            enrollments, filters)))
                    .previousStartDate(previous.startDate().toString())
                    .previousEndDate(previous.endDate().toString());
        }
        return out.build();
    }

    /** One period's rows. Checking records are loaded for the current period only. */
    record Loaded(List<TestInfo> tests, Map<String, List<String>> batchesByTest, List<AttemptRow> attempts,
                  boolean truncated, Map<String, EvalLog> evaluationLogs, Set<String> aiCheckedAttempts) {
        Set<String> batchIds() {
            Set<String> ids = new LinkedHashSet<>();
            batchesByTest.values().forEach(ids::addAll);
            return ids;
        }
    }

    private Loaded load(String instituteId, Period period, Instant now, boolean current) {
        // One over the cap, so the response can say the list was cut short.
        int limit = AssessmentDashboardAssembler.ASSESSMENTS_LIMIT + 1;
        List<TestInfo> tests = queries.findTests(instituteId, period.start(), period.end(), now, current, limit);
        boolean truncated = tests.size() >= limit;
        List<String> ids = tests.stream().map(TestInfo::id).toList();
        return new Loaded(tests,
                queries.findBatchesByTest(instituteId, ids),
                queries.findRegistrationsAndAttempts(instituteId, ids),
                truncated,
                current ? queries.findLatestEvaluationLogs(instituteId, ids) : Map.of(),
                current ? queries.findAiCheckedAttempts(instituteId, ids) : Set.of());
    }

    /** Teacher names from auth_service; a failed lookup leaves the name empty (the UI falls back to email / id). */
    private void fillEvaluatorNames(List<EvaluatorStats> evaluators) {
        if (evaluators.isEmpty()) return;
        List<String> ids = evaluators.stream().map(EvaluatorStats::getUserId).toList();
        Map<String, UserDTO> byId = new HashMap<>();
        for (UserDTO user : authService.getUsersByIds(ids)) {
            if (user != null && user.getId() != null) byId.put(user.getId(), user);
        }
        for (EvaluatorStats e : evaluators) {
            UserDTO user = byId.get(e.getUserId());
            if (user != null) {
                e.setName(user.getFullName());
                e.setEmail(user.getEmail());
            }
        }
    }

    /** Null when admin_core could not be reached — the dashboard then says so. */
    private Map<String, List<Enrollment>> loadEnrollments(String instituteId, List<String> batchIds) {
        if (batchIds.isEmpty()) {
            return new HashMap<>();
        }
        List<BatchEnrollmentRow> rows = adminCoreServiceClient.getBatchEnrollments(instituteId, batchIds);
        if (rows == null) {
            return null;
        }
        Map<String, List<Enrollment>> out = new HashMap<>();
        for (BatchEnrollmentRow row : rows) {
            if (row.getUserId() == null || row.getPackageSessionId() == null) continue;
            out.computeIfAbsent(row.getPackageSessionId(), k -> new ArrayList<>()).add(new Enrollment(
                    row.getUserId(), row.getPackageSessionId(), parseOptionalDate(row.getEnrolledDate()),
                    row.getFullName(), row.getEmail(), row.getMobileNumber()));
        }
        return out;
    }

    static ZoneId zoneOf(String timezone) {
        if (!StringUtils.hasText(timezone)) return DEFAULT_ZONE;
        try {
            return ZoneId.of(timezone.trim());
        } catch (Exception e) {
            return DEFAULT_ZONE;
        }
    }

    private static LocalDate parseDate(String value, String field) {
        try {
            return LocalDate.parse(Objects.requireNonNull(value).trim());
        } catch (NullPointerException | DateTimeParseException e) {
            throw new VacademyException(field + " must be a yyyy-MM-dd date");
        }
    }

    private static LocalDate parseOptionalDate(String value) {
        if (!StringUtils.hasText(value)) return null;
        try {
            return LocalDate.parse(value.trim().substring(0, Math.min(10, value.trim().length())));
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static Set<String> normalise(List<String> values, boolean upperCase) {
        if (values == null) return Set.of();
        return values.stream()
                .filter(StringUtils::hasText)
                .map(String::trim)
                .map(v -> upperCase ? v.toUpperCase(Locale.ROOT) : v)
                .collect(Collectors.toCollection(LinkedHashSet::new));
    }
}
