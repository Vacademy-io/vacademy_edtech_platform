package vacademy.io.assessment_service.features.open_registration.manager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import vacademy.io.assessment_service.features.assessment.entity.Assessment;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.open_registration.dto.GetAssessmentPublicResponseDto;
import vacademy.io.common.exceptions.VacademyException;

import vacademy.io.assessment_service.features.assessment.entity.AssessmentCustomField;

import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The admin round trip, end to end through the real decision path.
 *
 * <p>Both directions used to be wrong, because the page keyed off the
 * registration window and neither save direction keeps that window in step with
 * assessment_visibility:
 *
 * <ul>
 *   <li>PRIVATE -&gt; PUBLIC leaves the window NULL (handleOpenRegistration skips
 *       blank dates), so the link answered "Assessment is Private" forever.</li>
 *   <li>PUBLIC -&gt; PRIVATE never CLEARS the window (the closed-test branch of
 *       saveParticipantsToAssessment only flips visibility), so the old public
 *       link stayed registerable on an assessment the admin had just closed.</li>
 * </ul>
 */
class AssessmentPublicPageVisibilityFlowTest {

    private AssessmentPublicPageManager manager;
    private AssessmentInstituteMappingRepository mappingRepository;

    private static final long DAY = 24L * 60 * 60 * 1000;

    @BeforeEach
    void setUp() {
        manager = new AssessmentPublicPageManager();
        mappingRepository = mock(AssessmentInstituteMappingRepository.class);
        manager.assessmentInstituteMappingRepository = mappingRepository;
    }

    private Assessment assessment(String visibility, Date regOpen, Date regClose) {
        Assessment a = new Assessment();
        a.setId("a-1");
        a.setName("IIM BANGALORE UGAT");
        a.setStatus("PUBLISHED");
        a.setAssessmentVisibility(visibility);
        a.setRegistrationOpenDate(regOpen);
        a.setRegistrationCloseDate(regClose);
        a.setBoundEndTime(new Date(System.currentTimeMillis() + 30 * DAY));
        return a;
    }

    /** Drives the real endpoint; lets the VacademyException rejections escape. */
    private GetAssessmentPublicResponseDto pageFor(Assessment a) {
        return page(a);
    }

    private GetAssessmentPublicResponseDto page(Assessment a) {
        AssessmentInstituteMapping mapping = mock(AssessmentInstituteMapping.class);
        when(mapping.getAssessment()).thenReturn(a);
        when(mapping.getInstituteId()).thenReturn("inst-1");
        when(mappingRepository.findTopByAssessmentUrl(anyString())).thenReturn(Optional.of(mapping));

        ResponseEntity<GetAssessmentPublicResponseDto> response = manager.getAssessmentPage("291329");
        return response.getBody();
    }

    @Test
    void privateThenSwitchedToPublicOpensTheFormEvenWithNoWindow() {
        GetAssessmentPublicResponseDto body = page(assessment("PUBLIC", null, null));

        assertThat(body.getCanRegister()).isTrue();
        assertThat(body.getErrorMessage()).isNull();
    }

    @Test
    void publicThenSwitchedBackToPrivateClosesTheLinkDespiteTheStaleWindow() {
        // The window the assessment carried while it was public is still on the
        // row — visibility must win.
        Date opened = new Date(System.currentTimeMillis() - DAY);
        Date closes = new Date(System.currentTimeMillis() + DAY);

        GetAssessmentPublicResponseDto body = page(assessment("PRIVATE", opened, closes));

        assertThat(body.getCanRegister()).isFalse();
        assertThat(body.getErrorMessage()).isEqualTo("Assessment is Private");
    }

    @Test
    void publicInsideItsWindowRegisters() {
        Date opened = new Date(System.currentTimeMillis() - DAY);
        Date closes = new Date(System.currentTimeMillis() + DAY);

        assertThat(page(assessment("PUBLIC", opened, closes)).getCanRegister()).isTrue();
    }

