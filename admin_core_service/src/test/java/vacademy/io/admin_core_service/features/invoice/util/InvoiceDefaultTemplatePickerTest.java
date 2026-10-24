package vacademy.io.admin_core_service.features.invoice.util;

import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.institute.dto.template.TemplateResponse;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InvoiceDefaultTemplatePickerTest {

    private static TemplateResponse template(String id, String content) {
        return TemplateResponse.builder().id(id).content(content).build();
    }

    private final List<TemplateResponse> newestFirst = List.of(
            template("newest", "<p>new</p>"),
            template("older", "<p>old</p>"),
            template("blank", "  "));

    @Test
    void noDefaultKeepsNewest() {
        assertEquals("newest", InvoiceDefaultTemplatePicker.pick(newestFirst, null).orElseThrow().getId());
        assertEquals("newest", InvoiceDefaultTemplatePicker.pick(newestFirst, "").orElseThrow().getId());
    }

    @Test
    void defaultWinsOverNewest() {
        assertEquals("older", InvoiceDefaultTemplatePicker.pick(newestFirst, "older").orElseThrow().getId());
    }

    @Test
    void deletedOrEmptyDefaultFallsBackToNewest() {
        assertEquals("newest", InvoiceDefaultTemplatePicker.pick(newestFirst, "deleted").orElseThrow().getId());
        assertEquals("newest", InvoiceDefaultTemplatePicker.pick(newestFirst, "blank").orElseThrow().getId());
    }

    @Test
    void emptyListPicksNothing() {
        assertTrue(InvoiceDefaultTemplatePicker.pick(List.of(), "older").isEmpty());
        assertTrue(InvoiceDefaultTemplatePicker.pick(null, null).isEmpty());
    }

    @Test
    void readsDefaultIdFromSetting() {
        Map<String, Object> setting = new HashMap<>();
        setting.put(InvoiceDefaultTemplatePicker.PDF_SETTING_KEY, "older");
        setting.put(InvoiceDefaultTemplatePicker.EMAIL_SETTING_KEY, 42);

        assertEquals("older", InvoiceDefaultTemplatePicker.defaultIdFrom(setting,
                InvoiceDefaultTemplatePicker.PDF_SETTING_KEY));
        assertNull(InvoiceDefaultTemplatePicker.defaultIdFrom(setting,
                InvoiceDefaultTemplatePicker.EMAIL_SETTING_KEY));
        assertNull(InvoiceDefaultTemplatePicker.defaultIdFrom(null,
                InvoiceDefaultTemplatePicker.PDF_SETTING_KEY));
        assertNull(InvoiceDefaultTemplatePicker.defaultIdFrom("not a map",
                InvoiceDefaultTemplatePicker.PDF_SETTING_KEY));
    }
}
