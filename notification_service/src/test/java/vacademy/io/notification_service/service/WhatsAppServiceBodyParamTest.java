package vacademy.io.notification_service.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import vacademy.io.notification_service.features.chatbot_flow.engine.provider.CombotMessageProvider;
import vacademy.io.notification_service.features.combot.repository.ChannelToInstituteMappingRepository;
import vacademy.io.notification_service.features.notification_log.repository.NotificationLogRepository;
import vacademy.io.notification_service.institute.InstituteInfoDTO;
import vacademy.io.notification_service.institute.InstituteInternalService;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Meta rejects a template message (#132000) when the body param count differs from the approved
 * template, and audience sends always carry name + email. Extras are dropped on the META/COMBOT
 * path only — WATI ignores extras, and any send at or under the declared count is untouched.
 */
class WhatsAppServiceBodyParamTest {

    private static final String PHONE = "919392152337";
    private static final String INSTITUTE = "inst-1";

    @Test
    @DisplayName("counts the highest {{n}} in the body; blank body is unknown")
    void countsPlaceholders() {
        assertThat(WhatsAppService.countBodyPlaceholders("Join our webinar tomorrow")).isZero();
        assertThat(WhatsAppService.countBodyPlaceholders("Hi {{1}}, your {{ 2 }} is ready")).isEqualTo(2);
        assertThat(WhatsAppService.countBodyPlaceholders("{{1}} {{1}}")).isEqualTo(1);
        assertThat(WhatsAppService.countBodyPlaceholders(null)).isNull();
        assertThat(WhatsAppService.countBodyPlaceholders("  ")).isNull();
    }

    @Test
    @DisplayName("named placeholders are not positional: count unknown, so nothing is trimmed")
    void namedPlaceholdersAreUnknown() {
        assertThat(WhatsAppService.countBodyPlaceholders("Hello {{first_name}}, code {{1}}")).isNull();
        assertThat(WhatsAppService.countBodyPlaceholders("Congratulations {{Learner Name}}!")).isNull();
    }

    @Test
    @DisplayName("zero-variable template: identity vars dropped, control keys kept")
    void zeroVariableTemplate() {
        Map<String, String> vars = new HashMap<>();
        vars.put("name", "Vusapalli Obulesu");
        vars.put("email", "v@example.com");
        vars.put("_headerUrl", "https://cdn/x.png");

        assertThat(WhatsAppService.keepDeclaredBodyParams(vars, 0))
                .containsExactly(Map.entry("_headerUrl", "https://cdn/x.png"));
    }

    @Test
    @DisplayName("mapped position wins; unmapped extras and out-of-range positions dropped")
    void mappedPositionKept() {
        Map<String, String> vars = new HashMap<>();
        vars.put("1", "Riya");
        vars.put("2", "extra");
        vars.put("email", "r@example.com");

        assertThat(WhatsAppService.keepDeclaredBodyParams(vars, 1))
                .containsExactly(Map.entry("1", "Riya"));
    }

    @Test
    @DisplayName("template stored without variable names: unfilled position takes a named value")
    void unfilledPositionFilled() {
        Map<String, String> vars = new LinkedHashMap<>();
        vars.put("name", "Riya");
        vars.put("email", "r@example.com");

        assertThat(WhatsAppService.keepDeclaredBodyParams(vars, 1))
                .containsExactly(Map.entry("1", "Riya"));
    }

    @Test
    @DisplayName("recipients at or under the declared count, or unknown template, are passed through as-is")
    void atOrUnderCountUntouched() {
        Map<String, Map<String, String>> exact = Map.of(PHONE, Map.of("name", "Riya", "_buttonUrl", "x"));
        Map<String, Map<String, String>> under = Map.of("911", Map.of());
        List<Map<String, Map<String, String>>> in = List.of(exact, under);

        List<Map<String, Map<String, String>>> out = WhatsAppService.trimToDeclaredBodyParams(in, 1);
        assertThat(out.get(0)).isSameAs(exact);
        assertThat(out.get(1)).isSameAs(under);
        assertThat(WhatsAppService.trimToDeclaredBodyParams(in, null)).isSameAs(in);
    }

    @Test
    @DisplayName("META provider: zero-variable template goes out with no body component")
    void metaPathSendsNoExtraParams() throws Exception {
        CombotMessageProvider combot = mock(CombotMessageProvider.class);
        when(combot.sendTemplate(anyString(), any(), anyString(), any())).thenReturn("wamid.1");
        WatiService wati = mock(WatiService.class);
        WhatsAppService service = service(combot, wati, "META");

        List<WhatsAppService.WhatsAppSendResult> res = service.sendWhatsappMessagesDetailed("web_tut_mar",
                List.of(Map.of(PHONE, new HashMap<>(Map.of("name", "Vusapalli", "email", "v@example.com")))),
                null, null, null, null, "en", null, INSTITUTE, null, null, 0);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> payload = ArgumentCaptor.forClass(Map.class);
        verify(combot).sendTemplate(eq(PHONE), payload.capture(), eq(INSTITUTE), any());
        assertThat(payload.getValue()).doesNotContainKey("bodyParams");
        assertThat(res).singleElement().extracting(WhatsAppService.WhatsAppSendResult::success).isEqualTo(true);
    }

    @Test
    @DisplayName("WATI provider: params are handed over unchanged")
    void watiPathUnchanged() throws Exception {
        CombotMessageProvider combot = mock(CombotMessageProvider.class);
        WatiService wati = mock(WatiService.class);
        when(wati.sendTemplateMessages(anyString(), any(), anyString(), anyString(), anyString(), anyString()))
                .thenReturn(List.of(Map.of(PHONE, true)));
        WhatsAppService service = service(combot, wati, "WATI");

        Map<String, String> vars = new HashMap<>(Map.of("name", "Vusapalli", "email", "v@example.com"));
        service.sendWhatsappMessagesDetailed("final_dd4", List.of(Map.of(PHONE, vars)),
                null, null, null, null, "en", null, INSTITUTE, null, null, 0);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Map<String, Map<String, String>>>> sent = ArgumentCaptor.forClass(List.class);
        verify(wati).sendTemplateMessages(eq("final_dd4"), sent.capture(), anyString(), anyString(), anyString(), anyString());
        assertThat(sent.getValue().get(0).get(PHONE)).isEqualTo(Map.of("name", "Vusapalli", "email", "v@example.com"));
    }

    private static WhatsAppService service(CombotMessageProvider combot, WatiService wati, String provider) {
        InstituteInternalService institutes = mock(InstituteInternalService.class);
        InstituteInfoDTO dto = new InstituteInfoDTO();
        dto.setSetting("{\"setting\":{\"WHATSAPP_SETTING\":{\"data\":{\"UTILITY_WHATSAPP\":{\"provider\":\"" + provider
                + "\",\"wati\":{\"apiKey\":\"k\",\"apiUrl\":\"https://wati\"}}}}}}");
        when(institutes.getInstituteByInstituteId(INSTITUTE)).thenReturn(dto);
        return new WhatsAppService(combot, wati, institutes,
                mock(NotificationLogRepository.class), mock(ChannelToInstituteMappingRepository.class));
    }
}
