package vacademy.io.admin_core_service.features.audience.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.audience.dto.WhatsAppFlowLeadRequestDTO;
import vacademy.io.admin_core_service.features.audience.dto.WhatsAppFlowLeadResultDTO;
import vacademy.io.admin_core_service.features.audience.entity.AudienceResponse;
import vacademy.io.admin_core_service.features.audience.enums.AudienceStatusEnum;
import vacademy.io.admin_core_service.features.audience.repository.AudienceRepository;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.timeline.enums.LeadJourneyActionType;
import vacademy.io.admin_core_service.features.timeline.service.TimelineEventService;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.exceptions.VacademyException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Turns a WhatsApp chatbot conversation into a CRM lead.
 *
 * <p>Rules:
 * <ul>
 *   <li>One lead per phone per institute. A phone that is already a lead in ANY list of the
 *       institute is never entered again — the repeat contact is recorded on that lead instead
 *       (timeline RE_ENQUIRY), and a soft-deleted match is brought back. user_lead_profile is not
 *       touched: its last_activity_at is derived from submissions on rebuild and drives the
 *       admissions report's "stalled" count, so a bot contact must not move it.</li>
 *   <li>A new phone gets a lead in the institute's auto-provisioned "WhatsApp Leads" list as soon
 *       as the flow's CRM_LEAD_CHECK runs, so someone who stops halfway is still in the list.</li>
 *   <li>Answers are written as the flow collects them. On the lead this session created they may
 *       replace earlier answers; on a lead that already existed only empty fields are filled —
 *       what a counsellor has recorded is never overwritten by the bot.</li>
 *   <li>Check and create run under a per-phone advisory lock inside one transaction, so two
 *       messages arriving together cannot create two leads.</li>
 * </ul>
 */
@Service
@Slf4j
public class WhatsAppFlowLeadService {

    public static final String RESULT_NEW = "NEW";
    public static final String RESULT_EXISTING = "EXISTING";

    private static final String SOURCE_AUDIENCE_RESPONSE = "AUDIENCE_RESPONSE";
    private static final String STATUS_SOURCE = "WHATSAPP_FLOW";
    /** Order given to chatbot-collected fields when they are attached to the lead list's form. */
    private static final int ATTACHED_FIELD_ORDER = 10;
    private static final int MAX_TIMELINE_MESSAGE_CHARS = 300;

    @Autowired
    private AudienceService audienceService;
    @Autowired
    private AudienceResponseRepository audienceResponseRepository;
    @Autowired
    private AudienceRepository audienceRepository;
    @Autowired
    private CustomFieldValuesRepository customFieldValuesRepository;
    @Autowired
    private CustomFieldRepository customFieldRepository;
    @Autowired
    private TimelineEventService timelineEventService;
    @Autowired
    private LeadStatusService leadStatusService;
    @Autowired
    private LeadStatusRepository leadStatusRepository;
    @Autowired
    private PlaceholderEmailService placeholderEmailService;
    @Autowired
    private AuthService authService;

    /**
     * CRM_LEAD_CHECK: is this phone already a lead anywhere in the institute? If yes, record the
     * repeat contact on it and report EXISTING. If not, create the lead now and report NEW.
     */
    @Transactional
    public WhatsAppFlowLeadResultDTO checkOrCreate(WhatsAppFlowLeadRequestDTO request) {
        String phone = validate(request);
        lockPhone(request.getInstituteId(), phone);
        return resolveOrCreate(request, phone);
    }

