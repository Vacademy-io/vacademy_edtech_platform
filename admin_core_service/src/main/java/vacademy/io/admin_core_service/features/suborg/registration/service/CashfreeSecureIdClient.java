package vacademy.io.admin_core_service.features.suborg.registration.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.external.VendorCallLog;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Thin client for Cashfree SecureID's DigiLocker verification API
 * (https://api.cashfree.com/verification). Platform-level credentials from env —
 * NOT per-institute. Mirrors CashfreePaymentManager's WebClient + header pattern.
 *
 * Flow: createDigilockerUrl (URL expires in 10 min) → user consents on DigiLocker →
 * getStatus == AUTHENTICATED → getDocument per doc type (consent valid ~1 hour).
 */
@Slf4j
@Component
public class CashfreeSecureIdClient {

    private final WebClient webClient;

    @Value("${cashfree.secureid.client-id:}")
    private String clientId;

    @Value("${cashfree.secureid.client-secret:}")
    private String clientSecret;

    @Value("${cashfree.secureid.base-url:https://api.cashfree.com/verification}")
    private String baseUrl;

    public CashfreeSecureIdClient(WebClient.Builder webClientBuilder) {
        this.webClient = webClientBuilder.build();
    }

    public String getClientSecret() {
        return clientSecret;
    }

    public boolean isConfigured() {
        return StringUtils.hasText(clientId) && StringUtils.hasText(clientSecret);
    }

    /** POST /digilocker → { url (10-min expiry), status: PENDING, reference_id }. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> createDigilockerUrl(String verificationId,
                                                   List<String> documentsRequested,
                                                   String redirectUrl) {
        requireConfigured();
        Map<String, Object> payload = new HashMap<>();
        payload.put("verification_id", verificationId);
        payload.put("document_requested", documentsRequested);
        if (StringUtils.hasText(redirectUrl)) {
            payload.put("redirect_url", redirectUrl);
        }
        return (Map<String, Object>) post("/digilocker", payload);
    }

    /** GET /digilocker?verification_id= → { status: PENDING|AUTHENTICATED|EXPIRED|CONSENT_DENIED }. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getStatus(String verificationId) {
        requireConfigured();
        return (Map<String, Object>) get("/digilocker?verification_id=" + verificationId);
    }

    /** GET /digilocker/document/{AADHAAR|PAN}?verification_id= → verified document data. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getDocument(String verificationId, String documentType) {
        requireConfigured();
        return (Map<String, Object>) get(
                "/digilocker/document/" + documentType + "?verification_id=" + verificationId);
    }

    private Object post(String path, Map<String, Object> payload) {
        return webClient.post()
                .uri(baseUrl + path)
                .contentType(MediaType.APPLICATION_JSON)
                .header("x-client-id", clientId)
                .header("x-client-secret", clientSecret)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(Map.class)
                .doOnError(e -> VendorCallLog.failed(baseUrl, "create digilocker url", payload, e))
                .onErrorResume(WebClientResponseException.class, ex -> {
                    log.error("Cashfree SecureID error on {}. Status: {}, Body: {}",
                            path, ex.getStatusCode(), ex.getResponseBodyAsString());
                    return Mono.error(new VacademyException(
                            "Verification service error: " + ex.getResponseBodyAsString()));
                })
                .block();
    }

    private Object get(String pathWithQuery) {
        return webClient.get()
                .uri(baseUrl + pathWithQuery)
                .header("x-client-id", clientId)
                .header("x-client-secret", clientSecret)
                .retrieve()
                .bodyToMono(Map.class)
                .doOnError(e -> VendorCallLog.failed(baseUrl, "fetch digilocker status or document", null, e))
                .onErrorResume(WebClientResponseException.class, ex -> {
                    log.error("Cashfree SecureID error on {}. Status: {}, Body: {}",
                            pathWithQuery, ex.getStatusCode(), ex.getResponseBodyAsString());
                    return Mono.error(new VacademyException(
                            "Verification service error: " + ex.getResponseBodyAsString()));
                })
                .block();
    }

    private void requireConfigured() {
        if (!isConfigured()) {
            throw new VacademyException(
                    "Identity verification is not configured on this platform");
        }
    }
}
