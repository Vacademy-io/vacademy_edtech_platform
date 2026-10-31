package vacademy.io.admin_core_service.features.catalog_api.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.CatalogueLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;

import java.util.*;
import java.util.regex.Pattern;

/**
 * POST /leads: an enquiry from the institute's own site, into the CRM exactly as the hosted
 * catalogue's "Get Started" form lands ({@link AudienceService#submitCatalogueLead}): the
 * campaign named by {@code campaign_id} when it is an ACTIVE audience of the institute, else
 * the auto-provisioned "Course Catalogue Leads" list. Tagged {@code source_type=CATALOG_API},
 * {@code source_id = course_id ‖ "catalog-api"}.
 */
@Slf4j
@Service
public class CatalogLeadService {

    public static final String SOURCE_TYPE = "CATALOG_API";
    public static final String DEFAULT_SOURCE_ID = "catalog-api";
    static final int MAX_NAME = 200;
    static final int MAX_MESSAGE = 2000;
    static final int MAX_EMAIL = 254;
    static final int MAX_CUSTOM_FIELDS = 30;
    static final int MAX_CUSTOM_KEY = 64;
    static final int MAX_CUSTOM_VALUE = 1000;

    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    private static final Pattern PHONE = Pattern.compile("^\\+?[0-9 ()\\-.]{6,24}$");
    private static final Pattern UUID_SHAPED = Pattern.compile(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);
    private static final Pattern FIELD_KEY = Pattern.compile("^[A-Za-z0-9_\\-. ]+$");

    private final AudienceService audienceService;
    private final CatalogApiService catalogApiService;

    public CatalogLeadService(AudienceService audienceService, CatalogApiService catalogApiService) {
        this.audienceService = audienceService;
        this.catalogApiService = catalogApiService;
    }

    /** The validated request body. */
    public record Lead(String fullName, String email, String phone, String message, String courseId,
                       String campaignId, String source, Map<String, String> customFields) {
    }

    /** {@code received} → 201, {@code duplicate} → 200. */
    public record Outcome(String status) {
        public boolean created() {
            return "received".equals(status);
        }
    }

    /** Validates the raw body (snake_case fields) into a {@link Lead}; 400 invalid_request on the first problem. */
    /** Keys the lead's own fields use; custom_fields may not carry them. */
    static final Set<String> RESERVED_FIELDS = Set.of("full_name", "fullname", "name", "email", "phone",
            "mobile", "mobile_number", "message", "source", "course_id");

    public static Lead validate(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw invalid("Send a JSON object with full_name and email.", null);
        }
        String fullName = str(body, "full_name");
        if (fullName == null) throw invalid("full_name is required.", "full_name");
        if (fullName.length() > MAX_NAME) throw invalid("full_name must be at most " + MAX_NAME + " characters.", "full_name");
        String email = str(body, "email");
        if (email == null) throw invalid("email is required.", "email");
        if (!isValidEmail(email)) {
            throw invalid("email is not a valid email address.", "email");
        }
        String phone = str(body, "phone");
        if (phone != null && !isValidPhone(phone)) {
            throw invalid("phone must be a phone number, e.g. +91 98765 43210.", "phone");
        }
        String message = str(body, "message");
        if (message != null && message.length() > MAX_MESSAGE) {
            throw invalid("message must be at most " + MAX_MESSAGE + " characters.", "message");
        }
        String courseId = str(body, "course_id");
        if (courseId != null && courseId.length() > 64) throw invalid("course_id is not a course id.", "course_id");
        String campaignId = str(body, "campaign_id");
        if (campaignId != null && campaignId.length() > 64) throw invalid("campaign_id is not a campaign id.", "campaign_id");
        String source = str(body, "source");
        if (source != null && source.length() > 100) throw invalid("source must be at most 100 characters.", "source");

