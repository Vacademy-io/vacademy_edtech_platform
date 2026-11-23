package vacademy.io.auth_service.feature.admin_core_service.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.List;

/**
 * Takes members who lost access to an institute (Institute → Teams: disable, delete,
 * cancel invite) out of that institute's counsellor pools in admin_core, so they stop
 * receiving new leads. Without this the pool rows stayed ACTIVE and the round-robin kept
 * assigning leads to a member who could no longer sign in.
 *
 * Fire-and-forget, off the request thread: the status change has already committed and
 * must not wait on or fail with admin_core. A failure is logged with what is needed to
 * replay it by hand.
 */
@Component
@Slf4j
public class CounselorPoolSyncClient {

    private static final String ROUTE = "/admin-core-service/internal/counselor-pool/v1/deactivate-members";

    private final InternalClientUtils internalClientUtils;

    @Value("${admin.core.service.base_url}")
    private String adminCoreServiceBaseUrl;

    @Value("${spring.application.name:auth_service}")
    private String clientName;

    public CounselorPoolSyncClient(InternalClientUtils internalClientUtils) {
        this.internalClientUtils = internalClientUtils;
    }

    @Async
    public void deactivatePoolMemberships(String instituteId, List<String> userIds) {
        if (instituteId == null || instituteId.isBlank() || userIds == null || userIds.isEmpty()) {
            return;
        }
        try {
            internalClientUtils.makeHmacRequest(clientName, "POST", adminCoreServiceBaseUrl,
                    ROUTE + "?instituteId=" + instituteId, userIds);
        } catch (Exception e) {
            log.error("Pool membership deactivation FAILED for institute {} users {}: {}. These members may still "
                            + "receive new leads; replay with POST {}?instituteId={} and the user ids as the body",
                    instituteId, userIds, e.getMessage(), ROUTE, instituteId);
        }
    }
}
