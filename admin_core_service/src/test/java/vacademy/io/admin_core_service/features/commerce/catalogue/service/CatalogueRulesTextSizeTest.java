package vacademy.io.admin_core_service.features.commerce.catalogue.service;

import org.junit.jupiter.api.Test;
import vacademy.io.common.exceptions.InvalidRequestException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

/** Product text is capped where it is saved: the public shop keeps it in memory and serves it. */
class CatalogueRulesTextSizeTest {

    @Test
    void ordinaryTextPasses() {
        assertDoesNotThrow(() -> CatalogueRules.requireTextSizes("Hand-woven cotton", "<p>" + "x".repeat(20_000) + "</p>",
                List.of(Map.of("code", "care", "html", "<p>Wash cold</p>"))));
        assertDoesNotThrow(() -> CatalogueRules.requireTextSizes(null, null, null));
    }

    @Test
    void textLongerThanAProductPageHoldsIsRefused() {
        assertThrows(InvalidRequestException.class, () -> CatalogueRules.requireTextSizes(
                "x".repeat(CatalogueRules.MAX_SHORT_DESCRIPTION_CHARS + 1), null, null));
        assertThrows(InvalidRequestException.class, () -> CatalogueRules.requireTextSizes(
                null, "x".repeat(CatalogueRules.MAX_DESCRIPTION_HTML_CHARS + 1), null));
        assertThrows(InvalidRequestException.class, () -> CatalogueRules.requireTextSizes(
                null, null, List.of(Map.of("code", "story", "html", "x".repeat(CatalogueRules.MAX_CONTENT_BLOCKS_CHARS)))));
        List<Map<String, Object>> many = new ArrayList<>();
        for (int i = 0; i <= CatalogueRules.MAX_CONTENT_BLOCKS; i++) {
            many.add(Map.of("code", "b" + i));
        }
        assertThrows(InvalidRequestException.class, () -> CatalogueRules.requireTextSizes(null, null, many));
    }
}
