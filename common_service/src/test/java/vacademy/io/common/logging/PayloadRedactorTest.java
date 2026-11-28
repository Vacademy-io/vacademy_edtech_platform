package vacademy.io.common.logging;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PayloadRedactorTest {

    private final PayloadRedactor redactor = new PayloadRedactor();

    @Test
    void masksPublicApiSecretsInAnySpelling() {
        for (String key : List.of("x-api-key", "X-API-Key", "x_api_key", "xApiKey", "webhook_secret", "webhookSecret",
                "signing_secret", "client_secret", "clientSecret", "signature", "Signature")) {
            assertTrue(redactor.isSensitive(key), key);
        }
    }

    @Test
    void keepsTheExistingNames() {
        for (String key : List.of("password", "token", "accessToken", "refresh_token", "apiKey", "api_key", "otp",
                "cvv", "card_number", "aadhaar", "Authorization")) {
            assertTrue(redactor.isSensitive(key), key);
        }
        assertFalse(redactor.isSensitive("name"));
        assertFalse(redactor.isSensitive("question_text"));
        assertFalse(redactor.isSensitive(null));
    }

    @Test
    @SuppressWarnings("unchecked")
    void redactsNestedTreesWithoutTouchingTheInput() {
        Map<String, Object> endpoint = new LinkedHashMap<>();
        endpoint.put("url", "https://erp.example/hook");
        endpoint.put("signing_secret", "whsec_123");
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("name", "ERP");
        input.put("headers", Map.of("X-API-Key", "vak_eval_abc"));
        input.put("endpoints", List.of(endpoint));

        Map<String, Object> out = (Map<String, Object>) redactor.redact(input);

        assertEquals("ERP", out.get("name"));
        assertEquals(PayloadRedactor.MASK, ((Map<String, Object>) out.get("headers")).get("X-API-Key"));
        Map<String, Object> outEndpoint = ((List<Map<String, Object>>) out.get("endpoints")).get(0);
        assertEquals(PayloadRedactor.MASK, outEndpoint.get("signing_secret"));
        assertEquals("https://erp.example/hook", outEndpoint.get("url"));
        assertEquals("whsec_123", endpoint.get("signing_secret"), "input is not modified");
    }

    @Test
    void extraKeysExtendTheDefaults() {
        PayloadRedactor custom = new PayloadRedactor(List.of("roll_number"));
        assertTrue(custom.isSensitive("rollNumber"));
        assertTrue(custom.isSensitive("password"));
        assertFalse(redactor.isSensitive("roll_number"));
        assertTrue(PayloadRedactor.shared().isSensitive("x-api-key"));
    }
}
