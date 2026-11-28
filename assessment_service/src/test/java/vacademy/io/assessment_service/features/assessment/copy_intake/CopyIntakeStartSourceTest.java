package vacademy.io.assessment_service.features.assessment.copy_intake;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;
import vacademy.io.assessment_service.features.assessment.audit.AssessmentAuditClient;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCopyCheckClient;
import vacademy.io.assessment_service.features.assessment.copy_intake.dto.CopyIntakeDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.entity.AiCopyIntakeBatch;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeBatchRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.repository.AiCopyIntakeItemRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeNotifier;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.CopyIntakeService;
import vacademy.io.assessment_service.features.assessment.copy_intake.service.InstituteFileOwnership;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.manager.AdminOfflineDataEntryManager;
import vacademy.io.assessment_service.features.assessment.repository.AiEvaluationProcessRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentBatchRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentRepository;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentUserRegistrationRepository;
import vacademy.io.assessment_service.features.assessment.service.StudentAttemptService;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.AiEvaluationService;
import vacademy.io.assessment_service.features.auth_service.service.AuthService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Which source a batch is stored with: the dashboard upload keeps UPLOAD, the
 * scan station's overload stores SCAN, and not mapping students makes either
 * one CHECK_ONLY (so resolve and the check-only paths keep keying on it).
 */
class CopyIntakeStartSourceTest {

    private AiCopyIntakeBatchRepository batches;
    private CopyIntakeService service;
    private final CustomUserDetails admin = new CustomUserDetails();

    @BeforeEach
    void setUp() {
        batches = mock(AiCopyIntakeBatchRepository.class);
        AssessmentRepository assessments = mock(AssessmentRepository.class);
        InstituteFileOwnership ownership = mock(InstituteFileOwnership.class);
        service = new CopyIntakeService(batches, mock(AiCopyIntakeItemRepository.class), assessments,
                mock(AiEvaluationProcessRepository.class), mock(AssessmentUserRegistrationRepository.class),
                mock(AssessmentBatchRegistrationRepository.class), mock(AdminCoreServiceClient.class),
                mock(AiServiceCopyCheckClient.class), mock(AdminOfflineDataEntryManager.class),
                mock(AiEvaluationService.class), mock(StudentAttemptService.class), mock(CopyIntakeNotifier.class),
                mock(AssessmentAuditClient.class), new ObjectMapper(), mock(TransactionTemplate.class),
                mock(AuthService.class), ownership);
        ReflectionTestUtils.setField(service, "mediaServiceUrl", "http://media.invalid");
        ReflectionTestUtils.setField(admin, "userId", "admin-1");

        Assessment a = new Assessment();
        a.setId("a-1");
        a.setName("Science PT2");
        when(assessments.findById("a-1")).thenReturn(Optional.of(a));
        when(ownership.notOwnedBy(anyString(), anyList())).thenReturn(List.of());
        when(batches.save(any())).thenAnswer(inv -> {
            AiCopyIntakeBatch b = inv.getArgument(0);
            b.setId("batch-1");
            return b;
        });
    }

    private static CopyIntakeDtos.StartRequest request(Boolean mapStudents) {
        return CopyIntakeDtos.StartRequest.builder().mapStudents(mapStudents)
                .files(List.of(new CopyIntakeDtos.UploadedFile("f1", "Load 1 copy 1", 4))).build();
    }

    @Test
    void theFourArgumentStartStoresUpload() {
        assertThat(service.start(admin, "a-1", "i-1", request(null)).getSource())
                .isEqualTo(AiCopyIntakeBatch.SOURCE_UPLOAD);
    }

    @Test
    void theScanStationOverloadStoresScan() {
        AiCopyIntakeBatch b = service.start(admin, "a-1", "i-1", request(true), AiCopyIntakeBatch.SOURCE_SCAN);
        assertThat(b.getSource()).isEqualTo(AiCopyIntakeBatch.SOURCE_SCAN);
        assertThat(b.isCheckOnly()).isFalse();
    }

    @Test
    void notMappingStudentsIsCheckOnlyWhateverTheSource() {
        assertThat(service.start(admin, "a-1", "i-1", request(false), AiCopyIntakeBatch.SOURCE_SCAN).getSource())
                .isEqualTo(AiCopyIntakeBatch.SOURCE_CHECK_ONLY);
        assertThat(service.start(admin, "a-1", "i-1", request(false)).getSource())
                .isEqualTo(AiCopyIntakeBatch.SOURCE_CHECK_ONLY);
    }
}
