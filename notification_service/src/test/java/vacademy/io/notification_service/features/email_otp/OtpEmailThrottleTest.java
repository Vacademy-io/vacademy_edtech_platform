package vacademy.io.notification_service.features.email_otp;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.notification_service.features.email_otp.entity.EmailOtp;
import vacademy.io.notification_service.features.email_otp.repository.OtpRepository;
import vacademy.io.notification_service.features.email_otp.service.OTPService;
import vacademy.io.notification_service.service.EmailService;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** The public OTP endpoint cannot be used to flood one inbox through our SES. */
class OtpEmailThrottleTest {

    private OtpRepository repo;
    private EmailService email;
    private OTPService service;

    @BeforeEach
    void setUp() {
        repo = mock(OtpRepository.class);
        email = mock(EmailService.class);
        service = new OTPService();
        ReflectionTestUtils.setField(service, "otpRepository", repo);
        ReflectionTestUtils.setField(service, "emailService", email);
        ReflectionTestUtils.setField(service, "originInstituteResolver", mock(OriginInstituteResolver.class));
        ReflectionTestUtils.setField(service, "productConfigClient", mock(ProductConfigClient.class));
        when(repo.save(any(EmailOtp.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void sendsWhileUnderTheLimit() {
        when(repo.countRecentForEmail("learner@gmail.com", 10)).thenReturn(4L);
        assertTrue(service.sendEmailOtp("learner@gmail.com", null, "auth", "Asha", "inst-1"));
        verify(repo).save(any(EmailOtp.class));
    }

    @Test
    void stopsAtFiveInTenMinutes() throws Exception {
        when(repo.countRecentForEmail("learner@gmail.com", 10)).thenReturn(5L);
        assertFalse(service.sendEmailOtp(" learner@gmail.com", null, "auth", "Asha", "inst-1"));
        verify(repo, never()).save(any(EmailOtp.class));
        verifyNoInteractions(email);
    }
}
