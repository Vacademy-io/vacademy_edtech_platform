package vacademy.io.admin_core_service.features.commerce.label.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class LabelPrintDataTest {

    @Test
    void qrHoldsTheShopLinkWhenItFits() {
        assertEquals("https://shop.example/q/PABCDEFGH2", LabelQueueService.qrValue("https://shop.example",
                "PABCDEFGH2"));
        assertEquals("https://shop.example/q/VABCDEFGH2", LabelQueueService.qrValue("https://shop.example/",
                "VABCDEFGH2"));
        assertEquals("PABCDEFGH2", LabelQueueService.qrValue(null, "PABCDEFGH2"));
        String longBase = "https://" + "a".repeat(60) + ".example";
        assertEquals("PABCDEFGH2", LabelQueueService.qrValue(longBase, "PABCDEFGH2"));
        assertNull(LabelQueueService.qrValue("https://shop.example", null));
    }
}
