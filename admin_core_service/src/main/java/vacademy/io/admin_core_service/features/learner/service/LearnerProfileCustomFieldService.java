package vacademy.io.admin_core_service.features.learner.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.dto.request.CustomFieldValueDto;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.common.repository.InstituteCustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.SystemFieldCustomFieldMappingRepository;
import vacademy.io.admin_core_service.features.common.service.CustomFieldValueService;
import vacademy.io.admin_core_service.features.institute.dto.settings.InstituteSettingDto;
import vacademy.io.admin_core_service.features.institute.dto.settings.SettingDto;
import vacademy.io.common.institute.entity.Institute;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.institute.service.setting.InstituteSettingService;
import vacademy.io.admin_core_service.features.invoice.dto.InvoiceNumberConfig;
import vacademy.io.admin_core_service.features.institute_learner.repository.StudentSessionRepository;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileCustomFieldDTO;
import vacademy.io.admin_core_service.features.learner.dto.LearnerProfileCustomFieldValueDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Custom fields a learner sees and edits on their own profile in the learner app.
 *
 * A field shows when the institute ticked "Learner Profile" for it in Settings, or when the
 * learner already has a value for it: an enroll-invite or course-purchase answer, or a value an
 * admin typed in. Left out are the built-in Full Name / Email / Phone fields (the profile shows
 * the account's own), hidden form fields (the learner never saw them) and deleted fields.
 *
 * Only these fields can be saved from the learner app, and only as the learner's own value
 * (a USER row, the same row an admin edit writes). Fields the institute's own rules read are
 * shown but locked: a field that picks an invoice / receipt numbering series (a learner must not
 * move their own receipts to another series) and a field synced into a system column (that
 * write would skip the account checks the main profile edit applies). If the institute's
 * settings can't be read, every field is locked rather than guessing.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LearnerProfileCustomFieldService {

    static final String CUSTOM_FIELD_SETTING_KEY = "CUSTOM_FIELD_SETTING";
    static final String INVOICE_SETTING_KEY = "INVOICE_SETTING";
    static final String USER_SOURCE = "USER";
    static final List<String> ENROLLMENT_SOURCES =
            List.of("STUDENT_SESSION_INSTITUTE_GROUP_MAPPING", "STUDENT_SESSION_MAPPING");

    private static final String LEARNER_PROFILE_LOCATION = "learnerprofile";
    private static final String DELETED = "DELETED";
    private static final Set<String> IDENTITY_FIELDS = Set.of(
            "name", "fullname", "email", "emailid", "emailaddress",
            "phone", "phonenumber", "mobile", "mobilenumber", "contactnumber");

    private final CustomFieldValuesRepository customFieldValuesRepository;
    private final CustomFieldRepository customFieldRepository;
    private final InstituteCustomFieldRepository instituteCustomFieldRepository;
    private final SystemFieldCustomFieldMappingRepository systemFieldCustomFieldMappingRepository;
    private final InstituteRepository instituteRepository;
    private final StudentSessionRepository studentSessionRepository;
    private final InstituteSettingService instituteSettingService;
    private final CustomFieldValueService customFieldValueService;
    private final ObjectMapper objectMapper;

    /** The learner's profile fields in this institute; empty when they are not enrolled in it. */
    public List<LearnerProfileCustomFieldDTO> getProfileFields(String userId, String instituteId) {
        List<String> enrollmentIds = enrollmentIds(userId, instituteId);
        if (enrollmentIds.isEmpty()) {
            return List.of();
        }
        return buildProfileFields(userId, instituteId, enrollmentIds);
    }

    /**
     * Saves the learner's own values for fields on their profile and returns the refreshed list.
     * A field that is not on their profile is refused, so the learner app cannot write arbitrary fields.
     */
    @Transactional
    public List<LearnerProfileCustomFieldDTO> saveProfileFields(String userId, String instituteId,
                                                                List<LearnerProfileCustomFieldValueDTO> values) {
        List<String> enrollmentIds = enrollmentIds(userId, instituteId);
        if (enrollmentIds.isEmpty()) {
            throw new VacademyException(HttpStatus.FORBIDDEN, "You are not a learner of this institute");
        }
        if (CollectionUtils.isEmpty(values)) {
            return buildProfileFields(userId, instituteId, enrollmentIds);
        }

        Set<String> editable = buildProfileFields(userId, instituteId, enrollmentIds).stream()
                .filter(LearnerProfileCustomFieldDTO::isEditable)
                .map(LearnerProfileCustomFieldDTO::getCustomFieldId)
                .collect(Collectors.toSet());

        // Last value wins when the same field is sent twice.
        Map<String, String> latest = new LinkedHashMap<>();
        for (LearnerProfileCustomFieldValueDTO value : values) {
            if (value == null || !StringUtils.hasText(value.getCustomFieldId())) {
                continue;
            }
            if (!editable.contains(value.getCustomFieldId())) {
                throw new VacademyException(HttpStatus.FORBIDDEN, "This field can't be edited from your profile");
            }
            latest.put(value.getCustomFieldId(), value.getValue() == null ? "" : value.getValue());
        }

        List<CustomFieldValueDto> rows = new ArrayList<>();
        latest.forEach((customFieldId, value) -> {
            CustomFieldValueDto row = new CustomFieldValueDto();
            row.setCustomFieldId(customFieldId);
            row.setSourceType(USER_SOURCE);
            row.setSourceId(userId);
            row.setValue(value);
            rows.add(row);
        });
        customFieldValueService.upsertCustomFieldValues(rows);

        return buildProfileFields(userId, instituteId, enrollmentIds);
    }

    private List<String> enrollmentIds(String userId, String instituteId) {
        if (!StringUtils.hasText(userId) || !StringUtils.hasText(instituteId)) {
            return List.of();
        }
        List<String> ids = studentSessionRepository.findIdsByUserIdAndInstituteId(userId, instituteId);
        return ids == null ? List.of() : ids;
    }

    private List<LearnerProfileCustomFieldDTO> buildProfileFields(String userId, String instituteId,
                                                                  List<String> enrollmentIds) {
        InstituteRules rules = loadInstituteRules(instituteId);
        Map<String, Integer> profileOrder = rules.profileOrder();
        Map<String, String> values = currentValues(
                customFieldValuesRepository.findBySourceTypeAndSourceId(USER_SOURCE, userId),
                customFieldValuesRepository.findBySourceTypeInAndSourceIdIn(ENROLLMENT_SOURCES, enrollmentIds));

        Set<String> candidates = new LinkedHashSet<>(profileOrder.keySet());
        values.forEach((customFieldId, value) -> {
            if (StringUtils.hasText(value)) {
                candidates.add(customFieldId);
            }
        });
        if (candidates.isEmpty()) {
            return List.of();
        }

        Set<String> mapped = new HashSet<>(
                instituteCustomFieldRepository.findActiveCustomFieldIdsForInstitute(instituteId, candidates));
        List<String> fieldIds = candidates.stream().filter(mapped::contains).toList();
        if (fieldIds.isEmpty()) {
            return List.of();
        }

        Set<String> locked = new HashSet<>(rules.numberingFieldIds());
        List<String> synced = systemFieldCustomFieldMappingRepository.findCustomFieldIdsWithSystemSync(fieldIds);
        if (synced != null) {
            locked.addAll(synced);
        }

        return customFieldRepository.findAllById(fieldIds).stream()
                .filter(LearnerProfileCustomFieldService::isShownOnProfile)
                .sorted(profileComparator(profileOrder))
                .map(field -> LearnerProfileCustomFieldDTO.builder()
                        .customFieldId(field.getId())
                        .fieldKey(field.getFieldKey())
                        .fieldName(field.getFieldName())
                        .fieldType(field.getFieldType())
                        .config(field.getConfig())
                        .value(StringUtils.hasText(values.get(field.getId())) ? values.get(field.getId()) : null)
                        .editable(rules.readable() && !locked.contains(field.getId()))
                        .build())
                .toList();
    }

    /** What the institute's settings say about profile fields, read once per request. */
    record InstituteRules(Map<String, Integer> profileOrder, Set<String> numberingFieldIds, boolean readable) {
        static InstituteRules unreadable() {
            return new InstituteRules(Map.of(), Set.of(), false);
        }
    }

    @SuppressWarnings("unchecked")
    private InstituteRules loadInstituteRules(String instituteId) {
        try {
            Institute institute = instituteRepository.findById(instituteId).orElse(null);
            if (institute == null) {
                return InstituteRules.unreadable();
            }
            InstituteSettingDto settings = instituteSettingService.getAllSettings(institute);
            Map<String, SettingDto> byKey = settings == null || settings.getSetting() == null
                    ? Map.of() : settings.getSetting();
            SettingDto customFieldSetting = byKey.get(CUSTOM_FIELD_SETTING_KEY);
            SettingDto invoiceSetting = byKey.get(INVOICE_SETTING_KEY);

            Map<String, Integer> profileOrder = learnerProfileFieldOrder(
                    customFieldSetting == null || customFieldSetting.getData() == null
                            ? null : objectMapper.valueToTree(customFieldSetting.getData()));
            Object invoiceData = invoiceSetting == null ? null : invoiceSetting.getData();
            Set<String> numberingFieldIds = numberingFieldIds(
                    invoiceData instanceof Map ? InvoiceNumberConfig.fromInvoiceSettings((Map<String, Object>) invoiceData) : null);
            return new InstituteRules(profileOrder, numberingFieldIds, true);
        } catch (Exception e) {
            log.warn("Could not read the settings of institute {}: {}", instituteId, e.getMessage());
            return InstituteRules.unreadable();
        }
    }

    /** Every custom field an invoice / receipt numbering series is picked by. */
    static Set<String> numberingFieldIds(InvoiceNumberConfig config) {
        Set<String> ids = new HashSet<>();
        if (config == null) {
            return ids;
        }
        if (config.getSeries() != null) {
            for (InvoiceNumberConfig.Series series : config.getSeries()) {
                if (series != null && StringUtils.hasText(series.getLearnerFieldId())) {
                    ids.add(series.getLearnerFieldId().trim());
                }
            }
        }
        String askFieldId = config.askFieldId();
        if (StringUtils.hasText(askFieldId)) {
            ids.add(askFieldId.trim());
        }
        return ids;
    }

    /**
     * Field id → display order for every field the institute ticked "Learner Profile" for.
     * Accepts the setting's data node either as stored ({data: {...}}) or already unwrapped.
     */
    static Map<String, Integer> learnerProfileFieldOrder(JsonNode setting) {
        Map<String, Integer> order = new LinkedHashMap<>();
        if (setting == null || setting.isNull() || setting.isMissingNode()) {
            return order;
        }
        JsonNode data = setting.has("currentCustomFieldsAndGroups") ? setting : setting.path("data");

        List<JsonNode> entries = new ArrayList<>();
        data.path("currentCustomFieldsAndGroups").forEach(entries::add);
        data.path("customGroup").forEach(entries::add);

        int position = 0;
        for (JsonNode entry : entries) {
            position++;
            String customFieldId = text(entry, "customFieldId", "custom_field_id");
            if (!StringUtils.hasText(customFieldId)
                    || DELETED.equalsIgnoreCase(text(entry, "status"))
                    || !hasLearnerProfileLocation(entry.path("locations"))) {
                continue;
            }
            JsonNode individualOrder = entry.has("individualOrder") ? entry.path("individualOrder")
                    : entry.path("individual_order");
            int fieldOrder = individualOrder.isNumber() ? individualOrder.asInt() : position;
            order.merge(customFieldId, fieldOrder, Math::min);
        }
        return order;
    }

    /**
     * The value the learner currently has per field: their newest profile (USER) row, the same
     * row an edit updates; otherwise the newest row on one of their enrollments.
     */
    static Map<String, String> currentValues(List<CustomFieldValues> userRows, List<CustomFieldValues> enrollmentRows) {
        Map<String, String> values = new HashMap<>();
        Comparator<CustomFieldValues> newestFirst = Comparator
                .comparing(CustomFieldValues::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(CustomFieldValues::getId, Comparator.nullsLast(Comparator.reverseOrder()));
        for (List<CustomFieldValues> rows : List.of(
                userRows == null ? List.<CustomFieldValues>of() : userRows,
                enrollmentRows == null ? List.<CustomFieldValues>of() : enrollmentRows)) {
            rows.stream()
                    .filter(row -> row != null && StringUtils.hasText(row.getCustomFieldId()))
                    .sorted(newestFirst)
                    .forEach(row -> values.putIfAbsent(row.getCustomFieldId(), row.getValue()));
        }
        return values;
    }

    static boolean isShownOnProfile(CustomFields field) {
        if (field == null || DELETED.equalsIgnoreCase(field.getStatus())) {
            return false;
        }
        if (Boolean.TRUE.equals(field.getIsHidden())) {
            return false;
        }
        return !isIdentityField(field);
    }

    static boolean isIdentityField(CustomFields field) {
        String key = field.getFieldKey() == null ? null : field.getFieldKey().replaceFirst("(?i)_inst_.*$", "");
        return IDENTITY_FIELDS.contains(normalise(key)) || IDENTITY_FIELDS.contains(normalise(field.getFieldName()));
    }

    private static Comparator<CustomFields> profileComparator(Map<String, Integer> profileOrder) {
        return Comparator
                .comparing((CustomFields field) -> profileOrder.getOrDefault(field.getId(), Integer.MAX_VALUE))
                .thenComparing(field -> field.getFormOrder() == null ? Integer.MAX_VALUE : field.getFormOrder())
                .thenComparing(field -> field.getFieldName() == null ? "" : field.getFieldName().toLowerCase(Locale.ROOT));
    }

    private static boolean hasLearnerProfileLocation(JsonNode locations) {
        if (locations == null || !locations.isArray()) {
            return false;
        }
        for (JsonNode location : locations) {
            if (LEARNER_PROFILE_LOCATION.equals(normalise(location.asText(null)))) {
                return true;
            }
        }
        return false;
    }

    private static String text(JsonNode node, String... names) {
        for (String name : names) {
            JsonNode value = node.path(name);
            if (value.isTextual()) {
                return value.asText();
            }
        }
        return null;
    }

    private static String normalise(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }
}
