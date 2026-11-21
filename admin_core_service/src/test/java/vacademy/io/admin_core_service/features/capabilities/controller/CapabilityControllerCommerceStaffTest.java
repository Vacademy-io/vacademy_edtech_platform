package vacademy.io.admin_core_service.features.capabilities.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityQueryService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Shop staff are not general staff, but the admin app reads /me to draw their Commerce rail:
 * a commerce role-holder of THIS institute may read it, nobody else gains anything.
 */
class CapabilityControllerCommerceStaffTest {

    private static final String INSTITUTE = "inst-1";

    private CapabilityController controller;

    @BeforeEach
    void setUp() {
        CapabilityQueryService queryService = mock(CapabilityQueryService.class);
        when(queryService.me(INSTITUTE)).thenReturn(Map.of("mode", "LEGACY"));
        controller = new CapabilityController(queryService, new InstituteAccessValidator());
        clientIdHeader(INSTITUTE);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientIdHeader(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails user(boolean root, String... authorities) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("Test User");
        dto.setRootUser(root);
        dto.setAuthorities(List.of(authorities));
        return new CustomUserDetails(dto);
    }

    @Test
    void commerceRoleHolderOfThisInstituteMayReadMe() {
        assertEquals(HttpStatus.OK, controller.me(user(false, "COMMERCE_POS_CASHIER"), INSTITUTE).getStatusCode());
        assertEquals(HttpStatus.OK, controller.me(user(true, "COMMERCE_ACCOUNTANT"), INSTITUTE).getStatusCode());
    }

    @Test
    void commerceRoleInAnotherInstituteIsRefused() {
        clientIdHeader("inst-2");
        assertThrows(RuntimeException.class, () -> controller.me(user(false, "COMMERCE_POS_CASHIER"), INSTITUTE));
    }

    @Test
    void learnersAndRootUsersAreStillRefused() {
        assertThrows(RuntimeException.class, () -> controller.me(user(true, "STUDENT"), INSTITUTE));
        assertThrows(RuntimeException.class, () -> controller.me(user(true), INSTITUTE));
    }
}
