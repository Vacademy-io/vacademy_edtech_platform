package vacademy.io.auth_service.feature.selfsignup.service;

import io.jsonwebtoken.Claims;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.dto.RegisterRequest;
import vacademy.io.auth_service.feature.auth.manager.AuthManager;
import vacademy.io.auth_service.feature.notification.service.NotificationService;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupOtpRequest;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupRequest;
import vacademy.io.common.auth.entity.User;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.product.ProductConfigDTO;
import vacademy.io.common.notification.dto.EmailOTPRequest;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SelfSignupManagerTest {

    @Mock NotificationService notificationService;
    @Mock UserRepository userRepository;
    @Mock AuthManager authManager;
    @Mock SelfSignupTokenService tokenService;
    @Mock SelfSignupRateLimiter rateLimiter;
    @Mock Claims claims;
    @Mock ProductConfigClient productConfigClient;

    @InjectMocks SelfSignupManager manager;

    @BeforeEach
    void freeEmailAndUsername() {
        when(productConfigClient.get(anyString())).thenReturn(Optional.empty());
        when(productConfigClient.get("evalezy")).thenReturn(Optional.of(ProductConfigDTO.builder()
                .productKey("evalezy").displayName("Evalezy").fromEmail("hello@evalezy.com").fromName("Evalezy")
                .trialDays(3).selfSignupEnabled(true).appPath("/evalezy").logoUrl("/l.svg").build()));
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(claims.get("email", String.class)).thenReturn("teacher@school.in");
        when(claims.get("method", String.class)).thenReturn(SelfSignupTokenService.METHOD_EMAIL_OTP);
        when(claims.get("name", String.class)).thenReturn("");
        when(claims.get("subject_id", String.class)).thenReturn("");
        when(claims.get("vendor_id", String.class)).thenReturn("");
        when(tokenService.verify("good")).thenReturn(claims);
        when(authManager.registerRootUser(any(), any())).thenReturn(JwtResponseDto.builder().accessToken("a").refreshToken("r").build());
    }

    private SelfSignupRequest valid() {
        SelfSignupRequest r = new SelfSignupRequest();
        r.setSignupToken("good");
        r.setProduct("evalezy");
        r.setFullName("A Teacher");
        r.setUsername("ateacher");
        r.setPassword("longenough1");
        r.setInstituteName("Sunrise School");
        r.setInstituteType("school");
        r.setTeachers(3);
        return r;
    }

    private static void assertEndsInDays(long days, RegisterRequest sent) {
        long left = sent.getInstitute().getDemoExpiresAt().getTime() - System.currentTimeMillis();
        long expected = days * 86_400_000L;
        assertTrue(left <= expected && left > expected - 60_000L, "trial ends " + days + " days from now");
    }

    private SelfSignupOtpRequest otp(String email) {
        SelfSignupOtpRequest r = new SelfSignupOtpRequest();
        r.setProduct("evalezy");
        r.setEmail(email);
        return r;
    }

    @Test
    void otpIsMailedUnderTheProductsName() {
        manager.requestOtp(otp(" Teacher@School.in "), "1.1.1.1");
        ArgumentCaptor<EmailOTPRequest> mail = ArgumentCaptor.forClass(EmailOTPRequest.class);
        verify(notificationService).sendOtp(mail.capture(), any());
        assertEquals("teacher@school.in", mail.getValue().getTo());
        assertTrue(mail.getValue().getSubject().contains("Evalezy"));
        assertEquals("evalezy", mail.getValue().getProduct());
    }

    @Test
    void otherProductsCannotSignUp() {
        SelfSignupOtpRequest r = otp("t@s.in");
        r.setProduct("vacademy");
        assertThrows(VacademyException.class, () -> manager.requestOtp(r, "1.1.1.1"));
        verifyNoInteractions(notificationService);
    }

    @Test
    void anExistingAccountGetsNoCode() {
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc("t@s.in")).thenReturn(Optional.of(new User()));
        VacademyException e = assertThrows(VacademyException.class, () -> manager.requestOtp(otp("t@s.in"), "1.1.1.1"));
        assertTrue(e.getMessage().contains("log in"));
        verifyNoInteractions(notificationService);
    }

    @Test
    void aWrongCodeGetsNoToken() {
        when(notificationService.verifyOTP(any())).thenReturn(false);
        SelfSignupOtpRequest r = otp("t@s.in");
        r.setOtp("000000");
        assertThrows(VacademyException.class, () -> manager.verifyOtp(r));
        verify(tokenService, never()).issue(any(), any(), any(), any(), any());
    }

    @Test
    void signupCreatesAMarkedTrialWithTheProvenEmail() {
        SelfSignupRequest r = valid();
        manager.signup(r, "1.1.1.1");
        ArgumentCaptor<RegisterRequest> reg = ArgumentCaptor.forClass(RegisterRequest.class);
        verify(authManager).registerRootUser(reg.capture(), any());
        RegisterRequest sent = reg.getValue();
        assertEquals("teacher@school.in", sent.getEmail());
        assertEquals("ateacher", sent.getUserName());
        assertEquals("evalezy", sent.getInstitute().getProduct());
        assertEquals("FREE_TRIAL", sent.getInstitute().getLeadTag());
        assertEquals(List.of("1"), sent.getInstitute().getModuleRequestIds());
        assertEndsInDays(3, sent);
    }

    @Test
    void aBlankInstituteNameUsesTheTeachersName() {
        SelfSignupRequest r = valid();
        r.setInstituteName(" ");
        manager.signup(r, "1.1.1.1");
        ArgumentCaptor<RegisterRequest> reg = ArgumentCaptor.forClass(RegisterRequest.class);
        verify(authManager).registerRootUser(reg.capture(), any());
        assertEquals("A Teacher", reg.getValue().getInstitute().getInstituteName());
    }

    @Test
    void weakPasswordAndTakenUsernameCreateNothing() {
        SelfSignupRequest weak = valid();
        weak.setPassword("short");
        assertThrows(VacademyException.class, () -> manager.signup(weak, "1.1.1.1"));

        when(userRepository.findByUsername("ateacher")).thenReturn(Optional.of(new User()));
        assertThrows(VacademyException.class, () -> manager.signup(valid(), "1.1.1.1"));
        verify(authManager, never()).registerRootUser(any(), any());
    }

    @Test
    void googleNeedsNoPasswordAndLinksTheGoogleAccount() {
        when(claims.get("method", String.class)).thenReturn(SelfSignupTokenService.METHOD_GOOGLE);
        when(claims.get("name", String.class)).thenReturn("G Teacher");
        when(claims.get("subject_id", String.class)).thenReturn("sub1");
        when(claims.get("vendor_id", String.class)).thenReturn("google");
        SelfSignupRequest r = valid();
        r.setFullName(null);
        r.setUsername(null);
        r.setPassword(null);
        manager.signup(r, "1.1.1.1");
        ArgumentCaptor<RegisterRequest> reg = ArgumentCaptor.forClass(RegisterRequest.class);
        verify(authManager).registerRootUser(reg.capture(), any());
        assertEquals("G Teacher", reg.getValue().getFullName());
        assertEquals("sub1", reg.getValue().getSubjectId());
        assertNotNull(reg.getValue().getPassword());
    }

    @Test
    void aBadInstituteTypeIsRefused() {
        SelfSignupRequest r = valid();
        r.setInstituteType("hacker");
        assertThrows(VacademyException.class, () -> manager.signup(r, "1.1.1.1"));
    }

    @Test
    void aClosedProductCannotSignUp() {
        when(productConfigClient.get("evalezy")).thenReturn(Optional.of(ProductConfigDTO.builder()
                .productKey("evalezy").selfSignupEnabled(false).build()));
        assertThrows(VacademyException.class, () -> manager.requestOtp(otp("t@s.in"), "1.1.1.1"));
        verifyNoInteractions(notificationService);
    }

    @Test
    void trialDaysComeFromTheProductsSettings() {
        when(productConfigClient.get("evalezy")).thenReturn(Optional.of(ProductConfigDTO.builder()
                .productKey("evalezy").displayName("Evalezy").trialDays(10).selfSignupEnabled(true).build()));
        manager.signup(valid(), "1.1.1.1");
        ArgumentCaptor<RegisterRequest> reg = ArgumentCaptor.forClass(RegisterRequest.class);
        verify(authManager).registerRootUser(reg.capture(), any());
        assertEndsInDays(10, reg.getValue());
    }

    @Test
    void theScreensConfigHasNoSender() {
        assertEquals(3, manager.config("evalezy").getTrialDays());
        assertEquals("/evalezy", manager.config("evalezy").getAppPath());
    }
}
