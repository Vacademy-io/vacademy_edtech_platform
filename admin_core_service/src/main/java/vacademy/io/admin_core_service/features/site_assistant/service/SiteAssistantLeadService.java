package vacademy.io.admin_core_service.features.site_assistant.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.dto.CatalogueLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.catalog_api.CatalogApiException;
import vacademy.io.admin_core_service.features.catalog_api.service.CatalogLeadService;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.utm_attribution.service.UtmAttributionService;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * POST /internal/site-assistant/v1/leads: a contact the Site Assistant collected (SPEC 3.2), into
 * the CRM through the same website-lead pipeline as the hosted catalogue form and the Catalogue API
 * ({@link AudienceService#submitCatalogueLead}): campaign_id when it is an ACTIVE audience of the
 * institute, else the auto "Course Catalogue Leads" list; institute dedup, scoring and counsellor
 * pool assignment unchanged.
 *
 * <ul>
 *   <li>{@code source_type = SITE_ASSISTANT}, {@code source_id = custom_fields.conversation_id}
 *       (else {@code site-assistant}).</li>
 *   <li>Context goes into custom field values, never into the lead's own fields: {@code lead_kind}
 *       (SALES | SUPPORT), {@code summary}, {@code reason}, {@code course_ids}, {@code page_url},
 *       {@code conversation_id}, plus the campaign form fields the visitor filled.</li>
 *   <li>Email or phone, at least one. A phone-only lead uses the pipeline's existing placeholder
 *       identity for the auth user (see {@link AudienceService#submitCatalogueLead(CatalogueLeadRequestDTO, boolean)});
 *       the lead row keeps no email.</li>
 *   <li>UTM tags become a utm_attribution touch on the lead's campaign (the lead side-view card).</li>
 * </ul>
 */
@Slf4j
@Service
public class SiteAssistantLeadService {

    public static final String SOURCE_TYPE = "SITE_ASSISTANT";
    public static final String DEFAULT_SOURCE_ID = "site-assistant";
    static final Set<String> KINDS = Set.of("SALES", "SUPPORT");
    static final Set<String> UTM_KEYS = Set.of("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content");
    static final int MAX_NAME = 200;
    static final int MAX_SUMMARY = 2000;
    static final int MAX_REASON = 500;
    static final int MAX_URL = 2000;
    static final int MAX_COURSES = 10;
    static final int MAX_UTM_VALUE = 191;

    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_\\-]{1,64}$");
    private static final Pattern UUID_SHAPED = Pattern.compile(
            "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);

    private final AudienceService audienceService;
    private final AudienceResponseRepository audienceResponseRepository;
    private final UtmAttributionService utmAttributionService;
    private final InstituteRepository instituteRepository;

    public SiteAssistantLeadService(AudienceService audienceService,
                                    AudienceResponseRepository audienceResponseRepository,
                                    UtmAttributionService utmAttributionService,
                                    InstituteRepository instituteRepository) {
        this.audienceService = audienceService;
        this.audienceResponseRepository = audienceResponseRepository;
        this.utmAttributionService = utmAttributionService;
        this.instituteRepository = instituteRepository;
    }

    /** The validated body. */
    public record Lead(String instituteId, String kind, String campaignId, String fullName, String email,
                       String phone, List<String> courseIds, String pageUrl, Map<String, String> utm,
                       String summary, String reason, Map<String, String> customFields) {
    }

    /** {@code received} (lead_ref = the audience_response id) or {@code duplicate} (lead_ref null). */
    public record Outcome(String status, String leadRef) {
    }

    public static Lead validate(JsonNode body) {
        if (body == null || !body.isObject()) throw invalid("Send a JSON object.", null);
        String instituteId = str(body, "institute_id");
        if (instituteId == null || !ID.matcher(instituteId).matches()) {
            throw invalid("institute_id is required.", "institute_id");
        }
        String kind = str(body, "kind");
        kind = kind == null ? null : kind.toUpperCase(Locale.ROOT);
        if (kind == null || !KINDS.contains(kind)) throw invalid("kind must be SALES or SUPPORT.", "kind");
        String campaignId = str(body, "campaign_id");
        if (campaignId != null && !ID.matcher(campaignId).matches()) {
            throw invalid("campaign_id is not a campaign id.", "campaign_id");
        }
        String fullName = str(body, "full_name");
        if (fullName == null) throw invalid("full_name is required.", "full_name");
        if (fullName.length() > MAX_NAME) throw invalid("full_name must be at most " + MAX_NAME + " characters.", "full_name");
        String email = str(body, "email");
        if (email != null && !CatalogLeadService.isValidEmail(email)) {
            throw invalid("email is not a valid email address.", "email");
        }
        String phone = str(body, "phone");
        if (phone != null && !CatalogLeadService.isValidPhone(phone)) {
            throw invalid("phone must be a phone number, e.g. +91 98765 43210.", "phone");
        }
        if (email == null && phone == null) throw invalid("Send an email or a phone number.", "phone");

        List<String> courseIds = new ArrayList<>();
        JsonNode courses = body.get("course_ids");
        if (courses != null && !courses.isNull()) {
            if (!courses.isArray() || courses.size() > MAX_COURSES) {
                throw invalid("course_ids must be a list of at most " + MAX_COURSES + " course ids.", "course_ids");
            }
            for (JsonNode c : courses) {
                String id = c != null && c.isTextual() ? c.asText().trim() : null;
                if (id == null || !ID.matcher(id).matches()) throw invalid("course_ids holds an invalid id.", "course_ids");
                if (!courseIds.contains(id)) courseIds.add(id);
            }
        }
        String pageUrl = str(body, "page_url");
        if (pageUrl != null && pageUrl.length() > MAX_URL) {
            throw invalid("page_url must be at most " + MAX_URL + " characters.", "page_url");
        }
        String summary = str(body, "summary");
        if (summary != null && summary.length() > MAX_SUMMARY) {
            throw invalid("summary must be at most " + MAX_SUMMARY + " characters.", "summary");
        }
        String reason = str(body, "reason");
        if (reason != null && reason.length() > MAX_REASON) {
            throw invalid("reason must be at most " + MAX_REASON + " characters.", "reason");
        }

        Map<String, String> utm = new LinkedHashMap<>();
        JsonNode rawUtm = body.get("utm");
        if (rawUtm != null && !rawUtm.isNull()) {
            if (!rawUtm.isObject()) throw invalid("utm must be an object.", "utm");
            rawUtm.fields().forEachRemaining(e -> {
                String key = e.getKey() == null ? "" : e.getKey().trim().toLowerCase(Locale.ROOT);
                JsonNode v = e.getValue();
                if (!UTM_KEYS.contains(key) || v == null || !v.isValueNode() || v.isNull()) return;
                String value = v.asText().trim();
                if (!value.isEmpty()) utm.put(key, value.length() > MAX_UTM_VALUE ? value.substring(0, MAX_UTM_VALUE) : value);
            });
        }

        // Same rules as the Catalogue API leads (keys, sizes, reserved names).
        Map<String, String> custom = CatalogLeadService.parseCustomFields(body.get("custom_fields"));
        String conversationId = custom.get("conversation_id");
        if (conversationId != null && !ID.matcher(conversationId).matches()) {
            throw invalid("custom_fields.conversation_id is not a conversation id.", "custom_fields");
        }
        return new Lead(instituteId, kind, campaignId, fullName, email, phone, List.copyOf(courseIds), pageUrl,
                utm, summary, reason, custom);
    }

    public Outcome submit(Lead lead) {
        // The pipeline would auto-provision a lead list for any id; never for an unknown institute.
        if (!instituteRepository.existsById(lead.instituteId())) {
            throw new CatalogApiException(HttpStatus.NOT_FOUND, "not_found", "No such institute.");
        }
        Map<String, String> fields = new LinkedHashMap<>(lead.customFields());
        fields.put("lead_kind", lead.kind());
        if (lead.summary() != null) fields.put("summary", lead.summary());
        if (lead.reason() != null) fields.put("reason", lead.reason());
        if (!lead.courseIds().isEmpty()) fields.put("course_ids", String.join(",", lead.courseIds()));
        if (lead.pageUrl() != null) fields.put("page_url", lead.pageUrl());
        String conversationId = lead.customFields().get("conversation_id");

        CatalogueLeadRequestDTO dto = CatalogueLeadRequestDTO.builder()
                .instituteId(lead.instituteId())
                .audienceId(lead.campaignId())
                .sourceType(SOURCE_TYPE)
                .sourceId(conversationId != null ? conversationId : DEFAULT_SOURCE_ID)
                .fullName(lead.fullName())
                .email(lead.email())
                .mobileNumber(lead.phone())
                .customFieldValues(fields)
                .build();
        String result = audienceService.submitCatalogueLead(dto, true);
        if (result == null || !UUID_SHAPED.matcher(result.trim()).matches()) {
            // A repeat (same person, same campaign) or an institute dedup rule answers with a sentence.
            log.info("site-assistant: lead for institute {} treated as duplicate: {}", lead.instituteId(), result);
            return new Outcome("duplicate", null);
        }
        String leadRef = result.trim();
        recordUtm(lead, leadRef);
        return new Outcome("received", leadRef);
    }

    /** Best-effort: the lead is saved already; a lost attribution must never fail it. */
    private void recordUtm(Lead lead, String leadRef) {
        if (lead.utm().isEmpty()) return;
        try {
            String audienceId = audienceResponseRepository.findById(leadRef)
                    .map(AudienceResponse::getAudienceId).orElse(null);
            utmAttributionService.record(lead.instituteId(), null, lead.email(), lead.phone(), "AUDIENCE",
                    audienceId, lead.utm());
        } catch (Exception e) {
            log.warn("site-assistant: utm touch for lead {} dropped: {}", leadRef, e.getMessage());
        }
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
