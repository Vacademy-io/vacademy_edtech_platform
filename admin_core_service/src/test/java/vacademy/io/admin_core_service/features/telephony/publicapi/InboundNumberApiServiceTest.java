package vacademy.io.admin_core_service.features.telephony.publicapi;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyProviderRegistry;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderCapability;
import vacademy.io.admin_core_service.features.telephony.ivr.IvrMenuService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.IvrMenu;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.IvrNode;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyProviderNumber;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyProviderNumberRepository;
import vacademy.io.admin_core_service.features.telephony.spi.TelephonyProviderDescriptor;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Which agent answers an inbound number, and the narrow cases in which the API may switch it. */
class InboundNumberApiServiceTest {

    private static final String INST = "inst-1";
    private static final AiCallingApiAuth.Principal P =
            new AiCallingApiAuth.Principal(INST, "key-1", List.of("calls:read", "agents:manage"));

    private TelephonyProviderNumberRepository numbers;
    private IvrMenuService menus;
    private AiAgentRepository agents;
    private NamedParameterJdbcTemplate jdbc;
    private InboundNumberApiService service;
    private final List<TelephonyProviderNumber> rows = new ArrayList<>();
    /** menu id -> AI steps (id, agent id). */
    private final Map<String, List<IvrNode>> steps = new HashMap<>();

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        numbers = mock(TelephonyProviderNumberRepository.class);
        menus = mock(IvrMenuService.class);
        agents = mock(AiAgentRepository.class);
        jdbc = mock(NamedParameterJdbcTemplate.class);
        TelephonyProviderRegistry registry = mock(TelephonyProviderRegistry.class);
        TelephonyProviderDescriptor plivo = mock(TelephonyProviderDescriptor.class);
        when(plivo.supports(ProviderCapability.IVR_BUILDER)).thenReturn(true);
        TelephonyProviderDescriptor exotel = mock(TelephonyProviderDescriptor.class);
        when(registry.descriptor("PLIVO")).thenReturn(Optional.of(plivo));
        when(registry.descriptor("EXOTEL")).thenReturn(Optional.of(exotel));
        service = new InboundNumberApiService(numbers, registry, menus, agents, jdbc, mock(InstituteApiAuditWriter.class));
        when(numbers.findByInstituteId(INST)).thenReturn(rows);
        when(numbers.findById(anyString())).thenAnswer(i -> rows.stream()
                .filter(n -> n.getId().equals(i.getArgument(0))).findFirst());
        when(menus.resolveMenu(eq(INST), anyString(), any())).thenReturn(Optional.empty());
        when(jdbc.query(contains("ivr_node"), any(SqlParameterSource.class), any(RowMapper.class))).thenAnswer(i -> {
            SqlParameterSource p = i.getArgument(1);
            return steps.getOrDefault((String) p.getValue("m"), List.of());
        });
        when(jdbc.update(contains("UPDATE ivr_node"), any(SqlParameterSource.class))).thenReturn(1);
        agent("in-1", INST, true, "INBOUND");
        agent("both-1", INST, true, "BOTH");
        agent("out-1", INST, true, "OUTBOUND");
        agent("off-1", INST, false, "INBOUND");
    }

    private void agent(String id, String inst, boolean enabled, String direction) {
        when(agents.findByIdAndInstituteId(id, inst)).thenReturn(Optional.of(AiAgent.builder().id(id).instituteId(inst)
                .name(id).enabled(enabled).direction(direction).build()));
    }

    private TelephonyProviderNumber number(String id, String phone, String provider, String ownMenu) {
        TelephonyProviderNumber n = TelephonyProviderNumber.builder().id(id).instituteId(INST).providerType(provider)
                .phoneNumber(phone).enabled(true).inboundIvrMenuId(ownMenu).build();
        rows.add(n);
        return n;
    }

    private IvrMenu menu(String id, String root, String... aiStepAgents) {
        IvrMenu m = IvrMenu.builder().id(id).instituteId(INST).name("Menu " + id).rootNodeId(root).enabled(true).build();
        List<IvrNode> list = new ArrayList<>();
        for (int k = 0; k < aiStepAgents.length; k++) {
            list.add(IvrNode.builder().id(id + "-ai" + k).menuId(id).nodeType("AI_AGENT").aiAgentId(aiStepAgents[k]).build());
        }
        steps.put(id, list);
        return m;
    }

    private void routes(TelephonyProviderNumber n, IvrMenu m) {
        when(menus.resolveMenu(INST, n.getPhoneNumber(), n.getInboundIvrMenuId())).thenReturn(Optional.ofNullable(m));
    }

    @Test
    @SuppressWarnings("unchecked")
    void listShowsOnlyInboundCapableNumbersWithTheirRouting() {
        TelephonyProviderNumber direct = number("n-1", "+918000000001", "PLIVO", "m-1");
        TelephonyProviderNumber none = number("n-2", "+918000000002", "PLIVO", null);
        number("n-3", "+918000000003", "EXOTEL", null);
        routes(direct, menu("m-1", "m-1-ai0", "in-1"));
        routes(none, null);

        List<Map<String, Object>> data = (List<Map<String, Object>>) service.listNumbers(P).get("data");
        assertEquals(List.of("n-1", "n-2"), data.stream().map(d -> d.get("id")).toList());
        Map<String, Object> routing = (Map<String, Object>) data.get(0).get("routing");
        assertEquals("ai_agent", routing.get("type"));
        assertEquals("in-1", ((Map<String, Object>) data.get(0).get("agent")).get("id"));
        assertEquals("no_menu", ((Map<String, Object>) data.get(1).get("routing")).get("type"));
        assertNull(data.get(1).get("agent"));
    }

    @Test
    void aSimpleNumberIsSwitched() {
        TelephonyProviderNumber n = number("n-1", "+918000000001", "PLIVO", "m-1");
        routes(n, menu("m-1", "root-gather", "in-1"));
        service.setNumberAgent(P, "n-1", "both-1");
        ArgumentCaptor<SqlParameterSource> p = ArgumentCaptor.forClass(SqlParameterSource.class);
        verify(jdbc).update(contains("UPDATE ivr_node"), p.capture());
        assertEquals("both-1", p.getValue().getValue("a"));
        assertEquals("m-1-ai0", p.getValue().getValue("n"));
        assertEquals("m-1", p.getValue().getValue("m"));
    }

    @Test
    void theSameAgentIsANoOp() {
        TelephonyProviderNumber n = number("n-1", "+918000000001", "PLIVO", "m-1");
        routes(n, menu("m-1", "m-1-ai0", "in-1"));
        service.setNumberAgent(P, "n-1", "in-1");
        verify(jdbc, never()).update(contains("UPDATE ivr_node"), any(SqlParameterSource.class));
    }

    @Test
    void complexRoutingIs409WithTheReason() {
        TelephonyProviderNumber noMenu = number("n-1", "+918000000001", "PLIVO", null);
        routes(noMenu, null);
        assertReason("n-1", "no_menu");

        TelephonyProviderNumber people = number("n-2", "+918000000002", "PLIVO", "m-2");
        routes(people, menu("m-2", "dial"));
        assertReason("n-2", "menu_without_ai_agent");

        TelephonyProviderNumber several = number("n-3", "+918000000003", "PLIVO", "m-3");
        routes(several, menu("m-3", "gather", "in-1", "both-1"));
        assertReason("n-3", "menu_with_several_ai_agents");

        IvrMenu shared = menu("m-4", "m-4-ai0", "in-1");
        TelephonyProviderNumber a = number("n-4", "+918000000004", "PLIVO", null);
        TelephonyProviderNumber b = number("n-5", "+918000000005", "PLIVO", null);
        routes(a, shared);
        routes(b, shared);
        assertReason("n-4", "menu_shared");
        verify(jdbc, never()).update(contains("UPDATE ivr_node"), any(SqlParameterSource.class));
    }

    private void assertReason(String numberId, String reason) {
        AiCallingApiException e = assertThrows(AiCallingApiException.class,
                () -> service.setNumberAgent(P, numberId, "in-1"));
        assertEquals("number_routing_complex", e.getCode(), numberId);
        assertEquals(reason, e.getDetails().get("reason"), numberId);
    }

    @Test
    void theAgentMustBeOursOnAndAnswerCalls() {
        TelephonyProviderNumber n = number("n-1", "+918000000001", "PLIVO", "m-1");
        routes(n, menu("m-1", "m-1-ai0", "in-1"));
        when(agents.findByIdAndInstituteId("theirs", INST)).thenReturn(Optional.empty());
        assertEquals("agent_not_found", assertThrows(AiCallingApiException.class,
                () -> service.setNumberAgent(P, "n-1", "theirs")).getCode());
        assertEquals("agent_disabled", assertThrows(AiCallingApiException.class,
                () -> service.setNumberAgent(P, "n-1", "off-1")).getCode());
        assertEquals("agent_outbound_only", assertThrows(AiCallingApiException.class,
                () -> service.setNumberAgent(P, "n-1", "out-1")).getCode());
    }

    @Test
    void numbersOfAnotherInstituteOrProviderAreRefused() {
        TelephonyProviderNumber theirs = TelephonyProviderNumber.builder().id("n-9").instituteId("inst-2")
                .providerType("PLIVO").phoneNumber("+918000000009").enabled(true).build();
        when(numbers.findById("n-9")).thenReturn(Optional.of(theirs));
        assertEquals("number_not_found", assertThrows(AiCallingApiException.class,
                () -> service.setNumberAgent(P, "n-9", "in-1")).getCode());
        number("n-3", "+918000000003", "EXOTEL", null);
        assertEquals("number_not_inbound_capable", assertThrows(AiCallingApiException.class,
                () -> service.setNumberAgent(P, "n-3", "in-1")).getCode());
    }
}
