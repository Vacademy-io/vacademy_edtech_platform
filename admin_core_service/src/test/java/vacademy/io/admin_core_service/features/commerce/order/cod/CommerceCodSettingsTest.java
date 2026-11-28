package vacademy.io.admin_core_service.features.commerce.order.cod;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.storefront.model.StorefrontSettings;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.institute.entity.Institute;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The COD keys Part B adds to the commerce settings writer ({@code PUT /checkout-settings}):
 * {@code cod.blocked_pincodes} (replaces the list) and {@code cod.confirm_within_hours}. The
 * generic settings route writes {@code COMMERCE_SETTING} for super admins only, so this is their
 * writer. Every other key is kept.
 */
class CommerceCodSettingsTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String STORED = """
            {"setting": {"COMMERCE_SETTING": {"key": "COMMERCE_SETTING", "name": "Commerce", "data": {
               "holdMinutes": 20, "orders": {"refundShippingOnRto": false},
               "cod": {"enabled": true, "maxOrderValue": 4000, "staffConfirmThreshold": 2500,
                       "blockedPincodes": ["190001"], "maxRefusals": 1}}}}}
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
        service = new CommerceCheckoutSettingsService(instituteRepository, settingWriter,
                mock(CommerceStorefrontSettings.class));
    }

    private JsonNode written() {
        ArgumentCaptor<JsonNode> entry = ArgumentCaptor.forClass(JsonNode.class);
        verify(settingWriter).putSettingKey(any(), eq("COMMERCE_SETTING"), entry.capture(), any());
        return entry.getValue().get("data");
    }

    @Test
    void theBlockedPincodesAreReplacedSortedAndOnce() throws Exception {
        Map<String, Object> answer = service.update("inst-1", "staff-1", JSON.readTree(
                "{\"cod\": {\"blocked_pincodes\": [\"744101\", \"190001\", \" 744101 \", \"110001\"]}}"));
        JsonNode cod = written().get("cod");
        assertEquals("[\"110001\",\"190001\",\"744101\"]", cod.get("blockedPincodes").toString());
        assertEquals(4000, cod.get("maxOrderValue").asInt(), "other COD keys are kept");
        assertEquals(1, cod.get("maxRefusals").asInt());
        assertTrue(cod.get("enabled").asBoolean());
        @SuppressWarnings("unchecked")
        Map<String, Object> codView = (Map<String, Object>) answer.get("cod");
        assertEquals(List.of("110001", "190001", "744101"), codView.get("blocked_pincodes"));
        assertEquals(48, codView.get("confirm_within_hours"));
    }

    @Test
    void anEmptyListUnblocksEveryPincode() throws Exception {
        service.update("inst-1", "staff-1", JSON.readTree("{\"cod\": {\"blocked_pincodes\": []}}"));
        assertEquals(0, written().get("cod").get("blockedPincodes").size());
    }

    @Test
    void theConfirmationWindowIsWrittenInHours() throws Exception {
        Map<String, Object> answer = service.update("inst-1", "staff-1",
                JSON.readTree("{\"cod\": {\"confirm_within_hours\": 24}}"));
        JsonNode data = written();
        assertEquals(24, data.get("cod").get("confirmWithinHours").asInt());
        assertEquals("190001", data.get("cod").get("blockedPincodes").get(0).asText(), "the list is kept");
        assertEquals(false, data.get("orders").get("refundShippingOnRto").asBoolean());
        assertEquals(20, data.get("holdMinutes").asInt());
        @SuppressWarnings("unchecked")
        Map<String, Object> codView = (Map<String, Object>) answer.get("cod");
        assertEquals(24, codView.get("confirm_within_hours"));
    }

    @Test
    void badValuesAre400AndNothingIsWritten() throws Exception {
        List<String> bodies = new ArrayList<>(List.of(
                "{\"cod\": {\"blocked_pincodes\": [\"19000\"]}}",
                "{\"cod\": {\"blocked_pincodes\": [\"019000\"]}}",
                "{\"cod\": {\"blocked_pincodes\": [190001]}}",
                "{\"cod\": {\"blocked_pincodes\": [\"19000a\"]}}",
                "{\"cod\": {\"blocked_pincodes\": [null]}}",
                "{\"cod\": {\"blocked_pincodes\": \"190001\"}}",
                "{\"cod\": {\"confirm_within_hours\": 0}}",
                "{\"cod\": {\"confirm_within_hours\": 169}}",
                "{\"cod\": {\"confirm_within_hours\": 2.5}}",
                "{\"cod\": {\"confirm_within_hours\": \"48\"}}"));
        StringBuilder many = new StringBuilder("{\"cod\": {\"blocked_pincodes\": [");
        for (int i = 0; i <= CommerceCheckoutSettingsService.MAX_BLOCKED_PINCODES; i++) {
            many.append(i == 0 ? "" : ",").append('"').append(100000 + i).append('"');
        }
        bodies.add(many.append("]}}").toString());
        for (String body : bodies) {
            assertThrows(InvalidRequestException.class, () -> service.update("inst-1", "staff-1", JSON.readTree(body)),
                    body);
        }
        verify(settingWriter, never()).putSettingKey(any(), anyString(), any(), any());
    }

    @Test
    void fiveHundredPincodesAreAllowed() throws Exception {
        StringBuilder body = new StringBuilder("{\"cod\": {\"blocked_pincodes\": [");
        for (int i = 0; i < CommerceCheckoutSettingsService.MAX_BLOCKED_PINCODES; i++) {
            body.append(i == 0 ? "" : ",").append('"').append(100000 + i).append('"');
        }
        service.update("inst-1", "staff-1", JSON.readTree(body.append("]}}").toString()));
        assertEquals(500, written().get("cod").get("blockedPincodes").size());
    }

    @Test
    void theStoredWindowIsReadWithItsDefaultAndRange() throws Exception {
        assertEquals(48, StorefrontSettings.defaults().cod().confirmWithinHours());
        assertEquals(12, StorefrontSettings.parse(JSON.readTree("{\"cod\": {\"confirmWithinHours\": 12}}")).cod()
                .confirmWithinHours());
        for (String bad : List.of("0", "169", "1.5", "\"x\"", "null")) {
            assertEquals(48, StorefrontSettings.parse(JSON.readTree("{\"cod\": {\"confirmWithinHours\": " + bad
                    + "}}")).cod().confirmWithinHours(), bad);
        }
    }
}
