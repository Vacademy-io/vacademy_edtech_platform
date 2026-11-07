package vacademy.io.admin_core_service.features.product_config.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import vacademy.io.admin_core_service.features.notification.dto.UnifiedSendRequest;
import vacademy.io.admin_core_service.features.notification_service.service.NotificationService;
import vacademy.io.admin_core_service.features.product_config.dto.AlertResultDTO;
import vacademy.io.admin_core_service.features.product_config.dto.ProductSettingsDTO;
import vacademy.io.admin_core_service.features.product_config.dto.SignupEventDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ProductAlertServiceTest {

    @Mock PlatformProductService products;
    @Mock PlatformWhatsAppClient whatsApp;
    @Mock NotificationService notifications;
    @InjectMocks ProductAlertService service;

    private ProductSettingsDTO product;
    private final SignupEventDTO event = SignupEventDTO.builder().instituteId("i1").instituteName("Sun\nrise <b>School</b>")
            .fullName("A Teacher").email("a@s.in").phone("919876543210").method("Email OTP").trialEnds("8 Nov 2026").build();

    @BeforeEach
    void setUp() {
        product = ProductSettingsDTO.builder().productKey("evalezy").displayName("Evalezy")
                .fromEmail("hello@evalezy.com").fromName("Evalezy")
                .signupAlertEmails("one@x.com, two@x.com").signupAlertWhatsapp("919000000001,919000000002").build();
        lenient().when(products.get("evalezy")).thenReturn(product);
    }

    @Test
    void everyRecipientGetsOneAndTheResultSaysSo() {
        when(whatsApp.sendTemplate(anyString(), anyString(), anyString(), anyList())).thenReturn(null);
        AlertResultDTO result = service.signupCompleted("evalezy", event);
        assertEquals(4, result.getDeliveries().size());
        assertTrue(result.getDeliveries().stream().allMatch(AlertResultDTO.Delivery::isSent));
        verify(notifications, times(2)).sendUnified(any());
        verify(whatsApp).sendTemplate(eq("919000000001"), eq("product_signup_alert"), eq("en"), anyList());
    }

    @Test
    void theMailEscapesWhatThePublicFormTyped() {
        product.setSignupAlertWhatsapp(null);
        service.signupCompleted("evalezy", event);
        ArgumentCaptor<UnifiedSendRequest> mail = ArgumentCaptor.forClass(UnifiedSendRequest.class);
        verify(notifications, times(2)).sendUnified(mail.capture());
        String body = mail.getValue().getOptions().getEmailBody();
        assertFalse(body.contains("<b>School"), body);
        assertTrue(body.contains("&lt;b&gt;School"), body);
        assertFalse(mail.getValue().getOptions().getEmailSubject().contains("\n"));
        assertEquals("hello@evalezy.com", mail.getValue().getOptions().getFromEmail());
    }

    @Test
    void whatsAppVariablesAreSevenAndNeverBlankOrMultiline() {
        List<String> variables = ProductAlertService.variables(product, SignupEventDTO.builder()
                .fullName("  ").instituteName("Sun\n\trise    School").build());
        assertEquals(ProductAlertService.VARIABLE_COUNT, variables.size());
        assertEquals("-", variables.get(1));
        assertEquals("Sun rise School", variables.get(2));
        assertTrue(variables.stream().noneMatch(String::isBlank));
    }

    @Test
    void oneFailureNeverStopsTheOthersOrThrows() {
        doThrow(new RuntimeException("smtp")).when(notifications).sendUnified(any());
        when(whatsApp.sendTemplate(eq("919000000001"), anyString(), anyString(), anyList())).thenReturn("Template not approved");
        when(whatsApp.sendTemplate(eq("919000000002"), anyString(), anyString(), anyList())).thenThrow(new RuntimeException("net"));
        AlertResultDTO result = service.signupCompleted("evalezy", event);
        assertEquals(4, result.getDeliveries().size());
        assertTrue(result.getDeliveries().stream().noneMatch(AlertResultDTO.Delivery::isSent));
        assertEquals("Template not approved", result.getDeliveries().get(2).getError());
    }

    @Test
    void noRecipientsSendNothing() {
        product.setSignupAlertEmails(null);
        product.setSignupAlertWhatsapp(" ");
        assertTrue(service.signupCompleted("evalezy", event).getDeliveries().isEmpty());
        verifyNoInteractions(notifications, whatsApp);
    }

    @Test
    void aTemplateMustUseEveryVariable() {
        ProductAlertService.requireAllVariables(ProductAlertService.DEFAULT_BODY);
        assertThrows(VacademyException.class, () -> ProductAlertService.requireAllVariables("New {{1}} sign-up"));
        assertThrows(VacademyException.class, () -> ProductAlertService.requireAllVariables(
                ProductAlertService.DEFAULT_BODY + " {{8}}"));
    }

    @Test
    void registeringNeedsTheBusinessAccountId() {
        assertThrows(VacademyException.class, () -> service.registerTemplate("evalezy", null));
        verifyNoInteractions(whatsApp);
    }
}
