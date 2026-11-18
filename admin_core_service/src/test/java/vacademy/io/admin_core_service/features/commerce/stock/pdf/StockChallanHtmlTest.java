package vacademy.io.admin_core_service.features.commerce.stock.pdf;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.commerce.document.pdf.CommercePdfRenderer;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StockChallanHtmlTest {

    private static StockChallanHtml.Challan challan(String externalDocument) {
        return new StockChallanHtml.Challan("DC/2627-00001", LocalDate.of(2026, 11, 18), "TRF-000001",
                externalDocument,
                new StockChallanHtml.Place("WH1", "Main warehouse", "1 Market Road, Test City, 100001", "09",
                        "09AAAAA0000A1Z5"),
                new StockChallanHtml.Place("ST1", "दुकान", null, "09", "09AAAAA0000A1Z5"),
                List.of(new StockChallanHtml.Line("SCARF-1", "Cotton scarf", "Red", "6214", 2, 1, "PCS",
                                new BigDecimal("1200.00")),
                        new StockChallanHtml.Line("CLOTH-1", "कपड़ा", null, "5208", 15, 10,
                                "MTR", new BigDecimal("25.5")),
                        new StockChallanHtml.Line("BOTTLE-1", "Steel <bottle> & cup", null, null, 5, 1, "PCS",
                                null)),
                "EWB123", "Handle with care");
    }

    @Test
    void escapesAndPrintsEnglishOnly() {
        String html = StockChallanHtml.build(challan(null));
        assertTrue(html.contains("DELIVERY CHALLAN"));
        assertTrue(html.contains("not a sale"));
        assertTrue(html.contains("Steel &lt;bottle&gt; &amp; cup"));
        assertFalse(html.contains("कप"), "a Devanagari item name prints its SKU");
        assertTrue(html.contains(">ST1<"), "a Devanagari place name prints its code");
        assertTrue(html.contains("1.5 MTR"));
        assertTrue(StockChallanHtml.build(challan("EXT/77")).contains("STOCK TRANSFER NOTE"));
    }

    @Test
    void indianGrouping() {
        assertEquals("12,34,567.50", StockChallanHtml.indian(new BigDecimal("1234567.5")));
        assertEquals("999.00", StockChallanHtml.indian(new BigDecimal("999")));
        assertEquals("1,000.00", StockChallanHtml.indian(new BigDecimal("1000")));
    }

    /** Renders a sample; with -Dinv.samples=<dir> it is written there for a look. */
    @Test
    void rendersAPdf() throws IOException {
        byte[] pdf = new CommercePdfRenderer().render(StockChallanHtml.build(challan(null)));
        assertEquals("%PDF", new String(pdf, 0, 4, StandardCharsets.US_ASCII));
        String dir = System.getProperty("inv.samples");
        if (dir != null && !dir.isBlank()) {
            Files.write(Path.of(dir, "challan-sample.pdf"), pdf);
        }
    }
}
