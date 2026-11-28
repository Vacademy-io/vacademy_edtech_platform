package vacademy.io.admin_core_service.features.audience.leadagent.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.dto.SubmitLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.entity.Audience;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeRequestDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeResponseDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentBulkIntakeResponseDTO.Result;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentExistingContactsRequestDTO;
import vacademy.io.admin_core_service.features.audience.leadagent.dto.LeadAgentExistingContactsResponseDTO;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.service.AudienceService;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Delivery side of the Lead Agent (LEAD_AGENT_BUILD_SPEC §5): ai_service hands over researched
 * leads and this turns each one into an ordinary lead of the chosen list.
 *
 * <ul>
 *   <li>Every row goes through {@link AudienceService#submitLead} with source_type
 *       {@value #SOURCE_TYPE}, so the list's automations run exactly as for a form lead.</li>
 *   <li>A row whose phone (last 10 digits) or email is already a live lead anywhere in the
 *       institute is DUPLICATE and is not submitted — independent of the list's own dedup
 *       setting, which is off by default. The check and the submit run in one transaction under a
 *       per-institute advisory lock, so two concurrent deliveries cannot both create the lead.</li>
 *   <li>Each row has its own transaction: one row's failure never fails the others.</li>
 *   <li>The evidence note is a JOURNEY timeline event (actor SYSTEM), so it does not count as a
 *       counsellor's first response and does not stop the TAT clock.</li>
 * </ul>
 */
@Service
@Slf4j
public class LeadAgentIntakeService {

    public static final String SOURCE_TYPE = "LEAD_AGENT";
    public static final int MAX_ROWS = 50;
    static final int MAX_LOOKUP = 500;
    /** audience_response.source_id is VARCHAR(100). */
    static final int SOURCE_ID_MAX = 100;
    /** custom_field_values.value sits in a btree index (V334); keep well under its ~2.7 kB row limit. */
    static final int FIELD_VALUE_MAX = 1000;
    static final int NOTE_MAX = 10_000;
    static final int NAME_MAX = 200;
    /** lead_agent_intake.external_id is VARCHAR(255). */
    static final int EXTERNAL_ID_MAX = 255;
    /** Message on a CREATED result that a previous call already produced. */
    public static final String ALREADY_CREATED = "already created";

    private static final Pattern UUID = Pattern.compile(
            "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final AudienceService audienceService;
    private final AudienceRepository audienceRepository;
    private final AudienceResponseRepository audienceResponseRepository;
    private final TimelineEventService timelineEventService;
    private final LeadAgentContactLookup lookup;
    private final LeadAgentFieldProvisioner fieldProvisioner;
    private final TransactionTemplate rowTx;

    /** Optional: absent in unit tests that build the service by hand. */
    private vacademy.io.admin_core_service.features.engagement.service.EngagementEngineService engagementEngineService;

    @org.springframework.beans.factory.annotation.Autowired(required = false)
    public void setEngagementEngineService(
            vacademy.io.admin_core_service.features.engagement.service.EngagementEngineService engagementEngineService) {
        this.engagementEngineService = engagementEngineService;
    }

    public LeadAgentIntakeService(AudienceService audienceService,
                                  AudienceRepository audienceRepository,
                                  AudienceResponseRepository audienceResponseRepository,
                                  TimelineEventService timelineEventService,
                                  LeadAgentContactLookup lookup,
                                  LeadAgentFieldProvisioner fieldProvisioner,
                                  PlatformTransactionManager transactionManager) {
        this.audienceService = audienceService;
        this.audienceRepository = audienceRepository;
        this.audienceResponseRepository = audienceResponseRepository;
        this.timelineEventService = timelineEventService;
        this.lookup = lookup;
        this.fieldProvisioner = fieldProvisioner;
        this.rowTx = new TransactionTemplate(transactionManager);
    }

    // ── existing-contacts ───────────────────────────────────────────────

    public LeadAgentExistingContactsResponseDTO existingContacts(LeadAgentExistingContactsRequestDTO request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id is required");
        }
        Set<String> phones = new LinkedHashSet<>();
        if (request.getPhones() != null) {
            for (String p : request.getPhones()) {
                String n = LeadAgentContactLookup.last10(p);
                if (n != null) phones.add(n);
            }
        }
        Set<String> emails = new LinkedHashSet<>();
        if (request.getEmails() != null) {
            for (String e : request.getEmails()) {
                String n = LeadAgentContactLookup.normEmail(e);
                if (n != null) emails.add(n);
            }
        }
        if (phones.size() > MAX_LOOKUP || emails.size() > MAX_LOOKUP) {
            throw new VacademyException(HttpStatus.BAD_REQUEST,
                    "At most " + MAX_LOOKUP + " phones and " + MAX_LOOKUP + " emails per call");
        }
        String instituteId = request.getInstituteId().trim();
        return LeadAgentExistingContactsResponseDTO.builder()
                .phones(new ArrayList<>(lookup.existingPhones(instituteId, phones)))
                .emails(new ArrayList<>(lookup.existingEmails(instituteId, emails)))
                .build();
    }

    // ── bulk-intake ─────────────────────────────────────────────────────

    public LeadAgentBulkIntakeResponseDTO bulkIntake(LeadAgentBulkIntakeRequestDTO request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())
                || !StringUtils.hasText(request.getAudienceId())) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "institute_id and audience_id are required");
        }
        List<LeadAgentBulkIntakeRequestDTO.Row> rows = request.getRows();
        if (rows == null || rows.isEmpty()) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "rows cannot be empty");
        }
        if (rows.size() > MAX_ROWS) {
            throw new VacademyException(HttpStatus.BAD_REQUEST, "At most " + MAX_ROWS + " rows per call");
        }
        String instituteId = request.getInstituteId().trim();
        String audienceId = request.getAudienceId().trim();
        Audience audience = audienceRepository.findById(audienceId)
                .filter(a -> instituteId.equals(a.getInstituteId()))
                .orElseThrow(() -> new VacademyException(HttpStatus.NOT_FOUND,
                        "Lead list not found in this institute"));
        if (!"ACTIVE".equalsIgnoreCase(audience.getStatus())) {
            throw new VacademyException(HttpStatus.CONFLICT, "Lead list is not active");
        }

        Map<String, String> fieldIds = fieldProvisioner.ensureFields(instituteId, audienceId);

        List<Result> results = new ArrayList<>(rows.size());
        for (LeadAgentBulkIntakeRequestDTO.Row row : rows) {
            results.add(intakeRow(instituteId, audienceId, row, fieldIds));
        }
        return LeadAgentBulkIntakeResponseDTO.builder().results(results).build();
    }

    Result intakeRow(String instituteId, String audienceId, LeadAgentBulkIntakeRequestDTO.Row row,
                     Map<String, String> fieldIds) {
        if (row == null) {
            return fail(null, "Row is empty");
        }
        if (!StringUtils.hasText(row.getExternalId())) {
            return fail(null, "external_id is required");
        }
        String externalId = row.getExternalId().trim();
        if (externalId.length() > EXTERNAL_ID_MAX) {
            return fail(truncate(externalId, EXTERNAL_ID_MAX), "external_id is too long");
        }
        String last10 = LeadAgentContactLookup.last10(row.getMobile());
        String email = LeadAgentContactLookup.normEmail(row.getEmail());
        if (last10 == null && email == null) {
            return fail(externalId, "A mobile number or an email is required");
        }

        Result result;
        try {
            result = rowTx.execute(status -> {
                lookup.lock("lead-agent-intake:" + instituteId);
                // Idempotent on external_id: a repeat (e.g. after the caller's HTTP timeout) gets
                // the lead the first call created and never submits it a second time.
                Optional<String> earlier = lookup.findIntakeResponseId(instituteId, externalId);
                if (earlier.isPresent()) {
                    return Result.builder().externalId(externalId).status(LeadAgentBulkIntakeResponseDTO.CREATED)
                            .responseId(earlier.get()).message(ALREADY_CREATED).build();
                }
                if (last10 != null && !lookup.existingPhones(instituteId, List.of(last10)).isEmpty()) {
                    return duplicate(externalId, "This phone number is already a lead in this institute");
                }
                if (email != null && !lookup.existingEmails(instituteId, List.of(email)).isEmpty()) {
                    return duplicate(externalId, "This email is already a lead in this institute");
                }
                String outcome = audienceService.submitLead(buildSubmit(audienceId, row, email, fieldIds));
                Result r = classify(externalId, outcome);
                if (LeadAgentBulkIntakeResponseDTO.CREATED.equals(r.getStatus())) {
                    // Same transaction as the lead: both commit or neither does.
                    lookup.recordIntake(instituteId, externalId, audienceId, r.getResponseId());
                }
                return r;
            });
        } catch (Exception e) {
            log.warn("Lead Agent intake: row {} for list {} failed: {}", externalId, audienceId, e.getMessage());
            return fail(externalId, "Could not create the lead: " + truncate(e.getMessage(), 200));
        }
        if (result == null) {
            return fail(externalId, "Could not create the lead");
        }
        if (LeadAgentBulkIntakeResponseDTO.CREATED.equals(result.getStatus())
                && !ALREADY_CREATED.equals(result.getMessage())) {
            writeNote(result.getResponseId(), row, sourceId(row));
            enrollInEngines(instituteId, audienceId, result.getResponseId());
        }
        return result;
    }

    /**
     * The lead has committed: hand it to any live engagement engine on this list now, so outreach
     * starts within minutes. Best effort — the nightly reconcile enrols it anyway.
     */
    private void enrollInEngines(String instituteId, String audienceId, String responseId) {
        if (engagementEngineService == null || responseId == null) return;
        try {
            String userId = audienceResponseRepository.findById(responseId)
                    .map(vacademy.io.admin_core_service.features.audience.entity.AudienceResponse::getUserId)
                    .orElse(null);
            int joined = engagementEngineService.enrollNewLead(instituteId, audienceId, responseId, userId);
            if (joined > 0) log.info("Lead Agent intake: lead {} joined {} engagement engine(s)", responseId, joined);
        } catch (Exception e) {
            log.warn("Lead Agent intake: could not enrol lead {} in engagement engines: {}", responseId, e.getMessage());
        }
    }

    SubmitLeadRequestDTO buildSubmit(String audienceId, LeadAgentBulkIntakeRequestDTO.Row row, String email,
                                     Map<String, String> fieldIds) {
        Map<String, String> fields = row.getCustomFields() == null ? Map.of() : row.getCustomFields();
        Map<String, String> values = new LinkedHashMap<>();
        for (Map.Entry<String, String> e : fields.entrySet()) {
            String fieldId = e.getKey() == null ? null : fieldIds.get(e.getKey().trim());
            String value = truncate(e.getValue(), FIELD_VALUE_MAX);
            if (fieldId != null && StringUtils.hasText(value)) {
                values.put(fieldId, value);
            }
        }
        String name = firstText(row.getFullName(), fields.get("la_org_name"), domainOf(fields.get("la_website")));
        UserDTO user = UserDTO.builder()
                .fullName(truncate(name, NAME_MAX))
                .email(email)
                .mobileNumber(StringUtils.hasText(row.getMobile()) ? row.getMobile().trim() : null)
                .build();
        return SubmitLeadRequestDTO.builder()
                .audienceId(audienceId)
                .sourceType(SOURCE_TYPE)
                .sourceId(sourceId(row))
                .userDTO(user)
                .customFieldValues(values)
                // These people never filled a form: no "thank you for your response" email.
                // The list's workflows and the to_notify admin alert still run.
                .suppressRespondentEmail(true)
                .build();
    }

    /** submitLead returns the new response id, or a sentence explaining why nothing was saved. */
    static Result classify(String externalId, String outcome) {
        if (outcome != null && UUID.matcher(outcome.trim()).matches()) {
            return Result.builder().externalId(externalId).status(LeadAgentBulkIntakeResponseDTO.CREATED)
                    .responseId(outcome.trim()).build();
        }
        String lower = outcome == null ? "" : outcome.toLowerCase(Locale.ROOT);
        if (lower.contains("already submitted") || lower.contains("already exists")) {
            return duplicate(externalId, outcome);
        }
        return fail(externalId, StringUtils.hasText(outcome) ? outcome : "Could not create the lead");
    }

    private void writeNote(String responseId, LeadAgentBulkIntakeRequestDTO.Row row, String sourceId) {
        String note = truncate(row.getNote(), NOTE_MAX);
        if (!StringUtils.hasText(note)) return;
        try {
            String leadUserId = audienceResponseRepository.findById(responseId)
                    .map(r -> r.getUserId() != null ? r.getUserId() : r.getStudentUserId())
                    .orElse(null);
            Map<String, Object> metadata = new LinkedHashMap<>();
            metadata.put("source", SOURCE_TYPE);
            if (row.getExternalId() != null) metadata.put("external_id", row.getExternalId());
            if (sourceId != null) metadata.put("source_id", sourceId);
            Map<String, String> fields = row.getCustomFields();
            if (fields != null && StringUtils.hasText(fields.get("la_source_url"))) {
                metadata.put("source_url", truncate(fields.get("la_source_url"), 500));
            }
            timelineEventService.logJourneyEvent(
                    "AUDIENCE_RESPONSE", responseId,
                    LeadJourneyActionType.LEAD_AGENT_RESEARCH,
                    "SYSTEM", null, "Lead Agent",
                    "Found by the Lead Agent",
                    note, metadata, leadUserId);
        } catch (Exception e) {
            log.warn("Lead Agent intake: timeline note for lead {} failed: {}", responseId, e.getMessage());
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────

    /** The organisation's domain (from la_website), else the external id; at most 100 chars. */
    static String sourceId(LeadAgentBulkIntakeRequestDTO.Row row) {
        String website = row.getCustomFields() == null ? null : row.getCustomFields().get("la_website");
        String id = firstText(domainOf(website), row.getExternalId());
        return truncate(id, SOURCE_ID_MAX);
    }

    /** Registered host of a URL, lower-cased and without "www."; null when it cannot be parsed. */
    static String domainOf(String url) {
        if (!StringUtils.hasText(url)) return null;
        String u = url.trim();
        if (!u.contains("://")) u = "https://" + u;
        try {
            String host = URI.create(u).getHost();
            if (!StringUtils.hasText(host)) return null;
            host = host.toLowerCase(Locale.ROOT);
            return host.startsWith("www.") ? host.substring(4) : host;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String firstText(String... values) {
        for (String v : values) {
            if (StringUtils.hasText(v)) return v.trim();
        }
        return null;
    }

    static String truncate(String s, int max) {
        if (s == null) return null;
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    private static Result duplicate(String externalId, String message) {
        return Result.builder().externalId(externalId).status(LeadAgentBulkIntakeResponseDTO.DUPLICATE)
                .message(message).build();
    }

    private static Result fail(String externalId, String message) {
        return Result.builder().externalId(externalId).status(LeadAgentBulkIntakeResponseDTO.FAILED)
                .message(message).build();
    }
}
