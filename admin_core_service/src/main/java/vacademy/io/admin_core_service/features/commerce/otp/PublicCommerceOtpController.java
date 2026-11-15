package vacademy.io.admin_core_service.features.commerce.otp;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.servlet.http.HttpServletRequest;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiEnvelope;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.auth.CatalogApiAuth;
import vacademy.io.admin_core_service.features.commerce.security.CommerceFeature;
import vacademy.io.admin_core_service.features.commerce.storefront.controller.StorefrontFeatureGate;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Public OTP routes of the shop:
 * <pre>
 * POST /open/commerce/v1/otp/request  { phone, purpose }        → { sent, expires_in, resend_after }
 * POST /open/commerce/v1/otp/verify   { phone, code, purpose }  → { verified_phone_token, expires_in }
 * </pre>
 * Like the cart routes they sit behind the publishable Catalogue API key: the institute is the
 * key's, browser calls are locked to the institute's verified websites, and the family has
 * limits of its own per visitor and per key. The institute needs the {@code commerce.orders}
 * feature. On top of that {@link CommerceOtpService} counts sends and tries per phone, per
 * network address and per institute in the database, and {@code /request} asks for the bot
 * check where it is on.
 *
 * <p>The answers never say whether a phone number is known to the shop. The token of
 * {@code /verify} is not a login: it only proves the phone, for the purpose it was asked for.
 */
@RestController
@RequestMapping("/admin-core-service/open/commerce/v1/otp")
@RequiredArgsConstructor
public class PublicCommerceOtpController implements CatalogApiEnvelope {

    /** Per minute and pod; the database limits of the service are the real ones. */
    static final int OTP_PER_KEY = 300;
    static final int OTP_PER_VISITOR = 10;
    /** The two bodies are a few short fields. */
    static final int MAX_BODY_BYTES = 2048;

    private final CatalogApiAuth auth;
    private final StorefrontFeatureGate featureGate;
    private final CommerceOtpService otpService;
    private final CommerceBotCheck botCheck;

    @Data
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public static class OtpRequest {
        private String phone;
        private String purpose;
        private String code;
        /** The bot-check (Turnstile) token; needed for {@code /request} when the check is on. */
        private String challengeToken;
    }

    @PostMapping("/request")
    public ResponseEntity<Map<String, Object>> request(HttpServletRequest http,
                                                       @RequestBody(required = false) OtpRequest body) {
        var p = auth.authenticateUnmetered(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.ORDERS);
        auth.rateLimit(p, http, "otp", OTP_PER_KEY, OTP_PER_VISITOR);
        OtpRequest request = checked(http, body);
        String network = networkIp(http);
        // Every send is a paid message to a number the caller chooses: where the bot check is on
        // it is asked for here too. A remote call; no transaction is open.
        if (!botCheck.verify(p.instituteId(), request.getChallengeToken(), network)) {
            throw new CatalogApiException(HttpStatus.FORBIDDEN, "bot_check_failed",
                    "The security check did not pass. Reload the page and try again.");
        }
        try {
            CommerceOtpService.OtpSent sent = otpService.requestOtp(p.instituteId(), request.getPhone(),
                    request.getPurpose(), network, namedIp(http));
            Map<String, Object> answer = new LinkedHashMap<>();
            answer.put("sent", true);
            answer.put("expires_in", sent.expiresInSeconds());
            answer.put("resend_after", sent.resendAfterSeconds());
            return ResponseEntity.ok().header("Cache-Control", "no-store").body(answer);
        } catch (CommerceOtpException e) {
            throw toApi(e);
        }
    }

    @PostMapping("/verify")
    public ResponseEntity<Map<String, Object>> verify(HttpServletRequest http,
                                                      @RequestBody(required = false) OtpRequest body) {
        var p = auth.authenticateUnmetered(http, CatalogApiAuth.SCOPE_READ);
        featureGate.require(p.instituteId(), CommerceFeature.ORDERS);
        auth.rateLimit(p, http, "otp", OTP_PER_KEY, OTP_PER_VISITOR);
        OtpRequest request = checked(http, body);
        try {
            String token = otpService.verifyOtp(p.instituteId(), request.getPhone(), request.getCode(),
                    request.getPurpose(), networkIp(http));
            Map<String, Object> answer = new LinkedHashMap<>();
            answer.put("verified_phone_token", token);
            answer.put("expires_in", CommerceOtpService.TOKEN_MINUTES * 60);
            return ResponseEntity.ok().header("Cache-Control", "no-store").body(answer);
        } catch (CommerceOtpException e) {
            throw toApi(e);
        }
    }

    private static OtpRequest checked(HttpServletRequest http, OtpRequest body) {
        if (http.getContentLengthLong() > MAX_BODY_BYTES) {
            throw new CatalogApiException(HttpStatus.PAYLOAD_TOO_LARGE, "invalid_request", "The request is too large.");
        }
        if (body == null) {
            throw new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", "A phone number is needed.");
        }
        return body;
    }

    /**
     * The address the request came from, as the edge saw it. The database limits are counted
     * on this one: a caller cannot choose it, unlike X-Client-IP.
     */
    private static String networkIp(HttpServletRequest http) {
        String network = CatalogApiAuth.networkClientIp(http);
        return network != null ? network : http.getRemoteAddr();
    }

    /** The shopper a server-side caller names; null for a browser call. Only a second bucket. */
    private static String namedIp(HttpServletRequest http) {
        if (http.getHeader("Origin") != null) {
            return null;
        }
        String named = http.getHeader("X-Client-IP");
        return named != null && !named.isBlank() && named.trim().length() <= 64 ? named.trim() : null;
    }

    static CatalogApiException toApi(CommerceOtpException e) {
        String code = e.getCode();
        if (CommerceOtpException.RATE_LIMITED.equals(code)) {
            return new CatalogApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited", e.getMessage(), null,
                    e.getRetryAfterSeconds());
        }
        if (CommerceOtpException.LOCKED.equals(code)) {
            return new CatalogApiException(HttpStatus.TOO_MANY_REQUESTS, "otp_locked", e.getMessage());
        }
        if (CommerceOtpException.INVALID_CODE.equals(code)) {
            return new CatalogApiException(HttpStatus.BAD_REQUEST, "otp_invalid", e.getMessage());
        }
        if (CommerceOtpException.UNAVAILABLE.equals(code)) {
            return new CatalogApiException(HttpStatus.SERVICE_UNAVAILABLE, "otp_unavailable", e.getMessage(), null,
                    60);
        }
        return new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", e.getMessage());
    }
}
