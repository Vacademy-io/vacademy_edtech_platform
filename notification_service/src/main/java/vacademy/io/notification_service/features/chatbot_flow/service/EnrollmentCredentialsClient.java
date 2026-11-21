package vacademy.io.notification_service.features.chatbot_flow.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Fetches the ready-to-send login-details text for a phone number from
 * admin_core, for a SEND_MESSAGE node to emit as a free-text session message.
 *
 * Why a dedicated client instead of an HTTP_WEBHOOK node: the edge gates
 * "/admin-core-service/internal/**" on clientName + Signature headers, and a
 * webhook node would have to carry that Signature inside
 * chatbot_flow_node.config — a row that is editable and rendered in the
 * flow-builder UI, so a service secret would be readable by anyone with
 * dashboard flow access. Going through InternalClientUtils keeps the secret in
 * the database where it already lives and never puts it in a flow config.
 *
 * Returns null on 204 (phone has no in-scope enrollment) and on any failure, so
 * the caller sends nothing rather than a half-filled message.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class EnrollmentCredentialsClient {

    private static final String ENDPOINT =
            "/admin-core-service/internal/enrollment-credentials/text?phone=";

    private final InternalClientUtils internalClientUtils;

    @Value("${admin.core.service.baseurl:http://localhost:8081}")
    private String adminCoreServiceUrl;

    @Value("${spring.application.name:notification_service}")
    private String clientName;

    public String fetchCredentialsText(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isBlank()) {
            return null;
        }
        try {
            String endpoint = ENDPOINT + URLEncoder.encode(phoneNumber, StandardCharsets.UTF_8);
            ResponseEntity<String> resp = internalClientUtils.makeHmacRequest(
                    clientName, HttpMethod.GET.name(), adminCoreServiceUrl, endpoint, null);

            if (resp == null || !resp.getStatusCode().is2xxSuccessful()) {
                log.info("No credentials text for phone (status={})",
                        resp == null ? "null" : resp.getStatusCode());
                return null;
            }
            String body = resp.getBody();
            return (body == null || body.isBlank()) ? null : body;
        } catch (Exception e) {
            log.warn("Credentials-text lookup failed: {}", e.getMessage());
            return null;
        }
    }
}
