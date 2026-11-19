package vacademy.io.admin_core_service.features.payments.manager;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import io.netty.channel.ChannelOption;
import org.springframework.http.MediaType;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.payment.currency.CurrencyRegistry;
import vacademy.io.common.payment.dto.*;
import vacademy.io.common.payment.enums.PaymentStatusEnum;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class PhonePePaymentManager implements PaymentServiceStrategy {

    private static final Logger logger = LoggerFactory.getLogger(PhonePePaymentManager.class);
    private final WebClient webClient;
    /**
     * Same as {@link #webClient} with a 5 s connect and 10 s response timeout, for the status
     * read-back that confirms webhooks ({@link #checkPaymentStatusWithTimeouts}). Checkout and
     * the other calls keep using {@link #webClient} unchanged.
     */
    private final WebClient boundedWebClient;
    private final ObjectMapper objectMapper;

    static final int CHECK_CONNECT_TIMEOUT_MS = 5_000;
    static final Duration CHECK_RESPONSE_TIMEOUT = Duration.ofSeconds(10);

    /**
     * V2 OAuth access tokens are reusable until they expire, so cache them per
     * client id to avoid a token round-trip on every payment/status call.
     */
    private final Map<String, CachedToken> tokenCache = new ConcurrentHashMap<>();

    private static final class CachedToken {
        final String token;
        final long expiresAtEpochSec;

        CachedToken(String token, long expiresAtEpochSec) {
            this.token = token;
            this.expiresAtEpochSec = expiresAtEpochSec;
        }
    }

    public PhonePePaymentManager(WebClient.Builder webClientBuilder, ObjectMapper objectMapper) {
        this.boundedWebClient = webClientBuilder.clone()
                .clientConnector(new ReactorClientHttpConnector(HttpClient.create()
                        .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, CHECK_CONNECT_TIMEOUT_MS)
                        .responseTimeout(CHECK_RESPONSE_TIMEOUT)))
                .build();
        this.webClient = webClientBuilder.build();
        this.objectMapper = objectMapper;
    }

    @Override
    public PaymentResponseDTO initiatePayment(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {
        logger.info("Initiating PhonePe Standard Checkout payment for order: {}", request.getOrderId());

        try {
            // Route to the OAuth-based V2 flow when the institute is onboarded on V2
            // (client_id + client_secret + client_version). A configured
            // "clientVersion" is the discriminator; without it we fall back to the
            // legacy V1 salt-key / X-VERIFY flow below for older merchants.
            if (StringUtils.hasText((String) paymentGatewaySpecificData.get("clientVersion"))) {
                return initiatePaymentV2(user, request, paymentGatewaySpecificData);
            }

            // Extract Credentials
            String merchantId = (String) paymentGatewaySpecificData.get("clientId");
            String saltKey = (String) paymentGatewaySpecificData.get("clientSecret");
            String baseUrl = (String) paymentGatewaySpecificData.get("baseUrl");

            if (!StringUtils.hasText(baseUrl)) {
                // Fallback for potential legacy config, though we should enforce use of
                // 'baseUrl'
                baseUrl = (String) paymentGatewaySpecificData.getOrDefault("authBaseUrl",
                        paymentGatewaySpecificData.get("payBaseUrl"));
            }

            if (!StringUtils.hasText(merchantId) || !StringUtils.hasText(saltKey) || !StringUtils.hasText(baseUrl)) {
                throw new VacademyException("PhonePe Merchant ID, Salt Key, or Base URL is missing.");
            }

            // Sanitize inputs
            merchantId = merchantId.trim();
            saltKey = saltKey.trim();
            baseUrl = baseUrl.trim();

            // Warn if using Production ID in Sandbox
            if (baseUrl.contains("sandbox") && !merchantId.equalsIgnoreCase("PGTESTPAYUAT")) {
                logger.warn("MISMATCH WARNING: You are using a custom Merchant ID ({}) with the Sandbox URL. " +
                        "Sandbox only supports 'PGTESTPAYUAT'. This will likely fail with KEY_NOT_CONFIGURED.",
                        merchantId);
            }

            // Parse Salt Key and Index for logging
            String key = saltKey;
            String index = "1";
            if (saltKey.contains("###")) {
                String[] parts = saltKey.split("###");
                key = parts[0];
                index = parts.length > 1 ? parts[1] : "1";
            }

            // Step 1: Build the Request DTO
            PhonePePaymentRequestDTO payloadDTO = buildPaymentRequest(user, request, merchantId);

            // Step 2: Serialize to JSON and Base64 Encode
            String payloadJson = objectMapper.writeValueAsString(payloadDTO);
            logger.info("PhonePe Request Payload: {}", payloadJson);
            String base64Payload = Base64.getEncoder().encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8));

            // Step 3: Calculate X-VERIFY Checksum
            String apiEndpoint = "/pg/v1/pay";
            String checksum = calculateChecksum(base64Payload, apiEndpoint, saltKey);

            // Step 4: Make API Call
            PhonePeResponseWrapperDTO<PhonePePaymentResponseDTO> response = makePaymentRequest(baseUrl, apiEndpoint,
                    base64Payload, checksum);

            // Step 5: Handle Response
            if (response == null || !response.isSuccess() || response.getData() == null) {
                String errorMsg = response != null ? response.getMessage() : "Empty response from PhonePe";
                logger.error("PhonePe payment initiation failed: {}", errorMsg);
                throw new VacademyException("PhonePe payment initiation failed: " + errorMsg);
            }

            return buildPaymentResponse(response.getData(), request);

        } catch (org.springframework.web.reactive.function.client.WebClientResponseException e) {
            String responseBody = e.getResponseBodyAsString();
            logger.error("PhonePe API error. Status: {}, Body: {}", e.getStatusCode(), responseBody);
            throw new VacademyException("PhonePe API error: " + responseBody);
        } catch (JsonProcessingException e) {
            logger.error("Error serializing PhonePe request", e);
            throw new VacademyException("Error creating payment request: " + e.getMessage());
        } catch (Exception e) {
            logger.error("Error initiating PhonePe payment", e);
            throw new VacademyException("Error initiating PhonePe payment: " + e.getMessage());
        }
    }

    private PhonePePaymentRequestDTO buildPaymentRequest(UserDTO user, PaymentInitiationRequestDTO request,
            String merchantId) {
        long amountInPaise = CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency());

        PhonePeRequestDTO phonePeRequest = request.getPhonePeRequest();
        String redirectUrl = phonePeRequest != null ? phonePeRequest.getRedirectUrl() : "";

        // PhonePe sends the learner back to this redirectUrl after the hosted
        // checkout. The frontend result page needs the order id (= merchant
        // transaction id = payment log id) and the institute id to poll status
        // and complete the enrollment, so stamp them onto the URL here — the
        // frontend can't know the server-generated order id at request time.
        redirectUrl = appendReturnParams(redirectUrl, request.getOrderId(), request.getInstituteId());

        // CRITICAL FIX: callbackUrl must be the BACKEND webhook endpoint, not frontend
        // URL
        // PhonePe will POST to this URL when payment completes/fails
        // Format:
        // https://backend-stage.vacademy.io/admin-core-service/payments/webhook/callback/phonepe
        String callbackUrl = request.getInstituteId() != null
                ? constructWebhookCallbackUrl(request.getInstituteId())
                : redirectUrl; // Fallback to redirectUrl if instituteId is missing

        return PhonePePaymentRequestDTO.builder()
                .merchantId(merchantId)
                .merchantTransactionId(request.getOrderId()) // Utilizing orderId as transaction Id
                .merchantUserId(user != null ? "USER_" + user.getId() : "GUEST_" + request.getOrderId()) // Unique user
                                                                                                         // ID
                .amount(amountInPaise)
                .redirectUrl(redirectUrl) // Where user goes after payment (frontend)
                .redirectMode("REDIRECT") // Standard mode
                .callbackUrl(callbackUrl) // Where PhonePe POSTs webhook (backend)
                .mobileNumber(user != null ? user.getMobileNumber() : null) // Pass mobile number if available
                .paymentInstrument(PhonePePaymentRequestDTO.PaymentInstrument.builder()
                        .type("PAY_PAGE")
                        .build())
                .build();
    }

    /**
     * Appends {@code orderId} and {@code instituteId} to the frontend redirect
     * URL so the payment-result page can resolve and poll the right order after
     * PhonePe redirects the learner back. Preserves any existing query string
     * and skips params that are already present or missing.
     */
    private String appendReturnParams(String redirectUrl, String orderId, String instituteId) {
        if (!StringUtils.hasText(redirectUrl)) {
            return redirectUrl;
        }
        StringBuilder url = new StringBuilder(redirectUrl);
        if (StringUtils.hasText(orderId) && !redirectUrl.contains("orderId=")) {
            url.append(redirectUrl.contains("?") ? '&' : '?').append("orderId=").append(orderId);
        }
        if (StringUtils.hasText(instituteId) && !redirectUrl.contains("instituteId=")) {
            url.append(url.indexOf("?") >= 0 ? '&' : '?').append("instituteId=").append(instituteId);
        }
        return url.toString();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // V2 (OAuth-based Standard Checkout)
    // Docs: https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * V2 payment initiation. Fetches an OAuth token, calls
     * {@code POST {payBase}/checkout/v2/pay} with an {@code O-Bearer} header and
     * returns the hosted {@code redirectUrl}. The learner is redirected there;
     * the payment-result page + the dashboard-configured webhook drive
     * completion (identical to the V1 flow from the caller's perspective).
     */
    private PaymentResponseDTO initiatePaymentV2(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> data) {
        String payBaseUrl = resolvePayBaseUrl(data);
        if (!StringUtils.hasText(payBaseUrl)) {
            throw new VacademyException("PhonePe API Base URL is missing.");
        }

        String token = getAccessToken(data, webClient);
        long amountInPaise = CurrencyRegistry.toMinorUnits(request.getAmount(), request.getCurrency());

        PhonePeRequestDTO phonePeRequest = request.getPhonePeRequest();
        String redirectUrl = phonePeRequest != null ? phonePeRequest.getRedirectUrl() : "";
        redirectUrl = appendReturnParams(redirectUrl, request.getOrderId(), request.getInstituteId());

        Map<String, Object> merchantUrls = new HashMap<>();
        merchantUrls.put("redirectUrl", redirectUrl);

        Map<String, Object> paymentFlow = new HashMap<>();
        paymentFlow.put("type", "PG_CHECKOUT");
        paymentFlow.put("merchantUrls", merchantUrls);

        Map<String, Object> body = new HashMap<>();
        body.put("merchantOrderId", request.getOrderId());
        body.put("amount", amountInPaise);
        body.put("expireAfter", 1200);
        body.put("paymentFlow", paymentFlow);
        // V2 webhooks carry no query string, so stash the instituteId in metaInfo
        // (udf1) — PhonePeWebHookService resolves it from there.
        if (StringUtils.hasText(request.getInstituteId())) {
            Map<String, Object> metaInfo = new HashMap<>();
            metaInfo.put("udf1", request.getInstituteId());
            body.put("metaInfo", metaInfo);
        }

        String url = payBaseUrl + "/checkout/v2/pay";
        logger.info("Calling PhonePe V2 pay API: {}", url);

        Map<String, Object> response = webClient.post()
                .uri(url)
                .header("Authorization", "O-Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {
                })
                .block();

        Object hostedUrl = response != null ? response.get("redirectUrl") : null;
        if (hostedUrl == null) {
            String state = response != null ? String.valueOf(response.get("state")) : "no response";
            logger.error("PhonePe V2 payment initiation returned no redirectUrl (state={})", state);
            throw new VacademyException("PhonePe payment initiation failed: no redirect URL returned.");
        }

        Map<String, Object> responseData = new HashMap<>();
        responseData.put("phonePeOrderId", response.get("orderId"));
        responseData.put("redirectUrl", hostedUrl);
        responseData.put("status", response.get("state"));

        PaymentResponseDTO dto = new PaymentResponseDTO();
        dto.setOrderId(request.getOrderId());
        dto.setResponseData(responseData);
        dto.setMessage("Payment Initiated");
        return dto;
    }

    /**
     * V2 status check: {@code GET {payBase}/checkout/v2/order/{merchantOrderId}/status}
     * with an {@code O-Bearer} header. Returns the PhonePe order state
     * (COMPLETED / FAILED / PENDING). Never throws — returns a FAILED-state DTO on
     * error so the caller (PaymentService) can proceed without NPEs.
     */
    private PhonePeStatusResponseDTO checkPaymentStatusV2(String merchantOrderId, Map<String, Object> data,
            WebClient client) {
        try {
            String payBaseUrl = resolvePayBaseUrl(data);
            if (!StringUtils.hasText(payBaseUrl)) {
                throw new VacademyException("PhonePe API Base URL is missing.");
            }
            String token = getAccessToken(data, client);
            String url = payBaseUrl + "/checkout/v2/order/" + merchantOrderId + "/status";
            logger.info("Calling PhonePe V2 status API: {}", url);

            PhonePeStatusResponseDTO status = client.get()
                    .uri(url)
                    .header("Authorization", "O-Bearer " + token)
                    .retrieve()
                    .bodyToMono(PhonePeStatusResponseDTO.class)
                    .block();

            if (status != null && StringUtils.hasText(status.getState())) {
                if (!StringUtils.hasText(status.getMerchantOrderId())) {
                    status.setMerchantOrderId(merchantOrderId);
                }
                return status;
            }
            logger.error("PhonePe V2 status check returned empty state for order {}", merchantOrderId);
            return PhonePeStatusResponseDTO.builder().state("FAILED").merchantOrderId(merchantOrderId).build();
        } catch (Exception e) {
            logger.error("Error checking PhonePe V2 payment status for order {}", merchantOrderId, e);
            return PhonePeStatusResponseDTO.builder().state("FAILED").merchantOrderId(merchantOrderId).build();
        }
    }

    /**
     * Returns a valid V2 OAuth access token, fetching and caching a new one when
     * the cached token is absent or within 60s of expiry.
     */
    private String getAccessToken(Map<String, Object> data, WebClient client) {
        String clientId = trimToNull((String) data.get("clientId"));
        String clientSecret = trimToNull((String) data.get("clientSecret"));
        String clientVersion = trimToNull((String) data.get("clientVersion"));

        if (clientId == null || clientSecret == null || clientVersion == null) {
            throw new VacademyException("PhonePe V2 requires Client ID, Client Secret and Client Version.");
        }

        long now = Instant.now().getEpochSecond();
        CachedToken cached = tokenCache.get(clientId);
        if (cached != null && cached.expiresAtEpochSec - 60 > now) {
            return cached.token;
        }

        String oauthUrl = resolveOAuthUrl(data);
        if (!StringUtils.hasText(oauthUrl)) {
            throw new VacademyException("PhonePe OAuth token URL could not be resolved. Set the API Base URL.");
        }

        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", clientId);
        form.add("client_version", clientVersion);
        form.add("client_secret", clientSecret);
        form.add("grant_type", "client_credentials");

        Map<String, Object> tokenResponse = client.post()
                .uri(oauthUrl)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData(form))
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {
                })
                .block();

        Object accessToken = tokenResponse != null ? tokenResponse.get("access_token") : null;
        if (accessToken == null) {
            throw new VacademyException("Failed to obtain PhonePe access token.");
        }

        Object expiresAt = tokenResponse.get("expires_at");
        long expiresAtEpochSec = (expiresAt instanceof Number) ? ((Number) expiresAt).longValue() : now + 1200;
        tokenCache.put(clientId, new CachedToken(String.valueOf(accessToken), expiresAtEpochSec));
        return String.valueOf(accessToken);
    }

    /** Base URL for the V2 pay/status APIs (falls back to legacy config keys). */
    private String resolvePayBaseUrl(Map<String, Object> data) {
        String baseUrl = (String) data.get("baseUrl");
        if (!StringUtils.hasText(baseUrl)) {
            baseUrl = (String) data.getOrDefault("payBaseUrl", data.get("authBaseUrl"));
        }
        return baseUrl != null ? baseUrl.trim().replaceAll("/+$", "") : null;
    }

    /**
     * Resolves the OAuth token endpoint. Honours an explicit {@code oauthUrl}
     * override, otherwise derives it: sandbox tokens live under the same
     * pg-sandbox base, production tokens under the identity-manager host.
     */
    private String resolveOAuthUrl(Map<String, Object> data) {
        String explicit = trimToNull((String) data.get("oauthUrl"));
        if (explicit != null) {
            return explicit;
        }
        String payBaseUrl = resolvePayBaseUrl(data);
        if (payBaseUrl == null) {
            return null;
        }
        if (payBaseUrl.contains("preprod") || payBaseUrl.contains("sandbox")) {
            return payBaseUrl + "/v1/oauth/token";
        }
        return "https://api.phonepe.com/apis/identity-manager/v1/oauth/token";
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /**
     * Constructs the webhook callback URL for PhonePe
     * This is where PhonePe will POST payment status updates
     */
    private String constructWebhookCallbackUrl(String instituteId) {
        // Use the same base URL pattern as auth-service
        // In production/stage: https://backend-stage.vacademy.io
        // In local dev: http://localhost:8072
        // String baseUrl = System.getenv("AUTH_SERVER_BASE_URL");
        String baseUrl = "https://backend-stage.vacademy.io";
        // Construct webhook URL
        // Format:
        // {baseUrl}/admin-core-service/payments/webhook/callback/phonepe?instituteId={instituteId}
        String webhookUrl = baseUrl + "/admin-core-service/payments/webhook/callback/phonepe?instituteId="
                + instituteId;
        logger.info("PhonePe Callback URL being sent: {}", webhookUrl);

        return webhookUrl;
    }

    private String calculateChecksum(String base64Payload, String endpoint, String saltKey) {
        try {
            // Format: Base64(Payload) + "/pg/v1/pay" + SaltKey + "###" + SaltIndex
            // Assuming SaltIndex is 1, which is standard. If key mapping has it, we should
            // split it.
            // Usually saltKey provided in dashboard is just the key, index is 1.
            // Often format is: KEY###INDEX. Let's handle both.

            String key = saltKey;
            String index = "1";

            if (saltKey.contains("###")) {
                String[] parts = saltKey.split("###");
                key = parts[0];
                index = parts.length > 1 ? parts[1] : "1";
            }

            String dataToHash = base64Payload + endpoint + key;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] encodedHash = digest.digest(dataToHash.getBytes(StandardCharsets.UTF_8));

            // Convert to Hex
            StringBuilder hexString = new StringBuilder();
            for (byte b : encodedHash) {
                String hex = Integer.toHexString(0xff & b);
                if (hex.length() == 1)
                    hexString.append('0');
                hexString.append(hex);
            }

            return hexString.toString() + "###" + index;

        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 algorithm not found", e);
        }
    }

    private PhonePeResponseWrapperDTO<PhonePePaymentResponseDTO> makePaymentRequest(String baseUrl, String endpoint,
            String base64Payload, String checksum) {
        Map<String, String> requestBody = new HashMap<>();
        requestBody.put("request", base64Payload);

        // Ensure standard URL formation
        String url = baseUrl + endpoint;
        logger.info("Calling PhonePe API: {}", url);

        return webClient.post()
                .uri(url)
                .contentType(MediaType.APPLICATION_JSON)
                .header("X-VERIFY", checksum)
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<PhonePeResponseWrapperDTO<PhonePePaymentResponseDTO>>() {
                })
                .block();
    }

    private PaymentResponseDTO buildPaymentResponse(PhonePePaymentResponseDTO phonePeResponse,
            PaymentInitiationRequestDTO request) {
        Map<String, Object> responseData = new HashMap<>();
        responseData.put("phonePeOrderId", phonePeResponse.getMerchantTransactionId());

        String redirectUrl = null;
        if (phonePeResponse.getInstrumentResponse() != null &&
                phonePeResponse.getInstrumentResponse().getRedirectInfo() != null) {
            redirectUrl = phonePeResponse.getInstrumentResponse().getRedirectInfo().getUrl();
        }

        responseData.put("redirectUrl", redirectUrl);
        responseData.put("status", phonePeResponse.getState()); // E.g. PAYMENT_INITIATED

        PaymentResponseDTO dto = new PaymentResponseDTO();
        dto.setOrderId(request.getOrderId());
        dto.setResponseData(responseData);
        dto.setMessage(phonePeResponse.getMessage() != null ? phonePeResponse.getMessage() : "Payment Initiated");

        return dto;
    }

    public PhonePeStatusResponseDTO checkPaymentStatus(String merchantTransactionId,
            Map<String, Object> paymentGatewaySpecificData) {
        return checkPaymentStatus(merchantTransactionId, paymentGatewaySpecificData, webClient);
    }

    /**
     * {@link #checkPaymentStatus}, with a 5 s connect and 10 s response timeout on each call
     * (token and status), for confirming webhooks with the gateway.
     */
    public PhonePeStatusResponseDTO checkPaymentStatusWithTimeouts(String merchantTransactionId,
            Map<String, Object> paymentGatewaySpecificData) {
        return checkPaymentStatus(merchantTransactionId, paymentGatewaySpecificData, boundedWebClient);
    }

    private PhonePeStatusResponseDTO checkPaymentStatus(String merchantTransactionId,
            Map<String, Object> paymentGatewaySpecificData, WebClient client) {
        logger.info("Checking PhonePe payment status for transaction: {}", merchantTransactionId);

        // V2 (OAuth) institutes use the /checkout/v2/order/{id}/status endpoint.
        if (StringUtils.hasText((String) paymentGatewaySpecificData.get("clientVersion"))) {
            return checkPaymentStatusV2(merchantTransactionId, paymentGatewaySpecificData, client);
        }

        try {
            String merchantId = (String) paymentGatewaySpecificData.get("clientId");
            String saltKey = (String) paymentGatewaySpecificData.get("clientSecret");
            String baseUrl = (String) paymentGatewaySpecificData.get("baseUrl");

            if (!StringUtils.hasText(baseUrl)) {
                baseUrl = (String) paymentGatewaySpecificData.getOrDefault("authBaseUrl",
                        paymentGatewaySpecificData.get("payBaseUrl"));
            }

            // Sanitize inputs
            merchantId = merchantId != null ? merchantId.trim() : "";
            saltKey = saltKey != null ? saltKey.trim() : "";
            baseUrl = baseUrl != null ? baseUrl.trim() : "";

            // Build endpoint
            String endpoint = "/pg/v1/status/" + merchantId + "/" + merchantTransactionId;

            // Calculate X-VERIFY checksum
            String checksum = calculateChecksum("", endpoint, saltKey);

            // Make GET request
            String url = baseUrl + endpoint;
            logger.info("Calling PhonePe Status API: {}", url);

            PhonePeResponseWrapperDTO<PhonePeStatusResponseDTO> response = client.get()
                    .uri(url)
                    .header("X-VERIFY", checksum)
                    .header("X-MERCHANT-ID", merchantId)
                    .header("Content-Type", "application/json")
                    .retrieve()
                    .bodyToMono(new ParameterizedTypeReference<PhonePeResponseWrapperDTO<PhonePeStatusResponseDTO>>() {
                    })
                    .block();

            if (response != null && response.isSuccess()) {
                logger.info("PhonePe status check successful. State: {}",
                        response.getData().getState());
                return response.getData();
            } else {
                String errorMsg = response != null ? response.getMessage() : "Empty response from PhonePe";
                logger.error("PhonePe status check failed: {}", errorMsg);
                // Return valid object with FAILED state instead of null to prevent NPE
                return PhonePeStatusResponseDTO.builder()
                        .state("FAILED")
                        .merchantOrderId(merchantTransactionId)
                        .build();
            }

        } catch (org.springframework.web.reactive.function.client.WebClientResponseException e) {
            logger.error("PhonePe Status API error. Status: {}, Body: {}", e.getStatusCode(),
                    e.getResponseBodyAsString());
            return PhonePeStatusResponseDTO.builder()
                    .state("FAILED")
                    .merchantOrderId(merchantTransactionId)
                    .build();
        } catch (Exception e) {
            logger.error("Error checking PhonePe payment status", e);
            return PhonePeStatusResponseDTO.builder()
                    .state("FAILED")
                    .merchantOrderId(merchantTransactionId)
                    .build();
        }
    }

    @Override
    public Map<String, Object> createCustomer(UserDTO user, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {
        logger.info("PhonePe does not require explicit customer creation. Returning user details.");
        Map<String, Object> response = new HashMap<>();
        if (user != null) {
            response.put("customerId", user.getId());
            response.put("email", user.getEmail());
            response.put("contact", user.getMobileNumber());
        }
        return response;
    }

    @Override
    public Map<String, Object> createCustomerForUnknownUser(String email, PaymentInitiationRequestDTO request,
            Map<String, Object> paymentGatewaySpecificData) {
        Map<String, Object> response = new HashMap<>();
        response.put("customerId", "anon_" + System.currentTimeMillis());
        response.put("email", email);
        return response;
    }

    @Override
    public Map<String, Object> findCustomerByEmail(String email, Map<String, Object> paymentGatewaySpecificData) {
        return null;
    }
}
