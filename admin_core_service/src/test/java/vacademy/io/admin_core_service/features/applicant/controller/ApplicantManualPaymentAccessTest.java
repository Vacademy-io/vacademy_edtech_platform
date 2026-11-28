package vacademy.io.admin_core_service.features.applicant.controller;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import vacademy.io.admin_core_service.core.security.InstituteAccessValidator;
import vacademy.io.admin_core_service.features.applicant.service.ApplicantService;
import vacademy.io.common.auth.dto.UserServiceDTO;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.ForbiddenException;
import vacademy.io.common.payment.dto.PaymentInitiationRequestDTO;
import vacademy.io.common.payment.dto.PaymentResponseDTO;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Recording an offline (MANUAL) applicant payment is for staff of the applicant's institute.
 * Online payments (Razorpay etc.) from the parent portal are unchanged.
 */
class ApplicantManualPaymentAccessTest {

    private ApplicantService applicantService;
    private ApplicantPublicController controller;

    @BeforeEach
    void setUp() {
        applicantService = mock(ApplicantService.class);
        controller = new ApplicantPublicController(applicantService, new InstituteAccessValidator());
        when(applicantService.getInstituteIdForApplicant("app-1")).thenReturn("INST_1");
        when(applicantService.preparePayment(any(), any(), any(), any())).thenReturn(new PaymentResponseDTO());
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    private static void clientId(String instituteId) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("clientId", instituteId);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private static CustomUserDetails user(String... roles) {
        UserServiceDTO dto = new UserServiceDTO();
        dto.setUserId("u-1");
        dto.setUsername("u-1");
        dto.setFullName("User");
        dto.setRootUser(true);
        dto.setAuthorities(List.of(roles));
        return new CustomUserDetails(dto);
    }

    private static PaymentInitiationRequestDTO vendor(String vendor) {
        PaymentInitiationRequestDTO dto = new PaymentInitiationRequestDTO();
        dto.setVendor(vendor);
        return dto;
    }

    @Test
    void staffOfTheInstituteCanRecordAManualPayment() {
        clientId("INST_1");
        assertEquals(HttpStatus.OK,
                controller.initiatePayment("app-1", "opt-1", vendor("MANUAL"), user("ADMIN")).getStatusCode());
        assertEquals(HttpStatus.OK,
                controller.initiatePayment("app-1", "opt-1", vendor("manual"), user("COUNSELLOR")).getStatusCode());
        verify(applicantService, times(2)).preparePayment(eq("app-1"), eq("opt-1"), any(), any());
    }

    @Test
    void learnersAndOtherInstitutesCannotRecordAManualPayment() {
        clientId("INST_1");
        assertThrows(ForbiddenException.class,
                () -> controller.initiatePayment("app-1", "opt-1", vendor("MANUAL"), user("STUDENT")));
        assertThrows(ForbiddenException.class,
                () -> controller.initiatePayment("app-1", "opt-1", vendor("MANUAL"), user("PARENT")));
        clientId("INST_2");
        assertThrows(ForbiddenException.class,
                () -> controller.initiatePayment("app-1", "opt-1", vendor("MANUAL"), user("ADMIN")));
        assertEquals(HttpStatus.FORBIDDEN,
                controller.initiatePayment("app-1", "opt-1", vendor("MANUAL"), null).getStatusCode());
        verify(applicantService, never()).preparePayment(any(), any(), any(), any());
    }

    @Test
    void onlinePaymentsAreUnchanged() {
        assertEquals(HttpStatus.OK,
                controller.initiatePayment("app-1", "opt-1", vendor("RAZORPAY"), null).getStatusCode());
        clientId("INST_1");
        assertEquals(HttpStatus.OK,
                controller.initiatePayment("app-1", "opt-1", vendor("RAZORPAY"), user("PARENT")).getStatusCode());
        verify(applicantService, never()).getInstituteIdForApplicant(any());
    }
}
