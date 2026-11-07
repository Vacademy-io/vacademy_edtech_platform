package vacademy.io.common.core.internal_api_wrapper;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.http.HttpHeaders;
import vacademy.io.common.tracing.RequestIds;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class InternalClientUtilsRequestIdTest {

    @AfterEach
    void clear() {
        MDC.clear();
    }

    @Test
    void forwardsTheCurrentRequestId() {
        MDC.put(RequestIds.MDC_KEY, "req_1");
        HttpHeaders headers = new HttpHeaders();
        InternalClientUtils.forwardRequestId(headers);
        assertEquals("req_1", headers.getFirst("X-Request-Id"));
    }

    @Test
    void keepsACallerSuppliedId() {
        MDC.put(RequestIds.MDC_KEY, "req_1");
        HttpHeaders headers = new HttpHeaders();
        headers.set("x-request-id", "caller");
        InternalClientUtils.forwardRequestId(headers);
        assertEquals("caller", headers.getFirst(RequestIds.HEADER));
        assertEquals(1, headers.get(RequestIds.HEADER).size());
    }

    @Test
    void addsNothingOutsideARequest() {
        HttpHeaders headers = new HttpHeaders();
        InternalClientUtils.forwardRequestId(headers);
        assertFalse(headers.containsKey(RequestIds.HEADER));
    }
}