    /**
     * ASK_FIELD / SAVE_TO_CRM: write the collected answers onto the lead. When the session has no
     * usable lead id (its CRM_LEAD_CHECK failed, or the flow has no check node) the lead is
     * resolved or created here first, under the same rules as {@link #checkOrCreate}.
     */
    @Transactional
    public WhatsAppFlowLeadResultDTO save(WhatsAppFlowLeadRequestDTO request) {
        String phone = validate(request);
        String instituteId = request.getInstituteId();

        AudienceResponse lead = null;
        if (StringUtils.hasText(request.getResponseId())) {
            lead = audienceResponseRepository.findById(request.getResponseId())
                    .filter(r -> belongsToInstitute(r, instituteId))
                    .orElse(null);
            if (lead == null) {
                log.warn("WhatsApp flow save: response {} not found in institute {} — resolving by phone",
                        request.getResponseId(), instituteId);
            }
        }

        boolean createdBySession;
        boolean resolvedHere = lead == null;
        WhatsAppFlowLeadResultDTO outcome;
        if (lead != null) {
            createdBySession = Boolean.TRUE.equals(request.getOverwrite());
            outcome = WhatsAppFlowLeadResultDTO.builder()
                    .result(createdBySession ? RESULT_NEW : RESULT_EXISTING)
                    .responseId(lead.getId())
                    .userId(leadUserId(lead))
                    .audienceId(lead.getAudienceId())
                    .build();
        } else {
            lockPhone(instituteId, phone);
            outcome = resolveOrCreate(request, phone);
            createdBySession = RESULT_NEW.equals(outcome.getResult());
            lead = audienceResponseRepository.findById(outcome.getResponseId())
                    .orElseThrow(() -> new VacademyException("Lead not found after capture"));
        }

        int savedFields = writeFieldValues(lead, instituteId, request.getFieldValues(), createdBySession);
        applySystemFields(lead, request.getFullName(), request.getEmail(), createdBySession);
        outcome.setSavedFields(savedFields);

        boolean complete = Boolean.TRUE.equals(request.getComplete());
        if (complete && createdBySession) {
            if (StringUtils.hasText(request.getStatusKey())) {
                applyStatus(lead, instituteId, request.getStatusKey());
            }
            if (Boolean.TRUE.equals(request.getFireWorkflow())) {
                String responseId = lead.getId();
                runAfterCommit(() -> audienceService.fireLeadSubmissionWorkflow(responseId));
            }
        } else if (complete && !resolvedHere && hasAnyAnswer(request)) {
            // A known lead answered the flow's questions again — keep what they said this time
            // on the timeline so a counsellor can decide whether to update the lead. (When the
            // lead was resolved in this call, recordReContact already logged it with the answers.)
            logReEnquiry(lead, request, false, answersSnapshot(request));
        }
        return outcome;
    }

    // ==================== Resolve / create ====================

    private WhatsAppFlowLeadResultDTO resolveOrCreate(WhatsAppFlowLeadRequestDTO request, String phone) {
        String instituteId = request.getInstituteId();

        // 1. Any lead in the institute with this phone (last 10 digits, any list).
        AudienceResponse byPhone = findLeadByPhone(instituteId, phone);
        if (byPhone != null) {
            return recordReContact(byPhone, request);
        }

        // 2. The phone's user (find-or-create in auth_service). A lead whose parent_mobile is
        //    empty but whose user carries this number is still the same person.
        String userId = findOrCreateUser(instituteId, phone, request.getName());
        if (!StringUtils.hasText(userId)) {
            throw new VacademyException("Could not create the user for this WhatsApp number");
        }
        List<String> byUser = audienceResponseRepository.findResponseIdByInstituteAndUser(instituteId, userId);
        if (byUser != null && !byUser.isEmpty()) {
            AudienceResponse lead = audienceResponseRepository.findById(byUser.get(0)).orElse(null);
            if (lead != null) {
                return recordReContact(lead, request);
            }
        }

        // 3. A new person — create the lead in the WhatsApp Leads list.
        AudienceService.InboundCallLeadRef ref = audienceService.createWhatsAppFlowLead(
                instituteId, userId, phone, request.getName(), request.getFlowId());
        return WhatsAppFlowLeadResultDTO.builder()
                .result(RESULT_NEW)
                .responseId(ref.responseId())
                .userId(ref.userId())
                .audienceId(ref.audienceId())
                .build();
    }

    private AudienceResponse findLeadByPhone(String instituteId, String phone) {
        List<Object[]> rows = audienceResponseRepository
                .findChatbotLeadMatchByInstituteAndPhoneLast10(instituteId, lastDigits(phone, 10));
        if (rows == null || rows.isEmpty() || rows.get(0) == null || rows.get(0)[0] == null) {
            return null;
        }
        return audienceResponseRepository.findById(rows.get(0)[0].toString()).orElse(null);
    }

    /**
     * Find-or-create the person's auth user. The placeholder email is derived from the phone
     * alone (no name), so the same number always resolves to the same user however the WhatsApp
     * profile name changes — the same key inbound calls use.
     */
    private String findOrCreateUser(String instituteId, String phone, String name) {
        UserDTO userDTO = UserDTO.builder()
                .email(placeholderEmailService.synthesize(null, phone, null))
                .fullName(StringUtils.hasText(name) ? name.trim() : phone)
                .mobileNumber(phone)
                .build();
        UserDTO created = authService.createUserFromAuthService(userDTO, instituteId, false);
        return created != null ? created.getId() : null;
    }

