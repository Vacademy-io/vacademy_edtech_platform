package vacademy.io.common.tracing;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RequestTracingFilterTest {

    @Test
    void keepsQueryStringForOrdinaryPaths() {
        assertEquals("/admin-core-service/v1/x?page=1", RequestTracingFilter.loggablePath("/admin-core-service/v1/x", "page=1"));
        assertEquals("/admin-core-service/v1/x", RequestTracingFilter.loggablePath("/admin-core-service/v1/x", null));
    }

    @Test
    void dropsQueryStringForOpenPaths() {
        assertEquals("/admin-core-service/open/v1/learner", RequestTracingFilter.loggablePath("/admin-core-service/open/v1/learner", "token=abc"));
        assertEquals("/auth-service/open", RequestTracingFilter.loggablePath("/auth-service/open", "token=abc"));
        assertEquals("/admin-core-service/%6Fpen/v1/learner", RequestTracingFilter.loggablePath("/admin-core-service/%6Fpen/v1/learner", "token=abc"));
    }

    @Test
    void filtersTokenQueryParamsOnOtherPaths() {
        assertEquals("/admin-core-service/v1/telephony/webhook/plivo?token=[Filtered]&CallUUID=c",
                RequestTracingFilter.loggablePath("/admin-core-service/v1/telephony/webhook/plivo", "token=abc&CallUUID=c"));
    }
}
