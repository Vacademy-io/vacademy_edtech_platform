package vacademy.io.admin_core_service.features.live_session.service;

import jakarta.transaction.Transactional;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.fasterxml.jackson.databind.ObjectMapper;
import vacademy.io.admin_core_service.features.live_session.dto.GuestRegistrationRequestDTO;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionAudiencePushConfigDTO;
import vacademy.io.admin_core_service.features.common.entity.CustomFields;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldRepository;
import vacademy.io.admin_core_service.features.live_session.entity.LiveSession;
import vacademy.io.admin_core_service.features.live_session.entity.SessionGuestRegistration;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.repository.CustomFieldValuesRepository;
import vacademy.io.admin_core_service.features.live_session.repository.LiveSessionRepository;
import vacademy.io.admin_core_service.features.live_session.repository.SessionGuestRegistrationRepository;
import vacademy.io.admin_core_service.features.live_session.util.GuestFormFieldResolver;
import vacademy.io.admin_core_service.features.workflow.enums.WorkflowTriggerEvent;
import vacademy.io.admin_core_service.features.workflow.service.WorkflowTriggerService;
import vacademy.io.common.exceptions.VacademyException;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Slf4j
public class RegistrationService {

    @Autowired
    SessionGuestRegistrationRepository sessionGuestRegistration;
    @Autowired
    CustomFieldValuesRepository customFieldValuesRepository;
    @Autowired
    CustomFieldRepository customFieldRepository;
    @Autowired
    LiveSessionRepository liveSessionRepository;
    @Autowired
    LiveSessionWorkflowAsyncHelper liveSessionWorkflowAsyncHelper;
    @Autowired
    WorkflowTriggerService workflowTriggerService;
    @Autowired
    ObjectMapper objectMapper;


    /**
     * Shortest digit count that can be a real phone number rather than a dial code. The E.164
     * country code alone is 1-3 digits, and the shortest national subscriber numbers in use are
     * 4 digits, so anything under 7 digits cannot identify a person.
     */
    private static final int MIN_IDENTITY_PHONE_DIGITS = 7;

    /**
     * The mobile number to register this guest BY, or null when the form did not really collect
     * one.
     *
     * <p>A registration form is free to make its phone field optional, and the widget the learner
     * forms use keeps the selected country's dial code in the box — so "left blank" reaches us as
     * {@code "+91"}. Treated as an identity, that dial code is shared by every learner who skipped
     * the field: the second one to register would be matched onto the first one's row and
     * overwrite their answers. A value too short to be a phone number is therefore no phone number
     * at all. The shortest number ever stored in this table is 10 digits, so nothing real is
     * excluded.
     */
    private String identityPhone(String rawMobileNumber) {
        String digits = SessionGuestRegistration.normalizeMobileNumber(rawMobileNumber);
        return (digits != null && digits.length() >= MIN_IDENTITY_PHONE_DIGITS) ? digits : null;
    }

    /**
     * Idempotent guest registration keyed by either identity: email (classic) or
     * mobile number (phone-identity institutes). Re-registering with a known
     * identifier returns the existing registration id instead of failing, so a
     * refreshed public page can safely re-submit. When a returning guest supplies
     * an identifier the stored row is missing, it is backfilled (never stolen
     * from another registration) so future lookups by either identity succeed.
     */
    public String registerGuest(String email, String mobileNumber, String sessionId) {
        String normalizedEmail = (email == null || email.trim().isEmpty())
                ? null : email.trim().toLowerCase();
        String normalizedPhone = identityPhone(mobileNumber);
        if (normalizedEmail == null && normalizedPhone == null) {
            throw new VacademyException("Either an email or a mobile number is required to register");
        }

        Optional<SessionGuestRegistration> existing = normalizedEmail != null
                ? sessionGuestRegistration.findBySessionIdAndEmail(sessionId, normalizedEmail)
                : Optional.empty();
        if (existing.isEmpty() && normalizedPhone != null) {
            existing = sessionGuestRegistration.findBySessionIdAndMobileNumber(sessionId, normalizedPhone);
        }

        if (existing.isPresent()) {
            SessionGuestRegistration registration = existing.get();
            boolean changed = false;
            if (registration.getEmail() == null && normalizedEmail != null
                    && sessionGuestRegistration.findBySessionIdAndEmail(sessionId, normalizedEmail).isEmpty()) {
                registration.setEmail(normalizedEmail);
                changed = true;
            }
            if (registration.getMobileNumber() == null && normalizedPhone != null
                    && sessionGuestRegistration.findBySessionIdAndMobileNumber(sessionId, normalizedPhone).isEmpty()) {
                registration.setMobileNumber(normalizedPhone);
                changed = true;
            }
            if (changed) {
                sessionGuestRegistration.save(registration);
            }
            return registration.getId();
        }

        SessionGuestRegistration registration = SessionGuestRegistration.builder()
                .id(UUID.randomUUID().toString())
                .sessionId(sessionId)
                .email(normalizedEmail)
                .mobileNumber(normalizedPhone)
                .registeredAt(LocalDateTime.now())
                .build();
        sessionGuestRegistration.save(registration);
        return registration.getId();
    }


