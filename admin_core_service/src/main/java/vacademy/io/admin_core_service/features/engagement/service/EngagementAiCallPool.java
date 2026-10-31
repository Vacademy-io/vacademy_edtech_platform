package vacademy.io.admin_core_service.features.engagement.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.engagement.entity.EngagementEngine;
import vacademy.io.admin_core_service.features.engagement.repository.EngagementActionRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiAgentService;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.List;

/**
 * The pool of AI-calling agents an engine may dial with: {@code channels.AI_CALL.agentPool}, a list
 * of ai_agent ids. A pool is required whenever the channel is on, and each call takes the next agent
 * in turn (round-robin), so a lead's calls are spread evenly across the pool.
 */
@Service
@RequiredArgsConstructor
public class EngagementAiCallPool {

    private final AiAgentService agentService;
    private final EngagementActionRepository actionRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    /** Refuse an engine that turns AI_CALL on without a pool of existing, enabled agents. */
    public void requirePool(String instituteId, String channelsJson) {
        JsonNode ai = channelNode(channelsJson);
        if (ai == null || !ai.path("enabled").asBoolean(false)) return;
        List<String> ids = poolOf(ai);
        if (ids.isEmpty()) {
            throw new VacademyException("Pick at least one AI agent for the AI call channel, or turn the channel off.");
        }
        for (String id : ids) {
            boolean usable = agentService.find(id, instituteId)
                    .map(a -> !Boolean.FALSE.equals(a.getEnabled()))
                    .orElse(false);
            if (!usable) {
                throw new VacademyException("An AI agent in the AI call pool no longer exists or is turned off. Pick another.");
            }
        }
    }

    /** True when the engine has at least one agent to call with. */
    public boolean hasPool(EngagementEngine engine) {
        return !poolOf(channelNode(engine.getChannels())).isEmpty();
    }

    /**
     * The agent for the engine's next call, or null when the pool is empty. Both ways the engine
     * places a call count: an AI_CALL send, and an AI call action approved in the inbox.
     */
    public String next(EngagementEngine engine) {
        List<String> ids = poolOf(channelNode(engine.getChannels()));
        if (ids.isEmpty()) return null;
        long placed = actionRepository.countByEngineIdAndChannel(engine.getId(), "AI_CALL")
                + actionRepository.countByEngineIdAndActionTypeAndStatus(
                        engine.getId(), EngagementActionTypes.SCHEDULE_AI_CALL, "DONE");
        return ids.get((int) (placed % ids.size()));
    }

    private JsonNode channelNode(String channelsJson) {
        try {
            JsonNode n = objectMapper.readTree(channelsJson == null ? "{}" : channelsJson).path("AI_CALL");
            return n.isObject() ? n : null;
        } catch (Exception e) {
            return null;
        }
    }

    private List<String> poolOf(JsonNode ai) {
        List<String> out = new ArrayList<>();
        if (ai == null) return out;
        for (JsonNode n : ai.path("agentPool")) {
            String id = n.asText("").trim();
            if (!id.isEmpty() && !out.contains(id)) out.add(id);
        }
        return out;
    }
}
