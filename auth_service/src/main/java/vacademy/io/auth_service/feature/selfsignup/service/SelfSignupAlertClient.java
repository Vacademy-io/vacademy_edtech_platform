package vacademy.io.auth_service.feature.selfsignup.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.Map;
import java.util.concurrent.CompletableFuture;

/** Reports a finished sign-up to admin-core, which alerts the team. Never holds up or fails a sign-up. */
@Slf4j
@Component
public class SelfSignupAlertClient {

    @Autowired
    private InternalClientUtils internalClientUtils;

    @Value("${spring.application.name}")
    private String clientName;

    @Value("${admin.core.service.base_url}")
    private String adminCoreBaseUrl;

    public void signupCompleted(String productKey, Map<String, Object> event) {
        CompletableFuture.runAsync(() -> {
            try {
                internalClientUtils.makeHmacRequest(clientName, HttpMethod.POST.name(), adminCoreBaseUrl,
                        "/admin-core-service/internal/product-config/v1/" + productKey + "/signup-event", event);
            } catch (Exception e) {
                log.warn("[self-signup] the sign-up alert could not be reported for {}: {}", productKey, e.getMessage());
            }
        });
    }
}