    @Transactional
    public String saveGuestUserDetails(GuestRegistrationRequestDTO requestDto) {
        String guestUserId = registerGuest(requestDto.getEmail(), requestDto.getMobileNumber(), requestDto.getSessionId());

        Map<String, CustomFieldValues> existingByFieldId = customFieldValuesRepository
                .findBySourceTypeAndSourceId("EXTERNAL_PARTICIPANT", guestUserId).stream()
                .filter(v -> v.getCustomFieldId() != null)
                .collect(Collectors.toMap(CustomFieldValues::getCustomFieldId, v -> v, (a, b) -> a));

        for (GuestRegistrationRequestDTO.CustomFieldValueDTO fieldDto : requestDto.getCustomFields()) {
            CustomFieldValues existing = existingByFieldId.get(fieldDto.getCustomFieldId());
            if (existing != null) {
                existing.setValue(fieldDto.getValue());
                customFieldValuesRepository.save(existing);
                continue;
            }
            CustomFieldValues value = CustomFieldValues.builder()
                    .id(UUID.randomUUID().toString())
                    .customFieldId(fieldDto.getCustomFieldId())
                    .sourceType("EXTERNAL_PARTICIPANT")
                    .sourceId(guestUserId)
                    .type("SESSION")
                    .typeId(null)
                    .value(fieldDto.getValue())
                    .build();

            customFieldValuesRepository.save(value);
        }

        scheduleFormSubmissionWorkflow(requestDto, guestUserId);
        scheduleLiveClassLeadCapture(requestDto);
        return guestUserId;
    }

