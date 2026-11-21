package vacademy.io.admin_core_service.features.reporting.sections;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.reporting.client.AssessmentReportClient;
import vacademy.io.admin_core_service.features.reporting.spi.ReportContext;
import vacademy.io.admin_core_service.features.reporting.spi.ReportSection;
import vacademy.io.admin_core_service.features.reporting.spi.SectionFacts;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Test and assessment results — the outcome data the rest of the digest lacks.
 *
 * Every other section answers whether learners turned up, studied, asked or paid.
 * This one answers whether they LEARNED anything, which is the question an
 * institute is actually judged on.
 *
 * <h3>The one section that leaves the database</h3>
 * Assessments live in assessment_service's own database, so this cannot be SQL. It
 * is a single HTTP call per document to an aggregate endpoint built for this
 * purpose. That is a deliberate exception to the SPI's "no cross-service calls"
 * rule, and it is bounded: one call, not one per learner. A failure THROWS rather
 * than returning empty, per the SPI contract — "assessment_service was
 * unreachable" and "no tests were taken" must never render identically.
 *
 * <h3>Awaiting evaluation is the actionable number</h3>
 * Scores describe the past; unevaluated attempts are work someone still owes a
 * learner. Measured at one institute: 331 of 834 attempts in a month sat in
 * PENDING or EVALUATING, which is a third of the cohort waiting on a mark. That is
 * why rows are ranked by the evaluation backlog rather than by score.
 *
 * <h3>Percentages, carefully</h3>
 * {@code student_attempt.total_marks} is what the learner ACHIEVED, not the paper's
 * maximum — the two are equal on every row — so the obvious division yields 100%
 * for everybody. The maximum comes from the paper's sections, and attempts with no
 * usable maximum, or which somehow exceed it, are excluded from the average and
 * counted separately rather than folded in. See {@code AssessmentReportingService}
 * in assessment_service for the full account.
 */
@Component
@Slf4j
@RequiredArgsConstructor
public class AssessmentsSection implements ReportSection {

    private final AssessmentReportClient client;

    @Override
    public String key() {
        return "assessments";
    }

    @Override
    public String title() {
        return "Tests & assessments";
    }

    @Override
    public String description() {
        return "Attempts, average scores and the evaluation backlog for tests taken "
                + "in the period.";
    }

    @Override
    public Set<String> visibleToRoles() {
        return Set.of("ADMIN", "TEACHER");
    }

    @Override
    public Set<ReportContext.ScopeType> supportedScopes() {
        // The aggregate has no batch dimension, so a per-batch document would be a
        // copy of the institute one.
        return Set.of(ReportContext.ScopeType.INSTITUTE);
    }

    @Override
    public boolean isAvailableFor(String instituteId) {
        LocalDate today = LocalDate.now();
        JsonNode summary = client.fetchSummary(instituteId, today.minusDays(30), today);
        if (summary == null) {
            // THROW rather than return false. The registry catches this and hides
            // the section, whereas false is rendered by the config screen as the
            // positive claim "no data in the last 30 days" — which is how a failing
            // endpoint told an institute with 834 attempts that it had none.
            throw new IllegalStateException(
                    "assessment availability unknown for institute " + instituteId);
        }
        return summary.path("attempts").asInt(0) > 0;
    }

    @Override
    public SectionFacts compute(ReportContext ctx) {
        // A teacher is scoped to their own cohorts and this aggregate is
        // institute-wide, so there is no honest way to narrow it — showing the
        // institute figures to a cohort-scoped reader would leak other cohorts'
        // results. Empty is the correct answer for them.
        if (ctx.namingRestricted() || ctx.cohortRestricted()) {
            return SectionFacts.builder()
                    .sectionKey(key()).title(title()).identifying(false).empty(true)
                    .build();
        }

        LocalDate from = LocalDate.ofInstant(ctx.getWindowStart(), ctx.getZone());
        LocalDate to = LocalDate.ofInstant(ctx.getWindowEnd(), ctx.getZone());

        JsonNode s = client.fetchSummary(ctx.getInstituteId(), from, to);
        if (s == null) {
            // Per the SPI: a section that cannot answer must throw, never return
            // empty. "Unreachable" rendered as "nothing to report" would quietly
            // tell an institute their learners took no tests.
            throw new IllegalStateException(
                    "assessment summary unavailable for institute " + ctx.getInstituteId());
        }

        int assessments = s.path("assessments").asInt(0);
        int attempts = s.path("attempts").asInt(0);
        int submitted = s.path("submitted").asInt(0);
        int awaiting = s.path("awaitingEvaluation").asInt(0);
        int scored = s.path("scored").asInt(0);
        JsonNode avg = s.path("avgScorePct");
        int noMaximum = s.path("noMaximum").asInt(0);
        int aboveMaximum = s.path("aboveMaximum").asInt(0);

        List<SectionFacts.Row> rows = new ArrayList<>();
        for (JsonNode r : s.path("rows")) {
            JsonNode rowAvg = r.path("avgScorePct");
            int rowAwaiting = r.path("awaitingEvaluation").asInt(0);
            rows.add(SectionFacts.Row.builder()
                    .value(text(r.path("name"), "(untitled assessment)"))
                    .value(String.valueOf(r.path("attempts").asInt(0)))
                    .value(rowAwaiting == 0 ? "—" : String.valueOf(rowAwaiting))
                    .value(rowAvg.isNumber() ? rowAvg.asInt() + "%" : "—")
                    .build());
        }

        // Excluded attempts are declared, not hidden — a score average computed over
        // a subset should say so, or the reader assumes it covers everyone.
        int excluded = noMaximum + aboveMaximum;
        if (excluded > 0) {
            rows.add(SectionFacts.Row.builder()
                    .value(excluded + " attempt" + (excluded == 1 ? "" : "s")
                            + " left out of the average — the paper has no marks total"
                            + (aboveMaximum > 0 ? ", or the score exceeds it" : ""))
                    .value("").value("").value("")
                    .build());
        }

        SectionFacts.SectionFactsBuilder facts = SectionFacts.builder()
                .sectionKey(key())
                .title(title())
                .identifying(false) // assessment names and counts; no learner named
                .empty(attempts == 0)
                .headline("Tests attempted", String.valueOf(assessments))
                .headline("Attempts", attempts + (submitted < attempts
                        ? " · " + submitted + " submitted" : ""))
                .headline("Awaiting evaluation", String.valueOf(awaiting))
                .headline("Average score", avg.isNumber()
                        ? avg.asInt() + "%" + (scored < attempts ? " of " + scored : "")
                        : "—");

        if (attempts > 0) {
            // A third of a cohort waiting on a mark is a backlog worth reddening — but
            // NOT on a daily report, where the attempts were sat hours ago and nobody
            // could reasonably have marked them yet. Same figure, different meaning
            // depending on how long the window has had to clear.
            facts.tone("Awaiting evaluation", awaiting == 0 ? "good"
                    : ctx.isDailyCadence() ? "warn"
                    : awaiting * 4 >= attempts ? "bad" : "warn");
        }

        return facts
                .column("Assessment")
                .column("Attempts")
                .column("Awaiting")
                .column("Avg score")
                .rows(rows)
                .build();
    }

    private static String text(JsonNode node, String fallback) {
        String v = node == null || node.isMissingNode() ? null : node.asText(null);
        return v == null || v.isBlank() ? fallback : v.trim();
    }
}