    /** The phone is already a lead: bring it back if deleted, and record the repeat contact. */
    private WhatsAppFlowLeadResultDTO recordReContact(AudienceResponse lead, WhatsAppFlowLeadRequestDTO request) {
        boolean revived = false;
        if (AudienceStatusEnum.INACTIVE.name().equalsIgnoreCase(lead.getAudienceStatus())) {
            lead.setAudienceStatus(AudienceStatusEnum.ACTIVE.name());
            audienceResponseRepository.save(lead);
            revived = true;
            log.info("WhatsApp flow: revived soft-deleted lead {} on repeat contact", lead.getId());
        }
        logReEnquiry(lead, request, revived, hasAnyAnswer(request) ? answersSnapshot(request) : null);
        return WhatsAppFlowLeadResultDTO.builder()
                .result(RESULT_EXISTING)
                .responseId(lead.getId())
                .userId(leadUserId(lead))
                .audienceId(lead.getAudienceId())
                .revived(revived)
                .build();
    }

    // ==================== Writes ====================

    /**
     * Upsert answers keyed by custom_field_id onto the lead. On a lead that already existed, a
     * field that already holds a value is left alone.
     *
     * <p>A field is attached to the lead's list (so it shows as a column) ONLY when that list is the
     * auto-created "WhatsApp Leads" list. A list's attached fields are its campaign form's fields —
     * attaching one to an existing lead's "Website" list would add a question to that campaign's
     * public form. On other lists the value is stored without touching the form.
     */
    int writeFieldValues(AudienceResponse lead, String instituteId, Map<String, String> fieldValues,
                         boolean overwrite) {
        if (fieldValues == null || fieldValues.isEmpty()) return 0;
        boolean whatsAppLeadsList = audienceRepository.findById(lead.getAudienceId())
                .map(a -> AudienceService.WHATSAPP_FLOW_SOURCE_TYPE.equals(a.getCampaignType()))
                .orElse(false);
        int saved = 0;
        for (Map.Entry<String, String> entry : fieldValues.entrySet()) {
            String customFieldId = entry.getKey();
            String value = entry.getValue() != null ? entry.getValue().trim() : null;
            if (!StringUtils.hasText(customFieldId) || !StringUtils.hasText(value)) continue;
            if (!customFieldRepository.existsById(customFieldId)) {
                log.warn("WhatsApp flow: unknown custom field {} — answer not saved on lead {}",
                        customFieldId, lead.getId());
                continue;
            }
            if (whatsAppLeadsList) {
                try {
                    audienceService.attachFieldToLeadList(instituteId, lead.getAudienceId(), customFieldId,
                            ATTACHED_FIELD_ORDER);
                } catch (Exception e) {
                    log.warn("WhatsApp flow: attaching field {} to list {} failed: {}",
                            customFieldId, lead.getAudienceId(), e.getMessage());
                }
            }

            Optional<CustomFieldValues> existing = customFieldValuesRepository
                    .findTopByCustomFieldIdAndSourceTypeAndSourceIdOrderByCreatedAtDesc(
                            customFieldId, SOURCE_AUDIENCE_RESPONSE, lead.getId());
            if (existing.isPresent()) {
                CustomFieldValues row = existing.get();
                if (value.equals(row.getValue())) continue;
                if (!overwrite && StringUtils.hasText(row.getValue())) continue;
                row.setValue(value);
                customFieldValuesRepository.save(row);
            } else {
                customFieldValuesRepository.save(CustomFieldValues.builder()
                        .customFieldId(customFieldId)
                        .sourceType(SOURCE_AUDIENCE_RESPONSE)
                        .sourceId(lead.getId())
                        .value(value)
                        .build());
            }
            saved++;
        }
        return saved;
    }

    /** Name and email live on the lead row itself (parent_name drives the lead list's name column). */
    void applySystemFields(AudienceResponse lead, String fullName, String email, boolean overwrite) {
        boolean changed = false;
        if (StringUtils.hasText(fullName)) {
            String current = lead.getParentName();
            // Until the flow asks, a lead's name is its WhatsApp profile name or its phone number.
            boolean placeholderName = !StringUtils.hasText(current)
                    || current.replaceAll("[\\s+()\\-]", "").matches("\\d+");
            if (overwrite || placeholderName) {
                lead.setParentName(fullName.trim());
                changed = true;
            }
        }
        if (StringUtils.hasText(email) && email.contains("@")) {
            String current = lead.getParentEmail();
            boolean emptyOrPlaceholder = !StringUtils.hasText(current) || placeholderEmailService.isPlaceholder(current);
            if (overwrite || emptyOrPlaceholder) {
                lead.setParentEmail(email.trim());
                changed = true;
            }
        }
        if (changed) {
            audienceResponseRepository.save(lead);
        }
    }

    private void applyStatus(AudienceResponse lead, String instituteId, String statusKey) {
        leadStatusRepository.findByInstituteIdAndStatusKey(instituteId, statusKey.trim())
                .ifPresentOrElse(status -> {
                    if (!status.getId().equals(lead.getLeadStatusId())) {
                        leadStatusService.changeLeadStatus(lead.getId(), status.getId(), null, STATUS_SOURCE);
                    }
                }, () -> log.warn("WhatsApp flow: lead status '{}' not found for institute {}",
                        statusKey, instituteId));
    }

