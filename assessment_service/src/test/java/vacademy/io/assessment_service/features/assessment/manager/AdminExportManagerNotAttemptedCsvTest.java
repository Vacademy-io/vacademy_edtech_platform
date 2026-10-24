package vacademy.io.assessment_service.features.assessment.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import vacademy.io.assessment_service.features.assessment.dto.AssessmentUserFilter;
import vacademy.io.assessment_service.features.assessment.dto.batch_pending.EnrolledLearnerDto;
import vacademy.io.assessment_service.features.assessment.dto.export.ResultExportColumnsDto;
import vacademy.io.assessment_service.features.assessment.enums.UserRegistrationSources;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.batch_pending.NotAttemptedLearnerService;
import vacademy.io.assessment_service.features.client.AdminCoreServiceClient;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The "not attempted" CSV — the sheet an admin uses to chase learners who never sat the
 * test, so the contact columns are the whole point of it.
 */
class AdminExportManagerNotAttemptedCsvTest {

    private static final String ASSESSMENT_ID = "assessment-1";
    private static final String INSTITUTE_ID = "institute-1";
    private static final String HEADER = "Name,Email,Phone Number,Username,Batch";

    private AdminExportManager manager;
    private NotAttemptedLearnerService notAttemptedLearnerService;
    private AdminCoreServiceClient adminCoreServiceClient;

    @BeforeEach
    void setUp() {
        manager = new AdminExportManager();
        notAttemptedLearnerService = mock(NotAttemptedLearnerService.class);
        adminCoreServiceClient = mock(AdminCoreServiceClient.class);
        AssessmentInstituteMappingRepository instituteMappingRepository =
                mock(AssessmentInstituteMappingRepository.class);

        manager.notAttemptedLearnerService = notAttemptedLearnerService;
        manager.adminCoreServiceClient = adminCoreServiceClient;
        manager.assessmentInstituteMappingRepository = instituteMappingRepository;
    }

    /** The filter the Pending tab sends: batch source, PENDING attempt type. */
    private static AssessmentUserFilter pendingBatchFilter() {
        AssessmentUserFilter filter = new AssessmentUserFilter();
        filter.setAttemptType(List.of("PENDING"));
        filter.setRegistrationSource(UserRegistrationSources.BATCH_PREVIEW_REGISTRATION.name());
        return filter;
    }

    private String[] exportLines(AssessmentUserFilter filter) {
        ResponseEntity<byte[]> response =
                manager.getRegisteredCsvExport(null, INSTITUTE_ID, ASSESSMENT_ID, filter);
        assertThat(response.getBody()).isNotNull();
        return new String(response.getBody(), StandardCharsets.UTF_8).split("\n");
    }

    @Test
    void carriesTheContactDetailsNeededToChaseALearner() {
        when(notAttemptedLearnerService.findNotAttempted(eq(ASSESSMENT_ID), eq(INSTITUTE_ID), any()))
                .thenReturn(List.of(new EnrolledLearnerDto(
                        "u1", "Aadya Saxena", "batch-1", "aadya@example.com", "+919999999999", "aadya01")));
        when(adminCoreServiceClient.getBatchNames(anyList())).thenReturn(Map.of("batch-1", "Class 10 A"));

        String[] lines = exportLines(pendingBatchFilter());

        assertThat(lines[0]).isEqualTo(HEADER);
        assertThat(lines[1]).isEqualTo("Aadya Saxena,aadya@example.com,+919999999999,aadya01,Class 10 A");
    }

    @Test
    void omitsMarksAndRankBecauseTheseLearnersNeverStarted() {
        when(notAttemptedLearnerService.findNotAttempted(eq(ASSESSMENT_ID), eq(INSTITUTE_ID), any()))
                .thenReturn(List.of());
        when(adminCoreServiceClient.getBatchNames(anyList())).thenReturn(Map.of());

        // A zero in a Marks column would read as "sat the test and scored nothing".
        assertThat(exportLines(pendingBatchFilter())[0])
                .doesNotContain("Marks Obtained")
                .doesNotContain("Rank")
                .doesNotContain("Percentage");
    }

    @Test
    void stillReturnsTheHeaderWhenEveryoneAttempted() {
        when(notAttemptedLearnerService.findNotAttempted(eq(ASSESSMENT_ID), eq(INSTITUTE_ID), any()))
                .thenReturn(List.of());
        when(adminCoreServiceClient.getBatchNames(anyList())).thenReturn(Map.of());

        // Headers alone say "nobody is pending"; an empty file looks like a failed export.
        String[] lines = exportLines(pendingBatchFilter());

        assertThat(lines).hasSize(1);
        assertThat(lines[0]).isEqualTo(HEADER);
    }

    @Test
    void rendersMissingContactDetailsAsEmptyCellsRatherThanDroppingTheLearner() {
        // A learner imported without an email or phone still has to appear — they are
        // precisely the one the admin needs to notice they cannot reach.
        when(notAttemptedLearnerService.findNotAttempted(eq(ASSESSMENT_ID), eq(INSTITUTE_ID), any()))
                .thenReturn(List.of(new EnrolledLearnerDto("u1", "Aadya Saxena", null)));
        when(adminCoreServiceClient.getBatchNames(anyList())).thenReturn(Map.of());

        String[] lines = exportLines(pendingBatchFilter());

        assertThat(lines).hasSize(2);
        assertThat(lines[1]).isEqualTo("Aadya Saxena,,,,");
    }

    @Test
    void fallsBackToTheBatchIdWhenItsNameCannotBeResolved() {
        // admin_core unreachable returns an empty map; an id beats a blank cell.
        when(notAttemptedLearnerService.findNotAttempted(eq(ASSESSMENT_ID), eq(INSTITUTE_ID), any()))
                .thenReturn(List.of(new EnrolledLearnerDto("u1", "Aadya Saxena", "batch-1")));
        when(adminCoreServiceClient.getBatchNames(anyList())).thenReturn(Map.of());

        assertThat(exportLines(pendingBatchFilter())[1]).endsWith(",batch-1");
    }

    @Test
    void escapesACommaInALearnerNameSoTheRowKeepsItsColumns() {
        when(notAttemptedLearnerService.findNotAttempted(eq(ASSESSMENT_ID), eq(INSTITUTE_ID), any()))
                .thenReturn(List.of(new EnrolledLearnerDto(
                        "u1", "Saxena, Aadya", "batch-1", "a@b.c", "+91", "aadya01")));
        when(adminCoreServiceClient.getBatchNames(anyList())).thenReturn(Map.of("batch-1", "Class 10, A"));

        String[] lines = exportLines(pendingBatchFilter());

        assertThat(lines[1]).isEqualTo("\"Saxena, Aadya\",a@b.c,+91,aadya01,\"Class 10, A\"");
    }

    @Test
    void theColumnPickerOffersTheContactColumnsAndNoRegistrationFields() {
        ResultExportColumnsDto columns =
                manager.getResultExportColumns(null, INSTITUTE_ID, ASSESSMENT_ID, true).getBody();

        assertThat(columns).isNotNull();
        assertThat(columns.getBaseColumns())
                .containsExactly("Name", "Email", "Phone Number", "Username", "Batch");
        // A never-attempted learner has no registration row, so every form answer would be
        // blank — offering them would be a tick-list of empty columns.
        assertThat(columns.getCustomFields()).isEmpty();
    }
}
