package vacademy.io.community_service.feature.support.client;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import vacademy.io.common.core.internal_api_wrapper.HmacUtils;
import vacademy.io.community_service.feature.support.dto.SupportRecipientDto;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Raises an in-app SYSTEM_ALERT through notification-service's announcement pipeline — the same
 * feed the institute dashboard's alert list already reads. Email tells someone a reply landed
 * only if they check email; this is what makes it visible inside the product.
 *
 * <p>Best-effort by design: a failed alert must never fail the support reply that triggered it.
 */
@Service
@Slf4j
public class SupportAnnouncementClient {

    private static final String CREATE_MULTIPLE = "/notification-service/v1/announcements/admin/multiple";

    @Autowired
    @Qualifier(SupportClientConfig.SUPPORT_REST_TEMPLATE)
    private RestTemplate restTemplate;

    // Service credentials: notification-service requires clientName + Signature on this route.
    @Autowired
    private HmacUtils hmacUtils;

    @Value("${spring.application.name}")
    private String clientName;

    /** See SupportAuthClient — prod declares no property, so fall back to the env var then blank. */
    @Value("${notification.server.baseurl:${NOTIFICATION_SERVER_BASE_URL:}}")
    private String notificationServerBaseUrl;

    /**
     * @param recipients only those carrying a userId can receive an in-app alert; the rest are
     *                   reachable by email alone and are skipped here.
     */
    public void sendSystemAlert(String instituteId, String title, String htmlContent,
                                String createdByUserId, String createdByName,
                                List<SupportRecipientDto> recipients) {
        if (!StringUtils.hasText(notificationServerBaseUrl) || !StringUtils.hasText(instituteId)) {
            return;
        }
        List<Map<String, Object>> targets = new ArrayList<>();
        for (SupportRecipientDto r : recipients) {
            if (r == null || !StringUtils.hasText(r.getUserId())) {
                continue;
            }
            Map<String, Object> target = new HashMap<>();
            target.put("recipientType", "USER");
            target.put("recipientId", r.getUserId());
            target.put("recipientName", StringUtils.hasText(r.getName()) ? r.getName() : "Institute admin");
            targets.add(target);
        }
        if (targets.isEmpty()) {
            return;
        }

        try {
            Map<String, Object> content = new HashMap<>();
            content.put("type", "html");
            content.put("content", htmlContent);

            Map<String, Object> mode = new HashMap<>();
            mode.put("modeType", "SYSTEM_ALERT");
            // Settings are deliberately omitted: the validator treats null/empty as valid, but a
            // non-empty map without its own "modeType" key is rejected.

            Map<String, Object> request = new HashMap<>();
            request.put("title", title);
            request.put("content", content);
            request.put("instituteId", instituteId);
            request.put("createdBy", StringUtils.hasText(createdByUserId) ? createdByUserId : "SUPPORT");
            request.put("createdByName", StringUtils.hasText(createdByName) ? createdByName : "Vacademy Support");
            // MUST stay "ADMIN". AnnouncementService gates delivery on
            //   approvalRequired = <institute setting> && !"ADMIN".equals(createdByRole)
            // so any other role parks this in PENDING_APPROVAL at every institute that has
            // announcement approval switched on — i.e. the admin would have to approve being told
            // they received a reply, and until they did, nothing would be delivered. This alert is
            // transactional, not a broadcast, so it must not enter the approval workflow at all.
            // The user-visible identity stays honest via createdByName and the title.
            request.put("createdByRole", "ADMIN");
            request.put("recipients", targets);
            request.put("modes", List.of(mode));

            String secretKey = hmacUtils.retrieveSecretKeyFromDatabase(clientName);
            if (!StringUtils.hasText(secretKey)) {
                log.error("No service credentials for {}; support system alert not sent", clientName);
                return;
            }
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("clientName", clientName);
            headers.set("Signature", secretKey);
            HttpEntity<List<Map<String, Object>>> entity = new HttpEntity<>(List.of(request), headers);

            restTemplate.postForEntity(notificationServerBaseUrl + CREATE_MULTIPLE, entity, String.class);
        } catch (Exception e) {
            log.error("Failed to raise support system alert for institute {}: {}",
                    instituteId, e.getMessage());
        }
    }
}
