package vacademy.io.assessment_service.features.assessment.service.evaluation_ai;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import vacademy.io.assessment_service.features.assessment.dto.evaluation_ai.CopyCheckGradeRequestDto;
import vacademy.io.assessment_service.features.assessment.entity.AiEvaluationProcess;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;

import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** T0.31 subject on the grade request, and the partner-only billing fields (10.3, 10.8). */
class CopyCheckGradeRequestEnricherTest {

        private AssessmentInstituteMappingRepository mappings;
        private ObjectProvider<CopyCheckGradeContextProvider> providers;
        private CopyCheckGradeRequestEnricher enricher;
        private AiEvaluationProcess process;

        @BeforeEach
        @SuppressWarnings("unchecked")
        void setUp() {
                mappings = mock(AssessmentInstituteMappingRepository.class);
                providers = mock(ObjectProvider.class);
                enricher = new CopyCheckGradeRequestEnricher(mappings, providers, mock(AiEvaluationCreditGate.class));
                Assessment assessment = new Assessment();
                assessment.setId("a1");
                process = new AiEvaluationProcess();
                process.setId("p1");
                process.setAssessment(assessment);
                process.setInstituteId("inst-1");
        }

        private void storedSubject(String subjectId) {
                AssessmentInstituteMapping m = new AssessmentInstituteMapping();
                m.setSubjectId(subjectId);
                when(mappings.findByAssessmentIdAndInstituteId("a1", "inst-1")).thenReturn(Optional.of(m));
        }

        @Test
        void aSubjectStoredAsANameIsSent() {
                storedSubject("  Financial Accounting ");
                assertThat(enricher.subjectFor(process)).isEqualTo("Financial Accounting");
        }

        @Test
        void aSubjectIdOrTheLegacyPlaceholderSendsNothing() {
                assertThat(CopyCheckGradeRequestEnricher.subjectName("6b600940-1c2d-4e5f-8a9b-0c1d2e3f4a5b")).isNull();
                assertThat(CopyCheckGradeRequestEnricher.subjectName("N/A")).isNull();
                assertThat(CopyCheckGradeRequestEnricher.subjectName("")).isNull();
                assertThat(CopyCheckGradeRequestEnricher.subjectName(null)).isNull();
                assertThat(CopyCheckGradeRequestEnricher.subjectName("x".repeat(500)))
                                .hasSize(CopyCheckGradeRequestEnricher.MAX_SUBJECT_LENGTH);
        }

        @Test
        void noMappingSendsNothing() {
                when(mappings.findByAssessmentIdAndInstituteId("a1", "inst-1")).thenReturn(Optional.empty());
                assertThat(enricher.subjectFor(process)).isNull();
        }

        @Test
        void thePartnerExamsSubjectWinsAndItsContextIsAdded() {
                storedSubject("Science");
                CopyCheckGradeContextProvider provider = new CopyCheckGradeContextProvider() {
                        @Override
                        public String subject(AiEvaluationProcess p) {
                                return "General Studies II";
                        }

                        @Override
                        public void contribute(AiEvaluationProcess p, CopyCheckGradeRequestDto request) {
                                request.setExamContext(Map.of("level", "upsc"));
                        }
                };
                when(providers.getIfUnique()).thenReturn(provider);

                assertThat(enricher.subjectFor(process)).isEqualTo("General Studies II");
                CopyCheckGradeRequestDto request = new CopyCheckGradeRequestDto();
                enricher.enrich(process, request);
                assertThat(request.getExamContext()).containsEntry("level", "upsc");
        }

        @Test
        void aDashboardRunGetsNoBillingFields() {
                process.setPageCount(4);
                process.setRateSnapshot("{\"tool_key\":\"copy_check_evaluation\"}");
                CopyCheckGradeRequestDto request = new CopyCheckGradeRequestDto();

                enricher.enrich(process, request);

                assertThat(request.getBillingActor()).isNull();
                assertThat(request.getRateSnapshot()).isNull();
                assertThat(request.getPageCount()).isNull();
        }

        @Test
        void aPartnerRunIsBilledToItsKey() {
                process.setApiKeyId("key-9");
                process.setPageCount(3);
                CopyCheckGradeRequestDto request = new CopyCheckGradeRequestDto();

                enricher.enrich(process, request);

                assertThat(request.getBillingActor()).isEqualTo("apikey:key-9");
                assertThat(request.getPageCount()).isEqualTo(3);
        }
}
