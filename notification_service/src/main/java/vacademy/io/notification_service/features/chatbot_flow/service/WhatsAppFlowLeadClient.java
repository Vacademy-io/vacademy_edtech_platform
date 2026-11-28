package vacademy.io.notification_service.features.chatbot_flow.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import vacademy.io.common.core.internal_api_wrapper.InternalClientUtils;

import java.util.Map;

/**
 * HMAC-signed calls to admin-core's WhatsApp flow lead endpoints
 * ({@code /admin-core-service/internal/whatsapp-flow-lead/*}), used by the CRM chatbot nodes.
 * Every method throws on a non-2xx or unreadable response — callers decide how to degrade.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class WhatsAppFlowLeadClient {

    private static final String CHECK_ROUTE = "/admin-core-service/internal/whatsapp-flow-lead/check";
    private static final String SAVE_ROUTE = "/admin-core-service/internal/whatsapp-flow-lead/save";

    private final InternalClientUtils internalClientUtils;
    private final ObjectMapper objectMapper;

    @Value("${admin.core.service.baseurl:http://localhost:8081}")
    private String adminCoreServiceUrl;

    @Value("${spring.application.name:notification_service}")
    private String clientName;

    /** Existing lead (repeat contact recorded) or a new lead created now. */
    public Map<String, Object> check(Map<String, Object> request) {
        return post(CHECK_ROUTE, request);
    }

    /** Write answers onto the lead; with complete=true also status + workflows. */
    public Map<String, Object> save(Map<String, Object> request) {
        return post(SAVE_ROUTE, request);
    }

    private Map<String, Object> post(String route, Map<String, Object> body) {
        ResponseEntity<String> resp = internalClientUtils.makeHmacRequest(
                clientName, HttpMethod.POST.name(), adminCoreServiceUrl, route, body);
        if (resp == null || !resp.getStatusCode().is2xxSuccessful() || resp.getBody() == null) {
            throw new IllegalStateException("admin-core " + route + " returned "
                    + (resp == null ? "no response" : resp.getStatusCode()));
        }
        try {
            return objectMapper.readValue(resp.getBody(), new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Unreadable admin-core response from " + route, e);
        }
    }
}
