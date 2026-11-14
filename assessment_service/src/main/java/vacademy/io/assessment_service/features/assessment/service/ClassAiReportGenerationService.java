package vacademy.io.assessment_service.features.assessment.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentClassAiAnalysis;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentClassAiAnalysisRepository;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.Optional;
import java.util.UUID;

/**
 * Owns the money-critical half of the class AI report: claiming the right to
 * generate, recording the result, and charging.
 *
 * <p>Separated from the export manager so the claim can commit in its own
 * transaction. That is not a style choice — a claim inside the request's
 * transaction stays invisible to a competing request until after the model has
 * already run, which is exactly the double-spend it exists to prevent.
 *
 * <p>The order the caller must follow, and why:
 * <ol>
 *   <li><b>claim</b> — one caller wins; the rest are told it is already running</li>
 *   <li><b>model call</b> — the only step that costs real money</li>
 *   <li><b>persist</b> — must rethrow on failure; a swallowed failure here is
 *       how you charge for a report nobody can download</li>
 *   <li><b>charge</b> — last, and never rethrows; a billing blip must not
 *       destroy work the institute can already see</li>
 * </ol>
 * The asymmetry is deliberate: a persist failure bills nothing (Vacademy eats
 * the model cost), because there is no refund path from Java.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ClassAiReportGenerationService {

    private static final String KEY_PREFIX = "assessment_class_ai_report:";
    /** A row claimed longer ago than this was stranded by a dead pod, not a live call. */
    private static final long STALE_CLAIM_MINUTES = 15;

    private final AssessmentClassAiAnalysisRepository repository;
    private final AiServiceCreditClient creditClient;

    public Optional<AssessmentClassAiAnalysis> find(String assessmentId, String instituteId) {
        return repository.findLive(assessmentId, instituteId);
    }

    /** Every generation for this assessment, newest first — what the dialog lists. */
    public java.util.List<AssessmentClassAiAnalysis> history(String assessmentId, String instituteId) {
        return repository.findHistory(assessmentId, instituteId);
    }

    /**
     * Claims the right to generate. Committed immediately so a concurrent
     * request sees it.
     *
     * @param regenerate true for a deliberate, paid refresh of an existing report
     * @return the claimed row, or empty when another caller already holds it
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<AssessmentClassAiAnalysis> claim(String assessmentId, String instituteId,
                                                     String userId, BigDecimal creditsQuoted,
                                                     boolean regenerate) {
        if (regenerate) {
            // Retire the current report FIRST so it drops out of the partial
            // unique index — and survives as history rather than being
            // overwritten by the version replacing it.
            repository.supersedeLive(assessmentId, instituteId);
        } else {
            // A claim abandoned by a dead pod would otherwise block this
            // assessment forever.
            repository.retireStrandedClaim(assessmentId, instituteId, staleBefore());
        }

        String id = UUID.randomUUID().toString();
        String key = KEY_PREFIX + id;
        int claimed = repository.claim(id, assessmentId, instituteId, key, creditsQuoted, userId);
        if (claimed == 0) {
            // Someone else is mid-generation. Not an error — the caller tells
            // the admin it is running and will not be charged twice.
            return Optional.empty();
        }
        return repository.findById(id);
    }

    /**
     * Records a successful generation, then charges.
     *
     * <p>Persist first and charge second, so a billing failure leaves a usable
     * report rather than an unusable charge. The charge outcome is written to
     * {@code charge_status} because ai_service's billing swallows its own
     * errors and nothing retries — this column is the only way an unbilled
     * report is ever findable.
     */
    @Transactional
    public AssessmentClassAiAnalysis persistReady(AssessmentClassAiAnalysis row, String analysisJson,
                                                   String pdfFileId, String fingerprint, String model) {
        row.setStatus(AssessmentClassAiAnalysis.STATUS_READY);
        row.setAnalysisJson(analysisJson);
        row.setPdfFileId(pdfFileId);
        row.setContentFingerprint(fingerprint);
        row.setModel(model);
        row.setGeneratedAt(new Timestamp(System.currentTimeMillis()));
        return repository.save(row);
    }

    /** Never throws. Called only after the report is safely stored. */
    @Transactional
    public void charge(AssessmentClassAiAnalysis row) {
        boolean accepted = false;
        try {
            accepted = creditClient.charge(row.getInstituteId(), row.getIdempotencyKey(),
                    row.getGeneratedByUserId(), row.getModel());
        } catch (Exception e) {
            log.error("Unexpected error charging the class AI report for {}: {}",
                    row.getAssessmentId(), e.getMessage());
        }
        row.setChargeStatus(accepted
                ? AssessmentClassAiAnalysis.CHARGE_CHARGED
                : AssessmentClassAiAnalysis.CHARGE_FAILED);
        repository.save(row);
    }

    /** Releases a claim whose generation failed, so the teacher can try again. */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markFailed(String rowId) {
        repository.findById(rowId).ifPresent(row -> {
            row.setStatus(AssessmentClassAiAnalysis.STATUS_FAILED);
            // Retire it too: a failed attempt must not hold the live slot and
            // block the teacher from trying again. Nothing was charged.
            row.setSupersededAt(new Timestamp(System.currentTimeMillis()));
            repository.save(row);
        });
    }

    private Timestamp staleBefore() {
        return new Timestamp(System.currentTimeMillis() - STALE_CLAIM_MINUTES * 60_000L);
    }
}