        Map<String, String> custom = parseCustomFields(body.get("custom_fields"));
        return new Lead(fullName, email, phone, message, courseId, campaignId, source, custom);
    }

    /**
     * {@code custom_fields}: an object of at most 30 text/number/boolean values, keys 1-64 of
     * letters, digits, spaces, '_', '-' or '.', values at most 1000 characters, never one of the
     * lead's own reserved fields; blank values dropped. Null or JSON null = none. 400 on a problem.
     */
    public static Map<String, String> parseCustomFields(JsonNode raw) {
        Map<String, String> custom = new LinkedHashMap<>();
        if (raw != null && !raw.isNull()) {
            if (!raw.isObject()) throw invalid("custom_fields must be an object of text values.", "custom_fields");
            if (raw.size() > MAX_CUSTOM_FIELDS) {
                throw invalid("custom_fields holds at most " + MAX_CUSTOM_FIELDS + " fields.", "custom_fields");
            }
            Iterator<Map.Entry<String, JsonNode>> it = raw.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                String key = e.getKey() == null ? "" : e.getKey().trim();
                if (key.isEmpty() || key.length() > MAX_CUSTOM_KEY || !FIELD_KEY.matcher(key).matches()) {
                    throw invalid("custom_fields keys are 1-" + MAX_CUSTOM_KEY
                            + " letters, digits, spaces, '_', '-' or '.'.", "custom_fields");
                }
                JsonNode v = e.getValue();
                if (v == null || v.isNull()) continue;
                if (!v.isValueNode()) throw invalid("custom_fields." + key + " must be text, a number or a boolean.", "custom_fields");
                String value = v.asText().trim();
                if (value.length() > MAX_CUSTOM_VALUE) {
                    throw invalid("custom_fields." + key + " must be at most " + MAX_CUSTOM_VALUE + " characters.", "custom_fields");
                }
                // The lead's own fields are set from the validated values; a custom field must
                // not shadow them in the lead list.
                if (RESERVED_FIELDS.contains(key.toLowerCase(Locale.ROOT))) {
                    throw invalid("custom_fields." + key + " is reserved; send it as the top-level field.", "custom_fields");
                }
                if (!value.isEmpty()) custom.put(key, value);
            }
        }
        return custom;
    }

    /** The catalogue lead email rule: at most 254 characters, one @, a dotted domain. */
    public static boolean isValidEmail(String email) {
        return email != null && email.length() <= MAX_EMAIL && EMAIL.matcher(email).matches();
    }

    /** The catalogue lead phone rule: digits with + ( ) - . and spaces, at least 6 digits. */
    public static boolean isValidPhone(String phone) {
        return phone != null && PHONE.matcher(phone).matches() && phone.replaceAll("\\D", "").length() >= 6;
    }

    public Outcome submit(String instituteId, Lead lead) {
        if (lead.courseId() != null && !catalogApiService.isCatalogueCourse(instituteId, lead.courseId())) {
            throw invalid("course_id is not a published course of this institute.", "course_id");
        }
        Map<String, String> fields = new LinkedHashMap<>(lead.customFields());
        if (lead.message() != null) fields.put("message", lead.message());
        if (lead.source() != null) fields.put("source", lead.source());
        if (lead.courseId() != null) fields.put("course_id", lead.courseId());

        CatalogueLeadRequestDTO dto = CatalogueLeadRequestDTO.builder()
                .instituteId(instituteId)
                .audienceId(lead.campaignId())
                .sourceType(SOURCE_TYPE)
                .sourceId(lead.courseId() != null ? lead.courseId() : DEFAULT_SOURCE_ID)
                .fullName(lead.fullName())
                .email(lead.email())
                .mobileNumber(lead.phone())
                .customFieldValues(fields)
                .build();
        String result = audienceService.submitCatalogueLead(dto);
        // A saved lead returns its audience_response id; a repeat (same person, same campaign, or
        // an institute dedup rule) returns a sentence instead.
        if (result != null && UUID_SHAPED.matcher(result.trim()).matches()) return new Outcome("received");
        log.info("catalog-api: lead for institute {} treated as duplicate: {}", instituteId, result);
        return new Outcome("duplicate");
    }

    private static String str(JsonNode body, String field) {
        JsonNode v = body.get(field);
        if (v == null || v.isNull()) return null;
        if (!v.isTextual()) throw invalid(field + " must be a string.", field);
        String s = v.asText().trim();
        return s.isEmpty() ? null : s;
    }

    private static CatalogApiException invalid(String message, String param) {
        Map<String, Object> details = new LinkedHashMap<>();
        if (param != null) details.put("param", param);
        return new CatalogApiException(HttpStatus.BAD_REQUEST, "invalid_request", message,
                details.isEmpty() ? null : details, null);
    }
}
