package vacademy.io.admin_core_service.features.admin_activity_logs;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.admin_core_service.features.admin_activity_logs.controller.AdminActivityLogController;
import vacademy.io.admin_core_service.features.admin_activity_logs.dto.AdminActivityLogFilterDTO;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.admin_activity_logs.service.AdminActivityLogReadService;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * How the log endpoint turns query params into a filter.
 *
 * <p>Worth pinning because the audit UI's multi-selects send several values in
 * one param ({@code actorId=a,b,c}) — repeated {@code actorId[]=} keys are
 * rejected by the ingress before they reach the service — while every existing
 * bookmark and CSV-export link still sends a single value. Both have to keep
 * working, and an empty filter must widen the result set rather than empty it.
 */
class AdminActivityLogFilterParsingTest {

    private static final String INSTITUTE = "inst-1";

    private AdminActivityLogReadService readService;
    private AdminActivityLogController controller;
    private MockHttpServletRequest request;
    private InstituteAccessValidator validator;

    @BeforeEach
    void setUp() {
        readService = mock(AdminActivityLogReadService.class);
        when(readService.list(any(), any(), any())).thenReturn(Page.empty());
        when(readService.exportCsv(any(), any())).thenReturn(new byte[0]);

        controller = new AdminActivityLogController();
        ReflectionTestUtils.setField(controller, "readService", readService);
        validator = mock(InstituteAccessValidator.class);
        ReflectionTestUtils.setField(controller, "instituteAccessValidator", validator);

        request = new MockHttpServletRequest();
        request.addHeader("clientId", INSTITUTE);
    }

    @Test
    @DisplayName("a comma-separated actor param becomes a multi-value filter")
    void splitsCommaSeparatedActors() {
        controller.list(request, null, null, "user-a,user-b , user-c", null,
                null, null, null, null, null, 0, 20);

        assertEquals(List.of("user-a", "user-b", "user-c"), captureFilter().getActorIds());
    }

    @Test
    @DisplayName("a single value still filters, so old links keep working")
    void keepsSingleValueParamsWorking() {
        controller.list(request, null, null, "user-a", null,
                "LEAD", null, null, "CREATE", null, 0, 20);

        AdminActivityLogFilterDTO filter = captureFilter();
        assertEquals(List.of("user-a"), filter.getActorIds());
        assertEquals(List.of("LEAD"), filter.getEntityTypes());
        assertEquals(List.of("CREATE"), filter.getActions());
    }

    @Test
    @DisplayName("plural aliases merge with the singular params and de-duplicate")
    void mergesPluralAliases() {
        controller.list(request, null, null, "user-a", "user-b,user-a", null,
                "LEAD,AUDIENCE", null, null, "CREATE,CREATE", 0, 20);

        AdminActivityLogFilterDTO filter = captureFilter();
        assertEquals(List.of("user-a", "user-b"), filter.getActorIds());
        assertEquals(List.of("LEAD", "AUDIENCE"), filter.getEntityTypes());
        assertEquals(List.of("CREATE"), filter.getActions());
    }

    @Test
    @DisplayName("blank and empty params leave the filter unset, never IN ()")
    void treatsBlankParamsAsNoFilter() {
        controller.list(request, null, null, "  ", ",,", "", null, null, null, null, 0, 20);

        AdminActivityLogFilterDTO filter = captureFilter();
        assertNull(filter.getActorIds());
        assertNull(filter.getEntityTypes());
        assertNull(filter.getActions());
    }

    @Test
    @DisplayName("entityId is never split — bulk rows store a comma-joined id list")
    void keepsEntityIdIntact() {
        controller.list(request, null, null, null, null, null, null,
                "course-1,course-2", null, null, 0, 20);

        assertEquals("course-1,course-2", captureFilter().getEntityId());
    }

    @Test
    @DisplayName("the CSV export honours exactly the same filters as the list")
    void exportUsesTheSameFilters() {
        controller.exportCsv(request, 1000L, 2000L, "user-a,user-b", null,
                "LEAD", null, null, "DELETE", null);

        ArgumentCaptor<AdminActivityLogFilterDTO> captor =
                ArgumentCaptor.forClass(AdminActivityLogFilterDTO.class);
        verify(readService).exportCsv(eq(INSTITUTE), captor.capture());

        AdminActivityLogFilterDTO filter = captor.getValue();
        assertEquals(List.of("user-a", "user-b"), filter.getActorIds());
        assertEquals(List.of("LEAD"), filter.getEntityTypes());
        assertEquals(List.of("DELETE"), filter.getActions());
        assertEquals(1000L, filter.getStartDate().getTime());
        assertEquals(2000L, filter.getEndDate().getTime());
    }

    @Test
    @DisplayName("a request without clientId is refused — tenant scope is not optional")
    void refusesRequestWithoutInstituteHeader() {
        MockHttpServletRequest anonymous = new MockHttpServletRequest();

        assertThrows(VacademyException.class, () -> controller.list(
                anonymous, null, null, null, null, null, null, null, null, null, 0, 20));
    }

    @Test
    @DisplayName("the log is admin-only: a non-admin is refused before anything is read")
    void refusesNonAdmin() {
        doThrow(new ForbiddenException("Access denied: institute admin role required"))
                .when(validator).requireInstituteAdmin(any(), eq(INSTITUTE));

        assertThrows(ForbiddenException.class, () -> controller.list(
                request, null, null, null, null, null, null, null, null, null, 0, 20));
        assertThrows(ForbiddenException.class, () -> controller.exportCsv(
                request, null, null, null, null, null, null, null, null, null));
        verifyNoInteractions(readService);
    }

    private AdminActivityLogFilterDTO captureFilter() {
        ArgumentCaptor<AdminActivityLogFilterDTO> captor =
                ArgumentCaptor.forClass(AdminActivityLogFilterDTO.class);
        verify(readService).list(eq(INSTITUTE), captor.capture(), any(Pageable.class));
        return captor.getValue();
    }
}
