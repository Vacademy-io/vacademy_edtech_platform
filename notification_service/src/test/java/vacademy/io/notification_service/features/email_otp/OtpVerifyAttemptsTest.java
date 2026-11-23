package vacademy.io.notification_service.features.email_otp;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.institute.OriginInstituteResolver;
import vacademy.io.notification_service.features.email_otp.entity.EmailOtp;
import vacademy.io.notification_service.features.email_otp.repository.OtpRepository;
import vacademy.io.notification_service.features.email_otp.service.OTPService;
import vacademy.io.notification_service.service.EmailService;

import java.util.Date;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Each emailed code allows a limited number of wrong entries. */
class OtpVerifyAttemptsTest {

    private OtpRepository repo;
    private OTPService service;
    private EmailOtp stored;
    /** Simulates the database-side attempt count kept for the stored code. */
    private final AtomicInteger used = new AtomicInteger();

    @BeforeEach
    void setUp() {
        repo = mock(OtpRepository.class);
        service = new OTPService();
        ReflectionTestUtils.setField(service, "otpRepository", repo);
        ReflectionTestUtils.setField(service, "emailService", mock(EmailService.class));
        ReflectionTestUtils.setField(service, "originInstituteResolver", mock(OriginInstituteResolver.class));
        ReflectionTestUtils.setField(service, "productConfigClient", mock(ProductConfigClient.class));
        stored = EmailOtp.builder().id("otp-1").email("learner@gmail.com").otp("123456")
                .createdAt(new Date()).build();
        when(repo.findTopByEmailOrderByCreatedAtDesc("learner@gmail.com")).thenReturn(Optional.of(stored));
        when(repo.takeVerifyAttempt(eq("otp-1"), anyInt())).thenAnswer(inv -> {
            int max = inv.getArgument(1);
            if (used.get() >= max) return 0;
            used.incrementAndGet();
            return 1;
        });
        when(repo.markVerified("otp-1")).thenAnswer(inv -> {
            used.set(0);
            return 1;
        });
    }

    @Test
    void correctCodeVerifiesAndIsMarked() {
        assertTrue(service.verifyEmailOtp("123456", "learner@gmail.com"));
        verify(repo).markVerified("otp-1");
    }

    @Test
    void wrongCodeFailsWithoutMarking() {
        assertFalse(service.verifyEmailOtp("000000", "learner@gmail.com"));
        verify(repo, never()).markVerified(any());
    }

    @Test
    void fourWrongThenCorrectStillVerifies() {
        for (int i = 0; i < 4; i++) assertFalse(service.verifyEmailOtp("000000", "learner@gmail.com"));
        assertTrue(service.verifyEmailOtp("123456", "learner@gmail.com"));
    }

    @Test
    void afterFiveWrongEvenTheCorrectCodeFails() {
        for (int i = 0; i < 5; i++) assertFalse(service.verifyEmailOtp("000000", "learner@gmail.com"));
        assertFalse(service.verifyEmailOtp("123456", "learner@gmail.com"));
        verify(repo, never()).markVerified(any());
    }

    @Test
    void correctCodeCanBeSubmittedAgainWithinItsWindow() {
        // Login retries after the session-limit dialog send the same code again.
        assertTrue(service.verifyEmailOtp("123456", "learner@gmail.com"));
        assertTrue(service.verifyEmailOtp("123456", "learner@gmail.com"));
    }

    @Test
    void expiredCodeKeepsTheSameMessage() {
        stored.setCreatedAt(new Date(System.currentTimeMillis() - 11 * 60 * 1000));
        VacademyException e = assertThrows(VacademyException.class,
                () -> service.verifyEmailOtp("123456", "learner@gmail.com"));
        assertEquals("OTP has expired. Please request a new one.", e.getMessage());
        verify(repo, never()).takeVerifyAttempt(any(), anyInt());
    }

    @Test
    void generatedCodesKeepTheirLengthAndAreDigits() {
        for (int i = 0; i < 200; i++) {
            String code = OTPService.generateOTP(6);
            assertEquals(6, code.length());
            assertTrue(code.chars().allMatch(Character::isDigit));
        }
    }
}
