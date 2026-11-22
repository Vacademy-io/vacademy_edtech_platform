package vacademy.io.auth_service.feature.sso.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Asks admin-core to make sure the learner record exists and holds the batches a connection
 * grants (HMAC, /admin-core-service/internal/v1/sso/learner-sync).
 */
@Component
public class SsoEnrolmentSyncClient {

    static final String PATH = "/admin-core-service/internal/v1/sso/learner-sync";
    private static final Logger log = LoggerFactory.getLogger(SsoEnrolmentSyncClient.class);

    private final InternalClientUtils internalClientUtils;
    private final String applicationName;
    private final String adminCoreBaseUrl;

    public SsoEnrolmentSyncClient(InternalClientUtils internalClientUtils,
                                  @Value("${spring.application.name}") String applicationName,
                                  @Value("${admin.core.service.base_url}") String adminCoreBaseUrl) {
        this.internalClientUtils = internalClientUtils;
        this.applicationName = applicationName;
        this.adminCoreBaseUrl = adminCoreBaseUrl;
    }

    /** @return true when admin-core applied the change */
    public boolean sync(String instituteId, String userId, String username, String fullName, String email,
                        String mobileNumber, Collection<String> add, Collection<String> remove) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("institute_id", instituteId);
        body.put("user_id", userId);
        body.put("username", username);
        body.put("full_name", fullName);
        body.put("email", email);
        body.put("mobile_number", mobileNumber);
        body.put("add_package_session_ids", new ArrayList<>(add));
        body.put("remove_package_session_ids", new ArrayList<>(remove));
        try {
            ResponseEntity<String> response = internalClientUtils.makeHmacRequest(applicationName,
                    HttpMethod.POST.name(), adminCoreBaseUrl, PATH, body);
            boolean ok = response != null && response.getStatusCode().is2xxSuccessful();
            if (!ok) {
                log.warn("SSO learner sync refused: institute={} user={} status={}", instituteId, userId,
                        response == null ? null : response.getStatusCode());
            }
            return ok;
        } catch (Exception e) {
            log.error("SSO learner sync failed: institute={} user={}: {}", instituteId, userId, e.getMessage());
            return false;
        }
    }
}
