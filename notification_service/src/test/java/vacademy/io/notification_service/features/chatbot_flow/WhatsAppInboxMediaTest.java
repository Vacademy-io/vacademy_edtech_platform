package vacademy.io.notification_service.features.chatbot_flow;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.server.ResponseStatusException;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxMessageDTO;
import vacademy.io.notification_service.features.chatbot_flow.dto.InboxSendRequest;
import vacademy.io.notification_service.features.chatbot_flow.dto.SessionWindowDTO;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.ChatbotMessageProvider;
import vacademy.io.notification_service.features.chatbot_flow.service.ChatbotEscalationService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppInboxService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppMediaPolicy;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppSendFailureService;
import vacademy.io.notification_service.features.chatbot_flow.service.WhatsAppTemplateRenderer;
import vacademy.io.notification_service.features.combot.entity.ChannelToInstituteMapping;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.entity.NotificationLog;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Sending an image or video from the WhatsApp Inbox.
 * <p>
 * Meta allows free-form media inside the 24-hour customer service window with no template and no
 * approval — these pin the three things that decision depends on: the window is measured from the
 * learner's last INBOUND message (and "we have no inbound on record" is not the same as "closed"),
 * the media itself has to satisfy Meta's per-type rules before a provider ever sees it, and the
 * sent attachment survives on the log row so a reloaded thread still shows the photo.
 */
class WhatsAppInboxMediaTest {

    private static final String INSTITUTE = "inst-1";
    private static final String PHONE = "919876543210";
    /**
     * TEST-NET-3 (RFC 5737) literal, not a hostname: the media policy resolves the host to check it
     * is not an internal address, and an IP literal keeps these tests off the resolver entirely.
     */
    private static final String IMAGE_URL = "https://203.0.113.10/uploads/report.png";

    private NotificationLogRepository logRepository;
    private ChannelToInstituteMappingRepository channelRepository;
    private WhatsAppTemplateRenderer renderer;
    private ChatbotEscalationService escalationService;
    private WhatsAppSendFailureService failureService;
    private WhatsAppMediaPolicy mediaPolicy;
    private ChatbotMessageProvider provider;
    private WhatsAppInboxService service;

