package vacademy.io.admin_core_service.features.telephony.providers.aavtaar;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingConfigService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.external.VendorCallLog;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Thin HTTP client for Aavtaar's outbound trigger.
 *
 *   POST {base}/{companyCode}/click-to-call
 *   Headers: Authorization: Bearer <token>, CampaignId: <campaignId>, Content-Type: application/json
 *   Body:    { phoneNumber, customerName?, customerEmail?, campaignId, metadata{} }
 *
 * Credentials are resolved per-institute from ai_calling_config (the
 * Settings → AI Calling → Credentials card), falling back to the global
 * {@code aavtaar.api.*} properties when an institute hasn't configured them.
 */
@Component
@RequiredArgsConstructor
public class AavtaarHttpClient {

    private static final Logger log = LoggerFactory.getLogger(AavtaarHttpClient.class);

    private final AiCallingConfigService configService;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${aavtaar.base-url:https://webapi.aavtaar.ai/api/v1/partner}")
    private String baseUrl;

    @Value("${aavtaar.api.token:}")
    private String fallbackToken;

    @Value("${aavtaar.api.company-code:}")
    private String fallbackCompanyCode;

    public record Result(boolean success, String message, String data, String callUuid) {}

    public Result clickToCall(String instituteId, String phoneNumber, String campaignId,
                              String customerName, String customerEmail, Map<String, Object> metadata) {
        AiCallingConfigService.DecryptedCreds creds = configService.getDecrypted(instituteId).orElse(null);
        String token = notBlank(creds == null ? null : creds.token()) ? creds.token() : fallbackToken;
        String companyCode = notBlank(creds == null ? null : creds.companyCode())
                ? creds.companyCode() : fallbackCompanyCode;

        if (!notBlank(token) || !notBlank(companyCode)) {
            throw new VacademyException("Aavtaar is not configured — add the Company Code + Bearer Token "
                    + "in Settings → AI Calling → Credentials (or set the aavtaar.api.* properties).");
        }
        if (!notBlank(campaignId)) {
            throw new VacademyException("campaignId is required for an Aavtaar AI call.");
        }

        String url = baseUrl + "/" + companyCode + "/click-to-call";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);
        headers.set("CampaignId", campaignId);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("phoneNumber", phoneNumber);
        if (customerName != null) body.put("customerName", customerName);
        if (customerEmail != null) body.put("customerEmail", customerEmail);
        body.put("campaignId", campaignId);
        body.put("metadata", metadata == null ? Map.of() : metadata);

        ResponseEntity<Map> resp;
        try {
            resp = restTemplate.exchange(
                    URI.create(url), HttpMethod.POST, new HttpEntity<>(body, headers), Map.class);
        } catch (RestClientException e) {
            VendorCallLog.failed(url, "click to call", body, e);
            throw e;
        }

        Map<?, ?> respBody = resp.getBody();
        boolean ok = respBody != null && Boolean.TRUE.equals(respBody.get("isSuccess"));
        String message = respBody == null ? null : asString(respBody.get("message"));
        String data = respBody == null ? null : asString(respBody.get("data"));
        // Aavtaar now returns the call's id on the click-to-call response (agreed with
        // their team) so we can map the end-of-call webhook to this exact call. The field
        // name may vary — check the common keys, and the data envelope if it's an object.
        String callUuid = firstNonBlank(
                get(respBody, "callUuid"), get(respBody, "callId"),
                get(respBody, "call_uuid"), get(respBody, "callUUID"), get(respBody, "uuid"));
        if (!notBlank(callUuid) && respBody != null && respBody.get("data") instanceof Map<?, ?> dataObj) {
            callUuid = firstNonBlank(get(dataObj, "callUuid"), get(dataObj, "callId"),
                    get(dataObj, "call_uuid"), get(dataObj, "uuid"));
        }
        log.info("aavtaar click-to-call: phone={} campaign={} ok={} callUuid={} msg={}",
                phoneNumber, campaignId, ok, callUuid, message);
        return new Result(ok, message, data, callUuid);
    }

    private boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private String asString(Object o) {
        return o == null ? null : String.valueOf(o);
    }

    private String get(Map<?, ?> m, String key) {
        return m == null ? null : asString(m.get(key));
    }

    private String firstNonBlank(String... vals) {
        for (String v : vals) if (notBlank(v)) return v;
        return null;
    }
}
