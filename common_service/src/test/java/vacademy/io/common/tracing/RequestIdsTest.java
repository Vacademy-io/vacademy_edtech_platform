package vacademy.io.common.tracing;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import vacademy.io.common.testsupport.ServletFakes.FakeRequest;
import vacademy.io.common.testsupport.ServletFakes.FakeResponse;
import vacademy.io.common.testsupport.ServletFakes.RecordingChain;

import java.lang.reflect.Field;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RequestIdsTest {

    @AfterEach
    void clear() {
        MDC.clear();
    }

    @Test
    void acceptsSafeInboundIdsAndReplacesUnsafeOnes() {
        assertEquals("req_abc-123", RequestIds.acceptOrGenerate("req_abc-123"));
        assertEquals("abc", RequestIds.acceptOrGenerate("  abc "));
        String injected = RequestIds.acceptOrGenerate("abc\r\nSet-Cookie: x=1");
        assertTrue(injected.startsWith("req_"));
        assertTrue(RequestIds.acceptOrGenerate("<script>").startsWith("req_"));
        assertTrue(RequestIds.acceptOrGenerate("x".repeat(129)).startsWith("req_"));
        assertTrue(RequestIds.acceptOrGenerate(null).startsWith("req_"));
        assertTrue(RequestIds.acceptOrGenerate("").startsWith("req_"));
        assertNotEquals(RequestIds.generate(), RequestIds.generate());
        assertTrue(RequestIds.generate().matches("req_[0-9a-f]{32}"));
    }

    @Test
    void resolvePrefersStoredThenMdcThenHeader() {
        FakeRequest stored = new FakeRequest("GET", "/x").header(RequestIds.HEADER, "from-header");
        stored.attributes.put(RequestIds.ATTRIBUTE, "from-attribute");
        assertEquals("from-attribute", RequestIds.resolve(stored.proxy()));

        MDC.put(RequestIds.MDC_KEY, "from-mdc");
        assertEquals("from-mdc", RequestIds.resolve(new FakeRequest("GET", "/x").header(RequestIds.HEADER, "h").proxy()));
        MDC.clear();

        FakeRequest fresh = new FakeRequest("GET", "/x").header(RequestIds.HEADER, "from-header");
        assertEquals("from-header", RequestIds.resolve(fresh.proxy()));
        assertEquals("from-header", fresh.attributes.get(RequestIds.ATTRIBUTE));

        FakeRequest none = new FakeRequest("GET", "/x");
        String first = RequestIds.resolve(none.proxy());
        assertEquals(first, RequestIds.resolve(none.proxy()), "a minted id is stable for the request");
    }

    private static RequestTracingFilter filter(boolean enabled) throws Exception {
        TracingProperties props = new TracingProperties();
        props.setEnabled(enabled);
        RequestTracingFilter filter = new RequestTracingFilter();
        Field field = RequestTracingFilter.class.getDeclaredField("tracingProperties");
        field.setAccessible(true);
        field.set(filter, props);
        return filter;
    }

    @Test
    void tracingFilterEchoesInboundIdAndExposesItToTheChainOnly() throws Exception {
        for (boolean enabled : new boolean[] { true, false }) {
            FakeRequest request = new FakeRequest("GET", "/assessment-service/open/evaluation/v1/exams")
                    .header(RequestIds.HEADER, "req_partner_7");
            FakeResponse response = new FakeResponse();
            AtomicReference<String> inside = new AtomicReference<>();
            RecordingChain chain = new RecordingChain(r -> inside.set(RequestIds.current()));

            filter(enabled).doFilter(request.proxy(), response.proxy(), chain);

            assertTrue(chain.called);
            assertEquals("req_partner_7", inside.get(), "tracing enabled=" + enabled);
            assertEquals("req_partner_7", response.headers.get(RequestIds.HEADER));
            assertEquals("req_partner_7", request.attributes.get(RequestIds.ATTRIBUTE));
            assertNull(RequestIds.current(), "MDC cleared after the request");
        }
    }

    @Test
    void tracingFilterMintsAnIdAndRestoresAnOuterOne() throws Exception {
        MDC.put(RequestIds.MDC_KEY, "outer");
        FakeResponse response = new FakeResponse();
        AtomicReference<String> inside = new AtomicReference<>();
        filter(true).doFilter(new FakeRequest("GET", "/x").proxy(), response.proxy(),
                new RecordingChain(r -> inside.set(RequestIds.current())));
        assertTrue(inside.get().startsWith("req_"));
        assertEquals(inside.get(), response.headers.get(RequestIds.HEADER));
        assertEquals("outer", RequestIds.current());
    }

    @Test
    void taskDecoratorCarriesTheIdToTheWorkerAndCleansUp() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            MDC.put(RequestIds.MDC_KEY, "req_async");
            AtomicReference<String> seen = new AtomicReference<>();
            pool.submit(new MdcTaskDecorator().decorate(() -> seen.set(RequestIds.current()))).get(5, TimeUnit.SECONDS);
            assertEquals("req_async", seen.get());

            Callable<String> callable = MdcTaskDecorator.wrap(RequestIds::current);
            assertEquals("req_async", pool.submit(callable).get(5, TimeUnit.SECONDS));

            // The worker thread does not keep the id once the task is done.
            MDC.clear();
            assertNull(pool.submit(RequestIds::current).get(5, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
    }
}
