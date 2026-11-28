package vacademy.io.auth_service.feature.auth.controller;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.test.util.ReflectionTestUtils;
import vacademy.io.auth_service.feature.auth.dto.AppleNativeLoginRequestDto;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.manager.LearnerOAuth2Manager;
import vacademy.io.auth_service.feature.auth.service.AppleIdentityTokenVerifier;
import vacademy.io.common.auth.entity.OAuth2VendorToUserDetail;
import vacademy.io.common.auth.repository.OAuth2VendorToUserDetailRepository;
import vacademy.io.common.auth.service.OAuth2VendorToUserDetailService;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Native Apple sign-in takes the email from the verified id_token, not the request body. */
class AppleNativeEmailSourceTest {

    private AppleIdentityTokenVerifier verifier;
    private LearnerOAuth2Manager manager;
    private OAuth2VendorToUserDetailService vendorService;
    private OAuth2VendorToUserDetailRepository vendorRepo;
    private AppleNativeAuthController controller;
    private final JwtResponseDto ok = JwtResponseDto.builder().accessToken("a").refreshToken("r").build();

    @BeforeEach
    void setUp() throws Exception {
        verifier = mock(AppleIdentityTokenVerifier.class);
        manager = mock(LearnerOAuth2Manager.class);
        vendorService = mock(OAuth2VendorToUserDetailService.class);
        vendorRepo = mock(OAuth2VendorToUserDetailRepository.class);
        controller = new AppleNativeAuthController();
        ReflectionTestUtils.setField(controller, "appleIdentityTokenVerifier", verifier);
        ReflectionTestUtils.setField(controller, "learnerOAuth2Manager", manager);
        ReflectionTestUtils.setField(controller, "oAuth2VendorToUserDetailService", vendorService);
        ReflectionTestUtils.setField(controller, "oAuth2VendorToUserDetailRepository", vendorRepo);
        when(manager.loginUserByEmail(anyString(), anyString(), anyString(), anyString(), anyString())).thenReturn(ok);
    }

    private static Jwt token(String email) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "RS256").subject("sub-1")
                .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60));
        if (email != null) b.claim("email", email);
        else b.claim("aud", "io.vacademy.student.app");
        return b.build();
    }

    private static AppleNativeLoginRequestDto request(String bodyEmail) {
        AppleNativeLoginRequestDto r = new AppleNativeLoginRequestDto();
        r.setIdentityToken("id-token");
        r.setInstituteId("inst-1");
        r.setEmail(bodyEmail);
        return r;
    }

    @Test
    void tokenEmailWinsOverBodyEmail() throws Exception {
        when(verifier.verify("id-token")).thenReturn(token("real@privaterelay.appleid.com"));
        assertSame(ok, controller.appleNativeLogin(request("someone@else.com")));
        verify(vendorService).getEmailByProviderIdAndSubject("apple", "sub-1", "real@privaterelay.appleid.com");
        verify(manager).loginUserByEmail(anyString(), eq("real@privaterelay.appleid.com"), eq("inst-1"),
                eq("sub-1"), eq("apple"));
    }

    @Test
    void returningUserWithoutTokenEmailUsesLinkedEmail() throws Exception {
        when(verifier.verify("id-token")).thenReturn(token(null));
        OAuth2VendorToUserDetail linked = new OAuth2VendorToUserDetail();
        linked.setEmailId("linked@user.com");
        when(vendorRepo.findByProviderIdAndSubject("apple", "sub-1")).thenReturn(Optional.of(linked));
        assertSame(ok, controller.appleNativeLogin(request("someone@else.com")));
        verify(manager).loginUserByEmail(anyString(), eq("linked@user.com"), eq("inst-1"), eq("sub-1"), eq("apple"));
        verifyNoInteractions(vendorService);
    }

    @Test
    void unlinkedSubjectWithoutTokenEmailIsRefused() throws Exception {
        when(verifier.verify("id-token")).thenReturn(token(null));
        when(vendorRepo.findByProviderIdAndSubject("apple", "sub-1")).thenReturn(Optional.empty());
        VacademyException e = assertThrows(VacademyException.class,
                () -> controller.appleNativeLogin(request("victim@school.com")));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatus());
        assertEquals("Invalid Apple identity token", e.getMessage());
        verifyNoInteractions(manager, vendorService);
    }

    @Test
    void linkedSubjectWithBlankEmailWithoutTokenEmailIsRefused() throws Exception {
        when(verifier.verify("id-token")).thenReturn(token(null));
        when(vendorRepo.findByProviderIdAndSubject("apple", "sub-1"))
                .thenReturn(Optional.of(new OAuth2VendorToUserDetail()));
        assertThrows(VacademyException.class, () -> controller.appleNativeLogin(request("victim@school.com")));
        verifyNoInteractions(manager);
    }
}
