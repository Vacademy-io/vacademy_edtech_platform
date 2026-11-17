package vacademy.io.admin_core_service.features.commerce.customer;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.features.capabilities.service.CapabilityResolver;
import vacademy.io.admin_core_service.features.commerce.customer.controller.CommerceCustomerController;
import vacademy.io.admin_core_service.features.commerce.customer.dto.CustomerDtos;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerAddressRepository;
import vacademy.io.admin_core_service.features.commerce.customer.repository.CommerceCustomerRepository;
import vacademy.io.admin_core_service.features.commerce.customer.service.CommerceCustomerQueryService;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessGuard;
import vacademy.io.admin_core_service.features.commerce.security.repository.CommerceStaffLocationRepository;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Who may read the shop's customers, through the controller and the real commerce guard: store
 * manager, accountant and an institute ADMIN; never warehouse staff or a cashier; nobody when the
 * orders feature is off; and another institute's customer is "not found".
 */
class CommerceCustomerControllerTest {

    private static final String INST = "inst-1";

    private CapabilityResolver capabilities;
    private CommerceCustomerRepository customers;
    private CommerceCustomerController controller;

    @BeforeEach
    void setUp() {
        capabilities = mock(CapabilityResolver.class);
        when(capabilities.isFeatureGranted(eq(INST), anyString())).thenReturn(true);
        CommerceAccessGuard guard = new CommerceAccessGuard(capabilities, mock(CommerceStaffLocationRepository.class));
        customers = mock(CommerceCustomerRepository.class);
        when(customers.staffSearch(eq(INST), any(), any(), anyInt(), anyLong())).thenReturn(List.of());
        when(customers.staffCount(eq(INST), any(), any())).thenReturn(0L);
        CommerceCustomerRepository.StaffRow row = mock(CommerceCustomerRepository.StaffRow.class);
        when(row.getId()).thenReturn("cust-1");
        when(customers.findStaffRow(INST, "cust-1")).thenReturn(Optional.of(row));
        // A customer of another institute: the scoped read finds nothing.
        when(customers.findStaffRow(INST, "cust-of-inst-2")).thenReturn(Optional.empty());
        controller = new CommerceCustomerController(guard, new CommerceCustomerQueryService(customers,
                mock(CommerceCustomerAddressRepository.class), mock(PlatformTransactionManager.class)));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", INST);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static CustomUserDetails user(String... authorities) {
        CustomUserDetails user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("user-1");
        List<GrantedAuthority> granted = new ArrayList<>();
        for (String a : authorities) {
            granted.add(new SimpleGrantedAuthority(a));
        }
        when(user.getAuthorities()).thenAnswer(call -> granted);
        return user;
    }

    private static String refusal(Runnable call) {
        return assertThrows(CommerceAccessDeniedException.class, call::run).getCode();
    }

    @Test
    void managerAccountantAndAdminMayReadTheListAndAProfile() {
        for (String role : List.of("COMMERCE_STORE_MANAGER", "COMMERCE_ACCOUNTANT", "ADMIN")) {
            CustomUserDetails user = user(role);
            assertEquals(HttpStatus.OK, controller.list(INST, null, 0, 50, user).getStatusCode(), role);
            CustomerDtos.CustomerProfile profile = controller.profile("cust-1", INST, user).getBody();
            assertEquals("cust-1", profile.getCustomer().getId(), role);
        }
    }

    @Test
    void aCashierAndWarehouseStaffAreRefusedByRole() {
        for (String role : List.of("COMMERCE_POS_CASHIER", "COMMERCE_WAREHOUSE_STAFF")) {
            CustomUserDetails user = user(role);
            assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                    refusal(() -> controller.list(INST, null, 0, 50, user)), role);
            assertEquals(CommerceAccessDeniedException.ROLE_NOT_ALLOWED,
                    refusal(() -> controller.profile("cust-1", INST, user)), role);
        }
        verifyNoInteractions(customers);
    }

    @Test
    void withTheOrdersFeatureOffEvenAnAdminIsRefused() {
        when(capabilities.isFeatureGranted(INST, "commerce.orders")).thenReturn(false);
        CustomUserDetails admin = user("ADMIN");
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                refusal(() -> controller.list(INST, null, 0, 50, admin)));
        assertEquals(CommerceAccessDeniedException.FEATURE_DISABLED,
                refusal(() -> controller.profile("cust-1", INST, admin)));
        verifyNoInteractions(customers);
    }

    @Test
    void aCallerOfAnotherInstituteIsRefused() {
        CustomUserDetails admin = user("ADMIN");
        assertEquals(CommerceAccessDeniedException.ACCESS_DENIED,
                refusal(() -> controller.list("inst-2", null, 0, 50, admin)));
        verifyNoInteractions(customers);
    }

    @Test
    void anotherInstitutesCustomerIsNotFound() {
        CustomUserDetails manager = user("COMMERCE_STORE_MANAGER");
        VacademyException e = assertThrows(VacademyException.class,
                () -> controller.profile("cust-of-inst-2", INST, manager));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        assertTrue(e.getMessage().startsWith("CUSTOMER_NOT_FOUND:"), e.getMessage());
    }
}
