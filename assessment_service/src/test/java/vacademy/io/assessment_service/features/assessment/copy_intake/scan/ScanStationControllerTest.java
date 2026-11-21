package vacademy.io.assessment_service.features.assessment.copy_intake.scan;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.springframework.http.HttpStatus;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.config.ScanStationProperties;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.controller.ScanStationController;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.dto.ScanStationDtos;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.entity.AiScanSession;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.repository.AiScanSessionRepository;
import vacademy.io.assessment_service.features.assessment.copy_intake.scan.service.ScanStationService;
import vacademy.io.assessment_service.features.assessment.entity.AssessmentInstituteMapping;
import vacademy.io.assessment_service.features.assessment.repository.AssessmentInstituteMappingRepository;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.EvaluationAccessValidator;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The switch and the tenant binding in front of every scan station route. */
class ScanStationControllerTest {

    private final CustomUserDetails user = new CustomUserDetails();
    private final EvaluationAccessValidator access = mock(EvaluationAccessValidator.class);
    private final AssessmentInstituteMappingRepository mappings = mock(AssessmentInstituteMappingRepository.class);
    private final AiScanSessionRepository sessions = mock(AiScanSessionRepository.class);

    private ScanStationController controller(boolean enabled, String institutes) {
        ScanStationProperties props = new ScanStationProperties(enabled, institutes, 60000);
        ScanStationService service = new ScanStationService(props, sessions, null, null, null, null, null, null,
                null, null);
        when(mappings.findByAssessmentIdAndInstituteId(anyString(), anyString()))
                .thenReturn(Optional.of(mock(AssessmentInstituteMapping.class)));
        return new ScanStationController(service, props, access, mappings);
    }

    private static HttpStatus statusOf(Executable call) {
        Throwable t = catchThrowable(call::execute);
        assertThat(t).isInstanceOf(VacademyException.class);
        return ((VacademyException) t).getStatus();
    }

    @Test
    void configSaysOffWhileSwitchedOffAndChecksMembership() {
        ScanStationDtos.ConfigDto off = controller(false, "*").config(user, "inst-1", "inst-1").getBody();
        assertThat(off.isEnabled()).isFalse();
        assertThat(off.getMaxLoads()).isEqualTo(40);
        assertThat(off.getMaxPagesPerPass()).isEqualTo(100);
        assertThat(off.getMaxCopies()).isEqualTo(500);
        verify(access).requireActiveInstitute("inst-1", "inst-1");
        verify(access).requireInstituteMembership(user, "inst-1");

        assertThat(controller(true, "").config(user, "inst-1", "inst-1").getBody().isEnabled()).isFalse();
        assertThat(controller(true, "inst-2, inst-3").config(user, "inst-1", "inst-1").getBody().isEnabled()).isFalse();
        assertThat(controller(true, "inst-2, inst-1").config(user, "inst-1", "inst-1").getBody().isEnabled()).isTrue();
        assertThat(controller(true, "*").config(user, "inst-1", "inst-1").getBody().isEnabled()).isTrue();
    }

    @Test
    void everyOtherRouteIs404WhenOffOrNotListed() {
        for (ScanStationController c : List.of(controller(false, "*"), controller(true, ""),
                controller(true, "inst-9"))) {
            ScanStationDtos.LoadRequest load = new ScanStationDtos.LoadRequest();
            ScanStationDtos.DecisionRequest decision = new ScanStationDtos.DecisionRequest();
            List<Executable> calls = List.of(
                    () -> c.create(user, "inst-1", "a-1", "inst-1"),
                    () -> c.list(user, "inst-1", "a-1", "inst-1"),
                    () -> c.get(user, "inst-1", "inst-1", null, "sess-1"),
                    () -> c.addLoad(user, "inst-1", "inst-1", null, "sess-1", load),
                    () -> c.replaceLoad(user, "inst-1", "inst-1", null, "sess-1", 1, load),
                    () -> c.removeLoad(user, "inst-1", "inst-1", null, "sess-1", 1),
                    () -> c.decide(user, "inst-1", "inst-1", null, "sess-1", decision),
                    () -> c.build(user, "inst-1", "inst-1", null, "sess-1"),
                    () -> c.reopen(user, "inst-1", "inst-1", null, "sess-1"),
                    () -> c.start(user, "inst-1", "inst-1", null, "sess-1", null));
            for (Executable call : calls) {
                assertThat(statusOf(call)).isEqualTo(HttpStatus.NOT_FOUND);
            }
        }
    }

    @Test
    void aSessionOfAnotherInstituteOrAssessmentIs404() {
        AiScanSession s = AiScanSession.builder().id("sess-1").assessmentId("a-1").instituteId("inst-1")
                .status(AiScanSession.OPEN).build();
        when(sessions.findById("sess-1")).thenReturn(Optional.of(s));
        ScanStationController c = controller(true, "*");

        assertThat(statusOf(() -> c.get(user, "inst-2", "inst-2", null, "sess-1"))).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(statusOf(() -> c.build(user, "inst-2", "inst-2", null, "sess-1"))).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(statusOf(() -> c.get(user, "inst-1", "inst-1", "a-2", "sess-1"))).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(statusOf(() -> c.get(user, "inst-1", "inst-1", null, "missing"))).isEqualTo(HttpStatus.NOT_FOUND);
    }
}
