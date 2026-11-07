package vacademy.io.admin_core_service.features.classroom;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.classroom.controller.ClassroomTodayController;
import vacademy.io.admin_core_service.features.classroom.dto.ClassroomTodayResponse;
import vacademy.io.admin_core_service.features.classroom.service.ClassroomTodayService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.core.exception.GlobalExceptionHandler;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ClassroomTodayControllerTest {

    private static final String URL = "/admin-core-service/classroom/v1/today";
    private static final String INSTITUTE = "inst-a";

    private ClassroomTodayService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(ClassroomTodayService.class);
        mvc = MockMvcBuilders
                .standaloneSetup(new ClassroomTodayController(new InstituteAccessValidator(), service))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
        when(service.today(any(), any(), any())).thenReturn(new ClassroomTodayResponse(1000L, List.of(), false));
    }

    private static CustomUserDetails user(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("user-1");
        dto.setUsername("user-1");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    private static MockHttpServletRequestBuilder request(CustomUserDetails user, String clientId) {
        MockHttpServletRequestBuilder builder = get(URL).param("instituteId", INSTITUTE).requestAttr("user", user);
        return clientId == null ? builder : builder.header("clientId", clientId);
    }

    @Test
    void staffGetTheListMarkedNoStore() throws Exception {
        mvc.perform(request(user(false, "TEACHER"), INSTITUTE))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.server_time_ms").value(1000))
                .andExpect(jsonPath("$.truncated").value(false))
                .andExpect(jsonPath("$.classes").isArray());
    }

    @Test
    void scopeDefaultsToMineAndAllIsPassedOn() throws Exception {
        CustomUserDetails teacher = user(false, "TEACHER");
        mvc.perform(request(teacher, INSTITUTE)).andExpect(status().isOk());
        verify(service).today(eq(INSTITUTE), eq("mine"), any());

        mvc.perform(request(teacher, INSTITUTE).param("scope", "all")).andExpect(status().isOk());
        verify(service).today(eq(INSTITUTE), eq("all"), any());
    }

    @Test
    void customRoleAndAdminWhoIsAlsoALearnerAreStaff() throws Exception {
        mvc.perform(request(user(false, "FRONT_DESK"), INSTITUTE)).andExpect(status().isOk());
        mvc.perform(request(user(false, "ADMIN", "STUDENT"), INSTITUTE)).andExpect(status().isOk());
    }

    @Test
    void nonMemberIsRefused() throws Exception {
        // auth_service mints authorities for the clientId institute, so no role there means none.
        mvc.perform(request(user(false), INSTITUTE)).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void mismatchedOrMissingClientIdIsRefused() throws Exception {
        mvc.perform(request(user(false, "TEACHER"), "inst-b")).andExpect(status().isForbidden());
        mvc.perform(request(user(false, "TEACHER"), null)).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void rootFlagAloneGivesNoAccess() throws Exception {
        mvc.perform(request(user(true), INSTITUTE)).andExpect(status().isForbidden());
        mvc.perform(request(user(true, "TEACHER"), "inst-b")).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void learnersAreRefusedEvenWithTheTeacherRole() throws Exception {
        mvc.perform(request(user(false, "STUDENT"), INSTITUTE)).andExpect(status().isForbidden());
        mvc.perform(request(user(false, "STUDENT", "TEACHER"), INSTITUTE)).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    void instituteIdIsRequired() throws Exception {
        mvc.perform(get(URL).requestAttr("user", user(false, "TEACHER")).header("clientId", INSTITUTE))
                .andExpect(status().is4xxClientError());
        verifyNoInteractions(service);
    }
}
