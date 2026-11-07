package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.audience.entity.LeadStatus;
import vacademy.io.admin_core_service.features.audience.repository.AudienceResponseRepository;
import vacademy.io.admin_core_service.features.audience.repository.LeadStatusRepository;
import vacademy.io.admin_core_service.features.auth_service.service.AuthService;
import vacademy.io.admin_core_service.features.telephony.controller.TelephonyCounsellorEndpointController;
import vacademy.io.admin_core_service.features.telephony.core.CallDispositionService;
import vacademy.io.admin_core_service.features.telephony.core.CallLifecycleTxOps;
import vacademy.io.admin_core_service.features.telephony.core.CallOrchestrator;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyProviderRegistry;
import vacademy.io.admin_core_service.features.telephony.core.dto.ConnectCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.CallDispositionCatalog;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.HumanCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.HumanCallApiCallRepository;
import vacademy.io.admin_core_service.features.telephony.spi.dto.CallSubjectType;
import vacademy.io.common.auth.dto.UserDTO;
import vacademy.io.common.auth.dto.UserRoleDTO;
import vacademy.io.common.auth.dto.UserWithRolesDTO;
import vacademy.io.common.exceptions.ConflictException;
import vacademy.io.common.exceptions.VacademyException;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Human (counsellor) click-to-call through the public API: POST /v1/human-calls rings a
 * registered counsellor's phone and connects them to the number, on the institute's own
 * PRIMARY calling provider, exactly as the dashboard's Call button does (the checks and
 * the call rows in {@link HumanCallReservation}, then {@link CallOrchestrator#dispatchPrepared}). Also the counsellor list, the call
 * list and read, dispositions.
 *
 * <p>Why a separate resource from /v1/calls: an AI call waits in the AI queue for a line
 * and is decided by the agent; a human call rings a person NOW and its outcome is what
 * the counsellor records. The pre-v1 endpoint mixed the two (mode: CLICK_TO_CALL dialled
 * as MANUAL and skipped every guard, see docs/AI_CALLING_PUBLIC_API.md §8); here the
 * guards an API call needs are applied up front ({@link HumanCallGuards}) and anything
 * that cannot run now is refused, never queued.
 *
 * <p>Counsellors are only users the institute already registered: ACTIVE with a
 * COUNSELLOR/COUNSELOR/ADMIN role (the same set the Calling settings' extension picker
 * offers). An API key has no user identity, so it can never dial "as" anyone else.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class HumanCallApiService {

    static final int MAX_NOTES = 2000;
    static final String ID_PREFIX = "hcall_";
    /** A replay that finds the first request's row not yet dialled is told to retry. */
    static final Duration IN_PROGRESS_GRACE = Duration.ofMinutes(2);
    static final int IN_PROGRESS_RETRY_AFTER = 5;
    static final String OUT_OF_CREDITS = "This account is out of calling credits. Top up to place calls.";
    static final String NO_MOBILE = "This counsellor has no mobile number on their profile. Their phone rings first, "
            + "so add one to their profile.";
    static final String BAD_MOBILE = "This counsellor's mobile number is not a valid phone number. Fix it on their "
            + "profile, with the country code.";
    static final String BAD_PROVIDER_NUMBER = "The calling provider rejected a phone number on this call. The contact's "
            + "number was valid, so check the counsellor's mobile number on their profile (with the country code).";
    static final String NO_EXTENSION = "No Airtel extension is mapped to this counsellor. Map one under Settings → Calling.";
    static final String NOT_CONFIGURED = "Calling is not set up for this account. Connect a calling provider under "
            + "Settings → Calling.";
    /** Providers that place AI calls only; a counsellor cannot dial on them. */
    static final Set<String> AI_ONLY_PROVIDERS = Set.of(ProviderType.VACADEMY_AI, ProviderType.AAVTAAR, ProviderType.MOCK);

    private final HumanCallApiCallRepository callRepository;
    private final HumanCallViews views;
    private final HumanCallGuards guards;
    private final HumanCallReservation reservation;
    private final CallOrchestrator orchestrator;
    private final CallLifecycleTxOps callTx;
    private final TelephonyConfigCache configCache;
    private final TelephonyProviderRegistry registry;
    private final AuthService authService;
    private final AudienceResponseRepository leadRepository;
    private final CallDispositionService dispositionService;
    private final LeadStatusRepository leadStatusRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();
    /** For detaching freshly saved rows; null in unit tests that build the service by hand. */
    @PersistenceContext
    private EntityManager entityManager;

    // ── Requests ─────────────────────────────────────────────────────────────────

    /** POST /v1/human-calls, snake_case on the wire (see the controller). */
    public record HumanCallInput(String counsellorId, String counsellorEmail, String phoneNumber,
                                 String contactName, String contactEmail, String externalId,
                                 Map<String, Object> metadata, Boolean analyze) {
    }

    /** A registered counsellor of the institute, as auth_service lists them. */
    record Counsellor(String id, String name, String email, String mobile, List<String> roles) {
    }

    record Validated(String phone, String counsellorId, String counsellorEmail, String name, String email,
                     String externalId, Map<String, Object> metadata, boolean analyze,
                     List<Map<String, String>> errors) {
    }

    // ── Counsellors ──────────────────────────────────────────────────────────────

    /** GET /v1/counsellors — who can be named in counsellor_id, and whether they can take a call now. */
    public Map<String, Object> listCounsellors(AiCallingApiAuth.Principal p) {
        String instituteId = p.instituteId();
        String provider = primaryProvider(instituteId);
        List<Map<String, Object>> data = new ArrayList<>();
        for (Counsellor c : counsellors(instituteId)) {
            String blocked = blockedReason(instituteId, provider, c);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", c.id());
            m.put("object", "counsellor");
            m.put("name", c.name());
            m.put("email", c.email());
            m.put("roles", c.roles());
            m.put("status", "active");
            m.put("can_call", blocked == null);
            m.put("blocked_reason", blocked);
            // No phone numbers in the list, for any key: whether a login is shared with another
            // institute is only known per person (GET /v1/counsellors/{id} shows the number to a
            // counsellors:manage key when the login is this institute's alone).
            data.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("has_more", false);
        return out;
    }

    List<Counsellor> counsellors(String instituteId) {
        List<UserWithRolesDTO> users;
        try {
            users = authService.getActiveUsersByRoles(instituteId,
                    TelephonyCounsellorEndpointController.ENDPOINT_ELIGIBLE_ROLES);
        } catch (RuntimeException e) {
            log.warn("human-call-api: counsellor lookup failed for {}: {}", instituteId, e.getMessage());
            throw new AiCallingApiException(HttpStatus.SERVICE_UNAVAILABLE, "temporarily_unavailable",
                    "Could not load this account's counsellors right now. Retry shortly.", null, 5);
        }
        Map<String, Counsellor> byId = new LinkedHashMap<>();
        for (UserWithRolesDTO u : users == null ? List.<UserWithRolesDTO>of() : users) {
            if (u == null || u.getId() == null || u.getId().isBlank()) continue;
            byId.putIfAbsent(u.getId(), new Counsellor(u.getId(), displayName(u), blankToNull(u.getEmail()),
                    blankToNull(u.getMobileNumber()), instituteRoles(u, instituteId)));
        }
        List<Counsellor> out = new ArrayList<>(byId.values());
        out.sort(Comparator.comparing(c -> c.name() == null ? "" : c.name(), String.CASE_INSENSITIVE_ORDER));
        return out;
    }

    /**
     * Why this counsellor cannot take a click-to-call now, or null. The provider's own
     * pre-flight decides (OutboundOriginationResolver.callerBlockedReason), except that the
     * mobile-number providers (Exotel, Vacademy Voice) are answered from the user record
     * already in hand rather than one auth_service call per counsellor. Worded for an API
     * client, not for the counsellor.
     */
    String blockedReason(String instituteId, String provider, Counsellor c) {
        if (provider == null) return NOT_CONFIGURED;
        if (ProviderType.EXOTEL.equals(provider) || ProviderType.PLIVO.equals(provider)) {
            if (c.mobile() == null) return NO_MOBILE;
            int digits = c.mobile().replaceAll("[^0-9]", "").length();
            return digits < 10 || digits > 15 ? BAD_MOBILE : null;
        }
        try {
            Optional<String> reason = registry.originationResolver(provider).callerBlockedReason(instituteId, c.id());
            if (reason.isEmpty()) return null;
            return ProviderType.AIRTEL.equals(provider) ? NO_EXTENSION : reason.get();
        } catch (RuntimeException e) {
            // Advisory, like the Call button's pre-flight: the dial itself is the authority.
            log.debug("human-call-api: readiness probe failed for {}: {}", c.id(), e.getMessage());
            return null;
        }
    }

    /** The institute's enabled PRIMARY provider that a counsellor can dial on, or null. */
    String primaryProvider(String instituteId) {
        return configCache.get(instituteId)
                .filter(r -> Boolean.TRUE.equals(r.getConfig().getEnabled()))
                .map(r -> r.getConfig().getProviderType())
                .filter(t -> t != null && !AI_ONLY_PROVIDERS.contains(t))
                .orElse(null);
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    public Map<String, Object> createHumanCall(AiCallingApiAuth.Principal p, HumanCallInput in, String idempotencyKey) {
        String instituteId = p.instituteId();
        String idem = AiCallingApiService.normaliseIdempotencyKey(idempotencyKey);
        if (idem != null) {
            Optional<HumanCallApiCall> prior = callRepository.findByInstituteIdAndIdempotencyKey(instituteId, idem);
            if (prior.isPresent()) {
                if (prior.get().getCreatedAt() != null
                        && prior.get().getCreatedAt().plus(AiCallingApiService.IDEMPOTENCY_TTL).isBefore(Instant.now())) {
                    // Honoured for 24 hours; this one is older, so the key may be reused.
                    callRepository.clearIdempotencyKeysBefore(Instant.now().minus(AiCallingApiService.IDEMPOTENCY_TTL));
                } else {
                    return replay(prior.get(), in);
                }
            }
        }
        Validated v = validate(in);
        if (!v.errors().isEmpty()) {
            throw AiCallingApiException.invalid(v.errors().get(0).get("message"), Map.of("errors", v.errors()));
        }
        String provider = primaryProvider(instituteId);
        if (provider == null) {
            throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "telephony_not_configured", NOT_CONFIGURED);
        }
        Counsellor counsellor = requireCounsellor(instituteId, v);
        String blocked = blockedReason(instituteId, provider, counsellor);
        if (blocked != null) {
            throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "counsellor_cannot_call", blocked,
                    Map.of("counsellor_id", counsellor.id(), "reason", blocked));
        }
        guards.requireCallingHours(instituteId, Instant.now());
        LeadLink lead = linkLead(instituteId, v.phone());
        try {
            // Before the reservation: an HTTP read of the wallet must not run under its locks.
            orchestrator.assertCanDial(instituteId);
        } catch (RuntimeException e) {
            throw dialError(e);
        }

        HumanCallApiCall call = HumanCallApiCall.builder()
                .id(AiCallingApiService.newId(ID_PREFIX))
                .instituteId(instituteId)
                .apiKeyId(p.keyId())
                .counsellorUserId(counsellor.id())
                .counsellorName(counsellor.name())
                .counsellorEmail(counsellor.email() == null ? null : counsellor.email().toLowerCase(Locale.ROOT))
                .phoneNumber(v.phone())
                .contactName(v.name())
                .contactEmail(v.email())
                .externalId(v.externalId())
                .metadata(v.metadata())
                .analysisRequested(v.analyze())
                .providerType(provider)
                .idempotencyKey(idem)
                .webhookAttempts(0)
                .analysisWebhookAttempts(0)
                .build();
        String pseudoUser = AiCallingApiService.contactUserId(instituteId, v.phone());
        CallLifecycleTxOps.DialTarget target = lead != null
                ? new CallLifecycleTxOps.DialTarget(lead.responseId(),
                        lead.userId() != null ? lead.userId() : pseudoUser, v.phone(), null, null)
                : new CallLifecycleTxOps.DialTarget(null, pseudoUser, v.phone(),
                        CallSubjectType.API_CONTACT.name(), call.getId());

        HumanCallReservation.Reserved reserved;
        try {
            reserved = reservation.reserve(call, provider, guards.perNumberDailyCap(instituteId), target,
                    lead == null ? null : lead.responseId());
        } catch (DataIntegrityViolationException race) {
            // A concurrent request with the same Idempotency-Key won the insert.
            if (idem != null) {
                return callRepository.findByInstituteIdAndIdempotencyKey(instituteId, idem)
                        .map(prior -> replay(prior, in)).orElseThrow(() -> race);
            }
            throw race;
        } catch (AiCallingApiException e) {
            throw e;
        } catch (RuntimeException e) {
            // Origination refused (no mobile, no number...): the whole reservation rolled back.
            throw dialError(e);
        }
        if (reserved.prior() != null) return replay(reserved.prior(), in);
        detach(reserved.call());

        try {
            orchestrator.dispatchPrepared(reserved.prepared());
        } catch (RuntimeException e) {
            // Nothing is ringing: close the call row if the provider was never reached, and
            // drop the API row so a retry with the same Idempotency-Key places the call.
            try {
                callTx.markFailedIfNotDispatched(reserved.prepared().callLogId(), "dispatch_failed");
            } catch (RuntimeException ignored) {
                log.warn("human-call-api: could not close call log {}", reserved.prepared().callLogId());
            }
            safeDelete(call);
            throw dialError(e);
        }
        return views.view(callRepository.findById(call.getId()).orElse(call));
    }

    /** The orchestrator's refusals, in the API's error vocabulary. */
    static AiCallingApiException dialError(RuntimeException e) {
        if (e instanceof AiCallingApiException api) return api;
        String msg = e.getMessage() == null ? "" : e.getMessage();
        if (e instanceof ConflictException) {
            if (msg.toLowerCase(Locale.ROOT).contains("credit")) {
                return new AiCallingApiException(HttpStatus.PAYMENT_REQUIRED, "insufficient_credits", OUT_OF_CREDITS);
            }
            return new AiCallingApiException(HttpStatus.CONFLICT, "conflict", msg.isBlank() ? "Conflict." : msg);
        }
        if (e instanceof VacademyException) {
            if (msg.startsWith("Calling is not configured")) {
                return new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "telephony_not_configured", NOT_CONFIGURED);
            }
            String lower = msg.toLowerCase(Locale.ROOT);
            if (lower.contains("verified mobile")) {
                return new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "counsellor_cannot_call", NO_MOBILE,
                        Map.of("reason", NO_MOBILE));
            }
            if (lower.contains("extension")) {
                return new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "counsellor_cannot_call", NO_EXTENSION,
                        Map.of("reason", NO_EXTENSION));
            }
            // The contact's number, refused by our own pre-dial check (CallLifecycleTxOps).
            if (lower.contains("no phone on file") || lower.contains("phone number format not supported")) {
                return new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_request",
                        "phone_number is not a number this account's calling provider can dial.",
                        Map.of("errors", List.of(err("phone_number", "Not a dialable number."))));
            }
            // The provider refused a number's format. The contact's number reached it as
            // validated E.164, so the one left to blame is the counsellor's mobile.
            if (lower.contains("format rejected")) {
                return new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "counsellor_cannot_call",
                        BAD_PROVIDER_NUMBER, Map.of("reason", BAD_PROVIDER_NUMBER));
            }
            if (lower.contains("number is configured") || lower.contains("calling number")) {
                return new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "telephony_not_configured",
                        "No caller ID number is set up for this account's calling provider.");
            }
            if (lower.contains("temporarily unavailable")) {
                return new AiCallingApiException(HttpStatus.SERVICE_UNAVAILABLE, "provider_unavailable",
                        "The calling provider is temporarily unavailable. Retry shortly.", null, 30);
            }
            return new AiCallingApiException(HttpStatus.BAD_GATEWAY, "dial_failed",
                    msg.isBlank() ? "The calling provider did not place the call." : msg);
        }
        log.warn("human-call-api: dial failed: {}", e.toString());
        return new AiCallingApiException(HttpStatus.BAD_GATEWAY, "dial_failed",
                "The calling provider did not place the call. Retry shortly.");
    }

    Counsellor requireCounsellor(String instituteId, Validated v) {
        for (Counsellor c : counsellors(instituteId)) {
            if (v.counsellorId() != null && v.counsellorId().equals(c.id())) return c;
            if (v.counsellorEmail() != null && c.email() != null && v.counsellorEmail().equalsIgnoreCase(c.email())) return c;
        }
        String which = v.counsellorId() != null ? v.counsellorId() : v.counsellorEmail();
        throw new AiCallingApiException(HttpStatus.NOT_FOUND, "counsellor_not_found",
                "No active counsellor or admin " + which + " in this account. List them with GET /v1/counsellors.");
    }

    /** The lead a call is filed under: exactly one live lead of THIS institute with this number. */
    record LeadLink(String responseId, String userId) {
    }

    /**
     * Link the call to the institute's lead when the number identifies exactly one, so it
     * appears on that lead's timeline and a disposition can move the lead's status. Two
     * or more leads with the number is ambiguous, and filing the call on the wrong
     * person's history is worse than filing it on none: the call is then an API contact,
     * like an AI API call. First the lead's own phone (parent_mobile), then the user whose
     * mobile it is (as the Airtel importer does), both scoped to the institute.
     */
    LeadLink linkLead(String instituteId, String phone) {
        String last10 = HumanCallGuards.last10(phone);
        if (last10 == null) return null;
        try {
            List<Object[]> rows = leadRepository.findUpToTwoLiveLeadsByInstituteAndPhoneLast10(instituteId, last10);
            if (rows != null && rows.size() == 1) {
                Object[] r = rows.get(0);
                return new LeadLink(str(r[0]), r.length > 1 ? str(r[1]) : null);
            }
            if (rows != null && rows.size() > 1) return null;
            Optional<UserDTO> user = authService.getUserByMobile(last10);
            if (user.isEmpty() || user.get().getId() == null || user.get().getId().isBlank()) return null;
            List<String> ids = leadRepository.findUpToTwoLiveLeadIdsByInstituteAndUser(instituteId, user.get().getId());
            return ids != null && ids.size() == 1 ? new LeadLink(ids.get(0), user.get().getId()) : null;
        } catch (RuntimeException e) {
            // Linking is a convenience; an unlinked call still rings and is still reported.
            log.warn("human-call-api: lead lookup failed for institute {}: {}", instituteId, e.getMessage());
            return null;
        }
    }

    // ── Read ─────────────────────────────────────────────────────────────────────

    public Map<String, Object> getHumanCall(AiCallingApiAuth.Principal p, String id) {
        return views.view(require(p, id));
    }

    HumanCallApiCall require(AiCallingApiAuth.Principal p, String id) {
        return callRepository.findByIdAndInstituteId(id == null ? "" : id.trim(), p.instituteId())
                .orElseThrow(() -> AiCallingApiException.notFound("Human call " + id));
    }

    /** The statuses GET /human-calls?status= accepts: exactly those the object reports. */
    static final Set<String> STATUSES = Set.of("queued", "ringing_counsellor", "connecting", "in_progress",
            "completed", "no_answer", "busy", "failed", "canceled");

    public Map<String, Object> listHumanCalls(AiCallingApiAuth.Principal p, String counsellorId, String status,
                                              String phoneNumber, String externalId, Instant createdAfter,
                                              Instant createdBefore, int limit, String startingAfter) {
        int lim = Math.max(1, Math.min(100, limit <= 0 ? 25 : limit));
        String publicStatus = null;
        if (status != null && !status.isBlank()) {
            publicStatus = status.trim().toLowerCase(Locale.ROOT);
            if (!STATUSES.contains(publicStatus)) {
                throw AiCallingApiException.invalid("status must be one of " + new TreeSet<>(STATUSES) + ".");
            }
        }
        String phone = null;
        if (phoneNumber != null && !phoneNumber.isBlank()) {
            phone = AiCallingApiService.normalisePhone(phoneNumber);
            if (phone == null) throw AiCallingApiException.invalid("phone_number must be in E.164 format, e.g. +919876543210.");
        }
        Instant beforeTs = null;
        String beforeId = null;
        if (startingAfter != null && !startingAfter.isBlank()) {
            HumanCallApiCall cursor = callRepository.findByIdAndInstituteId(startingAfter.trim(), p.instituteId())
                    .orElseThrow(() -> AiCallingApiException.invalid("starting_after is not a human call of this account."));
            beforeTs = cursor.getCreatedAt();
            beforeId = cursor.getId();
        }
        // The same cut-offs HumanCallViews.state() applies, so the filter matches what each
        // returned object says (telephony_call_log.created_at is naive UTC).
        Instant now = Instant.now();
        List<HumanCallApiCall> rows = callRepository.page(p.instituteId(), blankToNull(counsellorId), phone,
                blankToNull(externalId), createdAfter, createdBefore, publicStatus,
                now.minus(HumanCallViews.CREATING_GRACE),
                naiveUtc(now.minus(HumanCallViews.STUCK_AFTER)), naiveUtc(now.minus(HumanCallViews.STUCK_AFTER_AIRTEL)),
                beforeTs, beforeId, lim + 1);
        boolean hasMore = rows.size() > lim;
        List<Map<String, Object>> data = new ArrayList<>();
        for (HumanCallApiCall c : rows.subList(0, Math.min(lim, rows.size()))) data.add(views.view(c));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("has_more", hasMore);
        return out;
    }

    // ── Dispositions ─────────────────────────────────────────────────────────────

    /** GET /v1/dispositions — the institute's call outcomes (seeded with the defaults on first use). */
    public Map<String, Object> listDispositions(AiCallingApiAuth.Principal p) {
        Map<String, LeadStatus> statuses = new HashMap<>();
        for (LeadStatus s : leadStatusRepository.findByInstituteIdAndIsActiveTrueOrderByDisplayOrderAsc(p.instituteId())) {
            statuses.put(s.getId(), s);
        }
        List<Map<String, Object>> data = new ArrayList<>();
        for (CallDispositionCatalog d : dispositionService.listForInstitute(p.instituteId())) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", d.getDispositionKey());
            m.put("object", "disposition");
            m.put("label", d.getLabel());
            m.put("category", d.getCategory());
            LeadStatus target = d.getMapsToLeadStatusId() == null ? null : statuses.get(d.getMapsToLeadStatusId());
            m.put("changes_lead_status", target != null);
            m.put("lead_status", target == null ? null : Map.of("key", String.valueOf(target.getStatusKey()),
                    "label", String.valueOf(target.getLabel())));
            data.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("has_more", false);
        return out;
    }

    /**
     * POST /v1/human-calls/{id}/disposition. Through CallDispositionService.applyDisposition,
     * the same path as the dashboard: it checks the call belongs to the institute and,
     * when the outcome maps to a lead status and the call was filed under a lead, moves
     * the lead. Recorded as set by "api:" + the key id (no hyphens, to fit the column).
     */
    public Map<String, Object> setDisposition(AiCallingApiAuth.Principal p, String id, String key, String notes) {
        HumanCallApiCall call = require(p, id);
        if (key == null || key.isBlank()) throw AiCallingApiException.invalid("key is required. List them with GET /v1/dispositions.");
        if (notes != null && notes.length() > MAX_NOTES) {
            throw AiCallingApiException.invalid("notes is at most " + MAX_NOTES + " characters.");
        }
        if (call.getCallLogId() == null) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "call_not_dialed",
                    "This call was never placed, so it cannot take a disposition.");
        }
        try {
            dispositionService.applyDisposition(call.getCallLogId(), p.instituteId(), key.trim(),
                    blankToNull(notes), null, actor(p.keyId()));
        } catch (VacademyException e) {
            String msg = e.getMessage() == null ? "" : e.getMessage();
            if (msg.startsWith("Unknown disposition")) {
                throw new AiCallingApiException(HttpStatus.UNPROCESSABLE_ENTITY, "unknown_disposition",
                        "No disposition " + key.trim() + " in this account. List them with GET /v1/dispositions.");
            }
            throw e;
        }
        return views.view(callRepository.findById(call.getId()).orElse(call));
    }

    /** "api:" + the key id without hyphens: dispositioned_by is VARCHAR(36), and a key id is a UUID. */
    static String actor(String keyId) {
        String compact = keyId == null ? "unknown" : keyId.replace("-", "");
        String a = "api:" + compact;
        return a.length() > 36 ? a.substring(0, 36) : a;
    }

    // ── Internals ────────────────────────────────────────────────────────────────

    Validated validate(HumanCallInput in) {
        List<Map<String, String>> errors = new ArrayList<>();
        String counsellorId = blankToNull(in == null ? null : in.counsellorId());
        String counsellorEmail = blankToNull(in == null ? null : in.counsellorEmail());
        if ((counsellorId == null) == (counsellorEmail == null)) {
            errors.add(err("counsellor_id", "Send exactly one of counsellor_id or counsellor_email. "
                    + "List counsellors with GET /v1/counsellors."));
        }
        String phone = AiCallingApiService.normalisePhone(in == null ? null : in.phoneNumber());
        if (phone == null) errors.add(err("phone_number", "phone_number must be in E.164 format, e.g. +919876543210."));
        String name = blankToNull(in == null ? null : in.contactName());
        if (name != null && name.length() > AiCallingApiService.MAX_NAME) {
            errors.add(err("contact.name", "contact.name is at most " + AiCallingApiService.MAX_NAME + " characters."));
        }
        String email = blankToNull(in == null ? null : in.contactEmail());
        if (email != null && (email.length() > AiCallingApiService.MAX_EMAIL
                || !AiCallingApiService.EMAIL.matcher(email).matches())) {
            errors.add(err("contact.email", "contact.email is not a valid email address."));
        }
        String externalId = blankToNull(in == null ? null : in.externalId());
        if (externalId != null && externalId.length() > AiCallingApiService.MAX_EXTERNAL_ID) {
            errors.add(err("contact.external_id", "contact.external_id is at most "
                    + AiCallingApiService.MAX_EXTERNAL_ID + " characters."));
        }
        Map<String, Object> metadata = in == null ? null : in.metadata();
        if (metadata != null) {
            try {
                if (objectMapper.writeValueAsBytes(metadata).length > AiCallingApiService.MAX_METADATA_BYTES) {
                    errors.add(err("metadata", "metadata is at most " + AiCallingApiService.MAX_METADATA_BYTES + " bytes as JSON."));
                }
            } catch (Exception e) {
                errors.add(err("metadata", "metadata must be a JSON object."));
            }
        }
        return new Validated(phone, counsellorId, counsellorEmail, name, email, externalId,
                metadata == null || metadata.isEmpty() ? null : metadata,
                in != null && Boolean.TRUE.equals(in.analyze()), errors);
    }

    /**
     * Same Idempotency-Key: the same request gets the first call back; a different one is
     * refused (409 idempotency_key_reused). A first request still dialling (its row has
     * no call log yet, and is young) is 409 request_in_progress with Retry-After.
     */
    Map<String, Object> replay(HumanCallApiCall prior, HumanCallInput in) {
        if (in == null || !sameRequest(prior, in)) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "idempotency_key_reused",
                    "This Idempotency-Key was already used for a different call.", Map.of("human_call_id", prior.getId()));
        }
        if (prior.getCallLogId() == null && prior.getCreatedAt() != null
                && prior.getCreatedAt().plus(IN_PROGRESS_GRACE).isAfter(Instant.now())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "request_in_progress",
                    "A request with this Idempotency-Key is still being processed. Retry in "
                            + IN_PROGRESS_RETRY_AFTER + " seconds.",
                    Map.of("human_call_id", prior.getId()), IN_PROGRESS_RETRY_AFTER);
        }
        Map<String, Object> view = views.view(prior);
        view.put("idempotent_replay", true);
        return view;
    }

    boolean sameRequest(HumanCallApiCall prior, HumanCallInput in) {
        String cid = blankToNull(in.counsellorId());
        String cemail = blankToNull(in.counsellorEmail());
        if (cid != null && cemail != null) return false;
        if (cid != null && !cid.equals(prior.getCounsellorUserId())) return false;
        if (cemail != null && !cemail.equalsIgnoreCase(String.valueOf(prior.getCounsellorEmail()))) return false;
        if (cid == null && cemail == null) return false;
        if (!Objects.equals(prior.getPhoneNumber(), AiCallingApiService.normalisePhone(in.phoneNumber()))) return false;
        if (!Objects.equals(prior.getContactName(), blankToNull(in.contactName()))) return false;
        if (!Objects.equals(prior.getContactEmail(), blankToNull(in.contactEmail()))) return false;
        if (!Objects.equals(prior.getExternalId(), blankToNull(in.externalId()))) return false;
        if (prior.isAnalysisRequested() != Boolean.TRUE.equals(in.analyze())) return false;
        Map<String, Object> md = in.metadata() == null || in.metadata().isEmpty() ? null : in.metadata();
        return Objects.equals(json(prior.getMetadata()), json(md));
    }

    private String json(Object o) {
        if (o == null) return null;
        try {
            return objectMapper.copy().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true).writeValueAsString(o);
        } catch (Exception e) {
            return String.valueOf(o);
        }
    }

    private void safeDelete(HumanCallApiCall call) {
        try {
            callRepository.deleteById(call.getId());
        } catch (RuntimeException e) {
            log.warn("human-call-api: could not drop the row of failed call {}: {}", call.getId(), e.getMessage());
        }
    }

    /** See AiCallingApiService.detach: a managed row's setters would be flushed as a whole-row UPDATE. */
    private HumanCallApiCall detach(HumanCallApiCall call) {
        if (entityManager != null && call != null) {
            try {
                entityManager.detach(call);
            } catch (RuntimeException e) {
                log.debug("human-call-api: could not detach {}: {}", call.getId(), e.getMessage());
            }
        }
        return call;
    }

    private static List<String> instituteRoles(UserWithRolesDTO u, String instituteId) {
        Set<UserRoleDTO> roles = u.getRoles();
        if (roles == null) return List.of();
        return roles.stream()
                .filter(r -> r.getRoleName() != null)
                .filter(r -> r.getInstituteId() == null || instituteId.equals(r.getInstituteId()))
                .map(r -> r.getRoleName().toUpperCase(Locale.ROOT))
                .distinct().sorted().toList();
    }

    private static String displayName(UserWithRolesDTO u) {
        if (u.getFullName() != null && !u.getFullName().isBlank()) return u.getFullName().trim();
        if (u.getEmail() != null && !u.getEmail().isBlank()) return u.getEmail().trim();
        if (u.getUsername() != null && !u.getUsername().isBlank()) return u.getUsername().trim();
        return u.getId();
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }

    private static Map<String, String> err(String field, String message) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("field", field);
        m.put("message", message);
        return m;
    }

    private static java.sql.Timestamp naiveUtc(Instant i) {
        return java.sql.Timestamp.valueOf(java.time.LocalDateTime.ofInstant(i, java.time.ZoneOffset.UTC));
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
