package vacademy.io.auth_service.feature.selfsignup.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import vacademy.io.auth_service.feature.selfsignup.service.ProductPaidWelcomeService;

/** Service to service (HMAC, under /auth-service/internal/**): admin-core only. */
@RestController
@RequestMapping("/auth-service/internal/v1/self-signup")
@RequiredArgsConstructor
public class SelfSignupInternalController {

    private final ProductPaidWelcomeService paidWelcome;

    /** A "Buy <plan>" account's plan is paid: send its login mail now. */
    @PostMapping("/{productKey}/paid-welcome")
    public String paidWelcome(@PathVariable String productKey, @RequestParam String instituteId) {
        paidWelcome.sendWelcome(productKey, instituteId);
        return "sent";
    }
}
