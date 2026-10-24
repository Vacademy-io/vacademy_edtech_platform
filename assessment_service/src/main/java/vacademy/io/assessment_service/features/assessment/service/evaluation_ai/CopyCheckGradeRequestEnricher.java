package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;

import java.util.regex.Pattern;

/**
 * What a grade request carries beyond the questions themselves (T0.25/T0.31, 10.3, 10.8):
 * the paper's subject on every question, and - for partner API runs only - who to bill,
 * the rate the copy was quoted at and its page count. Dashboard runs get the subject
 * when one is stored as a name and nothing else, so their billing is unchanged.
 */
@Slf4j
@Component
public class CopyCheckGradeRequestEnricher {

        private static final Pattern UUID_LIKE = Pattern.compile(
                        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
        static final int MAX_SUBJECT_LENGTH = 120;

        private final AssessmentInstituteMappingRepository instituteMappingRepository;
        private final ObjectProvider<CopyCheckGradeContextProvider> contextProviders;
        private final AiEvaluationCreditGate creditGate;

        /** Internal choice on dashboard assessments; null in unit tests that do not need it. */
        @org.springframework.beans.factory.annotation.Autowired(required = false)
        private DashboardChoiceGroups choiceGroups;

        public CopyCheckGradeRequestEnricher(AssessmentInstituteMappingRepository instituteMappingRepository,
                        ObjectProvider<CopyCheckGradeContextProvider> contextProviders,
                        AiEvaluationCreditGate creditGate) {
                this.instituteMappingRepository = instituteMappingRepository;
                this.contextProviders = contextProviders;
                this.creditGate = creditGate;
        }

        /**
         * The subject the grader is told for every question of this copy (T0.31). The
         * API facade's exam subject wins; otherwise the dashboard assessment's subject when
         * it is stored as a NAME. Since the subject picker moved to ids, subject_id holds
         * an admin-core subject UUID whose name lives in another service's database: that
         * (and the legacy "N/A") sends no subject rather than a meaningless id.
         */
        public String subjectFor(AiEvaluationProcess process) {
                CopyCheckGradeContextProvider provider = provider();
                if (provider != null) {
                        try {
                                String subject = clean(provider.subject(process));
                                if (subject != null) return subject;
                        } catch (Exception e) {
                                log.warn("[copy-check] subject provider failed for process {}: {}", process.getId(),
                                                e.getMessage());
                        }
                }
                if (process.getAssessment() == null || process.getInstituteId() == null) {
                        return null;
                }
                try {
                        return instituteMappingRepository
                                        .findByAssessmentIdAndInstituteId(process.getAssessment().getId(),
                                                        process.getInstituteId())
                                        .map(m -> subjectName(m.getSubjectId()))
                                        .orElse(null);
                } catch (Exception e) {
                        log.warn("[copy-check] could not read the subject of assessment {}: {}",
                                        process.getAssessment().getId(), e.getMessage());
                        return null;
                }
        }

        /** A stored subject_id that is a readable name, else null. */
        static String subjectName(String subjectId) {
                String value = clean(subjectId);
                if (value == null || "N/A".equalsIgnoreCase(value) || UUID_LIKE.matcher(value).matches()) {
                        return null;
                }
                return value;
        }

        private static String clean(String value) {
                if (value == null) return null;
                String trimmed = value.trim();
                if (trimmed.isEmpty()) return null;
                return trimmed.length() > MAX_SUBJECT_LENGTH ? trimmed.substring(0, MAX_SUBJECT_LENGTH) : trimmed;
        }

        /**
         * Billing fields for a partner API run (api_key_id set): billing actor, the C4 rate
         * snapshot when the row holds a complete rate, and the page count. Then the
         * facade's exam context, if a provider is registered.
         */
        public void enrich(AiEvaluationProcess process, CopyCheckGradeRequestDto request) {
                if (process.getApiKeyId() != null && !process.getApiKeyId().isBlank()) {
                        request.setBillingActor("apikey:" + process.getApiKeyId());
                        request.setRateSnapshot(creditGate.gradeRequestSnapshot(process.getRateSnapshot()));
                        request.setPageCount(process.getPageCount());
                }
                CopyCheckGradeContextProvider provider = provider();
                if (provider != null) {
                        try {
                                provider.contribute(process, request);
                        } catch (Exception e) {
                                log.warn("[copy-check] grade context provider failed for process {}: {}", process.getId(),
                                                e.getMessage());
                        }
                }
                // A dashboard paper's internal choice ("any 4 of 5"), when the provider set none.
                // Nothing is added for an assessment without groups.
                if (choiceGroups != null && process.getAssessment() != null) {
                        try {
                                choiceGroups.contribute(process.getAssessment().getId(), request);
                        } catch (Exception e) {
                                log.warn("[copy-check] choice groups not added for process {}: {}", process.getId(),
                                                e.getMessage());
                        }
                }
        }

        private CopyCheckGradeContextProvider provider() {
                try {
                        return contextProviders != null ? contextProviders.getIfUnique() : null;
                } catch (Exception e) {
                        return null;
                }
        }
}
