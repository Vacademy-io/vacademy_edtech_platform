package vacademy.io.admin_core_service.features.telephony.queue;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.telephony.core.AiCallingSettingsService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallingSettingsPojo;
import vacademy.io.admin_core_service.features.telephony.enums.CallStatus;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.TelephonyCallLogRepository;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallQueueItem;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Turns the ids on a queue row into the names a person reading a dashboard needs:
 * which institute, and which AI agent.
 *
 * <p>Resolved in BULK for a whole page rather than per row. A queue listing is polled
 * every few seconds by an ops screen, and a per-row institute lookup would turn one
 * page into fifty queries against a table whose rows carry a large settings blob.
 *
 * <p>Agent naming is not a single lookup because the two providers register campaigns
 * differently. Saving a {@code VACADEMY_AI} agent auto-registers it as a campaign whose
 * id IS the agent id, so {@code ai_agent} answers directly. An {@code AAVTAAR} campaign
 * id is the vendor's own, and its human name lives in the institute's AI_CALLING_SETTING
 * campaigns registry. Both are tried, and the raw id is the last resort — a dashboard
 * showing an opaque id is worse than one showing a name, but far better than one showing
 * a blank.
 */
@Service
@RequiredArgsConstructor
public class AiCallQueueDirectory {

    private static final Logger log = LoggerFactory.getLogger(AiCallQueueDirectory.class);

    private final InstituteRepository instituteRepository;
    private final AudienceRepository audienceRepository;
    private final AudienceResponseRepository audienceResponseRepository;
    private final AiAgentRepository aiAgentRepository;
    private final TelephonyCallLogRepository callLogRepository;
    private final AiCallingSettingsService settingsService;

    /**
     * Live call state for a page of already-dialled rows: is this call still on a line,
     * and for how long?
     *
     * <p>Needed because a queue row's own status stops at DIALED. Without this, a queue
     * screen cannot distinguish a call in progress from one that finished this morning —
     * which is precisely the question someone opens a queue screen to answer.
     */
    public Map<String, CallState> callStates(Collection<String> callLogIds) {
        Map<String, CallState> out = new HashMap<>();
        if (callLogIds == null || callLogIds.isEmpty()) return out;
        for (Object[] row : callLogRepository.findStatusByIds(callLogIds)) {
            String status = (String) row[1];
            Integer duration = row[2] == null ? null : ((Number) row[2]).intValue();
            String toNumber = row.length > 3 ? (String) row[3] : null;
            out.put((String) row[0], new CallState(status, duration,
                    !CallStatus.parseOrDefault(status).isTerminal(), toNumber));
        }
        return out;
    }

    /**
     * What a dialled call is doing right now, plus the number it actually reached —
     * which is often the only place the lead's phone exists, since a queued row
     * frequently carries only a lead id.
     */
    public record CallState(String status, Integer durationSeconds, boolean live,
                            String toNumber) {}

    /** Names for one page of rows, resolved in as few queries as the page allows. */
    public Names forItems(Collection<AiCallQueueItem> items) {
        Set<String> instituteIds = new HashSet<>();
        Set<String> campaignIds = new HashSet<>();
        for (AiCallQueueItem item : items) {
            if (notBlank(item.getInstituteId())) instituteIds.add(item.getInstituteId());
            if (notBlank(item.getCampaignId())) campaignIds.add(item.getCampaignId());
        }
        // Which bulk run a row belongs to. Without this the queue tab shows a hundred
        // rows all reading "Bulk campaign" with no way to tell two concurrent runs
        // apart — and no way to find the run whose progress dialog you just closed.
        Set<String> runRefs = new HashSet<>();
        for (AiCallQueueItem item : items) {
            if (notBlank(item.getSourceRef()) && "BULK".equals(item.getSource())) {
                runRefs.add(item.getSourceRef());
            }
        }
        // The lead's own name. A queue row stores only ids and, often, not even a phone
        // — the number is resolved downstream at dial time — so without this the Lead
        // column showed a bare number, or a raw uuid, for every row.
        Set<String> responseIds = new HashSet<>();
        for (AiCallQueueItem item : items) {
            if (notBlank(item.getResponseId())) responseIds.add(item.getResponseId());
        }
        Map<String, String> institutes = instituteNames(instituteIds);
        Map<String, String> agents = agentNames(campaignIds);
        Map<String, String> runs = campaignNamesFor(runRefs);
        Map<String, LeadRef> leads = leadNames(responseIds);

        // Only reach for an institute's settings when a campaign id is STILL unnamed
        // after ai_agent — i.e. an Aavtaar campaign. Most deployments never pay for this.
        Set<String> unresolvedInstitutes = new HashSet<>();
        for (AiCallQueueItem item : items) {
            String campaignId = item.getCampaignId();
            if (notBlank(campaignId) && !agents.containsKey(campaignId)
                    && !notBlank(item.getCampaignName()) && notBlank(item.getInstituteId())) {
                unresolvedInstitutes.add(item.getInstituteId());
            }
        }
        for (String instituteId : unresolvedInstitutes) {
            try {
                AiCallingSettingsPojo settings = settingsService.get(instituteId);
                if (settings.getCampaigns() == null) continue;
                for (AiCallingSettingsPojo.CampaignConfig campaign : settings.getCampaigns()) {
                    if (notBlank(campaign.getCampaignId()) && notBlank(campaign.getName())) {
                        agents.putIfAbsent(campaign.getCampaignId(), campaign.getName());
                    }
                }
            } catch (Exception e) {
                // One institute with an unparseable setting_json must not blank out the
                // names on every other row of the page.
                log.debug("ai-call queue: could not read AI settings for institute {} while "
                        + "naming agents: {}", instituteId, e.getMessage());
            }
        }
        return new Names(institutes, agents, runs, leads);
    }

