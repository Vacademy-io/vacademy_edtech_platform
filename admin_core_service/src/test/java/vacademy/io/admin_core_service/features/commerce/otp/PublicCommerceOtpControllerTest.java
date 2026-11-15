package vacademy.io.admin_core_service.features.commerce.otp;

import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.controller.StorefrontFeatureGate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** The public OTP routes: key, feature and limits first; answers in the public error shape. */
class PublicCommerceOtpControllerTest {

    private CatalogApiAuth auth;
    private StorefrontFeatureGate gate;
    private CommerceOtpService otp;
    private CommerceBotCheck botCheck;
    private PublicCommerceOtpController controller;
    private MockHttpServletRequest http;

    @BeforeEach
    void setUp() {
        auth = mock(CatalogApiAuth.class);
        gate = mock(StorefrontFeatureGate.class);
        otp = mock(CommerceOtpService.class);
        botCheck = mock(CommerceBotCheck.class);
        when(botCheck.verify(any(), any(), any())).thenReturn(true);
        controller = new PublicCommerceOtpController(auth, gate, otp, botCheck);
        http = new MockHttpServletRequest();
        http.addHeader("Origin", "https://shop.example");
        http.addHeader("CF-Connecting-IP", "203.0.113.7");
        http.addHeader("X-Client-IP", "198.51.100.1"); // ignored for a browser call
        when(auth.authenticateUnmetered(any(HttpServletRequest.class), eq(CatalogApiAuth.SCOPE_READ)))
                .thenReturn(new CatalogApiAuth.Principal("inst-1", "key-1", List.of(CatalogApiAuth.SCOPE_READ)));
    }

    private static PublicCommerceOtpController.OtpRequest body(String phone, String purpose, String code) {
        PublicCommerceOtpController.OtpRequest body = new PublicCommerceOtpController.OtpRequest();
        body.setPhone(phone);
        body.setPurpose(purpose);
        body.setCode(code);
        return body;
    }

    @Test
    void aRequestIsCheckedForKeyFeatureAndLimitBeforeACodeIsSent() {
        when(otp.requestOtp("inst-1", "9876543210", "TRACK_ORDER", "203.0.113.7", null))
                .thenReturn(new CommerceOtpService.OtpSent(540, 60));

        ResponseEntity<Map<String, Object>> answer = controller.request(http, body("9876543210", "TRACK_ORDER", null));

        assertEquals(Map.of("sent", true, "expires_in", 540, "resend_after", 60), answer.getBody());
        assertEquals("no-store", answer.getHeaders().getFirst("Cache-Control"));
        var order = inOrder(auth, gate, otp);
        order.verify(auth).authenticateUnmetered(any(HttpServletRequest.class), eq(CatalogApiAuth.SCOPE_READ));
        order.verify(gate).require("inst-1", CommerceFeature.ORDERS);
        order.verify(auth).rateLimit(any(), any(), eq("otp"), anyInt(), anyInt());
        order.verify(otp).requestOtp("inst-1", "9876543210", "TRACK_ORDER", "203.0.113.7", null);
    }

    @Test
    void theInstituteIsTheOneOfTheKeyAndVerifyAnswersTheToken() {
        when(otp.verifyOtp("inst-1", "9876543210", "123456", "COD", "203.0.113.7")).thenReturn("v1.payload.signature");

        ResponseEntity<Map<String, Object>> answer = controller.verify(http, body("9876543210", "COD", "123456"));

        assertEquals("v1.payload.signature", answer.getBody().get("verified_phone_token"));
        assertEquals(900, answer.getBody().get("expires_in"));
    }

    @Test
    void anInstituteWithoutTheShopGetsNoCode() {
        doThrow(new CatalogApiException(HttpStatus.FORBIDDEN, "commerce_not_enabled", "off"))
                .when(gate).require("inst-1", CommerceFeature.ORDERS);

        assertThrows(CatalogApiException.class, () -> controller.request(http, body("9876543210", "COD", null)));
        verifyNoInteractions(otp);
    }

    @Test
    void aLargeOrEmptyBodyIsRefused() {
        http.setContent(new byte[PublicCommerceOtpController.MAX_BODY_BYTES + 1]);

        assertEquals(HttpStatus.PAYLOAD_TOO_LARGE, assertThrows(CatalogApiException.class,
                () -> controller.request(http, body("9876543210", "COD", null))).getStatus());
        http.setContent(new byte[10]);
        assertEquals(HttpStatus.BAD_REQUEST, assertThrows(CatalogApiException.class,
                () -> controller.verify(http, null)).getStatus());
        verifyNoInteractions(otp);
    }

    @Test
    void refusalsOfTheServiceBecomePublicErrorCodes() {
        assertEquals("rate_limited", api(CommerceOtpException.RATE_LIMITED, 42).getCode());
        assertEquals(HttpStatus.TOO_MANY_REQUESTS, api(CommerceOtpException.RATE_LIMITED, 42).getStatus());
        assertEquals(42, api(CommerceOtpException.RATE_LIMITED, 42).getRetryAfterSeconds());
        assertEquals("otp_locked", api(CommerceOtpException.LOCKED, null).getCode());
        assertEquals("otp_invalid", api(CommerceOtpException.INVALID_CODE, null).getCode());
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, api(CommerceOtpException.UNAVAILABLE, null).getStatus());
        assertEquals("invalid_request", api(CommerceOtpException.INVALID_REQUEST, null).getCode());
    }

    @Test
    void aServerSideCallerIsLimitedOnItsNetworkAddress_theShopperItNamesIsPassedBesideIt() {
        MockHttpServletRequest server = new MockHttpServletRequest();
        server.addHeader("X-Client-IP", "198.51.100.1");
        server.addHeader("CF-Connecting-IP", "203.0.113.7");
        when(otp.requestOtp(anyString(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(new CommerceOtpService.OtpSent(540, 60));

        controller.request(server, body("9876543210", "COD", null));

        // The limit is keyed on the network address the request came from; the header is passed beside it.
        verify(otp).requestOtp("inst-1", "9876543210", "COD", "203.0.113.7", "198.51.100.1");
    }

    @Test
    void aBrowserCannotNameAnotherAddress_andVerifyIsCountedOnTheNetworkAddressToo() {
        when(otp.verifyOtp("inst-1", "9876543210", "123456", "COD", "203.0.113.7")).thenReturn("v1.p.s");
        MockHttpServletRequest server = new MockHttpServletRequest();
        server.addHeader("X-Client-IP", "198.51.100.1");
        server.addHeader("CF-Connecting-IP", "203.0.113.7");

        controller.verify(server, body("9876543210", "COD", "123456"));

        verify(otp).verifyOtp("inst-1", "9876543210", "123456", "COD", "203.0.113.7");
    }

    @Test
    void whereTheBotCheckIsOnACodeIsSentOnlyWithAGoodToken() {
        when(botCheck.verify("inst-1", "bad-token", "203.0.113.7")).thenReturn(false);
        PublicCommerceOtpController.OtpRequest body = body("9876543210", "COD", null);
        body.setChallengeToken("bad-token");

        CatalogApiException refused = assertThrows(CatalogApiException.class, () -> controller.request(http, body));

        assertEquals(HttpStatus.FORBIDDEN, refused.getStatus());
        assertEquals("bot_check_failed", refused.getCode());
        verifyNoInteractions(otp);
    }

    private static CatalogApiException api(String code, Integer retryAfter) {
        return PublicCommerceOtpController.toApi(new CommerceOtpException(code, "message", retryAfter));
    }
}
