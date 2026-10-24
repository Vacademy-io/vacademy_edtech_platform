package vacademy.io.common.logging;

import io.sentry.Hint;
import io.sentry.SentryEvent;
import io.sentry.protocol.Request;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class SentrySensitiveDataScrubberTest {

    @Test
    void stripsSensitiveHeadersAndCookies() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Authorization", "Bearer x");
        headers.put("x-api-key", "k");
        headers.put("COOKIE", "a=b");
        headers.put("Set-Cookie", "a=b");
        headers.put("X-Internal-Service-Token", "t");
        headers.put("Signature", "s");
        headers.put("Idempotency-Key", "i");
        headers.put("X-Review-Token", "r");
        headers.put("X-Webhook-Secret", "w");
        headers.put("X-Webhook-Token", "w");
        headers.put("X-BBB-Secret", "b");
        headers.put("Proxy-Authorization", "p");
        headers.put("User-Agent", "curl");
        headers.put("clientId", "inst");
        Request request = new Request();
        request.setHeaders(headers);
        request.setCookies("SESSION=abc");
        request.setUrl("https://x/admin-core-service/v1/foo");
        request.setQueryString("a=1&token=abc&Signature=s&page=2");
        SentryEvent event = new SentryEvent();
        event.setRequest(request);

        SentryEvent out = new SentrySensitiveDataScrubber().process(event, new Hint());

        assertEquals(Map.of("User-Agent", "curl", "clientId", "inst"), out.getRequest().getHeaders());
        assertNull(out.getRequest().getCookies());
        assertEquals("a=1&token=[Filtered]&Signature=[Filtered]&page=2", out.getRequest().getQueryString());
    }

    @Test
    void dropsQueryStringForOpenPaths() {
        Request request = new Request();
        request.setUrl("https://x/assessment-service/open/v1/candidate");
        request.setQueryString("external_id=R-17");
        SentryEvent event = new SentryEvent();
        event.setRequest(request);

        new SentrySensitiveDataScrubber().process(event, new Hint());

        assertNull(event.getRequest().getQueryString());
    }

    @Test
    void dropsQueryStringForPercentEncodedOpenPaths() {
        Request request = new Request();
        request.setUrl("https://x/assessment-service/%6Fpen/v1/candidate");
        request.setQueryString("external_id=R-17");
        SentryEvent event = new SentryEvent();
        event.setRequest(request);

        new SentrySensitiveDataScrubber().process(event, new Hint());

        assertNull(event.getRequest().getQueryString());
    }

    @Test
    void redactsOnlySecretLookingParams() {
        assertEquals("instituteId=i&access_token=[Filtered]&key=[Filtered]&keyword=x&sig=[Filtered]",
                SentrySensitiveDataScrubber.redactQueryString("instituteId=i&access_token=t&key=k&keyword=x&sig=s"));
        assertEquals("flag&a=", SentrySensitiveDataScrubber.redactQueryString("flag&a="));
        assertNull(SentrySensitiveDataScrubber.redactQueryString(null));
    }

    @Test
    void eventWithoutRequestIsUntouched() {
        SentryEvent event = new SentryEvent();
        assertEquals(event, new SentrySensitiveDataScrubber().process(event, new Hint()));
        assertNull(event.getRequest());
    }
}
