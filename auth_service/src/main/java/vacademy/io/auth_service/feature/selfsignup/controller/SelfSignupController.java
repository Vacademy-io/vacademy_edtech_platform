package vacademy.io.auth_service.feature.selfsignup.controller;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.auth.dto.JwtResponseDto;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupConfigResponse;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupOtpRequest;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupRequest;
import vacademy.io.auth_service.feature.selfsignup.dto.SelfSignupVerifyResponse;
import vacademy.io.auth_service.feature.selfsignup.service.SelfSignupManager;

/** Public on purpose: these are the first screens a new customer sees. */
@RestController
@RequestMapping("/auth-service/v1/self-signup")
@RequiredArgsConstructor
public class SelfSignupController {

    private final SelfSignupManager manager;

    @GetMapping("/config")
    public SelfSignupConfigResponse config(@RequestParam String product) {
        return manager.config(product);
    }

    @PostMapping("/request-otp")
    public String requestOtp(@RequestBody SelfSignupOtpRequest request, HttpServletRequest http) {
        return manager.requestOtp(request, clientIp(http));
    }

    @PostMapping("/verify-otp")
    public SelfSignupVerifyResponse verifyOtp(@RequestBody SelfSignupOtpRequest request) {
        return manager.verifyOtp(request);
    }

    @PostMapping("/signup")
    public JwtResponseDto signup(@RequestBody SelfSignupRequest request, HttpServletRequest http) {
        return manager.signup(request, clientIp(http));
    }

    /**
     * The visitor as Cloudflare saw them. Behind Cloudflare the first X-Forwarded-For hop can be the
     * edge, which would make unrelated visitors share one sign-up limit.
     */
    static String clientIp(HttpServletRequest http) {
        String cloudflare = http.getHeader("CF-Connecting-IP");
        if (StringUtils.hasText(cloudflare)) {
            return cloudflare.trim();
        }
        String forwarded = http.getHeader("X-Forwarded-For");
        return StringUtils.hasText(forwarded) ? forwarded.split(",")[0].trim() : http.getRemoteAddr();
    }
}