    /**
     * Schedules CRM lead capture to run strictly AFTER the registration commits, for the
     * same reasons as {@link #scheduleFormSubmissionWorkflow}: nothing here runs inside the
     * registration transaction (no early flush, no swallowed constraint failure), and
     * {@code afterCommit} fires only on a committed registration so a rolled-back one never
     * creates a lead.
     */
    private void scheduleLiveClassLeadCapture(GuestRegistrationRequestDTO requestDto) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    dispatchLiveClassLeadCapture(requestDto);
                }
            });
        } else {
            dispatchLiveClassLeadCapture(requestDto);
        }
    }

    /**
     * Turns a public live-class registration into a CRM lead so the registrant appears in
     * Audience Manager → Recent Leads (previously they only landed in
     * {@code session_guest_registrations}, which no lead screen reads).
     *
     * <p>Best-effort and never throwing — the registration has already committed by the
     * time this runs and must not be disturbed. Resolves the session's institute and the
     * guest's name/email/phone (same admin-defined-field resolution as the workflow
     * context), then hands off to the bounded async executor. Deliberately unconditional
     * (no trigger gate): guest registration only happens for public sessions, so this is
     * already scoped to public webinars, and every such registrant is a lead.
     */
    private void dispatchLiveClassLeadCapture(GuestRegistrationRequestDTO requestDto) {
        try {
            Optional<LiveSession> sessionOpt = liveSessionRepository.findById(requestDto.getSessionId());
            if (sessionOpt.isEmpty()) return;
            LiveSession session = sessionOpt.get();
            String instituteId = session.getInstituteId();
            if (instituteId == null || instituteId.isBlank()) return;

            GuestIdentity identity = resolveIdentity(requestDto);
            if (identity.email == null || identity.email.isBlank()) return; // no email → no lead

            liveSessionWorkflowAsyncHelper.createLiveClassLeadAsync(
                    instituteId, identity.fullName, identity.email, identity.mobileNumber,
                    identity.extraById, session.getId(), resolveConfiguredAudienceIds(session));
        } catch (Exception e) {
            log.warn("Failed to capture live-class lead for sessionId={}: {}",
                    requestDto.getSessionId(), e.getMessage(), e);
        }
    }

    /**
     * The audience lists this session's admin selected under "save registrants to
     * audience list(s)" — empty when the toggle is off, absent, or unparseable.
     * Never throws: a malformed config must not disturb lead capture.
     */
    private List<String> resolveConfiguredAudienceIds(LiveSession session) {
        String json = session.getAudiencePushConfigJson();
        if (json == null || json.isBlank()) return List.of();
        try {
            LiveSessionAudiencePushConfigDTO config =
                    objectMapper.readValue(json, LiveSessionAudiencePushConfigDTO.class);
            return config.isPushEnabled() ? config.getAudienceIds() : List.of();
        } catch (Exception e) {
            log.warn("Unparseable audience_push_config_json on session {}: {}",
                    session.getId(), e.getMessage());
            return List.of();
        }
    }

    /**
     * Schedules the {@code LIVE_SESSION_FORM_SUBMISSION} emit to run strictly AFTER the
     * registration commits.
     *
     * <p>Nothing in the emit — not even the trigger-existence lookup — runs inside the
     * registration transaction. That matters: a JPQL read here would force Hibernate to
     * flush the just-inserted guest rows early, so a genuine constraint failure (dangling
     * custom_field_id, the unique (session_id, email) race, a session deleted mid-submit)
     * would surface at our query and be swallowed instead of surfacing cleanly at commit.
     * Running post-commit keeps the registration's own success/failure path byte-for-byte
     * unchanged, and {@code afterCommit} only fires when the commit actually succeeded, so
     * a rolled-back registration never emits.
     */
    private void scheduleFormSubmissionWorkflow(GuestRegistrationRequestDTO requestDto, String guestUserId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    emitFormSubmissionWorkflow(requestDto, guestUserId);
                }
            });
        } else {
            // No active transaction (defensive): the writes above auto-committed, emit now.
            emitFormSubmissionWorkflow(requestDto, guestUserId);
        }
    }

    /**
     * Emits {@code LIVE_SESSION_FORM_SUBMISSION} so admins can hang a workflow (e.g. a
     * WhatsApp seat-confirmation) off a public registration form. Runs after commit.
     *
     * <p>Never throws — a notification problem must not fail or disturb the registration,
     * which has already committed by the time this runs.
     *
     * <p>Gated on an existing trigger so this is inert for every institute/session that
     * hasn't configured one: the only cost on that (overwhelmingly common) path is a
     * session lookup plus one indexed trigger lookup — no context is built and no async
     * thread is spawned.
     */
    private void emitFormSubmissionWorkflow(GuestRegistrationRequestDTO requestDto, String guestUserId) {
        try {
            Optional<LiveSession> sessionOpt = liveSessionRepository.findById(requestDto.getSessionId());
            if (sessionOpt.isEmpty()) {
                log.warn("Skipping LIVE_SESSION_FORM_SUBMISSION: no live session for id={}", requestDto.getSessionId());
                return;
            }
            LiveSession session = sessionOpt.get();
            String instituteId = session.getInstituteId();
            if (instituteId == null || instituteId.isBlank()) {
                log.warn("Skipping LIVE_SESSION_FORM_SUBMISSION: session {} has no instituteId", session.getId());
                return;
            }

            boolean triggerConfigured = workflowTriggerService
                    .findByInstituteIdEventNameAndEventId(
                            instituteId,
                            WorkflowTriggerEvent.LIVE_SESSION_FORM_SUBMISSION.name(),
                            session.getId())
                    .isPresent();
            if (!triggerConfigured) {
                return;
            }

            Map<String, Object> contextData = buildContext(requestDto, guestUserId, session, instituteId);
            dispatchFormSubmissionWorkflow(session.getId(), instituteId, contextData);
        } catch (Exception e) {
            log.warn("Failed to emit LIVE_SESSION_FORM_SUBMISSION for sessionId={}: {}",
                    requestDto.getSessionId(), e.getMessage(), e);
        }
    }

    /**
     * Hands the trigger to the async helper, swallowing any dispatch-time failure
     * (e.g. executor rejection). The async work itself is fire-and-forget; the guest's
     * registration has already committed and must not be affected either way.
     */
    private void dispatchFormSubmissionWorkflow(String sessionId, String instituteId,
                                                Map<String, Object> contextData) {
        try {
            liveSessionWorkflowAsyncHelper.fireLiveSessionFormSubmissionWorkflow(
                    sessionId, instituteId, contextData);
        } catch (Exception e) {
            log.warn("Failed to dispatch LIVE_SESSION_FORM_SUBMISSION workflow for sessionId={}: {}",
                    sessionId, e.getMessage(), e);
        }
    }

    /**
     * Builds the workflow context for one guest submission.
     *
     * <p>The form is entirely admin-defined custom fields, so the guest's name and phone
     * are resolved via {@link GuestFormFieldResolver} rather than read from fixed columns.
     * Answers are exposed under both their field key and their (lowercased) label so a
     * workflow can reference whichever is stable for that institute, and {@code guests}
     * is a single-element list so a SEND_WHATSAPP node can iterate it the same way it
     * iterates a QUERY result.
     */
    private Map<String, Object> buildContext(GuestRegistrationRequestDTO requestDto,
                                             String guestUserId,
                                             LiveSession session,
                                             String instituteId) {
        GuestIdentity id = resolveIdentity(requestDto);

        Map<String, Object> guest = new LinkedHashMap<>();
        guest.put("guestRegistrationId", guestUserId);
        guest.put("fullName", id.fullName);
        guest.put("mobileNumber", id.mobileNumber);
        guest.put("email", id.email);
        guest.put("sessionId", session.getId());
        guest.put("sessionTitle", session.getTitle());
        guest.putAll(id.byName);

        List<Map<String, Object>> guests = new ArrayList<>();
        guests.add(guest);

        Map<String, Object> contextData = new HashMap<>();
        contextData.put("instituteId", instituteId);
        contextData.put("instituteIdForWhatsapp", instituteId);
        contextData.put("sessionId", session.getId());
        contextData.put("sessionTitle", session.getTitle());
        contextData.put("guestRegistrationId", guestUserId);
        contextData.put("fullName", id.fullName);
        contextData.put("mobileNumber", id.mobileNumber);
        contextData.put("email", id.email);
        contextData.put("customFields", id.byKey);
        contextData.put("customFieldsByName", id.byName);
        contextData.put("liveSession", session);
        contextData.put("guests", guests);
        return contextData;
    }

    /**
     * Resolves the "who is this person" fields from a guest submission. The form is
     * entirely admin-defined custom fields, so name/phone/email are classified via
     * {@link GuestFormFieldResolver} rather than read from fixed columns. Answers are also
     * collected by field key and by (lowercased) label. Shared by the workflow context
     * ({@link #buildContext}) and CRM lead capture ({@link #dispatchLiveClassLeadCapture})
     * so both read identity the exact same way.
     */
    private GuestIdentity resolveIdentity(GuestRegistrationRequestDTO requestDto) {
        List<GuestRegistrationRequestDTO.CustomFieldValueDTO> submitted =
                requestDto.getCustomFields() == null ? List.of() : requestDto.getCustomFields();

        List<String> fieldIds = submitted.stream()
                .map(GuestRegistrationRequestDTO.CustomFieldValueDTO::getCustomFieldId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toList());

        Map<String, CustomFields> fieldsById = new HashMap<>();
        if (!fieldIds.isEmpty()) {
            for (CustomFields field : customFieldRepository.findAllById(fieldIds)) {
                fieldsById.put(field.getId(), field);
            }
        }

        Map<String, Object> byKey = new LinkedHashMap<>();
        Map<String, Object> byName = new LinkedHashMap<>();
        // Non-identity answers (everything that isn't name/email/phone), keyed by
        // custom_field_id → value, so lead capture can mirror them onto the lead audience.
        Map<String, String> extraById = new LinkedHashMap<>();
        String fullName = null;
        String mobileNumber = null;
        String email = requestDto.getEmail();

        for (GuestRegistrationRequestDTO.CustomFieldValueDTO answer : submitted) {
            CustomFields field = fieldsById.get(answer.getCustomFieldId());
            if (field == null) continue;

            String value = answer.getValue();
            if (field.getFieldKey() != null) byKey.put(field.getFieldKey(), value);
            if (field.getFieldName() != null) byName.put(field.getFieldName().toLowerCase().trim(), value);

            if (value == null || value.isBlank()) continue;
            switch (GuestFormFieldResolver.classify(field.getFieldKey(), field.getFieldName())) {
                case NAME -> {
                    if (fullName == null) fullName = value.trim();
                }
                case PHONE -> {
                    // An optional phone field the learner skipped still arrives as the widget's
                    // dial code ("+91"). Notifications and CRM leads must not treat that as a
                    // number they can reach anyone on.
                    if (mobileNumber == null && identityPhone(value) != null) mobileNumber = value.trim();
                }
                case EMAIL -> {
                    if (email == null || email.isBlank()) email = value.trim();
                }
                default -> {
                    if (answer.getCustomFieldId() != null) {
                        extraById.put(answer.getCustomFieldId(), value.trim());
                    }
                }
            }
        }

        return new GuestIdentity(fullName, mobileNumber, email, byKey, byName, extraById);
    }

    /** Immutable holder for the identity + answer maps resolved from a guest submission. */
    private static final class GuestIdentity {
        final String fullName;
        final String mobileNumber;
        final String email;
        final Map<String, Object> byKey;
        final Map<String, Object> byName;
        /** Non-identity answers keyed by custom_field_id → value (e.g. "CUET Marks"). */
        final Map<String, String> extraById;

        GuestIdentity(String fullName, String mobileNumber, String email,
                      Map<String, Object> byKey, Map<String, Object> byName,
                      Map<String, String> extraById) {
            this.fullName = fullName;
            this.mobileNumber = mobileNumber;
            this.email = email;
            this.byKey = byKey;
            this.byName = byName;
            this.extraById = extraById;
        }
    }
}
