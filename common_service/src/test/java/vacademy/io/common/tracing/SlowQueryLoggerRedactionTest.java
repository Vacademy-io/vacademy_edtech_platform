package vacademy.io.common.tracing;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

/**
 * The slow/failed-call log line and its Sentry extra print method arguments. A credentials
 * map (gateway key id + secret) was printed on prod (2026-10-16, a Razorpay refund call):
 * maps are now shown by size only, and key-shaped strings are masked.
 */
class SlowQueryLoggerRedactionTest {

    private final SlowQueryLogger logger = new SlowQueryLogger();

    @Test
    void mapsAreShownBySizeOnly() {
        Map<String, Object> creds = new LinkedHashMap<>();
        creds.put("keySecret", "very-secret-value");
        creds.put("apiKey", "rzp_live_abc");
        String out = logger.formatArg(creds);
        assertEquals("Map(size=2)", out);
        assertFalse(out.contains("secret"));
    }

    @Test
    void keyShapedStringsAreMasked() {
        assertEquals("\"***\"", logger.formatArg("rzp_live_abcdef"));
        assertEquals("\"***\"", logger.formatArg("sk-or-v1-123"));
        assertEquals("\"***\"", logger.formatArg("Bearer eyJhbGciOi"));
    }

    @Test
    void ordinaryArgumentsAreUnchanged() {
        assertEquals("\"pay_TocQeXAr3PMKvf\"", logger.formatArg("pay_TocQeXAr3PMKvf"));
        assertEquals("100", logger.formatArg(100L));
    }
}
