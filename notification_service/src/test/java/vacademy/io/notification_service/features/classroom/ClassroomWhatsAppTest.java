package vacademy.io.notification_service.features.classroom;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import vacademy.io.notification_service.features.classroom.controller.ClassroomWhatsAppInternalController;
import vacademy.io.notification_service.features.classroom.dto.ClassroomWhatsAppRequest;
import vacademy.io.notification_service.features.classroom.service.ClassroomWhatsAppService;
import vacademy.io.notification_service.features.classroom.service.ClassroomWhatsAppService.Outcome;

import java.lang.reflect.Constructor;
import java.lang.reflect.Parameter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ClassroomWhatsAppTest {

    private static final String URL = "/notification-service/internal/v1/classroom/whatsapp-summary";

    /** Records every send instead of calling Meta. */
    static final class Recorder implements ClassroomWhatsAppService.TemplateSender {
        final List<List<String>> params = new ArrayList<>();
        final List<String> templates = new ArrayList<>();
        final List<String> phones = new ArrayList<>();
        boolean accept = true;

        @Override
        public boolean send(String phoneNumberId, String accessToken, String phone, String templateName,
                            String languageCode, List<String> bodyParams) {
            phones.add(phone);
            templates.add(templateName);
            params.add(bodyParams);
            return accept;
        }
    }

    private static ClassroomWhatsAppService service(boolean enabled, String alertsTemplate, Recorder r) {
        return new ClassroomWhatsAppService(enabled, "weekly_tpl", alertsTemplate, "en", "token", "pnid", r);
    }

    private static ClassroomWhatsAppRequest weekly(String phone) {
        return new ClassroomWhatsAppRequest("WEEKLY_SUMMARY", phone, "Green Valley\nSchool",
                Map.of("hours", "31.2", "rooms_used", "17", "rooms_total", "20", "idle_rooms", "3",
                        "link", "https://console.example.test/settings?selectedTab=classroomPanels&view=usage"));
    }

    @Test
    void offByDefault() throws Exception {
        Constructor<?> ctor = null;
        for (Constructor<?> c : ClassroomWhatsAppService.class.getConstructors()) {
            if (c.isAnnotationPresent(org.springframework.beans.factory.annotation.Autowired.class)) ctor = c;
        }
        boolean found = false;
        for (Parameter p : ctor.getParameters()) {
            Value v = p.getAnnotation(Value.class);
            if (v != null && v.value().startsWith("${classroom.whatsapp.enabled")) {
                assertEquals("${classroom.whatsapp.enabled:false}", v.value());
                found = true;
            }
        }
        assertTrue(found);
    }

    @Test
    void whileOffNothingIsSentAndTheEndpointAnswers404() throws Exception {
        Recorder r = new Recorder();
        ClassroomWhatsAppService svc = service(false, "", r);
        assertEquals(Outcome.DISABLED, svc.send(weekly("+91 98765 43210")));
        assertTrue(r.params.isEmpty());

        MockMvc mvc = MockMvcBuilders.standaloneSetup(new ClassroomWhatsAppInternalController(svc)).build();
        mvc.perform(post(URL).contentType(MediaType.APPLICATION_JSON).content("{\"phone\":\"+919876543210\"}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("FEATURE_OFF"));
        assertTrue(r.params.isEmpty());
    }

    @Test
    void weeklySummarySendsTheTemplateParametersInOrder() {
        Recorder r = new Recorder();
        assertEquals(Outcome.SENT, service(true, "", r).send(weekly("+91 98765-43210")));
        assertEquals(List.of("weekly_tpl"), r.templates);
        assertEquals(List.of("919876543210"), r.phones);
        assertEquals(List.of("Green Valley School", "31.2", "17", "20", "3",
                "https://console.example.test/settings?selectedTab=classroomPanels&view=usage"), r.params.get(0));
    }

    @Test
    void alertsNeedTheirOwnTemplate() {
        Recorder r = new Recorder();
        ClassroomWhatsAppRequest alerts = new ClassroomWhatsAppRequest("alerts", "+919876543210", "School",
                Map.of("alert_count", "2", "link", "https://console.example.test/x"));
        assertEquals(Outcome.NOT_CONFIGURED, service(true, "", r).send(alerts));
        assertTrue(r.params.isEmpty());

        assertEquals(Outcome.SENT, service(true, "alerts_tpl", r).send(alerts));
        assertEquals(List.of("School", "2", "https://console.example.test/x"), r.params.get(0));
    }

    @Test
    void badInputIsRefusedBeforeAnySend() {
        Recorder r = new Recorder();
        ClassroomWhatsAppService svc = service(true, "", r);
        assertEquals(Outcome.INVALID, svc.send(null));
        assertEquals(Outcome.INVALID, svc.send(weekly(null)));
        assertEquals(Outcome.INVALID, svc.send(weekly("call me")));
        assertEquals(Outcome.INVALID, svc.send(weekly("123")));
        // A national number with a trunk 0 has no country code; it is refused, not guessed.
        assertEquals(Outcome.INVALID, svc.send(weekly("09876543210")));
        assertEquals(Outcome.INVALID, svc.send(weekly("+0 98765 43210")));
        assertEquals(Outcome.INVALID, svc.send(new ClassroomWhatsAppRequest("OTHER", "+919876543210", "S", Map.of())));
        assertTrue(r.params.isEmpty());
    }

    @Test
    void missingCredentialsAreNotConfigured() {
        Recorder r = new Recorder();
        ClassroomWhatsAppService svc = new ClassroomWhatsAppService(true, "weekly_tpl", "", "en", "", "", r);
        assertEquals(Outcome.NOT_CONFIGURED, svc.send(weekly("+919876543210")));
        assertTrue(r.params.isEmpty());
    }

    @Test
    void aRejectedOrThrowingSendIsAFailureAnd502() throws Exception {
        Recorder r = new Recorder();
        r.accept = false;
        ClassroomWhatsAppService svc = service(true, "", r);
        assertEquals(Outcome.FAILED, svc.send(weekly("+919876543210")));

        ClassroomWhatsAppService throwing = new ClassroomWhatsAppService(true, "weekly_tpl", "", "en", "t", "p",
                (a, b, c, d, e, f) -> {
                    throw new IllegalStateException("network");
                });
        assertEquals(Outcome.FAILED, throwing.send(weekly("+919876543210")));

        MockMvc mvc = MockMvcBuilders.standaloneSetup(new ClassroomWhatsAppInternalController(svc)).build();
        mvc.perform(post(URL).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"kind\":\"WEEKLY_SUMMARY\",\"phone\":\"+919876543210\",\"variables\":{}}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("SEND_FAILED"));
    }

    @Test
    void theEndpointSendsAndReadsSnakeCase() throws Exception {
        Recorder r = new Recorder();
        MockMvc mvc = MockMvcBuilders.standaloneSetup(
                new ClassroomWhatsAppInternalController(service(true, "", r))).build();
        mvc.perform(post(URL).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"phone\":\"+919876543210\",\"institute_name\":\"Oak School\","
                                + "\"variables\":{\"hours\":\"5\"},\"extra\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SENT"));
        assertEquals("Oak School", r.params.get(0).get(0));
        assertEquals("5", r.params.get(0).get(1));
        assertEquals("0", r.params.get(0).get(2));
        assertEquals("-", r.params.get(0).get(5));
    }

    @Test
    void theRequestNeverPrintsThePhoneNumber() {
        String s = weekly("+919876543210").toString();
        assertFalse(s.contains("9876543210"));
        assertTrue(s.contains("phone=present"));
    }

    @Test
    void paramsAreOneBoundedLine() {
        String longValue = "x".repeat(500);
        ClassroomWhatsAppRequest req = new ClassroomWhatsAppRequest(null, "+919876543210", longValue,
                Map.of("hours", "  1\t\n2  "));
        Recorder r = new Recorder();
        assertEquals(Outcome.SENT, service(true, "", r).send(req)); // kind defaults to WEEKLY_SUMMARY
        assertEquals(200, r.params.get(0).get(0).length());
        assertEquals("1 2", r.params.get(0).get(1));
    }
}
