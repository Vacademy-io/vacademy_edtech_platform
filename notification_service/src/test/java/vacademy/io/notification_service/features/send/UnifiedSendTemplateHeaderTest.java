package vacademy.io.notification_service.features.send;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.announcements.service.UserAnnouncementPreferenceService;
import vacademy.io.notification_service.features.chatbot_flow.entity.NotificationTemplate;
import vacademy.io.notification_service.features.chatbot_flow.repository.NotificationTemplateRepository;
import vacademy.io.notification_service.features.firebase_notifications.service.PushNotificationService;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.features.send.dto.UnifiedSendRequest;
import vacademy.io.notification_service.features.send.dto.UnifiedSendResponse;
import vacademy.io.notification_service.features.send.repository.SendBatchRepository;
import vacademy.io.notification_service.features.send.service.BatchProcessorService;
import vacademy.io.notification_service.features.send.service.EmailCcResolver;
import vacademy.io.notification_service.features.send.service.UnifiedSendService;
import vacademy.io.notification_service.service.EmailService;
import vacademy.io.notification_service.service.WhatsAppService;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * A template approved with a media header must go to the provider WITH that header component —
 * Meta rejects it otherwise (#132012 "header: Format mismatch, expected DOCUMENT, received
 * UNKNOWN"). The Inbox composer, automations and chatbot hand-offs only know the template name,
 * so the unified send path defaults the header to the file the template was approved with.
 */
class UnifiedSendTemplateHeaderTest {

    private static final String INSTITUTE = "inst-1";
    private static final String TEMPLATE = "missed_on_reply_messages__interested_candidates";
    private static final String BROCHURE =
            "https://cdn.example.com/ADMIN_PUBLIC_UPLOAD/63a5262b-f5e4-4de6-990e-d3296ca5012b-HCCA_Updated_Brochure_1.pdf";

    private WhatsAppService whatsAppService;
    private NotificationTemplateRepository templateRepository;
    private UnifiedSendService service;

    @BeforeEach
    void setUp() {
        whatsAppService = mock(WhatsAppService.class);
        templateRepository = mock(NotificationTemplateRepository.class);
        service = new UnifiedSendService(
                whatsAppService,
                mock(EmailService.class),
                mock(PushNotificationService.class),
                mock(SendBatchRepository.class),
                new ObjectMapper(),
                mock(BatchProcessorService.class),
                templateRepository,
                mock(UserAnnouncementPreferenceService.class),
                mock(EmailCcResolver.class),
                mock(NotificationLogRepository.class));

        when(whatsAppService.sendWhatsappMessagesDetailed(anyString(), any(), any(), any(), any(), any(),
                anyString(), any(), anyString(), any(), any(), any()))
                .thenReturn(List.of(new WhatsAppService.WhatsAppSendResult("917999873846", true, null, "wamid.1")));
    }

    private void storedTemplate(String headerType, String sampleUrl) {
        NotificationTemplate tpl = new NotificationTemplate();
        tpl.setInstituteId(INSTITUTE);
        tpl.setName(TEMPLATE);
        tpl.setLanguage("en");
        tpl.setHeaderType(headerType);
        tpl.setHeaderSampleUrl(sampleUrl);
        when(templateRepository.findByInstituteIdAndNameAndLanguage(INSTITUTE, TEMPLATE, "en"))
                .thenReturn(Optional.of(tpl));
    }

    private UnifiedSendRequest request(UnifiedSendRequest.SendOptions options) {
        return UnifiedSendRequest.builder()
                .instituteId(INSTITUTE)
                .channel("WHATSAPP")
                .templateName(TEMPLATE)
                .languageCode("en")
                .recipients(List.of(UnifiedSendRequest.Recipient.builder().phone("917999873846").build()))
                .options(options)
                .build();
    }

    @SuppressWarnings("unchecked")
    private ArgumentCaptor<Map<String, Map<String, String>>> headerParamsCaptor() {
        return ArgumentCaptor.forClass(Map.class);
    }

    @Test
    @DisplayName("DOCUMENT template sent with no header → header defaults to the approved sample file")
    void documentHeaderDefaultsToTemplateSample() {
        storedTemplate("DOCUMENT", BROCHURE);

        UnifiedSendResponse response = service.send(request(
                UnifiedSendRequest.SendOptions.builder().source("inbox-template-send").build()));

        assertThat(response.getAccepted()).isEqualTo(1);
        ArgumentCaptor<Map<String, Map<String, String>>> headers = headerParamsCaptor();
        ArgumentCaptor<String> headerType = ArgumentCaptor.forClass(String.class);
        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), headers.capture(),
                any(), any(), any(), eq("en"), headerType.capture(), eq(INSTITUTE), any(), any(), any());
        assertThat(headers.getValue()).containsEntry("917999873846", Map.of("link", BROCHURE));
        assertThat(headerType.getValue()).isEqualTo("document");
    }

    @Test
    @DisplayName("an explicit header from the caller still wins over the template sample")
    void explicitHeaderWins() {
        storedTemplate("DOCUMENT", BROCHURE);
        String custom = "https://cdn.example.com/custom-syllabus.pdf";

        service.send(request(UnifiedSendRequest.SendOptions.builder()
                .headerType("document").headerUrl(custom).build()));

        ArgumentCaptor<Map<String, Map<String, String>>> headers = headerParamsCaptor();
        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), headers.capture(),
                any(), any(), any(), eq("en"), eq("document"), eq(INSTITUTE), any(), any(), any());
        assertThat(headers.getValue()).containsEntry("917999873846", Map.of("link", custom));
    }

    @Test
    @DisplayName("VIDEO template routes the sample through the video header params")
    void videoHeaderDefaultsToTemplateSample() {
        String clip = "https://cdn.example.com/intro.mp4";
        storedTemplate("VIDEO", clip);

        service.send(request(null));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, String>> video = ArgumentCaptor.forClass(Map.class);
        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), eq(null),
                video.capture(), any(), any(), eq("en"), eq("video"), eq(INSTITUTE), any(), any(), any());
        assertThat(video.getValue()).containsEntry("917999873846", clip);
    }

    @Test
    @DisplayName("TEXT / NONE headers need no file, so nothing is invented")
    void textHeaderSendsNoHeaderComponent() {
        storedTemplate("TEXT", null);

        service.send(request(null));

        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), eq(null),
                eq(null), any(), any(), eq("en"), eq(null), eq(INSTITUTE), any(), any(), any());
    }

    @Test
    @DisplayName("DOCUMENT template with no sample on record → send goes out as the caller shaped it")
    void documentHeaderWithoutSampleIsUnchanged() {
        storedTemplate("DOCUMENT", "  ");

        service.send(request(null));

        // Nothing to fall back to: the provider gets the header type but no file, and reports
        // the mismatch itself — same as before, just not silently.
        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), eq(null),
                eq(null), any(), any(), eq("en"), eq("document"), eq(INSTITUTE), any(), any(), any());
    }

    @Test
    @DisplayName("a sample that is not an http(s) URL is never handed to the provider")
    void nonUrlSampleIsIgnored() {
        storedTemplate("IMAGE", "<a href=\"https://ibb.co/x\"><img src=\"https://i.ibb.co/x.png\"></a>");

        service.send(request(null));

        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), eq(null),
                eq(null), any(), any(), eq("en"), eq("image"), eq(INSTITUTE), any(), any(), any());
    }

    @Test
    @DisplayName("per-recipient _headerUrl beats both the request option and the template sample")
    void perRecipientHeaderWinsOverEverything() {
        storedTemplate("DOCUMENT", BROCHURE);
        String perLead = "https://cdn.example.com/lead-specific.pdf";
        UnifiedSendRequest req = request(UnifiedSendRequest.SendOptions.builder()
                .headerType("document").headerUrl("https://cdn.example.com/global.pdf").build());
        req.setRecipients(List.of(UnifiedSendRequest.Recipient.builder()
                .phone("917999873846").variables(Map.of("_headerUrl", perLead)).build()));

        service.send(req);

        ArgumentCaptor<Map<String, Map<String, String>>> headers = headerParamsCaptor();
        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), headers.capture(),
                any(), any(), any(), eq("en"), eq("document"), eq(INSTITUTE), any(), any(), any());
        assertThat(headers.getValue()).containsEntry("917999873846", Map.of("link", perLead));
    }

    @Test
    @DisplayName("body variables are still resolved and passed through unchanged")
    void bodyVariablesUnaffected() {
        NotificationTemplate tpl = new NotificationTemplate();
        tpl.setInstituteId(INSTITUTE);
        tpl.setName(TEMPLATE);
        tpl.setLanguage("en");
        tpl.setHeaderType("NONE");
        tpl.setBodyVariableNames("[\"name\",\"course\"]");
        when(templateRepository.findByInstituteIdAndNameAndLanguage(INSTITUTE, TEMPLATE, "en"))
                .thenReturn(Optional.of(tpl));
        UnifiedSendRequest req = request(null);
        req.setRecipients(List.of(UnifiedSendRequest.Recipient.builder()
                .phone("917999873846").variables(Map.of("name", "Asha", "course", "SAP HCM")).build()));

        service.send(req);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Map<String, Map<String, String>>>> body = ArgumentCaptor.forClass(List.class);
        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), body.capture(), eq(null),
                eq(null), any(), any(), eq("en"), eq(null), eq(INSTITUTE), any(), any(), any());
        assertThat(body.getValue()).hasSize(1);
        assertThat(body.getValue().get(0).get("917999873846"))
                .containsEntry("1", "Asha").containsEntry("2", "SAP HCM")
                .doesNotContainKey("_headerUrl");
    }

    @Test
    @DisplayName("unknown template → no lookup-driven changes at all")
    void unknownTemplateIsPassedThrough() {
        when(templateRepository.findByInstituteIdAndNameAndLanguage(INSTITUTE, TEMPLATE, "en"))
                .thenReturn(Optional.empty());

        service.send(request(null));

        verify(whatsAppService).sendWhatsappMessagesDetailed(eq(TEMPLATE), any(), eq(null),
                eq(null), any(), any(), eq("en"), eq(null), eq(INSTITUTE), any(), any(), any());
    }
}
