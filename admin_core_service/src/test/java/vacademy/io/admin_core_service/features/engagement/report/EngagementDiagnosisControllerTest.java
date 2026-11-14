package vacademy.io.admin_core_service.features.engagement.report;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.engagement.service.EngagementAccessGuard;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.exceptions.VacademyException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Institute admins only: a refusal is a 403 and nothing is read, as on /reports/daily. */
class EngagementDiagnosisControllerTest {

    private EngagementDiagnosisService service;
    private EngagementAccessGuard guard;
    private EngagementDiagnosisController controller;
    private final CustomUserDetails user = mock(CustomUserDetails.class);

    @BeforeEach
    void setUp() {
        service = mock(EngagementDiagnosisService.class);
        guard = mock(EngagementAccessGuard.class);
        controller = new EngagementDiagnosisController(service, guard);
    }

    @Test
    void aRefusalIs403() {
        doThrow(new VacademyException("Not an admin of this institute")).when(guard).requireAdmin(user, "inst");

        assertThrows(ForbiddenException.class, () -> controller.diagnosis(user, "inst", null, null, null, false));
        verifyNoInteractions(service);
    }

    @Test
    void aBlankInstituteIs400() {
        assertThrows(InvalidRequestException.class, () -> controller.diagnosis(user, " ", null, null, null, false));
        verifyNoInteractions(guard, service);
    }

    @Test
    void anAdminGetsTheDiagnosis() {
        EngagementDiagnosis body = mock(EngagementDiagnosis.class);
        when(service.diagnosis("inst", "e1", "WEEKLY", "2026-11-04", true)).thenReturn(body);

        var response = controller.diagnosis(user, "inst", "e1", "WEEKLY", "2026-11-04", true);

        assertEquals(200, response.getStatusCode().value());
        assertSame(body, response.getBody());
    }
}
