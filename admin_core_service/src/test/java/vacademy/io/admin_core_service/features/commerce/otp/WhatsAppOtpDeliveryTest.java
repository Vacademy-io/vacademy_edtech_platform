package vacademy.io.admin_core_service.features.commerce.otp;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.admin_core_service.features.notification.dto.NotificationTemplateConfigDTO;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendResponse;
import vacademy.io.admin_core_service.features.notification.dto.WhatsappRequest;
import vacademy.io.admin_core_service.features.notification.service.NotificationConfigService;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The delivery of a shop OTP: the institute's OTP template through the unified WhatsApp send,
 * with the code commerce made. The platform's OTP routes (which keep a code of their own in a
 * shared store) are not called at all.
 */
class WhatsAppOtpDeliveryTest {

    private NotificationConfigService config;
    private NotificationService notifications;
    private WhatsAppOtpDelivery delivery;

    @BeforeEach
    void setUp() {
        config = mock(NotificationConfigService.class);
        notifications = mock(NotificationService.class);
        delivery = new WhatsAppOtpDelivery(config, notifications, new ObjectMapper());
        when(notifications.sendWhatsappViaUnified(any(WhatsappRequest.class), eq("inst-1")))
                .thenReturn(UnifiedSendResponse.builder().total(1).accepted(1).status("COMPLETED").build());
    }

    private void template(String settingJson) {
        when(config.getTemplateConfigByEvent("OTP_REQUEST", "inst-1", "WHATSAPP")).thenReturn(
                NotificationTemplateConfigDTO.builder().templateName("shop_otp").languageCode("hi")
                        .settingJson(settingJson).build());
    }

    private WhatsappRequest sent() {
        ArgumentCaptor<WhatsappRequest> request = ArgumentCaptor.forClass(WhatsappRequest.class);
        verify(notifications).sendWhatsappViaUnified(request.capture(), eq("inst-1"));
        return request.getValue();
    }

    @Test
    void theCodeOfCommerceIsTheBodyAndTheButtonParameterOfTheInstitutesOtpTemplate() {
        template("{\"parameters\":{\"body\":[{\"source\":\"otp\"}],\"button\":[{\"source\":\"otp\"}]}}");

        delivery.send("inst-1", "919876543210", "482913");

        WhatsappRequest request = sent();
        assertEquals("shop_otp", request.getTemplateName());
        assertEquals("hi", request.getLanguageCode());
        assertEquals(Map.of("1", "482913"), request.getUserDetails().get(0).get("919876543210"));
        assertEquals("482913", request.getButtonUrlParams().get("919876543210"));
        assertEquals("0", request.getButtonIndexParams().get("919876543210"));
    }

    @Test
    void aBodyOnlyTemplateGetsNoButtonParameter() {
        template("{\"parameters\":{\"body\":[{\"source\":\"otp\"}]}}");

        delivery.send("inst-1", "919876543210", "482913");

        assertNull(sent().getButtonUrlParams());
        assertTrue(delivery.hasButtonParameter(null));
        assertTrue(delivery.hasButtonParameter("not json"));
        assertFalse(delivery.hasButtonParameter("{\"parameters\":{\"button\":[]}}"));
    }

    @Test
    void anInstituteWithoutAnOtpTemplateGetsNoCode() {
        when(config.getTemplateConfigByEvent("OTP_REQUEST", "inst-1", "WHATSAPP"))
                .thenThrow(new VacademyException("Notification template configuration not found"));

        CommerceOtpException refused = assertThrows(CommerceOtpException.class,
                () -> delivery.send("inst-1", "919876543210", "482913"));

        assertEquals(CommerceOtpException.UNAVAILABLE, refused.getCode());
        verifyNoInteractions(notifications);
    }

    @Test
    void aSendThatFailsOrIsNotAcceptedIsUnavailable_andTheMessageCarriesNeitherPhoneNorCode() {
        template(null);
        when(notifications.sendWhatsappViaUnified(any(WhatsappRequest.class), eq("inst-1")))
                .thenThrow(new IllegalStateException("failed for 919876543210 code 482913"))
                .thenReturn(UnifiedSendResponse.builder().total(1).accepted(0).failed(1).status("FAILED").build())
                .thenReturn(null);

        for (int i = 0; i < 3; i++) {
            CommerceOtpException refused = assertThrows(CommerceOtpException.class,
                    () -> delivery.send("inst-1", "919876543210", "482913"));
            assertEquals(CommerceOtpException.UNAVAILABLE, refused.getCode());
            assertFalse(refused.getMessage().contains("9876543210"));
            assertFalse(refused.getMessage().contains("482913"));
        }
    }
}
