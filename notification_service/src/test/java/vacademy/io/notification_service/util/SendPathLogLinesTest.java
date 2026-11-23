package vacademy.io.notification_service.util;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.CombotMessageProvider;
import vacademy.io.notification_service.features.external_communication_log.service.ExternalCommunicationLogService;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;
import vacademy.io.notification_service.service.WatiService;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The log lines on the send path of a WhatsApp or e-mail message show a recipient only masked,
 * and never a message's values (a name, a link meant for the recipient); the sends themselves are
 * unchanged.
 */
class SendPathLogLinesTest {

    private static final String PHONE = "919876543210";
    private static final String NAME = "Asha Verma";
    private static final String LINK = "https://shop.example.com/order#l=l1.cGF5bG9hZA.c2lnbmF0dXJl";

    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();
    private final List<Logger> loggers = new ArrayList<>();

    private void capture(Class<?>... types) {
        appender.start();
        for (Class<?> type : types) {
            Logger logger = (Logger) LoggerFactory.getLogger(type);
            logger.setLevel(Level.INFO);
            logger.addAppender(appender);
            loggers.add(logger);
        }
    }

    @AfterEach
    void release() {
        for (Logger logger : loggers) {
            logger.detachAppender(appender);
            logger.setLevel(null);
        }
    }

    private void assertNothingPrivateLogged() {
        assertFalse(appender.list.isEmpty(), "the send path still logs");
        for (ILoggingEvent e : appender.list) {
            String line = e.getFormattedMessage();
            for (String value : List.of(PHONE, "9876543210", NAME, LINK, "l1.cGF5bG9hZA")) {
                assertFalse(line.contains(value), "logged a private value: " + line);
            }
        }
    }

    @Test
    void aMetaWhatsAppSendLogsTheNumberMaskedAndStillSendsTheSamePayload() {
        capture(CombotMessageProvider.class);
        RestTemplate rest = mock(RestTemplate.class);
        when(rest.postForEntity(anyString(), any(), eq(String.class)))
                .thenReturn(ResponseEntity.ok("{\"messages\":[{\"id\":\"wamid.1\"}]}"));
        InstituteInternalService institutes = mock(InstituteInternalService.class);
        InstituteInfoDTO institute = new InstituteInfoDTO();
        institute.setSetting("{\"setting\":{\"WHATSAPP_SETTING\":{\"data\":{\"UTILITY_WHATSAPP\":"
                + "{\"provider\":\"META\",\"meta\":{\"access_token\":\"test-token\",\"appId\":\"1001\"}}}}}}");
        when(institutes.getInstituteByInstituteId("inst-1")).thenReturn(institute);
        CombotMessageProvider provider = new CombotMessageProvider(rest, new ObjectMapper(), institutes);

        String id = provider.sendText(PHONE, "Hello " + NAME + ", your order: " + LINK, "inst-1", null);

        assertEquals("wamid.1", id);
        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<HttpEntity<Map<String, Object>>> sent =
                org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        verify(rest).postForEntity(eq("https://graph.facebook.com/v22.0/1001/messages"), sent.capture(),
                eq(String.class));
        assertEquals(PHONE, sent.getValue().getBody().get("to"), "the number sent is the whole number");
        assertNothingPrivateLogged();
        assertTrue(appender.list.stream().anyMatch(e -> e.getFormattedMessage().contains("to=••••3210")));
    }

    @Test
    void aWatiSendLogsACountAndMaskedNumbersAndStillSendsTheSameRequest() {
        capture(WatiService.class);
        WatiService wati = new WatiService(mock(ExternalCommunicationLogService.class));
        RestTemplate rest = mock(RestTemplate.class);
        when(rest.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(String.class)))
                .thenReturn(ResponseEntity.ok("{\"result\":true}"));
        ReflectionTestUtils.setField(wati, "restTemplate", rest);

        List<Map<String, Boolean>> results = wati.sendTemplateMessages("order_shipped",
                List.of(Map.of(PHONE, Map.of("customer_name", NAME, "order_link", LINK))), "hi", "test-key",
                "https://wati.example.com", "Order");

        assertEquals(List.of(Map.of(PHONE, true)), results);
        @SuppressWarnings("unchecked")
        org.mockito.ArgumentCaptor<HttpEntity<String>> requests = org.mockito.ArgumentCaptor.forClass(HttpEntity.class);
        verify(rest, times(2)).exchange(anyString(), eq(HttpMethod.POST), requests.capture(), eq(String.class));
        String bulk = requests.getAllValues().get(1).getBody();
        assertTrue(bulk.contains(PHONE) && bulk.contains(NAME) && bulk.contains(LINK),
                "the request itself is unchanged: " + bulk);
        assertNothingPrivateLogged();
        assertTrue(appender.list.stream().anyMatch(e -> e.getFormattedMessage()
                .equals("WATI Bulk Request: template=order_shipped, receivers=1")));
    }

    @Test
    void theHtmlEmailLinesMaskTheAddress() throws Exception {
        String source = Files.readString(Path.of(
                "src/main/java/vacademy/io/notification_service/service/EmailService.java"));
        assertTrue(source.contains("logger.info(\"Sending HTML email to: {} using emailType: {} for service: {}\", "
                + "LogMask.email(to),"), "the send line");
        assertTrue(source.contains("logger.error(\"Failed to send HTML email to: {}\", LogMask.email(to), e);"),
                "the failure line");
        assertFalse(source.contains("\"Sending HTML email to: {} using emailType: {} for service: {}\", to,"));
    }
}
