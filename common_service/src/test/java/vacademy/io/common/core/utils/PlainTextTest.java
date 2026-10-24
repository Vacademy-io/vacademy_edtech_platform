package vacademy.io.common.core.utils;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class PlainTextTest {

    @Test
    void escapesMarkupSoItIsShownLiterally() {
        assertEquals("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;", PlainText.escape("<script>alert(\"x\")</script>"));
        assertEquals("Tom &amp; Jerry&#39;s", PlainText.escape("Tom & Jerry's"));
        assertEquals("&lt;br&gt;", PlainText.escape("<br>"));
        assertEquals("&amp;lt;", PlainText.escape("&lt;"));
    }

    @Test
    void turnsEveryLineBreakStyleIntoBr() {
        assertEquals("a<br>b<br>c<br>d", PlainText.escape("a\nb\r\nc\rd"));
        assertEquals("<br><br>", PlainText.escape("\n\n"));
        assertEquals("x<br>", PlainText.escape("x\r\n"));
    }

    @Test
    void leavesOrdinaryTextAndUnicodeAlone() {
        assertEquals("Explain photosynthesis. (5 marks)\tप्रकाश", PlainText.escape("Explain photosynthesis. (5 marks)\tप्रकाश"));
        assertEquals("", PlainText.escape(""));
        assertNull(PlainText.escape(null));
    }

    @Test
    void unescapeRoundTrips() {
        String[] samples = { "<b>bold</b> & 'q' \"d\"", "line1\nline2", "&lt; literal", "<br> typed by partner", "" };
        for (String s : samples) {
            assertEquals(s, PlainText.unescape(PlainText.escape(s)));
        }
        assertEquals("a\nb", PlainText.unescape(PlainText.escape("a\r\nb")));
        assertEquals("a\nb\nc", PlainText.unescape("a<br/>b<BR />c"));
        assertNull(PlainText.unescape(null));
    }
}