    /** A lead's display name and the number on its CRM record. */
    public record LeadRef(String name, String mobile) {}

    /** Lead ids (audience_response ids) → name + number. */
    public Map<String, LeadRef> leadNames(Collection<String> responseIds) {
        Map<String, LeadRef> out = new HashMap<>();
        if (responseIds == null || responseIds.isEmpty()) return out;
        try {
            for (Object[] row : audienceResponseRepository.findIdNameAndMobileByIds(responseIds)) {
                if (row[0] != null) {
                    out.put((String) row[0], new LeadRef((String) row[1], (String) row[2]));
                }
            }
        } catch (Exception e) {
            // A deleted lead must not blank out the names on the rest of the page.
            log.debug("ai-call queue: could not resolve lead names: {}", e.getMessage());
        }
        return out;
    }

    /** Bulk-run ids (audience ids) → campaign name. */
    public Map<String, String> campaignNamesFor(Collection<String> audienceIds) {
        Map<String, String> out = new HashMap<>();
        if (audienceIds == null || audienceIds.isEmpty()) return out;
        try {
            for (Object[] row : audienceRepository.findIdAndCampaignNameByIds(audienceIds)) {
                if (row[0] != null && row[1] != null) out.put((String) row[0], (String) row[1]);
            }
        } catch (Exception e) {
            // A deleted audience must not blank out the rest of the page.
            log.debug("ai-call queue: could not resolve campaign names: {}", e.getMessage());
        }
        return out;
    }

    public Map<String, String> instituteNames(Collection<String> instituteIds) {
        Map<String, String> out = new HashMap<>();
        if (instituteIds == null || instituteIds.isEmpty()) return out;
        for (Object[] row : instituteRepository.findIdAndNameByIds(instituteIds)) {
            if (row[0] != null) out.put((String) row[0], (String) row[1]);
        }
        return out;
    }

    private Map<String, String> agentNames(Collection<String> campaignIds) {
        Map<String, String> out = new HashMap<>();
        if (campaignIds == null || campaignIds.isEmpty()) return out;
        List<Object[]> rows = aiAgentRepository.findIdAndNameByIds(campaignIds);
        for (Object[] row : rows) {
            if (row[0] != null && row[1] != null) out.put((String) row[0], (String) row[1]);
        }
        return out;
    }

    /** Resolved names for one page. */
    public static final class Names {
        private final Map<String, String> institutes;
        private final Map<String, String> agents;
        private final Map<String, String> runs;
        private final Map<String, LeadRef> leads;

        Names(Map<String, String> institutes, Map<String, String> agents,
              Map<String, String> runs, Map<String, LeadRef> leads) {
            this.institutes = institutes;
            this.agents = agents;
            this.runs = runs;
            this.leads = leads;
        }

        /** The lead's name, or null when the CRM record has none. */
        public String leadName(String responseId) {
            LeadRef ref = responseId == null ? null : leads.get(responseId);
            return ref == null || ref.name() == null || ref.name().isBlank() ? null : ref.name();
        }

        /** The number on the lead's CRM record — a fallback when the queue row has none. */
        public String leadMobile(String responseId) {
            LeadRef ref = responseId == null ? null : leads.get(responseId);
            return ref == null ? null : ref.mobile();
        }

        /** The campaign a bulk row came from, or null when it is not a bulk row. */
        public String runName(String sourceRef) {
            return sourceRef == null ? null : runs.get(sourceRef);
        }

        public String instituteName(String instituteId) {
            return institutes.get(instituteId);
        }

        /**
         * The agent as a person would name it: the name the caller already carried, else
         * the registered agent/campaign name, else the raw campaign id so the row is
         * still identifiable.
         */
        public String agentName(String campaignName, String campaignId) {
            if (notBlank(campaignName)) return campaignName;
            if (notBlank(campaignId)) {
                String resolved = agents.get(campaignId);
                return notBlank(resolved) ? resolved : campaignId;
            }
            return null;
        }
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
