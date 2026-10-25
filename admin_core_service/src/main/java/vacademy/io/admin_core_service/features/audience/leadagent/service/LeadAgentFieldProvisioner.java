package vacademy.io.admin_core_service.features.audience.leadagent.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Creates the Lead Agent's {@code la_*} custom fields once per institute and attaches them to a
 * lead list's AUDIENCE_FORM schema (idempotent), so the values a delivered lead carries render as
 * columns of that list and are never orphaned.
 *
 * <p>Field keys follow the platform convention {@code <name>_inst_<instituteId>}
 * ({@code CustomFieldKeyGenerator}), so one set of fields per institute is shared by every list
 * that has a Lead Agent. Runs under a per-institute advisory lock so two concurrent intakes
 * cannot create the same field twice.
 *
 * <p>Note: attaching a field to a list also adds it to that list's public form (the learner form
 * does not filter {@code is_hidden}); the Lead Agent should be set up on a list of its own.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class LeadAgentFieldProvisioner {

    /** la_* key → column label (LEAD_AGENT_BUILD_SPEC §5), in display order. */
    public static final Map<String, String> FIELDS;

    static {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("la_org_name", "Organisation");
        f.put("la_website", "Website");
        f.put("la_city", "City");
        f.put("la_role", "Role");
        f.put("la_contact_quality", "How to reach");
        f.put("la_other_contacts", "Other contacts");
        f.put("la_score", "Lead score");
        f.put("la_why", "Why this lead");
        f.put("la_opening", "Opening question");
        f.put("la_platforms", "Platforms they use");
        f.put("la_source_url", "Source page");
        FIELDS = java.util.Collections.unmodifiableMap(f);
    }

    /** Form order given to the attached fields: after the list's own questions. */
    static final int FIRST_ORDER = 100;

    private final CustomFieldRepository customFieldRepository;
    private final AudienceService audienceService;
    private final LeadAgentContactLookup lookup;

    static String fieldKey(String laKey, String instituteId) {
        return laKey + "_inst_" + instituteId;
    }

    /** Ensures every la_* field exists and is attached to the list; returns la_* key → custom_field_id. */
    @Transactional
    public Map<String, String> ensureFields(String instituteId, String audienceId) {
        lookup.lock("lead-agent-fields:" + instituteId);
        Map<String, String> ids = new LinkedHashMap<>();
        int order = FIRST_ORDER;
        for (Map.Entry<String, String> e : FIELDS.entrySet()) {
            String key = fieldKey(e.getKey(), instituteId);
            CustomFields field = customFieldRepository
                    .findTopByFieldKeyAndStatusOrderByCreatedAtDesc(key, "ACTIVE")
                    .orElseGet(() -> {
                        log.info("Lead Agent: creating custom field {} for institute {}", key, instituteId);
                        return customFieldRepository.save(CustomFields.builder()
                                .fieldKey(key)
                                .fieldName(e.getValue())
                                .fieldType("text")
                                .config("{}")
                                .formOrder(0)
                                .isMandatory(false)
                                .isFilter(false)
                                .isSortable(false)
                                .isHidden(false)
                                .status("ACTIVE")
                                .build());
                    });
            audienceService.attachFieldToLeadList(instituteId, audienceId, field.getId(), order++);
            ids.put(e.getKey(), field.getId());
        }
        return ids;
    }
}