    // ==================== Records ====================

    private void logReEnquiry(AudienceResponse lead, WhatsAppFlowLeadRequestDTO request, boolean revived,
                              Map<String, String> answers) {
        try {
            Map<String, Object> metadata = new LinkedHashMap<>();
            metadata.put("channel", "WHATSAPP");
            if (request.getFlowId() != null) metadata.put("flow_id", request.getFlowId());
            if (request.getFlowName() != null) metadata.put("flow_name", request.getFlowName());
            String message = truncate(request.getMessageText());
            if (message != null) metadata.put("message", message);
            metadata.put("revived", revived);
            if (answers != null && !answers.isEmpty()) metadata.put("answers", answers);

            StringBuilder description = new StringBuilder();
            if (StringUtils.hasText(request.getFlowName())) {
                description.append("Flow: ").append(request.getFlowName());
            }
            if (message != null) {
                if (description.length() > 0) description.append(" · ");
                description.append("Message: \"").append(message).append("\"");
            }
            if (answers != null && !answers.isEmpty()) {
                if (description.length() > 0) description.append(" · ");
                description.append("Shared details again (lead not changed)");
            }
            if (revived) {
                if (description.length() > 0) description.append(" · ");
                description.append("Lead was deleted and has been restored");
            }

            timelineEventService.logJourneyEvent(
                    SOURCE_AUDIENCE_RESPONSE, lead.getId(),
                    LeadJourneyActionType.RE_ENQUIRY,
                    "SYSTEM", null, "WhatsApp chatbot",
                    "Contacted again on WhatsApp",
                    description.toString(),
                    metadata,
                    leadUserId(lead));
        } catch (Exception e) {
            log.warn("WhatsApp flow: RE_ENQUIRY timeline event failed for lead {}: {}", lead.getId(), e.getMessage());
        }
    }

    // ==================== Helpers ====================

    /** Validates the request and returns the phone as digits only. */
    private String validate(WhatsAppFlowLeadRequestDTO request) {
        if (request == null || !StringUtils.hasText(request.getInstituteId())) {
            throw new VacademyException("instituteId is required");
        }
        String digits = request.getPhone() == null ? "" : request.getPhone().replaceAll("[^0-9]", "");
        if (digits.length() < 7) {
            throw new VacademyException("A valid phone number is required");
        }
        return digits;
    }

    private void lockPhone(String instituteId, String phone) {
        audienceResponseRepository.acquireTransactionLock(
                "whatsapp-flow-lead:" + instituteId + ":" + lastDigits(phone, 10));
    }

    private boolean belongsToInstitute(AudienceResponse lead, String instituteId) {
        return audienceRepository.findById(lead.getAudienceId())
                .map(a -> instituteId.equals(a.getInstituteId()))
                .orElse(false);
    }

    private static String leadUserId(AudienceResponse lead) {
        return lead.getUserId() != null ? lead.getUserId() : lead.getStudentUserId();
    }

    static String lastDigits(String digits, int n) {
        return digits.length() > n ? digits.substring(digits.length() - n) : digits;
    }

    private static boolean hasAnyAnswer(WhatsAppFlowLeadRequestDTO request) {
        return (request.getFieldValues() != null && request.getFieldValues().values().stream()
                .anyMatch(StringUtils::hasText))
                || StringUtils.hasText(request.getFullName())
                || StringUtils.hasText(request.getEmail());
    }

    private static Map<String, String> answersSnapshot(WhatsAppFlowLeadRequestDTO request) {
        Map<String, String> answers = new LinkedHashMap<>();
        if (request.getFieldValues() != null) {
            request.getFieldValues().forEach((k, v) -> {
                if (StringUtils.hasText(v)) answers.put(k, v.trim());
            });
        }
        if (StringUtils.hasText(request.getFullName())) answers.put("full_name", request.getFullName().trim());
        if (StringUtils.hasText(request.getEmail())) answers.put("email", request.getEmail().trim());
        return answers;
    }

    private static String truncate(String text) {
        if (!StringUtils.hasText(text)) return null;
        String trimmed = text.trim();
        return trimmed.length() > MAX_TIMELINE_MESSAGE_CHARS
                ? trimmed.substring(0, MAX_TIMELINE_MESSAGE_CHARS) + "…" : trimmed;
    }

    /** Run once the surrounding transaction has committed, so the work sees the saved lead. */
    private static void runAfterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        action.run();
                    } catch (Exception e) {
                        log.error("WhatsApp flow: after-commit action failed: {}", e.getMessage(), e);
                    }
                }
            });
        } else {
            action.run();
        }
    }
}