    @BeforeEach
    void setUp() {
        logRepository = mock(NotificationLogRepository.class);
        channelRepository = mock(ChannelToInstituteMappingRepository.class);
        renderer = mock(WhatsAppTemplateRenderer.class);
        escalationService = mock(ChatbotEscalationService.class);
        failureService = mock(WhatsAppSendFailureService.class);
        provider = mock(ChatbotMessageProvider.class);

        // Real validation rules, but no network: checkSize probes the media host over HTTP.
        mediaPolicy = spy(new WhatsAppMediaPolicy());
        doNothing().when(mediaPolicy).checkSize(any());

        when(provider.supports(anyString())).thenReturn(true);
        when(renderer.newCache()).thenReturn(new HashMap<>());

        ChannelToInstituteMapping mapping = new ChannelToInstituteMapping();
        mapping.setChannelId("channel-1");
        mapping.setChannelType("WHATSAPP_WATI");
        when(channelRepository.findAllByInstituteId(INSTITUTE)).thenReturn(List.of(mapping));

        when(logRepository.save(any(NotificationLog.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));

        service = new WhatsAppInboxService(logRepository, channelRepository, renderer,
                escalationService, failureService, mediaPolicy, new ObjectMapper(), List.of(provider));
    }

    private void lastInboundAt(Instant when) {
        when(logRepository.findTopByChannelIdAndInstituteIdAndNotificationTypeOrderByNotificationDateDesc(
                PHONE, INSTITUTE, "WHATSAPP_MESSAGE_INCOMING"))
                .thenReturn(when == null ? Optional.empty() : Optional.of(logRow(when)));
    }

    private NotificationLog logRow(Instant when) {
        NotificationLog row = new NotificationLog();
        row.setNotificationDate(when);
        return row;
    }

    private InboxSendRequest imageRequest() {
        return InboxSendRequest.builder()
                .phone(PHONE)
                .instituteId(INSTITUTE)
                .text("Here is your report")
                .mediaType("image")
                .mediaUrl(IMAGE_URL)
                .build();
    }

    // ==================== The window ====================

    @Test
    @DisplayName("an image goes out while the learner's last message is inside 24h")
    void sendsMediaInsideWindow() {
        lastInboundAt(Instant.now().minus(Duration.ofHours(2)));
        when(provider.sendMedia(anyString(), anyString(), anyString(), any(), any(), anyString(), anyString()))
                .thenReturn("wamid.ABC");

        InboxMessageDTO sent = service.sendMediaReply(imageRequest());

        verify(provider).sendMedia(PHONE, "image", IMAGE_URL, "Here is your report",
                "report.png", INSTITUTE, "channel-1");
        assertThat(sent.getMediaType()).isEqualTo("image");
        assertThat(sent.getMediaUrl()).isEqualTo(IMAGE_URL);
        assertThat(sent.getDirection()).isEqualTo("OUTGOING");
    }

    @Test
    @DisplayName("the window closes 24h after the last inbound message, and nothing is sent")
    void refusesOutsideWindow() {
        lastInboundAt(Instant.now().minus(Duration.ofHours(30)));

        assertThatThrownBy(() -> service.sendMediaReply(imageRequest()))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("24-hour")
                .hasMessageContaining("30 hours ago");

        verify(provider, never()).sendMedia(anyString(), anyString(), anyString(), any(), any(),
                anyString(), anyString());
    }

    @Test
    @DisplayName("no inbound message on record is unknown, not closed — Meta gets to decide")
    void attemptsSendWhenWindowUnknown() {
        lastInboundAt(null);

        service.sendMediaReply(imageRequest());

        verify(provider).sendMedia(eq(PHONE), eq("image"), eq(IMAGE_URL), any(), any(),
                eq(INSTITUTE), anyString());
    }

    @Test
    @DisplayName("force overrides a closed window — 72h ad conversations and missed webhooks")
    void forceOverridesClosedWindow() {
        lastInboundAt(Instant.now().minus(Duration.ofHours(48)));

        InboxSendRequest request = imageRequest();
        request.setForce(true);
        service.sendMediaReply(request);

        verify(provider).sendMedia(eq(PHONE), eq("image"), eq(IMAGE_URL), any(), any(),
                eq(INSTITUTE), anyString());
    }

    @Test
    @DisplayName("sessionWindow reports the deadline the UI counts down to")
    void reportsWindowDeadline() {
        Instant lastInbound = Instant.now().minus(Duration.ofHours(4));
        lastInboundAt(lastInbound);

        SessionWindowDTO window = service.sessionWindow(PHONE, INSTITUTE);

        assertThat(window.isOpen()).isTrue();
        assertThat(window.isUnknown()).isFalse();
        assertThat(window.getExpiresAt()).isEqualTo(lastInbound.plus(Duration.ofHours(24)));
        assertThat(window.getMinutesRemaining()).isBetween(1190L, 1200L);
    }

    @Test
    @DisplayName("an unknown window is never reported as open")
    void unknownWindowIsNotOpen() {
        lastInboundAt(null);

        SessionWindowDTO window = service.sessionWindow(PHONE, INSTITUTE);

        assertThat(window.isUnknown()).isTrue();
        assertThat(window.isOpen()).isFalse();
        assertThat(window.getExpiresAt()).isNull();
    }

    // ==================== The log row ====================

    @Test
    @DisplayName("the sent attachment survives on the row, so a reloaded thread still shows the photo")
    void storesMediaOnTheLogRow() {
        lastInboundAt(Instant.now().minus(Duration.ofMinutes(5)));
        when(provider.sendMedia(anyString(), anyString(), anyString(), any(), any(), anyString(), anyString()))
                .thenReturn("wamid.XYZ");

        service.sendMediaReply(imageRequest());

        ArgumentCaptor<NotificationLog> saved = ArgumentCaptor.forClass(NotificationLog.class);
        verify(logRepository).save(saved.capture());
        NotificationLog row = saved.getValue();

        assertThat(row.getNotificationType()).isEqualTo("WHATSAPP_MESSAGE_OUTGOING");
        assertThat(row.getSource()).isEqualTo("INBOX");
        // wamid on source_id is what lets the delivered/read webhooks join THIS message.
        assertThat(row.getSourceId()).isEqualTo("wamid.XYZ");
        assertThat(row.getMessagePayload()).contains("\"mediaUrl\":\"" + IMAGE_URL + "\"");
        assertThat(row.getMessagePayload()).contains("\"mediaType\":\"image\"");
        assertThat(row.getBody()).isEqualTo("Here is your report");
    }

    @Test
    @DisplayName("a caption-less image still reads as something in the conversation list")
    void captionlessImageGetsAPlaceholderBody() {
        lastInboundAt(Instant.now().minus(Duration.ofMinutes(5)));
        InboxSendRequest request = imageRequest();
        request.setText(null);

        service.sendMediaReply(request);

        ArgumentCaptor<NotificationLog> saved = ArgumentCaptor.forClass(NotificationLog.class);
        verify(logRepository).save(saved.capture());
        assertThat(saved.getValue().getBody()).isEqualTo("📷 Photo");
    }

    @Test
    @DisplayName("a refused media send stays in the thread, carrying the attachment it tried to send")
    void logsFailureWithTheAttachment() {
        lastInboundAt(Instant.now().minus(Duration.ofMinutes(5)));
        doThrow(new RuntimeException("WATI sendSessionFile result=false: out of credits"))
                .when(provider).sendMedia(anyString(), anyString(), anyString(), any(), any(),
                        anyString(), anyString());

        assertThatThrownBy(() -> service.sendMediaReply(imageRequest()))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("out of credits");

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> extra = ArgumentCaptor.forClass(Map.class);
        verify(failureService).logFailure(eq(INSTITUTE), eq(PHONE), eq("channel-1"), isNull(),
                eq("image"), anyString(), eq("INBOX"), anyString(), extra.capture());
        assertThat(extra.getValue()).containsEntry("mediaUrl", IMAGE_URL);
        verify(logRepository, never()).save(any(NotificationLog.class));
    }

    @Test
    @DisplayName("a stored media row comes back as media when the thread is reloaded")
    void surfacesMediaWhenReadingTheThread() {
        NotificationLog row = new NotificationLog();
        row.setId("log-1");
        row.setNotificationType("WHATSAPP_MESSAGE_OUTGOING");
        row.setChannelId(PHONE);
        row.setBody("Here is your report");
        row.setNotificationDate(Instant.now());
        row.setMessagePayload("{\"mediaType\":\"image\",\"mediaUrl\":\"" + IMAGE_URL
                + "\",\"filename\":\"report.png\"}");
        when(logRepository.findMessagesForPhone(eq(PHONE), eq(INSTITUTE), any(), eq(50)))
                .thenReturn(List.of(row));

        List<InboxMessageDTO> messages = service.getMessages(PHONE, INSTITUTE, null, 50);

        assertThat(messages).hasSize(1);
        assertThat(messages.get(0).getMediaUrl()).isEqualTo(IMAGE_URL);
        assertThat(messages.get(0).getMediaType()).isEqualTo("image");
        assertThat(messages.get(0).getMediaFilename()).isEqualTo("report.png");
    }

    // ==================== Meta's media rules ====================

    @Test
    @DisplayName("only the types WhatsApp actually accepts get through")
    void rejectsUnsupportedMediaType() {
        assertThatThrownBy(() -> mediaPolicy.validate("gif", IMAGE_URL, null, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Unsupported media type");
    }

    @Test
    @DisplayName("WhatsApp downloads the file itself, so the URL has to be a public link")
    void rejectsNonHttpUrl() {
        assertThatThrownBy(() -> mediaPolicy.validate("image", "s3://bucket/key.png", null, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("public http(s) link");
    }

    @Test
    @DisplayName("a caption over Meta's 1024 limit is refused before the send, not after")
    void rejectsOverlongCaption() {
        String caption = "x".repeat(1025);
        assertThatThrownBy(() -> mediaPolicy.validate("image", IMAGE_URL, caption, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("Caption is too long");
    }

    @Test
    @DisplayName("audio bubbles have no caption in WhatsApp, so the caption is dropped")
    void dropsCaptionOnAudio() {
        WhatsAppMediaPolicy.Media media =
                mediaPolicy.validate("Audio", "https://203.0.113.10/a/voice.mp3", "listen", null);

        assertThat(media.type()).isEqualTo("audio");
        assertThat(media.caption()).isNull();
    }

    @Test
    @DisplayName("a URL pointing back inside our own network is refused")
    void rejectsInternalMediaUrl() {
        // /send needs no JWT and the WATI path fetches the URL from this service, so an internal
        // address here would deliver our own network's responses to any phone number.
        assertThatThrownBy(() -> mediaPolicy.validate("image", "http://169.254.169.254/latest/meta-data/", null, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("must be a public link");

        assertThatThrownBy(() -> mediaPolicy.validate("image", "http://10.0.0.5/private.png", null, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("must be a public link");

        assertThatThrownBy(() -> mediaPolicy.validate("image", "http://127.0.0.1:8080/actuator/env", null, null))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("must be a public link");
    }

    @Test
    @DisplayName("a URL with no extension still gets one — WATI reads the media type off the filename")
    void derivesFilenameExtensionForWati() {
        WhatsAppMediaPolicy.Media video =
                mediaPolicy.validate("video", "https://203.0.113.10/files/9f3c1a", null, null);
        assertThat(video.filename()).isEqualTo("9f3c1a.mp4");

        WhatsAppMediaPolicy.Media image =
                mediaPolicy.validate("image", IMAGE_URL + "?sig=abc123", null, null);
        assertThat(image.filename()).isEqualTo("report.png");
    }
}
