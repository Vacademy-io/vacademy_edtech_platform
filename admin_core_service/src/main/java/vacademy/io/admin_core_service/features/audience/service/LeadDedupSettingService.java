package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Per-institute lead deduplication settings, read from the {@code LEAD_SETTING}
 * blob the Settings UI saves:
 *
 * <pre>
 * institute.setting → setting → LEAD_SETTING → data → dedup → {
 *   "enabled": false,
 *   "field": "EMAIL" | "PHONE",
 *   "scope": "CAMPAIGN" | "SELECTED" | "INSTITUTE",
 *   "audienceIds": ["..."],           // only meaningful when scope = SELECTED
 *   "action": "REJECT" | "ALLOW_REASSIGN",
 *   "repeatLead": {                   // only meaningful when action = ALLOW_REASSIGN
 *     "counsellorMode": "NONE" | "SAME_AS_PREVIOUS" | "SPECIFIC" | "ROUND_ROBIN",
 *     "specificCounsellorId": "...",  // only meaningful when counsellorMode = SPECIFIC
 *     "specificCounsellorName": "...",
 *     "statusMode": "KEEP_EXISTING" | "RESET_TO_NEW" | "RESET_CLOSED_TO_NEW",
 *     "samePersonByPhone": false,     // field = PHONE: a repeat with a new email joins the
 *                                     // person who already holds the phone
 *     "blockOwnedManualAdd": false,   // field = PHONE: a counsellor cannot add by hand a
 *                                     // phone whose lead another counsellor owns
 *     "blockOpenLeadManualAdd": false, // a counsellor cannot add by hand a lead (dedup field)
 *                                     // that is still open — not converted, not LOST
 *     "alsoMatchEmail": false,        // field = PHONE: a new enquiry whose phone matches no
 *                                     // lead still counts as a repeat when its email does
 *     "reattempt": {                  // what a repeat enquiry leaves behind; all off by default
 *       "markDuplicate": false,       // flag the new enquiry as a duplicate of the lead it repeats
 *       "duplicateOpenOnly": true,    // ...only while that lead is open (not converted / LOST);
 *                                     // a repeat of a closed lead comes in as a new lead
 *       "duplicatesTabOnly": false,   // duplicates only on the Duplicate Leads tab; other lists
 *                                     // show the lead once, badged (route duplicates= still wins)
 *       "journeyEntry": false,        // write a "Reattempt" entry in that lead's journey
 *       "notifyOwner": false,         // bell to the lead's counsellor
 *       "showBadge": false,           // "Duplicate" badge next to the name in lead tables (FE only)
 *       "followUp": false,            // open a priority follow-up for the counsellor, listed first
 *       "tier": null                  // lead_tier key to set on the lead, e.g. "VERY_HOT"; null = keep
 *     }
 *   }
 * }
 * </pre>
 *
 * Cached 5 minutes per institute (same pattern as {@link LeadReportSettingService}).
 * Defensive parsing: a missing subtree or invalid enum value falls back to the
 * defaults below (dedup disabled, reject on match, keep whatever the lead already
 * had), so a bad manual edit of the JSON can never start silently rejecting or
 * reassigning leads in an unexpected way.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LeadDedupSettingService {

    public enum DedupField { EMAIL, PHONE }

    /**
     * CAMPAIGN — only the lead list being submitted to.
     * SELECTED — a specific admin-chosen set of lead lists ({@code audienceIds}).
     * INSTITUTE — every lead list in the institute.
     */
    public enum DedupScope { CAMPAIGN, SELECTED, INSTITUTE }

    /** REJECT — block the submission (today's only behaviour). ALLOW_REASSIGN — let it
     * through and apply {@link RepeatLeadSettings}. */
    public enum DedupAction { REJECT, ALLOW_REASSIGN }

    /**
     * NONE — explicitly clear any counsellor. SAME_AS_PREVIOUS — don't touch it (leave
     * whatever the lead already had). SPECIFIC — always assign {@code specificCounsellorId}.
     * ROUND_ROBIN — run the normal pool/round-robin assignment, same as a first-time lead.
     */
    public enum CounsellorMode { NONE, SAME_AS_PREVIOUS, SPECIFIC, ROUND_ROBIN }

    /**
     * KEEP_EXISTING — don't touch conversion_status. RESET_TO_NEW — set it back to "LEAD".
     * RESET_CLOSED_TO_NEW — set it back to "LEAD" only when the lead the enquiry repeats is
     * closed (converted or LOST); a lead still being worked keeps its status.
     */
    public enum StatusMode { KEEP_EXISTING, RESET_TO_NEW, RESET_CLOSED_TO_NEW }

    /**
     * What a repeat enquiry leaves behind, each switch on its own (all off by default):
     * {@code markDuplicate} flags the new enquiry as a duplicate of the lead it repeats,
     * {@code journeyEntry} writes a "Reattempt" entry in that lead's journey,
     * {@code notifyOwner} rings the bell of the lead's counsellor, {@code followUp} opens a
     * priority follow-up for that counsellor (listed first on the Follow-ups page), and
     * {@code tier} sets the lead's tier (Interest Level) to that institute tier key. {@code
     * showBadge} is read by the admin UI only, to badge duplicate enquiries in the lead tables.
     * {@code duplicateOpenOnly} (default on) limits {@code markDuplicate} to repeats of a lead
     * that is still open — not converted and not LOST — so a closed lead's repeat counts as a
     * new lead. {@code duplicatesTabOnly} (default off) keeps duplicate enquiries out of every
     * lead list whose route does not ask for them, so they show only on the Duplicate Leads
     * tab, and badges the lead they repeat instead. Off = lists behave exactly as before.
     */
    public record ReattemptSettings(boolean markDuplicate, boolean journeyEntry, boolean notifyOwner,
            boolean showBadge, boolean followUp, String tier, boolean duplicateOpenOnly,
            boolean duplicatesTabOnly) {

        public static final ReattemptSettings OFF =
                new ReattemptSettings(false, false, false, false, false, null, true, false);

        /** {@code duplicatesTabOnly} off, its default. */
        public ReattemptSettings(boolean markDuplicate, boolean journeyEntry, boolean notifyOwner,
                boolean showBadge, boolean followUp, String tier, boolean duplicateOpenOnly) {
            this(markDuplicate, journeyEntry, notifyOwner, showBadge, followUp, tier, duplicateOpenOnly, false);
        }

        /** {@code duplicateOpenOnly} on, its default. */
        public ReattemptSettings(boolean markDuplicate, boolean journeyEntry, boolean notifyOwner,
                boolean showBadge, boolean followUp, String tier) {
            this(markDuplicate, journeyEntry, notifyOwner, showBadge, followUp, tier, true, false);
        }

        public ReattemptSettings {
            tier = (tier == null || tier.isBlank()) ? null : tier.trim().toUpperCase();
        }

        /** True when any switch that acts at intake is on. */
        public boolean anyIntakeAction() {
            return markDuplicate || journeyEntry || notifyOwner || followUp || tier != null;
        }
    }

    /**
     * {@code samePersonByPhone}, {@code blockOwnedManualAdd} and {@code alsoMatchEmail} only
     * act when the dedup field is PHONE; all default to off, which keeps the behaviour from
     * before they existed. {@code alsoMatchEmail}: auth_service already treats one email as
     * one person, so a repeat that brings a new phone (e.g. a Google form prefilled from the
     * Google account) joins that person, and without this it would arrive as a second,
     * unflagged lead.
     */
    public record RepeatLeadSettings(CounsellorMode counsellorMode, String specificCounsellorId,
            String specificCounsellorName, StatusMode statusMode, boolean samePersonByPhone,
            boolean blockOwnedManualAdd, ReattemptSettings reattempt, boolean blockOpenLeadManualAdd,
            boolean alsoMatchEmail) {

        public RepeatLeadSettings {
            if (reattempt == null) reattempt = ReattemptSettings.OFF;
        }

        /** {@code alsoMatchEmail} off. */
        public RepeatLeadSettings(CounsellorMode counsellorMode, String specificCounsellorId,
                String specificCounsellorName, StatusMode statusMode, boolean samePersonByPhone,
                boolean blockOwnedManualAdd, ReattemptSettings reattempt, boolean blockOpenLeadManualAdd) {
            this(counsellorMode, specificCounsellorId, specificCounsellorName, statusMode, samePersonByPhone,
                    blockOwnedManualAdd, reattempt, blockOpenLeadManualAdd, false);
        }

        /** {@code blockOpenLeadManualAdd} off. */
        public RepeatLeadSettings(CounsellorMode counsellorMode, String specificCounsellorId,
                String specificCounsellorName, StatusMode statusMode, boolean samePersonByPhone,
                boolean blockOwnedManualAdd, ReattemptSettings reattempt) {
            this(counsellorMode, specificCounsellorId, specificCounsellorName, statusMode, samePersonByPhone,
                    blockOwnedManualAdd, reattempt, false);
        }

        /** Reattempt switches off. */
        public RepeatLeadSettings(CounsellorMode counsellorMode, String specificCounsellorId,
                String specificCounsellorName, StatusMode statusMode, boolean samePersonByPhone,
                boolean blockOwnedManualAdd) {
            this(counsellorMode, specificCounsellorId, specificCounsellorName, statusMode, samePersonByPhone,
                    blockOwnedManualAdd, ReattemptSettings.OFF);
        }

        /** Both phone switches and the reattempt switches off. */
        public RepeatLeadSettings(CounsellorMode counsellorMode, String specificCounsellorId,
                String specificCounsellorName, StatusMode statusMode) {
            this(counsellorMode, specificCounsellorId, specificCounsellorName, statusMode, false, false);
        }
    }

    public record DedupSettings(boolean enabled, DedupField field, DedupScope scope, List<String> audienceIds,
            DedupAction action, RepeatLeadSettings repeatLead) {
    }

    public static final RepeatLeadSettings DEFAULT_REPEAT_LEAD = new RepeatLeadSettings(
            CounsellorMode.SAME_AS_PREVIOUS, null, null, StatusMode.KEEP_EXISTING);

    public static final DedupSettings DEFAULTS = new DedupSettings(
            false, DedupField.EMAIL, DedupScope.CAMPAIGN, Collections.emptyList(),
            DedupAction.REJECT, DEFAULT_REPEAT_LEAD);

    private final InstituteRepository instituteRepository;
    private final ObjectMapper objectMapper;

    private final Cache<String, DedupSettings> byInstituteId = Caffeine.newBuilder()
            .maximumSize(2000)
            .expireAfterWrite(Duration.ofMinutes(5))
            .build();

    /** Cached 5-min; defaults to disabled / reject. */
    public DedupSettings get(String instituteId) {
        if (instituteId == null || instituteId.isBlank()) return DEFAULTS;
        return byInstituteId.get(instituteId, this::load);
    }

    private DedupSettings load(String instituteId) {
        try {
            String settingJson = instituteRepository.findById(instituteId)
                    .map(i -> i.getSetting())
                    .orElse(null);
            if (settingJson == null || settingJson.isBlank()) return DEFAULTS;

            JsonNode root = objectMapper.readTree(settingJson);
            JsonNode dedup = root.path("setting").path("LEAD_SETTING").path("data").path("dedup");
            if (!dedup.isObject()) return DEFAULTS;

            boolean enabled = dedup.path("enabled").asBoolean(false);
            DedupField field = parseField(dedup.path("field"), instituteId);
            DedupScope scope = parseScope(dedup.path("scope"), instituteId);
            List<String> audienceIds = parseAudienceIds(dedup.path("audienceIds"));
            DedupAction action = parseAction(dedup.path("action"), instituteId);
            RepeatLeadSettings repeatLead = parseRepeatLead(dedup.path("repeatLead"), instituteId);

            return new DedupSettings(enabled, field, scope, audienceIds, action, repeatLead);
        } catch (Exception e) {
            log.warn("Failed to read lead dedup settings for institute {} — using defaults: {}",
                    instituteId, e.getMessage());
            return DEFAULTS;
        }
    }

    private DedupField parseField(JsonNode node, String instituteId) {
        if (!node.isTextual()) return DEFAULTS.field();
        try {
            return DedupField.valueOf(node.asText().trim().toUpperCase());
        } catch (Exception e) {
            log.warn("Invalid dedup field '{}' for institute {} — using default {}",
                    node.asText(), instituteId, DEFAULTS.field());
            return DEFAULTS.field();
        }
    }

    private DedupScope parseScope(JsonNode node, String instituteId) {
        if (!node.isTextual()) return DEFAULTS.scope();
        try {
            return DedupScope.valueOf(node.asText().trim().toUpperCase());
        } catch (Exception e) {
            log.warn("Invalid dedup scope '{}' for institute {} — using default {}",
                    node.asText(), instituteId, DEFAULTS.scope());
            return DEFAULTS.scope();
        }
    }

    private List<String> parseAudienceIds(JsonNode node) {
        if (!node.isArray()) return Collections.emptyList();
        List<String> ids = new ArrayList<>();
        for (JsonNode item : node) {
            if (item.isTextual() && !item.asText().isBlank()) {
                ids.add(item.asText().trim());
            }
        }
        return ids;
    }

    private DedupAction parseAction(JsonNode node, String instituteId) {
        if (!node.isTextual()) return DEFAULTS.action();
        try {
            return DedupAction.valueOf(node.asText().trim().toUpperCase());
        } catch (Exception e) {
            log.warn("Invalid dedup action '{}' for institute {} — using default {}",
                    node.asText(), instituteId, DEFAULTS.action());
            return DEFAULTS.action();
        }
    }

    private RepeatLeadSettings parseRepeatLead(JsonNode node, String instituteId) {
        if (!node.isObject()) return DEFAULT_REPEAT_LEAD;

        CounsellorMode counsellorMode = DEFAULT_REPEAT_LEAD.counsellorMode();
        JsonNode counsellorModeNode = node.path("counsellorMode");
        if (counsellorModeNode.isTextual()) {
            try {
                counsellorMode = CounsellorMode.valueOf(counsellorModeNode.asText().trim().toUpperCase());
            } catch (Exception e) {
                log.warn("Invalid repeat-lead counsellorMode '{}' for institute {} — using default {}",
                        counsellorModeNode.asText(), instituteId, DEFAULT_REPEAT_LEAD.counsellorMode());
            }
        }

        String specificCounsellorId = node.path("specificCounsellorId").isTextual()
                ? node.path("specificCounsellorId").asText().trim() : null;
        String specificCounsellorName = node.path("specificCounsellorName").isTextual()
                ? node.path("specificCounsellorName").asText().trim() : null;
        // SPECIFIC with no id configured has nothing to assign — fall back to a no-op
        // rather than silently leaving every repeat lead unassigned.
        if (counsellorMode == CounsellorMode.SPECIFIC
                && (specificCounsellorId == null || specificCounsellorId.isBlank())) {
            counsellorMode = CounsellorMode.SAME_AS_PREVIOUS;
        }

        StatusMode statusMode = DEFAULT_REPEAT_LEAD.statusMode();
        JsonNode statusModeNode = node.path("statusMode");
        if (statusModeNode.isTextual()) {
            try {
                statusMode = StatusMode.valueOf(statusModeNode.asText().trim().toUpperCase());
            } catch (Exception e) {
                log.warn("Invalid repeat-lead statusMode '{}' for institute {} — using default {}",
                        statusModeNode.asText(), instituteId, DEFAULT_REPEAT_LEAD.statusMode());
            }
        }

        return new RepeatLeadSettings(counsellorMode, specificCounsellorId, specificCounsellorName, statusMode,
                node.path("samePersonByPhone").asBoolean(false),
                node.path("blockOwnedManualAdd").asBoolean(false),
                parseReattempt(node.path("reattempt")),
                node.path("blockOpenLeadManualAdd").asBoolean(false),
                node.path("alsoMatchEmail").asBoolean(false));
    }

    private ReattemptSettings parseReattempt(JsonNode node) {
        if (!node.isObject()) return ReattemptSettings.OFF;
        return new ReattemptSettings(
                node.path("markDuplicate").asBoolean(false),
                node.path("journeyEntry").asBoolean(false),
                node.path("notifyOwner").asBoolean(false),
                node.path("showBadge").asBoolean(false),
                node.path("followUp").asBoolean(false),
                node.path("tier").isTextual() ? node.path("tier").asText() : null,
                node.path("duplicateOpenOnly").asBoolean(true),
                node.path("duplicatesTabOnly").asBoolean(false));
    }
}
