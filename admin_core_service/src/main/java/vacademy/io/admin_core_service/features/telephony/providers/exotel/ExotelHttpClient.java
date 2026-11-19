package vacademy.io.admin_core_service.features.telephony.providers.exotel;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.telephony.spi.dto.BridgeCallRequest;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials;
import vacademy.io.common.external.VendorCallLog;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;

/**
 * Thin REST adapter for Exotel — the ONLY class that knows Exotel's HTTP
 * shape. All other code stays provider-agnostic.
 */
@Component
public class ExotelHttpClient {

    @Value("${telephony.exotel.base-url:https://api.exotel.com}")
    private String baseUrl;

    @Value("${telephony.request-timeout-ms:8000}")
    private int requestTimeoutMs;

    private RestTemplate restTemplate;

    /**
     * Hard request timeouts so a dead Exotel can't tie up a tomcat worker
     * for the default ~5 minutes. Connect = 3s (fast-fail unreachable).
     * Read = configurable (default 8s — Exotel's published SLA + buffer).
     * The circuit breaker takes over after repeated failures so we don't
     * even reach this point during an outage.
     */
    @jakarta.annotation.PostConstruct
    public void init() {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofSeconds(3));
        f.setReadTimeout(Duration.ofMillis(requestTimeoutMs));
        this.restTemplate = new RestTemplate(f);
    }

    /**
     * Exotel "Connect Two Numbers" — bridges From and To via the ExoPhone.
     * Returns the JSON envelope; caller picks out CallSid.
     *
     * Docs: https://developer.exotel.com/api/make-a-call-api
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> connect(BridgeCallRequest req, ProviderCredentials creds) {
        URI uri = URI.create(baseUrl + "/v1/Accounts/" + creds.getAccountId() + "/Calls/connect.json");

        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        // Defensive trim — admin-pasted ExoPhones / counsellor mobiles can carry
        // stray whitespace that Exotel sometimes accepts and sometimes doesn't.
        form.add("From", trimOrNull(req.getFrom()));
        form.add("To", trimOrNull(req.getTo()));
        form.add("CallerId", trimOrNull(req.getCallerId()));
        form.add("CallType", "trans");
        if (req.isRecord()) form.add("Record", "true");
        if (req.getStatusCallbackUrl() != null) {
            // StatusCallback content type: omit. Exotel's default is
            // application/x-www-form-urlencoded which is what req.getParameter
            // reads. Adding StatusCallbackContentType triggered 340025 in a
            // previous attempt, so we don't set it.
            //
            // StatusCallbackEvents: Exotel's Connect-Two-Numbers API only
            // accepts `terminal` (the default). Earlier attempts to also
            // subscribe to `answered` for granular SSE updates ("counsellor
            // picked up → lead picked up") returned
            //   400 Bad Request: Invalid 'StatusCallbackEvents' specified
            // so we leave the param unset and accept the single end-of-call
            // event.
            form.add("StatusCallback", req.getStatusCallbackUrl());
        }
        if (req.getCorrelationId() != null) {
            // Exotel echoes CustomField back on every status callback — that's
            // how the webhook finds the row even if CallSid hasn't been recorded.
            form.add("CustomField", req.getCorrelationId());
        }

        HttpHeaders headers = basicAuthHeaders(creds);
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        ResponseEntity<Map> resp;
        try {
            resp = restTemplate.exchange(uri,
                    HttpMethod.POST,
                    new HttpEntity<>(form, headers),
                    Map.class);
        } catch (RestClientException e) {
            VendorCallLog.failed(uri.toString(), "connect call", form, e);
            throw e;
        }
        return resp.getBody();
    }

    private static String trimOrNull(String s) {
        return s == null ? null : s.trim();
    }

    /**
     * Attach an ExoPhone to an App Bazaar flow so inbound calls execute that
     * flow (and therefore hit our Connect-applet URL). Replaces whatever the
     * number was previously attached to.
     *
     * Endpoint: PUT /v2_beta/Accounts/{sid}/IncomingPhoneNumbers/{exoPhoneSid}
     *
     * Field name: Exotel's public docs are fragmentary on whether they expect
     * {@code app_id}, {@code AppSid}, or {@code voice_url} on the PUT body —
     * different SDK samples use different names. We defensively send all
     * three: Exotel silently ignores unknown params, so this works regardless
     * of which name they accept on the account we're hitting. {@code voice_url}
     * is constructed in the documented {@code start_voice} form.
     *
     * Returns the parsed JSON body (Exotel echoes the updated row). Throws if
     * the response is non-2xx; the caller wraps + persists the error message
     * on the provider-number row so the admin sees it in the UI.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> attachExoPhoneToFlow(String exoPhoneSid, String flowSid,
                                                    ProviderCredentials creds) {
        URI uri = URI.create(baseUrl + "/v2_beta/Accounts/" + creds.getAccountId()
                + "/IncomingPhoneNumbers/" + exoPhoneSid.trim());

        String trimmedFlow = flowSid.trim();
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("app_id", trimmedFlow);
        form.add("AppSid", trimmedFlow);
        // Exotel's documented "start a flow on incoming call" URL shape. They
        // use it as the canonical representation of "this number runs this
        // flow" in API responses; sending it on writes works too.
        form.add("voice_url", "https://my.exotel.in/Exotel/exoml/start_voice/" + trimmedFlow);

        HttpHeaders headers = basicAuthHeaders(creds);
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        ResponseEntity<Map> resp;
        try {
            resp = restTemplate.exchange(uri,
                    HttpMethod.PUT,
                    new HttpEntity<>(form, headers),
                    Map.class);
        } catch (RestClientException e) {
            VendorCallLog.failed(uri.toString(), "attach exophone to flow", form, e);
            throw e;
        }
        return resp.getBody();
    }

    /**
     * List every ExoPhone on the account. Powers the "Sync from Exotel"
     * button so admins don't have to manually copy {@code exoPhoneSid}s out
     * of the dashboard into our Numbers card. Returns the raw envelope —
     * caller extracts the {@code incoming_phone_numbers} array.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> listExoPhones(ProviderCredentials creds) {
        URI uri = URI.create(baseUrl + "/v2_beta/Accounts/" + creds.getAccountId()
                + "/IncomingPhoneNumbers");
        HttpHeaders headers = basicAuthHeaders(creds);
        ResponseEntity<Map> resp;
        try {
            resp = restTemplate.exchange(uri,
                    HttpMethod.GET,
                    new HttpEntity<>(headers),
                    Map.class);
        } catch (RestClientException e) {
            VendorCallLog.failed(uri.toString(), "list exophones", null, e);
            throw e;
        }
        return resp.getBody();
    }

    /**
     * Fetch the account's current credit balance + currency. Used by the
     * Settings → Calling page to surface "how much credit is left" without
     * forcing the admin to open the Exotel dashboard.
     *
     * Endpoint: GET /v1/Accounts/{sid}/Balance.json
     * Response shape (per docs): {"Account": {"BalanceData": {"Balance": "...",
     *                  "Currency": "INR", "PricingPlan": "...",
     *                  "DateUpdated": "..."}}}
     *
     * Returns the raw response body as a String. Some accounts/regions
     * surface a content-type that Spring's Map auto-binder silently drops to
     * an empty Map for — pulling the raw bytes and parsing in the caller
     * sidesteps that. Plus we get to log exactly what Exotel sent.
     *
     * Also: we send {@code Accept: application/json} explicitly. The default
     * RestTemplate also advertises {@code application/cbor} which can cause
     * some Exotel endpoints to negotiate to a binary body Spring's JSON
     * parser can't read.
     */
    public String getBalanceRaw(ProviderCredentials creds) {
        URI uri = URI.create(baseUrl + "/v1/Accounts/" + creds.getAccountId()
                + "/Balance.json");
        HttpHeaders headers = basicAuthHeaders(creds);
        headers.setAccept(java.util.List.of(MediaType.APPLICATION_JSON));
        ResponseEntity<String> resp;
        try {
            resp = restTemplate.exchange(uri,
                    HttpMethod.GET,
                    new HttpEntity<>(headers),
                    String.class);
        } catch (RestClientException e) {
            VendorCallLog.failed(uri.toString(), "get account balance", null, e);
            throw e;
        }
        return resp.getBody();
    }

    /**
     * Stream an Exotel recording mp3. Returns the underlying InputStream so the
     * caller can pipe it straight to media_service without buffering on disk.
     */
    public InputStream openRecordingStream(String recordingUrl, ProviderCredentials creds) throws IOException {
        URL url = new URL(recordingUrl);
        URLConnection conn = url.openConnection();
        String basic = Base64.getEncoder().encodeToString(
                (creds.getUsername() + ":" + creds.getPassword())
                        .getBytes(StandardCharsets.UTF_8));
        conn.setRequestProperty("Authorization", "Basic " + basic);
        conn.setConnectTimeout(8_000);
        conn.setReadTimeout(30_000);
        try {
            return conn.getInputStream();
        } catch (IOException e) {
            VendorCallLog.failed(recordingUrl, "fetch recording", null, e);
            throw e;
        }
    }

    private HttpHeaders basicAuthHeaders(ProviderCredentials creds) {
        HttpHeaders h = new HttpHeaders();
        String basic = Base64.getEncoder().encodeToString(
                (creds.getUsername() + ":" + creds.getPassword())
                        .getBytes(StandardCharsets.UTF_8));
        h.set(HttpHeaders.AUTHORIZATION, "Basic " + basic);
        return h;
    }
}
