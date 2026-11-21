package vacademy.io.admin_core_service.features.commerce.storefront.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.commerce.security.CommerceAccessDeniedException;
import vacademy.io.admin_core_service.features.commerce.security.CommerceRole;
import vacademy.io.admin_core_service.features.commerce.security.CommerceSetupAccess;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceCheckoutSettingsService;
import vacademy.io.admin_core_service.features.commerce.storefront.service.CommerceStorefrontSettings;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.setting_history.InstituteSettingWriter;
import vacademy.io.common.auth.model.CustomUserDetails;
import vacademy.io.common.exceptions.InvalidRequestException;
import vacademy.io.common.institute.entity.Institute;

import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** Staff checkout settings: the guard, a write that keeps every other key, and 400 for bad values. */
class CommerceCheckoutSettingsControllerTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String STORED = """
            {"setting": {
               "COMMERCE_SETTING": {"key": "COMMERCE_SETTING", "name": "Commerce", "data": {
                  "holdMinutes": 20, "baseLocale": "hi", "botCheck": {"enabled": true},
                  "limits": {"adjustmentQuantity": 20},
                  "otp": {"other": "kept"},
                  "cod": {"enabled": false, "maxOrderValue": 4000, "staffConfirmThreshold": 2500,
                          "blockedPincodes": ["190001"]}}},
               "NAMING_SETTING": {"key": "NAMING_SETTING", "data": {"x": 1}}}}
            """;

    private InstituteRepository instituteRepository;
    private InstituteSettingWriter settingWriter;
    private CommerceSetupAccess setupAccess;
    private CommerceCheckoutSettingsController controller;
    private Institute institute;
    private CustomUserDetails user;

    @BeforeEach
    void setUp() {
        instituteRepository = mock(InstituteRepository.class);
        settingWriter = mock(InstituteSettingWriter.class);
        setupAccess = mock(CommerceSetupAccess.class);
        institute = new Institute();
        institute.setId("inst-1");
        institute.setSetting(STORED);
        when(instituteRepository.findByIdForUpdate("inst-1")).thenReturn(Optional.of(institute));
        CommerceCheckoutSettingsService service = new CommerceCheckoutSettingsService(instituteRepository,
                settingWriter, mock(CommerceStorefrontSettings.class));
        controller = new CommerceCheckoutSettingsController(service, setupAccess);
        user = mock(CustomUserDetails.class);
        when(user.getUserId()).thenReturn("staff-1");
    }

    private JsonNode written() {
        ArgumentCaptor<JsonNode> entry = ArgumentCaptor.forClass(JsonNode.class);
        verify(settingWriter).putSettingKey(eq(institute), eq("COMMERCE_SETTING"), entry.capture(), any());
        return entry.getValue();
    }

    @Test
    void theStoreManagerWritesAndTheAccountantReads() {
        assertEquals(Set.of(CommerceRole.STORE_MANAGER), CommerceCheckoutSettingsController.WRITE);
        assertEquals(Set.of(CommerceRole.STORE_MANAGER, CommerceRole.ACCOUNTANT),
                CommerceCheckoutSettingsController.READ);
        doThrow(new CommerceAccessDeniedException(CommerceAccessDeniedException.FEATURE_DISABLED, "no"))
                .when(setupAccess).require(user, "inst-1", CommerceCheckoutSettingsController.WRITE);

        assertThrows(CommerceAccessDeniedException.class,
                () -> controller.update(JSON.createObjectNode(), "inst-1", user));
        verifyNoInteractions(instituteRepository, settingWriter);
    }

    @Test
    void aWriteChangesOnlyItsKeysAndKeepsEveryOtherOne() throws Exception {
        JsonNode body = JSON.readTree("""
                {"buyer_identity": "phone_otp", "otp_institute_hourly_cap": 500,
                 "cod": {"enabled": true, "max_order_value": 5000.00, "staff_confirm_threshold": 3000.00,
                         "max_open_orders_per_phone": 3, "max_refusals": 1}}
                """);

        Map<String, Object> answer = controller.update(body, "inst-1", user).getBody();

        verify(setupAccess).require(user, "inst-1", CommerceCheckoutSettingsController.WRITE);
        JsonNode entry = written();
        JsonNode data = entry.get("data");
        assertEquals("COMMERCE_SETTING", entry.get("key").asText());
        assertEquals("PHONE_OTP", data.get("buyerIdentity").asText());
        assertEquals(500, data.get("otp").get("instituteHourlyCap").asInt());
        assertEquals("kept", data.get("otp").get("other").asText());
        assertEquals(20, data.get("holdMinutes").asInt());
        assertEquals("hi", data.get("baseLocale").asText());
        assertTrue(data.get("botCheck").get("enabled").asBoolean());
        assertEquals(20, data.get("limits").get("adjustmentQuantity").asInt());
        assertEquals("190001", data.get("cod").get("blockedPincodes").get(0).asText());
        assertTrue(data.get("cod").get("enabled").asBoolean());
        assertEquals(3, data.get("cod").get("maxOpenOrdersPerPhone").asInt());
        assertEquals("PHONE_OTP", answer.get("buyer_identity"));
        assertEquals(500, answer.get("otp_institute_hourly_cap"));
    }

    @Test
    void aKeyLeftOutKeepsItsValue() throws Exception {
        controller.update(JSON.readTree("{\"buyer_identity\": \"EMAIL\"}"), "inst-1", user);

        JsonNode data = written().get("data");
        assertEquals("EMAIL", data.get("buyerIdentity").asText());
        assertEquals(4000, data.get("cod").get("maxOrderValue").asInt());
        assertTrue(data.get("otp").get("instituteHourlyCap") == null);
    }

    @Test
    void badValuesAre400AndNothingIsWritten() throws Exception {
        for (String body : new String[] {
                "{\"buyer_identity\": \"PHONE\"}",
                "{\"buyer_identity\": 1}",
                "{\"otp_institute_hourly_cap\": 9}",
                "{\"otp_institute_hourly_cap\": 2001}",
                "{\"otp_institute_hourly_cap\": 50.5}",
                "{\"cod\": {\"max_order_value\": 5000.01}}",
                "{\"cod\": {\"staff_confirm_threshold\": 4500}}",
                "{\"cod\": {\"max_order_value\": 0}}",
                "{\"cod\": {\"enabled\": \"yes\"}}",
                "{\"cod\": {\"max_open_orders_per_phone\": 0}}",
                "{\"cod\": {\"max_refusals\": 21}}",
                "{\"cod\": 1}",
                "[]"}) {
            assertThrows(InvalidRequestException.class, () -> controller.update(JSON.readTree(body), "inst-1", user),
                    body);
        }
        verify(settingWriter, never()).putSettingKey(any(), anyString(), any(), any());
    }

    @Test
    void anInstituteWithoutTheSettingGetsANewEntry() throws Exception {
        institute.setSetting(null);

        controller.update(JSON.readTree("{\"buyer_identity\": \"EITHER\"}"), "inst-1", user);

        JsonNode entry = written();
        assertEquals("COMMERCE_SETTING", entry.get("key").asText());
        assertEquals("EITHER", entry.get("data").get("buyerIdentity").asText());
    }

    @Test
    void theOrderDeskKeyIsWrittenUnderOrdersAndOnlyABooleanIsTaken() throws Exception {
        Map<String, Object> answer = controller.update(JSON.readTree(
                "{\"orders\": {\"refund_shipping_on_rto\": false}}"), "inst-1", user).getBody();
        JsonNode data = written().get("data");
        assertEquals(false, data.get("orders").get("refundShippingOnRto").asBoolean());
        assertEquals(4000, data.get("cod").get("maxOrderValue").asInt(), "other keys are kept");
        assertTrue(answer.containsKey("orders"));
        for (String body : new String[] {"{\"orders\": {\"refund_shipping_on_rto\": \"no\"}}",
                "{\"orders\": []}"}) {
            assertThrows(InvalidRequestException.class, () -> controller.update(JSON.readTree(body), "inst-1", user),
                    body);
        }
    }
}
