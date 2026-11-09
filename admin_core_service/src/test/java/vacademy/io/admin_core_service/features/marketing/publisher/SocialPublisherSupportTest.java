package vacademy.io.admin_core_service.features.marketing.publisher;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.marketing.client.MarketingApiException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SocialPublisherSupportTest {

    private static MarketingApiException failWith(String code, boolean transientError, boolean authError) {
        MarketingApiException cause = new MarketingApiException(code, "boom", transientError, authError);
        return assertThrows(MarketingApiException.class,
                () -> SocialPublisherSupport.createOnce(() -> { throw cause; }, "Facebook", "the Page"));
    }

    @Test
    @DisplayName("A timeout, 5xx or Meta code 1/2 on a create call is OUTCOME_UNKNOWN, never retried")
    void ambiguousFailuresAreNotRetried() {
        for (String code : new String[]{"NETWORK_ERROR", "HTTP_500", "1", "2", "2/1234", "EMPTY_RESPONSE", "INTERNAL"}) {
            MarketingApiException e = failWith(code, true, false);
            assertEquals(MarketingApiException.OUTCOME_UNKNOWN, e.getPlatformCode(), code);
            assertFalse(e.isTransientError(), code);
            assertTrue(e.getMessage().contains("check the Page before retrying"), code);
        }
    }

    @Test
    @DisplayName("Rate limits and connect failures were refused before running, so they stay transient")
    void refusedRequestsStayTransient() {
        for (String code : new String[]{"4", "17", "32", "341", "613", "613/1996", "80001", "HTTP_429",
                "RESOURCE_EXHAUSTED", MarketingApiException.CONNECT_ERROR}) {
            MarketingApiException e = failWith(code, true, false);
            assertEquals(code, e.getPlatformCode());
            assertTrue(e.isTransientError(), code);
        }
    }

    @Test
    @DisplayName("Permanent and auth errors pass through unchanged; success returns the response")
    void otherOutcomesPassThrough() {
        assertEquals("100", failWith("100", false, false).getPlatformCode());
        assertTrue(failWith("190", false, true).isAuthError());
        JsonNode ok = JsonNodeFactory.instance.objectNode().put("id", "1");
        assertSame(ok, SocialPublisherSupport.createOnce(() -> ok, "Facebook", "the Page"));
    }
}
