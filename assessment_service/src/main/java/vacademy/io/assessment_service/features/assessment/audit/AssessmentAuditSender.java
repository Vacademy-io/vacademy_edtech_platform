package vacademy.io.assessment_service.features.assessment.audit;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.Map;

/** The off-thread HMAC post behind {@link AssessmentAuditClient}; never throws. */
@Component
@Slf4j
public class AssessmentAuditSender {

    private static final String ROUTE = "/admin-core-service/internal/audit/v1/record";

    private final InternalClientUtils internalClientUtils;

    @Value("${admin.core.service.baseurl:http://localhost:8072}")
    private String adminCoreServiceBaseUrl;

    @Value("${spring.application.name:assessment_service}")
    private String clientName;

    public AssessmentAuditSender(InternalClientUtils internalClientUtils) {
        this.internalClientUtils = internalClientUtils;
    }

    @Async
    public void send(Map<String, Object> body) {
        try {
            internalClientUtils.makeHmacRequest(clientName, "POST", adminCoreServiceBaseUrl, ROUTE, body);
        } catch (Exception e) {
            log.warn("assessment audit post failed ({} {}): {}", body.get("action"), body.get("entity_id"), e.getMessage());
        }
    }
}
