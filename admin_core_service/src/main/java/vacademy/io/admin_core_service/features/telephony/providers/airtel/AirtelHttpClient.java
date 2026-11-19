package vacademy.io.admin_core_service.features.telephony.providers.airtel;

import vacademy.io.admin_core_service.core.external.ExternalCallLog;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;
import vacademy.io.admin_core_service.features.telephony.spi.dto.ProviderCredentials;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

/**
 * VBC Telephony API client. Currently: place an outbound click2dial (the lead's
 * leg rings the counsellor's extension first, then bridges to the lead). The
 * create-call response is text/plain with NO call id — correlation to our row
 * happens later via the CDR S3 feed (POLL_AND_MATCH), so we don't parse it.
 */
@Component
public class AirtelHttpClient {

    static final String DEFAULT_BASE_URL = "https://api.vonage.com/t/vbc.prod";

    private final RestTemplate rest = ExternalCallLog.attach(new RestTemplate());
    @Autowired private AirtelVbcTokenService tokenService;

    /**
     * Place a click2dial from a counsellor extension to a lead PSTN number.
     * Retries once on a 401 (token may have just expired) with a fresh token.
     */
    public void click2dial(ProviderCredentials creds, String fromExtension, String toPstn) {
        String base = firstNonBlank(creds.conf("baseUrl"), DEFAULT_BASE_URL);
        String accountId = creds.conf("accountId");
        if (accountId == null || accountId.isBlank()) {
            throw new VacademyException("Airtel accountId is not configured");
        }
        String url = base + "/telephony/v3/cc/accounts/" + accountId + "/calls";
        Map<String, Object> payload = Map.of(
                "from", Map.of("destination", nz(fromExtension), "type", "extension"),
                "to", Map.of("destination", nz(toPstn), "type", "pstn"),
                "type", "click2dial");
        try {
            post(url, payload, tokenService.bearer(creds));
        } catch (HttpClientErrorException e) {
            if (e.getStatusCode().value() == 401) {
                tokenService.invalidate(creds);
                post(url, payload, tokenService.bearer(creds));
            } else {
                throw e;
            }
        }
    }

    private void post(String url, Map<String, Object> payload, String bearer) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(bearer);
        // Response is text/plain (no id) — read as String and discard.
        rest.postForEntity(url, new HttpEntity<>(payload, headers), String.class);
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    private static String firstNonBlank(String a, String b) {
        return (a != null && !a.isBlank()) ? a : b;
    }
}
