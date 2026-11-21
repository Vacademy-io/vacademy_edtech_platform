package vacademy.io.admin_core_service.features.learner_profile;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.learner_profile.controller.LearnerProfileController;
import vacademy.io.admin_core_service.features.learner_profile.dto.LearnerProfileSignalDto;
import vacademy.io.admin_core_service.features.learner_profile.service.LearnerProfileService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Observations about a learner reach only staff of that learner's institute. */
class LearnerProfileControllerTest {

    private static final String INSTITUTE = "inst-1";

    private final LearnerProfileService service = mock(LearnerProfileService.class);
    private final LearnerProfileController controller =
            new LearnerProfileController(service, new InstituteAccessValidator());
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private void as(String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("staff-1");
        dto.setUsername("staff-1");
        dto.setFullName("Staff");
        dto.setRootUser(false);
        dto.setAuthorities(List.of(authorities));
        request.setAttribute("user", new CustomUserDetails(dto));
    }

    @Test
    void staffReadTheirInstitutesSignals() {
        as("ADMIN");
        LearnerProfileSignalDto signal = LearnerProfileSignalDto.builder().id(1L).kind("WEAKNESS").build();
        when(service.signals(INSTITUTE, "learner-1", false)).thenReturn(List.of(signal));

        assertEquals(List.of(signal), controller.signals(request, "learner-1", false).getBody());
    }

    @Test
    void aLearnerCannotReadOrDismiss() {
        as("STUDENT");

        assertThrows(RuntimeException.class, () -> controller.signals(request, "learner-1", false));
        assertThrows(RuntimeException.class, () -> controller.dismiss(request, 7L));
        verify(service, never()).signals(anyString(), anyString(), anyBoolean());
    }

    @Test
    void dismissIsScopedToTheHeaderInstitute() {
        as("ADMIN");
        when(service.dismiss(INSTITUTE, 7L, "staff-1")).thenReturn(true);
        when(service.dismiss(INSTITUTE, 8L, "staff-1")).thenReturn(false);

        assertEquals(204, controller.dismiss(request, 7L).getStatusCode().value());
        assertEquals(404, controller.dismiss(request, 8L).getStatusCode().value());
    }
}
