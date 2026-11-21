package vacademy.io.admin_core_service.features.telephony.publicapi;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute_api.service.InstituteApiAuditWriter;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyProviderRegistry;
import vacademy.io.admin_core_service.features.telephony.enums.IvrNodeType;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderCapability;
import vacademy.io.admin_core_service.features.telephony.ivr.IvrMenuService;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.IvrMenu;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.IvrNode;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.TelephonyProviderNumber;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyProviderNumberRepository;

import java.util.*;

/**
 * The institute's inbound numbers and which AI agent answers each (Telleo API v1.3):
 * GET /v1/numbers (calls:read) and PUT /v1/numbers/{id}/agent (agents:manage).
 *
 * <p>Only numbers whose provider runs the IVR builder (Vacademy Voice, i.e. Plivo) answer
 * with an AI agent; a call to one plays the IVR menu the runtime resolves exactly as
 * {@code PlivoCallbackController.answerInbound} does — the number's own menu, else the
 * menu for that dialled number, else the institute's default menu — and an AI_AGENT step
 * of that menu hands the caller to its agent.
 *
 * <p>Switching a number's agent edits that ONE step, and only when it is unambiguous:
 * <ul>
 *   <li>the number resolves to a menu (no menu = calls ring counsellors; the dashboard has no
 *       one-click "answer with AI" that creates a menu, so neither does the API);</li>
 *   <li>the menu has exactly one AI_AGENT step (none = the menu sends callers to people; two
 *       or more = keypad options per agent, which only a person can re-map);</li>
 *   <li>no other number resolves to the same menu (the change would move those too).</li>
 * </ul>
 * Anything else is 409 number_routing_complex with what was found, to change in the
 * dashboard's IVR builder. The agent must be this account's, turned on, and answer incoming
 * calls (direction inbound or both).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InboundNumberApiService {

    private final TelephonyProviderNumberRepository numbers;
    private final TelephonyProviderRegistry registry;
    private final IvrMenuService ivrMenus;
    private final AiAgentRepository agents;
    private final NamedParameterJdbcTemplate jdbc;
    private final InstituteApiAuditWriter audit;

    /** One number with the menu it resolves to and that menu's AI steps. */
    record Routing(TelephonyProviderNumber number, IvrMenu menu, List<IvrNode> aiSteps, List<String> sharedWith) {
    }

    // ── Read ─────────────────────────────────────────────────────────────────────

    public Map<String, Object> listNumbers(AiCallingApiAuth.Principal p) {
        Map<String, Routing> routes = routes(p.instituteId());
        List<Map<String, Object>> data = new ArrayList<>();
        for (Routing r : routes.values()) data.add(view(p.instituteId(), r));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("has_more", false);
        return out;
    }

    /** Every inbound-capable number of the institute, keyed by id, in the Numbers card's order. */
    Map<String, Routing> routes(String instituteId) {
        List<TelephonyProviderNumber> all = numbers.findByInstituteId(instituteId).stream()
                .filter(n -> inboundCapable(n.getProviderType()))
                .toList();
        Map<String, IvrMenu> menuOf = new LinkedHashMap<>();
        for (TelephonyProviderNumber n : all) {
            menuOf.put(n.getId(), ivrMenus.resolveMenu(instituteId, n.getPhoneNumber(), n.getInboundIvrMenuId())
                    .orElse(null));
        }
        Map<String, List<IvrNode>> stepsByMenu = new HashMap<>();
        Map<String, Routing> out = new LinkedHashMap<>();
        for (TelephonyProviderNumber n : all) {
            IvrMenu menu = menuOf.get(n.getId());
            List<IvrNode> steps = List.of();
            List<String> shared = new ArrayList<>();
            if (menu != null) {
                steps = stepsByMenu.computeIfAbsent(menu.getId(), this::aiSteps);
                for (TelephonyProviderNumber other : all) {
                    IvrMenu om = menuOf.get(other.getId());
                    if (!other.getId().equals(n.getId()) && om != null && om.getId().equals(menu.getId())) {
                        shared.add(other.getPhoneNumber());
                    }
                }
            }
            out.put(n.getId(), new Routing(n, menu, steps, shared));
        }
        return out;
    }

    /**
     * The AI_AGENT steps of a menu, read with SQL rather than through the entity: a switch
     * updates ai_agent_id with SQL, and a node entity already loaded in this request would
     * still show the old agent.
     */
    List<IvrNode> aiSteps(String menuId) {
        return jdbc.query("""
                SELECT id, ai_agent_id FROM ivr_node
                 WHERE menu_id = :m AND node_type = 'AI_AGENT'
                 ORDER BY id
                """, new MapSqlParameterSource().addValue("m", menuId), (rs, i) -> IvrNode.builder()
                .id(rs.getString("id")).menuId(menuId).nodeType(IvrNodeType.AI_AGENT.name())
                .aiAgentId(rs.getString("ai_agent_id")).build());
    }

    boolean inboundCapable(String providerType) {
        if (providerType == null) return false;
        return registry.descriptor(providerType).map(d -> d.supports(ProviderCapability.IVR_BUILDER)).orElse(false);
    }

    Map<String, Object> view(String instituteId, Routing r) {
        TelephonyProviderNumber n = r.number();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", n.getId());
        m.put("object", "number");
        m.put("phone_number", n.getPhoneNumber());
        m.put("label", n.getLabel());
        m.put("provider", n.getProviderType() == null ? null : n.getProviderType().toLowerCase(Locale.ROOT));
        m.put("enabled", Boolean.TRUE.equals(n.getEnabled()));
        Map<String, Object> routing = new LinkedHashMap<>();
        Object agent = null;
        if (r.menu() == null) {
            routing.put("type", "no_menu");
            routing.put("description", "No IVR menu: calls ring counsellors (or voicemail).");
        } else {
            routing.put("menu_id", r.menu().getId());
            routing.put("menu_name", r.menu().getName());
            routing.put("ai_agent_steps", r.aiSteps().size());
            routing.put("shared_with", r.sharedWith());
            if (r.aiSteps().isEmpty()) {
                routing.put("type", "menu_without_ai_agent");
                routing.put("description", "The menu sends callers to people, voicemail or recordings; no AI agent answers.");
            } else if (r.aiSteps().size() == 1) {
                IvrNode step = r.aiSteps().get(0);
                boolean direct = step.getId().equals(r.menu().getRootNodeId());
                routing.put("type", direct ? "ai_agent" : "menu_with_ai_agent");
                routing.put("description", direct ? "An AI agent answers every call."
                        : "Callers reach the AI agent through a menu option.");
                agent = agentSummary(instituteId, step.getAiAgentId());
            } else {
                routing.put("type", "menu_with_several_ai_agents");
                routing.put("description", "Different menu options go to different AI agents.");
                List<Object> list = new ArrayList<>();
                for (IvrNode s : r.aiSteps()) list.add(agentSummary(instituteId, s.getAiAgentId()));
                routing.put("agents", list);
            }
        }
        m.put("agent", agent);
        m.put("routing", routing);
        return m;
    }

    private Object agentSummary(String instituteId, String agentId) {
        if (agentId == null) return null;
        return agents.findByIdAndInstituteId(agentId, instituteId).map(AgentApiService::summary)
                .<Object>map(x -> x).orElseGet(() -> {
                    Map<String, Object> missing = new LinkedHashMap<>();
                    missing.put("id", agentId);
                    missing.put("object", "agent");
                    missing.put("deleted", true);
                    return missing;
                });
    }

    // ── Switch ───────────────────────────────────────────────────────────────────

    /** PUT /v1/numbers/{id}/agent. */
    public Map<String, Object> setNumberAgent(AiCallingApiAuth.Principal p, String numberId, String agentId) {
        String instituteId = p.instituteId();
        if (agentId == null || agentId.isBlank()) {
            throw AiCallingApiException.invalid("agent_id is required. List your agents with GET /v1/agents.");
        }
        TelephonyProviderNumber number = numbers.findById(numberId == null ? "" : numberId.trim())
                .filter(n -> instituteId.equals(n.getInstituteId()))
                .orElseThrow(() -> new AiCallingApiException(HttpStatus.NOT_FOUND, "number_not_found",
                        "No number " + numberId + " in this account. List them with GET /v1/numbers."));
        if (!inboundCapable(number.getProviderType())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "number_not_inbound_capable",
                    "Calls to this number are not answered by an AI agent on its provider ("
                            + number.getProviderType() + "). Only Vacademy Voice numbers can be.");
        }
        AiAgent agent = agents.findByIdAndInstituteId(agentId.trim(), instituteId)
                .orElseThrow(() -> new AiCallingApiException(HttpStatus.NOT_FOUND, "agent_not_found",
                        "No agent " + agentId + " in this account. List your agents with GET /v1/agents."));
        if (!Boolean.TRUE.equals(agent.getEnabled())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "agent_disabled",
                    "Agent " + agent.getId() + " is turned off. Turn it on first (POST /v1/agents/" + agent.getId() + "/enable).");
        }
        String direction = agent.getDirection() == null ? "OUTBOUND" : agent.getDirection().toUpperCase(Locale.ROOT);
        if (!direction.equals("INBOUND") && !direction.equals("BOTH")) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "agent_outbound_only",
                    "Agent " + agent.getId() + " only places calls. Set its direction to inbound or both to let it answer.");
        }
        Routing r = routes(instituteId).get(number.getId());
        IvrNode step = requireSimpleRouting(r);
        String previous = step.getAiAgentId();
        if (!agent.getId().equals(previous)) {
            int n = jdbc.update("""
                    UPDATE ivr_node SET ai_agent_id = :a, updated_at = NOW()
                     WHERE id = :n AND menu_id = :m AND node_type = 'AI_AGENT'
                    """, new MapSqlParameterSource().addValue("a", agent.getId()).addValue("n", step.getId())
                    .addValue("m", r.menu().getId()));
            if (n != 1) {
                throw new AiCallingApiException(HttpStatus.CONFLICT, "number_routing_changed",
                        "The number's menu changed while this request ran. Read it again with GET /v1/numbers.");
            }
            Map<String, Object> before = new LinkedHashMap<>();
            before.put("ai_agent_id", previous);
            try {
                audit.recordApi(instituteId, p.keyId(), "IVR_NODE", step.getId(), "NUMBER_AGENT_SET",
                        "Inbound number " + number.getPhoneNumber() + " moved to AI agent " + agent.getName() + " through the API",
                        Map.of("number_id", number.getId(), "menu_id", r.menu().getId(), "agent_id", agent.getId()), before);
            } catch (RuntimeException e) {
                log.warn("number-api: audit write failed: {}", e.getMessage());
            }
        }
        return view(instituteId, routes(instituteId).get(number.getId()));
    }

    /** The one AI step a switch may edit, or 409 number_routing_complex saying why not. */
    static IvrNode requireSimpleRouting(Routing r) {
        if (r == null || r.menu() == null) {
            throw complex("This number has no IVR menu, so calls ring counsellors and no AI agent answers. "
                    + "Create a menu with an AI agent step in the dashboard (Settings → Calling → IVR) and pick it "
                    + "for this number; after that its agent can be switched here.", Map.of("reason", "no_menu"));
        }
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("menu_id", r.menu().getId());
        d.put("menu_name", r.menu().getName());
        d.put("ai_agent_steps", r.aiSteps().size());
        if (r.aiSteps().isEmpty()) {
            d.put("reason", "menu_without_ai_agent");
            throw complex("This number's menu sends callers to people, voicemail or recordings, not to an AI agent. "
                    + "Add an AI agent step to the menu in the dashboard.", d);
        }
        if (r.aiSteps().size() > 1) {
            d.put("reason", "menu_with_several_ai_agents");
            throw complex("This number's menu has " + r.aiSteps().size() + " AI agent steps (one per menu option). "
                    + "Choose which option changes in the dashboard's IVR builder.", d);
        }
        if (!r.sharedWith().isEmpty()) {
            d.put("reason", "menu_shared");
            d.put("shared_with", r.sharedWith());
            throw complex("This number's menu also answers " + String.join(", ", r.sharedWith())
                    + "; switching it here would move those numbers too. Give this number its own menu in the "
                    + "dashboard first.", d);
        }
        return r.aiSteps().get(0);
    }

    private static AiCallingApiException complex(String message, Map<String, Object> details) {
        return new AiCallingApiException(HttpStatus.CONFLICT, "number_routing_complex", message, details);
    }
}
