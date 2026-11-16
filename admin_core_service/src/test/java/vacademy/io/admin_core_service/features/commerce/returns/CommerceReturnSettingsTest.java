package vacademy.io.admin_core_service.features.commerce.returns;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnPolicy;
import vacademy.io.admin_core_service.features.commerce.returns.policy.CommerceReturnSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.institute.entity.Institute;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The return policy keys ({@code returns}) of {@code PUT /checkout-settings}: written by the
 * commerce settings writer, every other key kept byte for byte, read back with defaults.
 */
class CommerceReturnSettingsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String STORED = """
            {"setting": {"COMMERCE_SETTING": {"key": "COMMERCE_SETTING", "name": "Commerce", "data": {
               "holdMinutes": 20, "orders": {"refundShippingOnRto": false},
               "cod": {"enabled": true, "maxOrderValue": 4000}}}}}
            """;

    private InstituteSettingWriter settingWriter;
    private CommerceCheckoutSettingsService service;

    @BeforeEach
    void setUp() {
        InstituteRepository instituteRepository = mock(InstituteRepository.class);
        settingWriter = mock(InstituteSettingWriter.class);
        Institute institute = new Institute();
        institute.setId("inst-1");
        institute.setSetting(STORED);
        when(instituteRepository.findByIdForUpdate("inst-1")).thenReturn(Optional.of(institute));
        CommerceStorefrontSettings storefront = mock(CommerceStorefrontSettings.class);
        when(storefront.read("inst-1")).thenReturn(
                vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings.defaults());
        service = new CommerceCheckoutSettingsService(instituteRepository, settingWriter, storefront);
    }

    private JsonNode written() {
        ArgumentCaptor<JsonNode> entry = ArgumentCaptor.forClass(JsonNode.class);
        verify(settingWriter).putSettingKey(any(), eq("COMMERCE_SETTING"), entry.capture(), any());
        return entry.getValue().get("data");
    }

    @Test
    @SuppressWarnings("unchecked")
    void theReturnsBlockIsWrittenAndEveryOtherKeyKept() throws Exception {
        Map<String, Object> answer = service.update("inst-1", "staff-1", JSON.readTree(
                "{\"returns\": {\"window_days\": 10, \"allowed_reasons\": [\"DEFECTIVE\", \"SIZE\"], "
                        + "\"photo_required\": true, \"policy_text\": {\"en\": \"Ten days\"}}}"));
        JsonNode data = written();
        assertEquals(10, data.get("returns").get("windowDays").asInt());
        assertEquals("[\"DEFECTIVE\",\"SIZE\"]", data.get("returns").get("allowedReasons").toString());
        assertEquals("SELLER", data.get("returns").get("returnShippingPaidBy").asText(), "a key left out: default");
        assertEquals(20, data.get("holdMinutes").asInt());
        assertEquals(4000, data.get("cod").get("maxOrderValue").asInt());
        assertEquals(false, data.get("orders").get("refundShippingOnRto").asBoolean());
        Map<String, Object> returns = (Map<String, Object>) answer.get("returns");
        assertEquals(10, returns.get("window_days"));
        assertEquals(List.of("DEFECTIVE", "SIZE"), returns.get("allowed_reasons"));
        assertEquals(Boolean.TRUE, returns.get("photo_required"));
    }

    @Test
    void aBadReturnsValueIsRefusedAndNothingIsWritten() throws Exception {
        assertThrows(InvalidRequestException.class, () -> service.update("inst-1", "staff-1",
                JSON.readTree("{\"returns\": {\"window_days\": -1}}")));
        assertThrows(InvalidRequestException.class, () -> service.update("inst-1", "staff-1",
                JSON.readTree("{\"returns\": {\"allowed_reasons\": [\"LOST\"]}}")));
        verify(settingWriter, never()).putSettingKey(any(), any(), any(), any());
    }

    @Test
    void theReaderTakesDefaultsWhenNothingOrSomethingBadIsStored() {
        InstituteSettingService settings = mock(InstituteSettingService.class);
        CommerceReturnSettings reader = new CommerceReturnSettings(settings, JSON);
        when(settings.getSettingByInstituteIdAndKey("inst-1", "COMMERCE_SETTING")).thenReturn(null);
        assertEquals(CommerceReturnPolicy.defaults(), reader.read("inst-1"));
        when(settings.getSettingByInstituteIdAndKey("inst-1", "COMMERCE_SETTING"))
                .thenReturn(Map.of("returns", Map.of("windowDays", 3)));
        assertEquals(3, reader.read("inst-1").windowDays());
        when(settings.getSettingByInstituteIdAndKey("inst-2", "COMMERCE_SETTING"))
                .thenThrow(new IllegalStateException("down"));
        assertEquals(CommerceReturnPolicy.defaults(), reader.read("inst-2"));
        // Without the reader (a service built by hand) the view shows the defaults.
        assertEquals(7, ((Map<?, ?>) service.get("inst-1").get("returns")).get("window_days"));
    }
}
