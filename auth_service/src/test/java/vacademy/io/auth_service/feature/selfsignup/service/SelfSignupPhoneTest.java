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
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupConfigResponse;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupOtpRequest;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupRequest;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.core.internal_api_wrapper.ProductConfigClient;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.product.ProductConfigDTO;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** Telleo's sign-up: the trial is guarded by a phone proven over WhatsApp, one trial per phone. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SelfSignupPhoneTest {

    @Mock NotificationService notificationService;
    @Mock UserRepository userRepository;
    @Mock AuthManager authManager;
    @Mock SelfSignupTokenService tokenService;
    @Mock SelfSignupRateLimiter rateLimiter;
    @Mock Claims claims;
    @Mock ProductConfigClient productConfigClient;
    @Mock SelfSignupAlertClient alertClient;
    @Mock SelfSignupRulesClient rulesClient;

    @InjectMocks SelfSignupManager manager;

    @BeforeEach
    void setUp() {
        when(productConfigClient.get(anyString())).thenReturn(Optional.empty());
        when(productConfigClient.get("telleo")).thenReturn(Optional.of(ProductConfigDTO.builder()
                .productKey("telleo").displayName("Telleo").fromEmail("hello@telleo.ai").fromName("Telleo")
                .trialDays(7).selfSignupEnabled(true).appPath("/telleo/setup").build()));
        SelfSignupRulesClient.Rules rules = new SelfSignupRulesClient.Rules();
        rules.setPhoneVerificationRequired(true);
        rules.setHideTeachers(true);
        rules.setInstituteTypes(List.of("real_estate", "other"));
        when(rulesClient.rules("telleo")).thenReturn(rules);
        when(rulesClient.isTrialPhoneAvailable(eq("telleo"), anyString())).thenReturn(true);
        when(userRepository.findFirstByEmailOrderByCreatedAtDesc(anyString())).thenReturn(Optional.empty());
        when(userRepository.findByUsername(anyString())).thenReturn(Optional.empty());
        when(claims.get("email", String.class)).thenReturn("owner@biz.in");
        when(claims.get("method", String.class)).thenReturn(SelfSignupTokenService.METHOD_EMAIL_OTP);
        when(claims.get("name", String.class)).thenReturn("");
        when(claims.get("subject_id", String.class)).thenReturn("");
        when(claims.get("vendor_id", String.class)).thenReturn("");
        when(claims.get("phone", String.class)).thenReturn("919876543210");
        when(tokenService.verify("good")).thenReturn(claims);
        when(authManager.registerRootUser(any(), any()))
                .thenReturn(JwtResponseDto.builder().accessToken("a").refreshToken("r").build());
    }

    private SelfSignupOtpRequest phoneRequest(String phone) {
        SelfSignupOtpRequest r = new SelfSignupOtpRequest();
        r.setProduct("telleo");
        r.setSignupToken("good");
        r.setPhone(phone);
        return r;
    }

    private SelfSignupRequest signup() {
        SelfSignupRequest r = new SelfSignupRequest();
        r.setSignupToken("good");
        r.setProduct("telleo");
        r.setFullName("A Owner");
        r.setPhone("+91 11111 11111");
        r.setUsername("aowner");
        r.setPassword("longenough1");
        r.setInstituteName("Sunrise Homes");
        r.setInstituteType("real_estate");
        r.setTeachers(9);
        return r;
    }

    @Test
    void configTellsTheFormToVerifyAPhone() {
        SelfSignupConfigResponse config = manager.config("telleo");
        assertTrue(config.getPhoneVerificationRequired());
        assertTrue(config.getHideTeachers());
        assertEquals(List.of("real_estate", "other"), config.getInstituteTypes());
    }

    @Test
    void phoneCodeGoesToTheNormalisedNumber() {
        manager.requestPhoneOtp(phoneRequest("98765 43210"), "1.1.1.1");
        verify(notificationService).sendPlatformDefaultWhatsAppOtp("919876543210");
    }

    @Test
    void aPhoneThatHadATrialGetsNoCode() {
        when(rulesClient.isTrialPhoneAvailable("telleo", "919876543210")).thenReturn(false);
        VacademyException e = assertThrows(VacademyException.class,
                () -> manager.requestPhoneOtp(phoneRequest("9876543210"), "1.1.1.1"));
        assertTrue(e.getMessage().contains("already been used"));
        verify(notificationService, never()).sendPlatformDefaultWhatsAppOtp(anyString());
    }

    @Test
    void aPhoneCodeNeedsTheEmailProofFirst() {
        when(tokenService.verify("bad")).thenThrow(new VacademyException("expired"));
        SelfSignupOtpRequest r = phoneRequest("9876543210");
        r.setSignupToken("bad");
        assertThrows(VacademyException.class, () -> manager.requestPhoneOtp(r, "1.1.1.1"));
        verify(notificationService, never()).sendPlatformDefaultWhatsAppOtp(anyString());
    }

    @Test
    void aRightCodeIssuesAProofCarryingThePhone() {
        when(notificationService.verifyWhatsAppOTP(any())).thenReturn(true);
        when(tokenService.issue(any(), any(), any(), any(), any(), any())).thenReturn("with-phone");
        SelfSignupOtpRequest r = phoneRequest("9876543210");
        r.setOtp("123456");
        assertEquals("with-phone", manager.verifyPhoneOtp(r).getSignupToken());
        verify(tokenService).issue(eq("owner@biz.in"), any(), any(), any(), any(), eq("919876543210"));
    }

    @Test
    void aWrongCodeIssuesNothing() {
        when(notificationService.verifyWhatsAppOTP(any())).thenReturn(false);
        SelfSignupOtpRequest r = phoneRequest("9876543210");
        r.setOtp("000000");
        assertThrows(VacademyException.class, () -> manager.verifyPhoneOtp(r));
        verify(tokenService, never()).issue(any(), any(), any(), any(), any(), any());
    }

    @Test
    void signupUsesOnlyTheProvenPhoneAndSkipsTeachers() {
        manager.signup(signup(), "1.1.1.1");
        ArgumentCaptor<RegisterRequest> reg = ArgumentCaptor.forClass(RegisterRequest.class);
        verify(authManager).registerRootUser(reg.capture(), any());
        assertEquals("919876543210", reg.getValue().getInstitute().getPhone());
        assertEquals("919876543210", reg.getValue().getMobileNumber());
        assertNull(reg.getValue().getInstitute().getStaffStrength());
        assertEquals("real_estate", reg.getValue().getInstitute().getType());
    }

    @Test
    void signupWithoutAProvenPhoneIsRefused() {
        when(claims.get("phone", String.class)).thenReturn("");
        assertThrows(VacademyException.class, () -> manager.signup(signup(), "1.1.1.1"));
        verify(authManager, never()).registerRootUser(any(), any());
    }

    @Test
    void signupRefusesAPhoneThatStartedATrialMeanwhile() {
        when(rulesClient.isTrialPhoneAvailable("telleo", "919876543210")).thenReturn(false);
        assertThrows(VacademyException.class, () -> manager.signup(signup(), "1.1.1.1"));
        verify(authManager, never()).registerRootUser(any(), any());
    }

    @Test
    void institutesTypesAreNotOfferedToTelleo() {
        SelfSignupRequest r = signup();
        r.setInstituteType("school");
        assertThrows(VacademyException.class, () -> manager.signup(r, "1.1.1.1"));
    }
}
