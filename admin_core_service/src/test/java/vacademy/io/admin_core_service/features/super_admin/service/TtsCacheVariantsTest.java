package vacademy.io.admin_core_service.features.super_admin.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class TtsCacheVariantsTest {

    @Test
    void punctuationAndAddressVariantsShareOneCanonicalLine() {
        String a = "Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है, हम Day one से काम करते हैं।";
        String b = "Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है हम Day one से काम करते हैं।";
        String c = "सर, Shiksha Nation में हमारा focus सिर्फ syllabus पूरा करने पर नहीं है — हम Day one से काम करते हैं।";
        assertEquals(TtsCacheAnalyticsService.canonicalLine(a), TtsCacheAnalyticsService.canonicalLine(b));
        assertEquals(TtsCacheAnalyticsService.canonicalLine(a), TtsCacheAnalyticsService.canonicalLine(c));
    }

    @Test
    void differentContentStaysApart() {
        assertNotEquals(TtsCacheAnalyticsService.canonicalLine("दूसरी, regular tests हों।"),
                TtsCacheAnalyticsService.canonicalLine("तीसरी, regular tests हों।"));
    }
}