    @Test
    void publicBeforeItsWindowOpensIsNotYetRegisterable() {
        Date opensTomorrow = new Date(System.currentTimeMillis() + DAY);

        GetAssessmentPublicResponseDto body = page(assessment("PUBLIC", opensTomorrow, null));

        assertThat(body.getCanRegister()).isFalse();
        assertThat(body.getErrorMessage()).isEqualTo("Assessment is closed");
    }

    @Test
    void publicAfterItsWindowClosedIsNotRegisterable() {
        Date closedYesterday = new Date(System.currentTimeMillis() - DAY);

        GetAssessmentPublicResponseDto body = page(assessment("PUBLIC", null, closedYesterday));

        assertThat(body.getCanRegister()).isFalse();
        assertThat(body.getErrorMessage()).isEqualTo("Assessment is closed");
    }

    @Test
    void publicWithOnlyAnOpenDateInThePastStaysOpenIndefinitely() {
        Date openedLastWeek = new Date(System.currentTimeMillis() - 7 * DAY);

        assertThat(page(assessment("PUBLIC", openedLastWeek, null)).getCanRegister()).isTrue();
    }

    @Test
    void aPublicNoWindowAssessmentShipsItsRegistrationFormFields() {
        // The learner form renders from these. Before the fix this response was
        // never reached for a no-window assessment, so the fields never shipped.
        Assessment a = assessment("PUBLIC", null, null);
        AssessmentCustomField fullName = new AssessmentCustomField();
        fullName.setFieldKey("full_name");
        a.setAssessmentCustomFields(new LinkedHashSet<>(List.of(fullName)));

        GetAssessmentPublicResponseDto body = page(a);

        assertThat(body.getCanRegister()).isTrue();
        assertThat(body.getAssessmentCustomFields())
                .extracting(AssessmentCustomField::getFieldKey)
                .containsExactly("full_name");
    }

    @Test
    void aDeletedAssessmentLooksLikeADeadLinkEvenThoughItIsPublic() {
        // 3 prod assessments were live in exactly this state: DELETED, PUBLIC,
        // and still carrying an open registration window from before deletion.
        Assessment a = assessment("PUBLIC", new Date(System.currentTimeMillis() - DAY), null);
        a.setStatus("DELETED");

        assertThatThrownBy(() -> pageFor(a))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("Assessment not found");
    }

    @Test
    void aDraftAssessmentIsNotRegisterableBeforeItIsPublished() {
        Assessment a = assessment("PUBLIC", new Date(System.currentTimeMillis() - DAY), null);
        a.setStatus("DRAFT");

        assertThatThrownBy(() -> pageFor(a))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("Assessment not found");
    }

    @Test
    void anUnknownStatusFailsClosed() {
        Assessment a = assessment("PUBLIC", null, null);
        a.setStatus(null);

        assertThatThrownBy(() -> pageFor(a)).isInstanceOf(VacademyException.class);
    }

    @Test
    void anEndedAssessmentIsRejectedEvenWhileItsRegistrationWindowIsOpen() {
        Assessment a = assessment("PUBLIC", new Date(System.currentTimeMillis() - DAY),
                new Date(System.currentTimeMillis() + DAY));
        a.setBoundEndTime(new Date(System.currentTimeMillis() - DAY));

        assertThatThrownBy(() -> pageFor(a))
                .isInstanceOf(VacademyException.class)
                .hasMessageContaining("Assessment is ended");
    }

    @Test
    void aPrivateAssessmentNeverLeaksItsRegistrationFormFields() {
        Assessment a = assessment("PRIVATE", null, null);
        AssessmentCustomField email = new AssessmentCustomField();
        email.setFieldKey("email");
        a.setAssessmentCustomFields(new LinkedHashSet<>(List.of(email)));

        GetAssessmentPublicResponseDto body = page(a);

        assertThat(body.getCanRegister()).isFalse();
        assertThat(body.getAssessmentCustomFields()).isNull();
    }
}
