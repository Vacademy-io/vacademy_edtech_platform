package vacademy.io.auth_service.feature.user.audit;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.List;
import java.util.Map;

/** The off-thread HMAC posts behind {@link RoleStatusAuditClient}; never throws. */
@Component
@Slf4j
public class RoleStatusAuditSender {

    private static final String ROUTE = "/admin-core-service/internal/audit/v1/record";

    private final InternalClientUtils internalClientUtils;

    @Value("${admin.core.service.baseurl:http://localhost:8072}")
    private String adminCoreServiceBaseUrl;

    @Value("${spring.application.name:auth_service}")
    private String clientName;

    public RoleStatusAuditSender(InternalClientUtils internalClientUtils) {
        this.internalClientUtils = internalClientUtils;
    }

    /**
     * One row per member, posted one after another on a single pool thread: a bulk change
     * of hundreds of members must not take hundreds of the pool's threads.
     *
     * Stops at the first failure. This pool also runs the per-request activity tracking;
     * with admin-core down, every post would wait out the 10s connect / 30s read timeout,
     * and a bulk change would hold the thread for minutes. Losing the rest of one batch's
     * audit rows is the cheaper outcome.
     */
    @Async
    public void send(List<Map<String, Object>> bodies) {
        for (int i = 0; i < bodies.size(); i++) {
            Map<String, Object> body = bodies.get(i);
            try {
                internalClientUtils.makeHmacRequest(clientName, "POST", adminCoreServiceBaseUrl, ROUTE, body);
            } catch (Exception e) {
                log.warn("role status audit post failed ({} {}), {} row(s) not recorded: {}", body.get("action"),
                        body.get("entity_id"), bodies.size() - i, e.getMessage());
                return;
            }
        }
    }
}
