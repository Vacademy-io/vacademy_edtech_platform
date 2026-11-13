package vacademy.io.admin_core_service.features.audience.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.entity.InstituteCustomField;
import vacademy.io.admin_core_service.features.common.enums.StatusEnum;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.util.CustomFieldKeyGenerator;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Creates and finds the lead list that belongs to ONE public live session or ONE open
 * assessment, so every webinar and every open test gets its own list without any setup.
 *
 * <p>The list is named after what the admin typed — {@code "<Title> - Public Live Session"} /
 * {@code "<Title> - Open Assessment"} — and its campaign type is the same readable label.
 * Which session or test it belongs to is kept in the list's own {@code setting_json} under
 * {@value #SOURCE_KEY}, not in the name, so renaming the list (or the test) never makes the
 * next registrant create a second one. The admin campaign form merges into setting_json
 * rather than replacing it, so the link survives an edit of the list.
 */
@Service
public class AutoLeadListProvisioner {

    private static final Logger logger = LoggerFactory.getLogger(AutoLeadListProvisioner.class);

    /** Campaign type, and name suffix, of a public live session's list. */
    public static final String PUBLIC_LIVE_SESSION = "Public Live Session";
    /** Campaign type, and name suffix, of an open assessment's list. */
    public static final String OPEN_ASSESSMENT = "Open Assessment";

    /** Key inside audience.setting_json: {"type": PUBLIC_LIVE_SESSION|OPEN_ASSESSMENT, "id": source id}. */
    static final String SOURCE_KEY = "autoLeadListSource";

    /** campaign_name is a varchar(255). */
    private static final int MAX_NAME_LENGTH = 255;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Autowired
    private AudienceRepository audienceRepository;

    @Autowired
    private AudienceResponseRepository audienceResponseRepository;

    @Autowired
    private CustomFieldRepository customFieldRepository;

    @Autowired
    private InstituteCustomFieldRepository instituteCustomFieldRepository;

    @Autowired
    private CustomFieldKeyGenerator keyGenerator;

    /**
     * The list for this session / test, created on first use. Runs in its own transaction
     * because it holds an advisory lock: two people registering at the same moment must not
     * create two lists.
     *
     * @param type     {@link #PUBLIC_LIVE_SESSION} or {@link #OPEN_ASSESSMENT}
     * @param sourceId live session id or assessment id
     * @param title    the session / test title the admin typed; only used when creating
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Audience getOrCreate(String instituteId, String type, String sourceId, String title) {
        Optional<Audience> existing = find(instituteId, type, sourceId);
        if (existing.isPresent()) return existing.get();

        audienceResponseRepository.acquireTransactionLock("auto-lead-list:" + type + ":" + sourceId);
        return find(instituteId, type, sourceId).orElseGet(() -> {
            Audience saved = audienceRepository.save(Audience.builder()
                    .id(UUID.randomUUID().toString())
                    .instituteId(instituteId)
                    .campaignName(listName(title, type))
                    .campaignType(type)
                    .campaignObjective("LEAD_GENERATION")
                    .description(OPEN_ASSESSMENT.equals(type)
                            ? "Leads captured from this open assessment's registration form"
                            : "Leads captured from this public live session's registration form")
                    .status("ACTIVE")
                    .defaultInitialScore(20)
                    .settingJson(sourceJson(type, sourceId))
                    .build());
            logger.info("Auto-created {} lead list {} ({}) for {} in institute {}",
                    type, saved.getId(), saved.getCampaignName(), sourceId, instituteId);
            return saved;
        });
    }

    /**
     * The list already created for this session / test, if any — whatever its status. A
     * paused, archived or DELETED list is returned too and the caller skips it: an admin who
     * deleted a test's list did not want it, so it is never silently re-created.
     */
    public Optional<Audience> find(String instituteId, String type, String sourceId) {
        if (!StringUtils.hasText(instituteId) || !StringUtils.hasText(sourceId)) return Optional.empty();
        List<Audience> matches = audienceRepository
                .findByInstituteIdAndSettingJsonContainingOrderByCreatedAtAsc(instituteId, sourceId)
                .stream()
                .filter(a -> isSourceOf(a.getSettingJson(), type, sourceId))
                .toList();
        return matches.stream()
                .filter(a -> "ACTIVE".equalsIgnoreCase(a.getStatus()))
                .findFirst()
                .or(() -> matches.stream().findFirst());
    }

    /**
     * Make sure the list has a text column called {@code fieldName} and return its
     * custom_field id. In order:
     * <ol>
     *   <li>a field of that name already on this list (the admin may have added it);</li>
     *   <li>the institute's ACTIVE field with the key the settings screens generate for that
     *       name, so "Class" stays one column across the institute;</li>
     *   <li>a new TEXT field.</li>
     * </ol>
     * An existing field is never edited, and an INACTIVE one is never re-activated — that
     * would bring a field the admin switched off back onto every other form that uses it; a
     * new field with a free key is created instead.
     *
     * @return the custom_field id, or null when the admin removed a column of that name from
     *         this list — the caller then leaves that value out
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public String ensureField(String instituteId, String audienceId, String fieldName, int order) {
        String name = fieldName.trim();
        for (Object[] row : instituteCustomFieldRepository.findInstituteCustomFieldsWithDetails(
                instituteId, "AUDIENCE_FORM", audienceId)) {
            InstituteCustomField link = (InstituteCustomField) row[0];
            CustomFields onList = (CustomFields) row[1];
            if (onList == null || onList.getFieldName() == null
                    || !name.equalsIgnoreCase(onList.getFieldName().trim())) {
                continue;
            }
            // The admin removed this column from the list (or switched the field off): leave
            // it out rather than putting it back.
            if (!StatusEnum.ACTIVE.name().equalsIgnoreCase(link.getStatus())
                    || !StatusEnum.ACTIVE.name().equalsIgnoreCase(onList.getStatus())) {
                return null;
            }
            return onList.getId();
        }

        String baseKey = keyGenerator.generateFieldKey(name, instituteId);
        // The row locks below cannot stop two first-time inserts of the same new key (there is
        // no row yet to lock), and field_key is UNIQUE — serialize on the key instead.
        audienceResponseRepository.acquireTransactionLock("custom-field-key:" + baseKey);
        CustomFields field = activeOrNewField(baseKey, name, order);

        boolean linked = instituteCustomFieldRepository
                .findTopByInstituteIdAndCustomFieldIdAndTypeAndTypeIdAndStatusOrderByCreatedAtDesc(
                        instituteId, field.getId(), "AUDIENCE_FORM", audienceId, StatusEnum.ACTIVE.name())
                .isPresent();
        if (!linked) {
            instituteCustomFieldRepository.save(InstituteCustomField.builder()
                    .instituteId(instituteId)
                    .customFieldId(field.getId())
                    .type("AUDIENCE_FORM")
                    .typeId(audienceId)
                    .status(StatusEnum.ACTIVE.name())
                    .isMandatory(false)
                    .individualOrder(order)
                    .groupInternalOrder(0)
                    .build());
        }
        return field.getId();
    }

    /**
     * The ACTIVE field under {@code baseKey}, or under {@code baseKey_1}, {@code _2}… (the
     * suffixes the settings screens use for a second field of the same name); else a new TEXT
     * field on the first key nobody holds. A key held only by an INACTIVE field is skipped,
     * never re-activated. Caller holds the advisory lock on {@code baseKey}.
     */
    private CustomFields activeOrNewField(String baseKey, String name, int order) {
        for (int n = 0; n <= 50; n++) {
            String key = n == 0 ? baseKey : baseKey + "_" + n;
            List<CustomFields> rows = customFieldRepository.findByFieldKeyAnyStatusWithLock(key);
            if (rows.isEmpty()) {
                return customFieldRepository.save(CustomFields.builder()
                        .fieldKey(key)
                        .fieldName(name)
                        .fieldType("TEXT")
                        .formOrder(order)
                        .isMandatory(false)
                        .isFilter(false)
                        .isSortable(false)
                        .isHidden(false)
                        .status(StatusEnum.ACTIVE.name())
                        .build());
            }
            Optional<CustomFields> active = rows.stream()
                    .filter(cf -> StatusEnum.ACTIVE.name().equalsIgnoreCase(cf.getStatus()))
                    .findFirst();
            if (active.isPresent()) return active.get();
        }
        throw new IllegalStateException("No free custom field key for " + baseKey);
    }

    /** "<Title> - <Type>", falling back to just the type when the title is blank. */
    static String listName(String title, String type) {
        String suffix = " - " + type;
        if (!StringUtils.hasText(title)) return type;
        String trimmed = title.trim();
        int room = MAX_NAME_LENGTH - suffix.length();
        if (trimmed.length() > room) trimmed = trimmed.substring(0, room).trim();
        return trimmed + suffix;
    }

    static String sourceJson(String type, String sourceId) {
        ObjectNode root = MAPPER.createObjectNode();
        ObjectNode source = root.putObject(SOURCE_KEY);
        source.put("type", type);
        source.put("id", sourceId);
        return root.toString();
    }

    static boolean isSourceOf(String settingJson, String type, String sourceId) {
        if (!StringUtils.hasText(settingJson)) return false;
        try {
            JsonNode source = MAPPER.readTree(settingJson).path(SOURCE_KEY);
            return type.equals(source.path("type").asText(null))
                    && sourceId.equals(source.path("id").asText(null));
        } catch (Exception e) {
            return false;
        }
    }
}
