package vacademy.io.admin_core_service.features.app_status.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.List;

/**
 * Reads app-registry records for an institute from community_service.
 *
 * <p>The registry lives in community_service's own database (institute-role membership tables do
 * not — see {@code InternalAppRegistryController}'s javadoc on that side), so this institute's
 * app status can only be fetched over the network, not joined in SQL. This class trusts the
 * caller (AppStatusService) to have already verified the requesting user belongs to
 * {@code instituteId} — the internal endpoint itself only checks HMAC service identity.
 */
@Component
@Slf4j
public class CommunityAppRegistryClient {

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;
    private final String communityServiceBaseUrl;
    private final String clientName;

    public CommunityAppRegistryClient(
            InternalClientUtils internalClientUtils,
            ObjectMapper objectMapper,
            @Value("${community.server.baseurl:http://localhost:8072}") String communityServiceBaseUrl,
            @Value("${spring.application.name:admin_core_service}") String clientName) {
        this.internalClientUtils = internalClientUtils;
        this.objectMapper = objectMapper;
        this.communityServiceBaseUrl = communityServiceBaseUrl;
        this.clientName = clientName;
    }

    /**
     * @return the institute's app records, or an empty list when the call fails. Empty-on-failure
     *         (rather than propagating the error) is deliberate: this backs a read-only status
     *         panel on an institute admin's settings page, and one flaky internal call must not
     *         break page load for an unrelated feature on the same screen.
     */
    public List<JsonNode> fetchByInstitute(String instituteId) {
        try {
            String route = "/community-service/internal/v1/app-registry/by-institute?instituteId=" + instituteId;

            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(
                    clientName, "GET", communityServiceBaseUrl, route, null);

            if (response.getStatusCode() == HttpStatus.OK && response.getBody() != null) {
                List<JsonNode> out = new ArrayList<>();
                objectMapper.readTree(response.getBody()).forEach(out::add);
                return out;
            }
            log.warn("[app-status] community_service app-registry lookup returned {} for institute {}",
                    response.getStatusCode(), instituteId);
        } catch (Exception e) {
            log.warn("[app-status] community_service app-registry lookup failed for institute {}: {}",
                    instituteId, e.getMessage());
        }
        return List.of();
    }
}
