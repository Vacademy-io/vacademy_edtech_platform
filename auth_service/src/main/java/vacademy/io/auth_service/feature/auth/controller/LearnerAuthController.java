package vacademy.io.auth_service.feature.auth.controller;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.auth.dto.AuthRequestDto;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.auth.dto.TrustedLoginRequestDto;
import vacademy.io.auth_service.feature.auth.manager.LearnerAuthManager;
import vacademy.io.common.auth.dto.RefreshTokenRequestDTO;
import vacademy.io.common.auth.dto.learner.LearnerEnrollRequestDTO;
import vacademy.io.common.auth.repository.UserRepository;
import vacademy.io.common.auth.service.JwtService;
import vacademy.io.common.auth.service.RefreshTokenService;

@RestController
@RequestMapping("/auth-service/learner/v1")
public class LearnerAuthController {

    @Autowired
    UserRepository userRepository;

    @Autowired
    JwtService jwtService;

    @Autowired
    RefreshTokenService refreshTokenService;

    @Autowired
    LearnerAuthManager authManager;

    @PostMapping("/register")
    public JwtResponseDto registerLearner(@RequestBody LearnerEnrollRequestDTO learnerEnrollRequestDTO) {
        return authManager.registerLearner(learnerEnrollRequestDTO);
    }

    @PostMapping("/login")
    public JwtResponseDto authenticateAndGetToken(@RequestBody AuthRequestDto authRequestDTO) {
        return authManager.loginUser(authRequestDTO);
    }

    @PostMapping("/request-otp")
    public String requestOtp(@RequestBody AuthRequestDto authRequestDTO) {
        return authManager.requestOtp(authRequestDTO);
    }

    @PostMapping("/login-otp")
    public JwtResponseDto loginViaOtp(@RequestBody AuthRequestDto authRequestDTO) {
        return authManager.loginViaOtp(authRequestDTO);
    }

    @PostMapping("/refresh-token")
    public JwtResponseDto refreshToken(@RequestBody RefreshTokenRequestDTO refreshTokenRequestDTO) {
        return authManager.refreshToken(refreshTokenRequestDTO);
    }

    @PostMapping("/login-otp-ten-days")
    public JwtResponseDto loginViaOtpForTenDays(@RequestBody AuthRequestDto authRequestDTO) {
        return authManager.loginViaOtpForTenDays(authRequestDTO);
    }

    // ============================================================================
    // TRUSTED LOGIN - EMERGENCY ENDPOINT (TEMPORARY)
    // ============================================================================
    // ⚠️ WARNING: This endpoint bypasses OTP verification.
    // It should ONLY be enabled when SES email service is down.
    //
    // Security measures implemented:
    // - Feature flag: security.trusted-login.enabled (default: false)
    // - All requests are logged with IP address for audit
    // - Only works for STUDENT role users
    //
    // TODO: Remove this endpoint once email service is restored.
    // Rollback plan:
    // 1. Set security.trusted-login.enabled=false in config
    // 2. Redeploy auth-service
    // 3. Remove this endpoint in next release
    // ============================================================================

    /**
     * Emergency login by username without OTP verification.
     * 
     * ⚠️ TEMPORARY: This is for emergency use when email service is down.
     * 
     * @param request     The trusted login request containing username (required)
     *                    and
     *                    institute_id (optional - if null, looks up by username
     *                    only)
     * @param httpRequest The HTTP request (for IP logging)
     * @return JwtResponseDto with access and refresh tokens
     */
    @PostMapping("/login-by-username-trusted")
    public JwtResponseDto loginByUsernameTrusted(
            @RequestBody TrustedLoginRequestDto request,
            HttpServletRequest httpRequest) {

        // Extract client IP for audit logging
        String clientIP = getClientIP(httpRequest);

        return authManager.loginByUsernameTrusted(
                request.getUsername(),
                request.getInstituteId(),
                request.getCode(),
                request.getRoute(),
                clientIP);
    }

    /**
     * Extracts the client IP address from the request.
     * Handles X-Forwarded-For header for reverse proxy scenarios.
     */
    private String getClientIP(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            // X-Forwarded-For can contain multiple IPs, take the first one
            return xForwardedFor.split(",")[0].trim();
        }
        String xRealIP = request.getHeader("X-Real-IP");
        if (xRealIP != null && !xRealIP.isEmpty()) {
            return xRealIP;
        }
        return request.getRemoteAddr();
    }

}
