package vacademy.io.admin_core_service.features.telephony.publicapi;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import vacademy.io.admin_core_service.features.telephony.core.AiCallService;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallRequestDTO;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiCallResponseDTO;
import vacademy.io.admin_core_service.features.telephony.enums.CallTrigger;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.AiAgent;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.AiAgentRepository;
import vacademy.io.admin_core_service.features.telephony.publicapi.entity.AiCallApiCall;
import vacademy.io.admin_core_service.features.telephony.publicapi.repository.AiCallApiCallRepository;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueDrainJob;
import vacademy.io.admin_core_service.features.telephony.queue.AiCallQueueService;
import vacademy.io.admin_core_service.features.telephony.queue.dto.AiCallQueueDTOs.EnqueueResult;
import vacademy.io.admin_core_service.features.telephony.queue.entity.AiCallQueueItem;
import vacademy.io.admin_core_service.features.telephony.queue.repository.AiCallQueueItemRepository;
import vacademy.io.admin_core_service.features.telephony.spi.dto.CallSubjectType;
import vacademy.io.common.exceptions.ConflictException;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The public AI calling API (Telleo API v1): create calls and batches, read them back,
 * cancel waiting calls, list agents.
 *
 * <p>Every real call goes through the AI call queue with {@link CallTrigger#API}, so it
 * inherits calling hours, line capacity and fairness between institutes, the institute
 * and per-number daily caps, the recall gap and the duplicate window. A single call is
 * queued at interactive priority and dialled on the request thread when a line is free.
 * Test calls ({@code test: true}) never dial: they run through the MOCK provider, which
 * fabricates an outcome through the same result pipeline.
 *
 * <p>The contact is {@link CallSubjectType#API_CONTACT} with subjectId = the public call
 * id: the client's CRM owns it, so the outcome is stored, billed and delivered to the
 * webhook, and no lead in our CRM is assigned or re-statused.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiCallingApiService {

    public static final int MAX_BATCH = 1000;
    static final String OUT_OF_CREDITS = "This account is out of AI calling credits. Top up to place calls.";
    static final int MAX_VARIABLES = 50;
    static final int MAX_VARIABLE_VALUE = 500;
    static final int MAX_METADATA_BYTES = 8192;
    static final Pattern E164 = Pattern.compile("^\\+[1-9][0-9]{7,14}$");
    static final Pattern VARIABLE_KEY = Pattern.compile("^[A-Za-z][A-Za-z0-9_ ]{0,39}$");
    static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{\\s*([a-zA-Z0-9_ ]+?)\\s*\\}\\}");
    /**
     * Placeholders the platform fills itself (bot.py _fill_placeholders), so they are not
     * listed as client variables: the contact's name, and the clock. institute_name,
     * lead_source and booked_slot ARE client variables for an API call.
     */
    static final Set<String> CLOCK_PLACEHOLDERS = Set.of(
            "day", "today", "date", "time", "datetime", "now", "tomorrow", "year", "month");
    static final Set<String> BUILT_IN_PLACEHOLDERS;
    static {
        Set<String> b = new HashSet<>(CLOCK_PLACEHOLDERS);
        b.addAll(List.of("name", "lead_name", "lead_source_line"));
        BUILT_IN_PLACEHOLDERS = Set.copyOf(b);
    }
    static final int MAX_NAME = 120;
    static final int MAX_EMAIL = 254;
    static final int MAX_EXTERNAL_ID = 255;
    /** Test calls per institute per 24 hours (each one writes rows and can post a webhook). */
    static final int MAX_TEST_CALLS_PER_DAY = 500;
    static final java.time.Duration IDEMPOTENCY_TTL = java.time.Duration.ofHours(24);
    /**
     * A batch row is stored under "key#index" in idempotency_key VARCHAR(255), so a batch
     * key leaves room for "#999": a 252+ character key made row 0's INSERT fail with
     * "value too long" and the whole batch a 500 (review of v1.1, 2026-10-14).
     */
    static final int MAX_BATCH_IDEMPOTENCY_KEY = 255 - ("#" + (MAX_BATCH - 1)).length();
    /**
     * A batch replay that finds a placeable row with no stored call, while the newest stored
     * call of that batch is this recent, is answered 409 request_in_progress: the first
     * request may still be working through its rows (each is a separate insert + enqueue).
     */
    static final java.time.Duration BATCH_IN_PROGRESS_GRACE = java.time.Duration.ofMinutes(2);
    static final int BATCH_IN_PROGRESS_RETRY_AFTER = 30;
    static final String SOURCE = "API";

    private static final SecureRandom RANDOM = new SecureRandom();

    private final AiAgentRepository agentRepository;
    private final AiCallApiCallRepository callRepository;
    private final AiCallQueueService queueService;
    private final AiCallQueueDrainJob drainJob;
    private final AiCallQueueItemRepository queueRepository;
    private final AiCallService aiCallService;
    private final AiCallingApiViews views;
    private final ObjectMapper objectMapper = new ObjectMapper();
    /** For detaching freshly saved rows; null in unit tests that build the service by hand. */
    @PersistenceContext
    private EntityManager entityManager;

    // ── Requests ─────────────────────────────────────────────────────────────────

    /** One call. Fields are snake_case on the wire (see the controller's DTOs). */
    public record CallInput(String agentId, String phoneNumber, String contactName, String contactEmail,
                            String externalId, Map<String, Object> variables, Map<String, Object> metadata) {
    }

    // ── Create ───────────────────────────────────────────────────────────────────

    public Map<String, Object> createCall(AiCallingApiAuth.Principal p, CallInput in, boolean test,
                                          String idempotencyKey) {
        String idem = normaliseIdempotencyKey(idempotencyKey);
        if (idem != null) {
            Optional<AiCallApiCall> prior = callRepository.findByInstituteIdAndIdempotencyKey(p.instituteId(), idem);
            if (prior.isPresent()) {
                if (prior.get().getCreatedAt() != null
                        && prior.get().getCreatedAt().plus(IDEMPOTENCY_TTL).isBefore(Instant.now())) {
                    // Keys are honoured for 24 hours; this one is older, so it may be reused.
                    callRepository.clearIdempotencyKeysBefore(Instant.now().minus(IDEMPOTENCY_TTL));
                } else {
                    return replay(prior.get(), in, test);
                }
            }
        }
        Validated v = validate(p.instituteId(), in, null);
        if (!v.errors().isEmpty()) {
            throw AiCallingApiException.invalid(v.errors().get(0).get("message"), Map.of("errors", v.errors()));
        }
        if (test) requireTestAllowance(p.instituteId(), 1);
        if (!test && !aiCallService.canAffordCall(p.instituteId())) {
            throw new AiCallingApiException(HttpStatus.PAYMENT_REQUIRED, "insufficient_credits",
                    OUT_OF_CREDITS);
        }
        AiCallApiCall call = newCall(p, v, null, test, idem);
        try {
            call = detach(callRepository.saveAndFlush(call));
        } catch (DataIntegrityViolationException race) {
            // A concurrent request with the same Idempotency-Key won the insert.
            if (idem != null) {
                return callRepository.findByInstituteIdAndIdempotencyKey(p.instituteId(), idem)
                        .map(prior -> replay(prior, in, test)).orElseThrow(() -> race);
            }
            throw race;
        }
        if (test) {
            try {
                placeTestCall(call, v);
            } catch (RuntimeException e) {
                // Nothing was placed: drop the row so a retry with the same
                // Idempotency-Key places the call instead of replaying a dead one.
                callRepository.delete(call);
                throw e;
            }
        } else {
            EnqueueResult q;
            try {
                q = queueService.enqueue(toRequest(call, v, ProviderType.VACADEMY_AI),
                        CallTrigger.API, SOURCE, null, null, true);
                if (q.isQueued()) callRepository.setQueueItemId(call.getId(), q.getQueueItemId());
            } catch (RuntimeException e) {
                abandon(call);
                throw e;
            }
            if (!q.isQueued()) {
                callRepository.delete(call);
                throw alreadyQueued(p.instituteId(), q.getQueueItemId(), v.phone());
            }
            call.setQueueItemId(q.getQueueItemId());
            tryDialNow(call);
        }
        Map<String, Object> out = views.call(callRepository.findById(call.getId()).orElse(call), false);
        if (!v.warnings().isEmpty()) out.put("warnings", v.warnings());
        return out;
    }

    public Map<String, Object> createBatch(AiCallingApiAuth.Principal p, String agentId,
                                           List<CallInput> rows, boolean test) {
        return createBatch(p, agentId, rows, test, null);
    }

    /**
     * Up to {@link #MAX_BATCH} calls; each row is accepted or rejected on its own. A row may
     * name its own agent_id; otherwise the batch's agent calls it. With an Idempotency-Key,
     * each accepted row is stored under "key#index", and a retry of the same request
     * returns the batch it created instead of queueing the calls again (see
     * {@link #batchReplay}); a different request under the key is refused with 409.
     */
    public Map<String, Object> createBatch(AiCallingApiAuth.Principal p, String agentId,
                                           List<CallInput> rows, boolean test, String idempotencyKey) {
        String idem = normaliseIdempotencyKey(idempotencyKey);
        if (idem != null && idem.length() > MAX_BATCH_IDEMPOTENCY_KEY) {
            throw AiCallingApiException.invalid("For a batch, Idempotency-Key is at most " + MAX_BATCH_IDEMPOTENCY_KEY
                    + " characters (each call is stored under the key plus \"#\" and its index).",
                    Map.of("max_length", MAX_BATCH_IDEMPOTENCY_KEY, "received", idem.length()));
        }
        if (idem != null) {
            List<AiCallApiCall> prior = priorBatchRows(p.instituteId(), idem);
            if (!prior.isEmpty() && prior.get(0).getCreatedAt() != null
                    && prior.get(0).getCreatedAt().plus(IDEMPOTENCY_TTL).isBefore(Instant.now())) {
                // Keys are honoured for 24 hours; this batch is older, so the key may be reused.
                callRepository.clearIdempotencyKeysBefore(Instant.now().minus(IDEMPOTENCY_TTL));
                prior = List.of();
            }
            if (!prior.isEmpty()) return batchReplay(p, agentId, rows, test, idem, prior);
        }
        if (rows == null || rows.isEmpty()) throw AiCallingApiException.invalid("calls must contain at least one call.");
        if (rows.size() > MAX_BATCH) {
            throw AiCallingApiException.invalid("A batch holds at most " + MAX_BATCH + " calls; split it.",
                    Map.of("max_calls", MAX_BATCH, "received", rows.size()));
        }
        AiAgent agent = requireAgent(p.instituteId(), agentId);
        if (test) requireTestAllowance(p.instituteId(), rows.size());
        if (!test && !aiCallService.canAffordCall(p.instituteId())) {
            throw new AiCallingApiException(HttpStatus.PAYMENT_REQUIRED, "insufficient_credits",
                    OUT_OF_CREDITS);
        }
        String batchId = newId("batch_");
        List<Map<String, Object>> accepted = new ArrayList<>();
        List<Map<String, Object>> rejected = new ArrayList<>();
        Set<String> seenPhones = new HashSet<>();
        Map<String, Object> agents = new HashMap<>();
        agents.put(agent.getId(), agent);
        for (int i = 0; i < rows.size(); i++) {
            RowCheck rc = checkRow(p.instituteId(), i, rows.get(i), agent.getId(), agents, seenPhones);
            if (rc.rejection() != null) {
                rejected.add(rc.rejection());
                continue;
            }
            Validated v = rc.validated();
            String rowKey = idem == null ? null : idem + "#" + i;
            AiCallApiCall call;
            try {
                call = detach(callRepository.save(newCall(p, v, batchId, test, rowKey)));
            } catch (DataIntegrityViolationException race) {
                // Another request with this Idempotency-Key stored this row first: it is
                // still running (it found no rows when it started, like this one did).
                if (rowKey != null && callRepository.findByInstituteIdAndIdempotencyKey(p.instituteId(), rowKey).isPresent()) {
                    throw batchInProgress(null);
                }
                throw race;
            }
            if (test) {
                try {
                    placeTestCall(call, v);
                } catch (RuntimeException e) {
                    callRepository.delete(call);
                    log.warn("ai-calling-api: test row {} of batch {} failed: {}", i, batchId, e.getMessage());
                    rejected.add(rejection(i, v.phone(), "call_failed", "This call could not be placed; retry it."));
                    continue;
                }
            } else {
                EnqueueResult q;
                try {
                    q = queueService.enqueue(toRequest(call, v, ProviderType.VACADEMY_AI),
                            CallTrigger.API, SOURCE, batchId, null, false);
                    if (q.isQueued()) callRepository.setQueueItemId(call.getId(), q.getQueueItemId());
                } catch (RuntimeException e) {
                    abandon(call);
                    log.warn("ai-calling-api: row {} of batch {} not queued: {}", i, batchId, e.getMessage());
                    rejected.add(rejection(i, v.phone(), "call_failed", "This call could not be queued; retry it."));
                    continue;
                }
                if (!q.isQueued()) {
                    callRepository.delete(call);
                    Map<String, Object> r = rejection(i, v.phone(), "call_already_queued",
                            "This number already has a call waiting for a line.");
                    String existing = existingCallForQueueItem(p.instituteId(), q.getQueueItemId());
                    if (existing != null) r.put("call_id", existing);
                    rejected.add(r);
                    continue;
                }
                call.setQueueItemId(q.getQueueItemId());
            }
            accepted.add(acceptedRow(i, call, agent.getId(), v.warnings()));
        }
        return batchResponse(batchId, agent.getId(), test, accepted, rejected);
    }

    // ── Read ─────────────────────────────────────────────────────────────────────

    public Map<String, Object> getCall(AiCallingApiAuth.Principal p, String id) {
        AiCallApiCall call = callRepository.findByIdAndInstituteId(id, p.instituteId())
                .orElseThrow(() -> AiCallingApiException.notFound("Call " + id));
        return views.call(call, false);
    }

    public Map<String, Object> listCalls(AiCallingApiAuth.Principal p, String batchId, String externalId,
                                         Instant since, int limit, String startingAfter) {
        int lim = Math.max(1, Math.min(100, limit <= 0 ? 25 : limit));
        Instant beforeTs = null;
        String beforeId = null;
        if (startingAfter != null && !startingAfter.isBlank()) {
            AiCallApiCall cursor = callRepository.findByIdAndInstituteId(startingAfter.trim(), p.instituteId())
                    .orElseThrow(() -> AiCallingApiException.invalid("starting_after is not a call of this account."));
            beforeTs = cursor.getCreatedAt();
            beforeId = cursor.getId();
        }
        List<AiCallApiCall> rows = callRepository.page(p.instituteId(), blankToNull(batchId),
                blankToNull(externalId), since, beforeTs, beforeId, lim + 1);
        boolean hasMore = rows.size() > lim;
        List<Map<String, Object>> data = new ArrayList<>();
        for (AiCallApiCall c : rows.subList(0, Math.min(lim, rows.size()))) data.add(views.call(c, false));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("has_more", hasMore);
        return out;
    }

    public Map<String, Object> getBatch(AiCallingApiAuth.Principal p, String batchId) {
        List<AiCallApiCall> calls = callRepository.findByBatchIdAndInstituteIdOrderByCreatedAtAsc(batchId, p.instituteId());
        if (calls.isEmpty()) throw AiCallingApiException.notFound("Batch " + batchId);
        Map<String, Integer> byStatus = new TreeMap<>();
        for (AiCallApiCall c : calls) {
            String s = String.valueOf(views.call(c, true).get("status"));
            byStatus.merge(s, 1, Integer::sum);
        }
        int done = 0;
        for (Map.Entry<String, Integer> e : byStatus.entrySet()) {
            if (AiCallingApiViews.FINAL_STATUSES.contains(e.getKey())) done += e.getValue();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", batchId);
        out.put("object", "batch");
        out.put("agent_id", calls.get(0).getAgentId());
        out.put("test", calls.get(0).isTestMode());
        out.put("total", calls.size());
        out.put("finished", done);
        out.put("counts", byStatus);
        out.put("created_at", calls.get(0).getCreatedAt().toString());
        return out;
    }

    public Map<String, Object> cancel(AiCallingApiAuth.Principal p, String id) {
        AiCallApiCall call = callRepository.findByIdAndInstituteId(id, p.instituteId())
                .orElseThrow(() -> AiCallingApiException.notFound("Call " + id));
        if (call.getQueueItemId() == null
                || queueRepository.cancelIfQueued(call.getQueueItemId(), "Canceled through the API.") == 0) {
            Map<String, Object> current = views.call(call, true);
            throw new AiCallingApiException(HttpStatus.CONFLICT, "call_not_cancelable",
                    "Only a call that is still waiting can be canceled; this one is " + current.get("status") + ".",
                    Map.of("status", current.get("status")));
        }
        return views.call(call, false);
    }

    public Map<String, Object> listAgents(AiCallingApiAuth.Principal p) {
        return listAgents(p, false);
    }

    /**
     * GET /v1/agents: the agents a call can name (enabled, not inbound-only); with
     * {@code includeDisabled} every agent of the account, turned off and inbound-only ones too.
     * v1.3 added enabled, direction, voice, tts_model and updated_at (additive).
     */
    public Map<String, Object> listAgents(AiCallingApiAuth.Principal p, boolean includeDisabled) {
        List<Map<String, Object>> data = new ArrayList<>();
        for (AiAgent a : agentRepository.findByInstituteIdOrderByCreatedAtDesc(p.instituteId())) {
            if (!includeDisabled && !Boolean.TRUE.equals(a.getEnabled())) continue;
            if (!includeDisabled && "INBOUND".equalsIgnoreCase(a.getDirection())) continue;
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", a.getId());
            m.put("object", "agent");
            m.put("name", a.getName());
            m.put("language", a.getLanguage());
            m.put("enabled", Boolean.TRUE.equals(a.getEnabled()));
            m.put("direction", a.getDirection() == null ? "outbound" : a.getDirection().toLowerCase(Locale.ROOT));
            m.put("voice", a.getVoice());
            m.put("tts_model", a.getTtsModel());
            m.put("updated_at", a.getUpdatedAt() == null ? null : a.getUpdatedAt().toInstant().toString());
            Set<String> used = placeholders(a.getOpeningLine(), a.getSystemPrompt());
            m.put("uses_contact_name", used.contains("name") || used.contains("lead_name"));
            List<String> vars = new ArrayList<>();
            for (String u : used) if (!BUILT_IN_PLACEHOLDERS.contains(u)) vars.add(u);
            m.put("variables", vars);
            data.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("object", "list");
        out.put("data", data);
        out.put("has_more", false);
        return out;
    }

    // ── Internals ────────────────────────────────────────────────────────────────

    record Validated(String phone, AiAgent agent, String name, String email, String externalId,
                     Map<String, String> variables, Map<String, Object> metadata,
                     List<Map<String, String>> errors, List<Map<String, String>> warnings) {
    }

    Validated validate(String instituteId, CallInput in, AiAgent knownAgent) {
        List<Map<String, String>> errors = new ArrayList<>();
        AiAgent agent = knownAgent;
        if (agent == null) {
            if (in == null || in.agentId() == null || in.agentId().isBlank()) {
                errors.add(err("agent_id", "agent_id is required. List your agents with GET /v1/agents."));
            } else {
                agent = requireAgent(instituteId, in.agentId());
            }
        }
        String phone = normalisePhone(in == null ? null : in.phoneNumber());
        if (phone == null) {
            errors.add(err("phone_number", "phone_number must be in E.164 format, e.g. +919876543210."));
        }
        String name = blankToNull(in == null ? null : in.contactName());
        if (name != null && name.length() > MAX_NAME) {
            errors.add(err("contact.name", "contact.name is at most " + MAX_NAME + " characters."));
        }
        String email = blankToNull(in == null ? null : in.contactEmail());
        if (email != null && (email.length() > MAX_EMAIL || !EMAIL.matcher(email).matches())) {
            errors.add(err("contact.email", "contact.email is not a valid email address."));
        }
        String externalId = blankToNull(in == null ? null : in.externalId());
        if (externalId != null && externalId.length() > MAX_EXTERNAL_ID) {
            errors.add(err("contact.external_id", "contact.external_id is at most " + MAX_EXTERNAL_ID + " characters."));
        }
        Map<String, String> vars = new LinkedHashMap<>();
        if (in != null && in.variables() != null) {
            if (in.variables().size() > MAX_VARIABLES) {
                errors.add(err("variables", "At most " + MAX_VARIABLES + " variables per call."));
            } else {
                for (Map.Entry<String, Object> e : in.variables().entrySet()) {
                    String k = e.getKey() == null ? "" : e.getKey().trim();
                    if (!VARIABLE_KEY.matcher(k).matches()) {
                        errors.add(err("variables." + k, "Variable names start with a letter and use letters, digits, spaces or underscores (max 40)."));
                        continue;
                    }
                    Object val = e.getValue();
                    if (val instanceof Map || val instanceof Collection) {
                        errors.add(err("variables." + k, "Variable values must be text, numbers or booleans."));
                        continue;
                    }
                    String s = val == null ? "" : String.valueOf(val).trim();
                    if (s.length() > MAX_VARIABLE_VALUE) {
                        errors.add(err("variables." + k, "Variable values are at most " + MAX_VARIABLE_VALUE + " characters."));
                        continue;
                    }
                    vars.put(k, s);
                }
            }
        }
        Map<String, Object> metadata = in == null ? null : in.metadata();
        if (metadata != null) {
            try {
                if (objectMapper.writeValueAsBytes(metadata).length > MAX_METADATA_BYTES) {
                    errors.add(err("metadata", "metadata is at most " + MAX_METADATA_BYTES + " bytes as JSON."));
                }
            } catch (Exception e) {
                errors.add(err("metadata", "metadata must be a JSON object."));
            }
        }
        return new Validated(phone, agent, name, email, externalId, vars.isEmpty() ? null : vars,
                metadata == null || metadata.isEmpty() ? null : metadata, errors, reservedVariableWarnings(vars));
    }

    /**
     * Variables named like a placeholder the platform fills itself (name, lead_name and the
     * clock words). They are accepted and stored, and reach the agent with the other
     * variables as what it knows about the contact, but never fill the placeholder: the bot
     * resolves its own values first (bot.py _fill_placeholders), so {{date}} is always today
     * and {{name}} always contact.name. c7ff69b207 rejected them, which broke CRM
     * integrations live since 10-13 that forward fields such as "date" or "year"; the client
     * is told with a non-fatal warning instead (review of v1.1, 2026-10-14).
     */
    static List<Map<String, String>> reservedVariableWarnings(Map<String, ?> variables) {
        List<Map<String, String>> out = new ArrayList<>();
        if (variables == null) return out;
        for (String raw : variables.keySet()) {
            String k = raw == null ? "" : raw.trim();
            String lower = k.toLowerCase(Locale.ROOT);
            boolean isName = "name".equals(lower) || "lead_name".equals(lower);
            if (!isName && !CLOCK_PLACEHOLDERS.contains(lower)) continue;
            Map<String, String> w = new LinkedHashMap<>();
            w.put("field", "variables." + k);
            w.put("code", "reserved_variable");
            w.put("message", "{{" + lower + "}} in the agent's script is always filled "
                    + (isName ? "from contact.name" : "with the current date and time")
                    + "; this value does not replace it. The agent receives it only as information about the contact.");
            out.add(w);
        }
        return out;
    }

    AiAgent requireAgent(String instituteId, String agentId) {
        if (agentId == null || agentId.isBlank()) {
            throw AiCallingApiException.invalid("agent_id is required. List your agents with GET /v1/agents.");
        }
        AiAgent a = agentRepository.findByIdAndInstituteId(agentId.trim(), instituteId)
                .orElseThrow(() -> new AiCallingApiException(HttpStatus.NOT_FOUND, "agent_not_found",
                        "No agent " + agentId + " in this account. List your agents with GET /v1/agents."));
        if (!Boolean.TRUE.equals(a.getEnabled())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "agent_disabled", "Agent " + agentId + " is turned off.");
        }
        if ("INBOUND".equalsIgnoreCase(a.getDirection())) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "agent_inbound_only",
                    "Agent " + agentId + " only answers incoming calls.");
        }
        return a;
    }

    private AiCallApiCall newCall(AiCallingApiAuth.Principal p, Validated v, String batchId, boolean test, String idem) {
        return AiCallApiCall.builder()
                .id(newId("call_"))
                .instituteId(p.instituteId())
                .apiKeyId(p.keyId())
                .batchId(batchId)
                .agentId(v.agent().getId())
                .phoneNumber(v.phone())
                .contactName(v.name())
                .contactEmail(v.email())
                .externalId(v.externalId())
                .variables(v.variables())
                .metadata(v.metadata())
                .testMode(test)
                .idempotencyKey(idem)
                .webhookAttempts(0)
                .build();
    }

    private AiCallRequestDTO toRequest(AiCallApiCall call, Validated v, String provider) {
        AiCallRequestDTO r = new AiCallRequestDTO();
        r.setInstituteId(call.getInstituteId());
        r.setProvider(provider);
        r.setPhoneNumber(call.getPhoneNumber());
        r.setUserId(contactUserId(call.getInstituteId(), call.getPhoneNumber()));
        r.setCampaignId(call.getAgentId());
        r.setSubjectType(CallSubjectType.API_CONTACT.name());
        r.setSubjectId(call.getId());
        r.setCustomerName(call.getContactName());
        r.setCustomerEmail(call.getContactEmail());
        Map<String, Object> md = new LinkedHashMap<>();
        md.put("apiCallId", call.getId());
        if (call.getBatchId() != null) md.put("apiBatchId", call.getBatchId());
        r.setMetadata(md);
        return r;
    }

    /**
     * A stable pseudo user id per (institute, number). The per-number daily cap, the
     * recall gap and the duplicate window all key on the user, so two API calls to the
     * same number are recognised as the same person. It never exists in auth_service.
     */
    static String contactUserId(String instituteId, String phone) {
        return UUID.nameUUIDFromBytes(("ai-calling-api:" + instituteId + ":" + phone)
                .getBytes(StandardCharsets.UTF_8)).toString();
    }

    private void placeTestCall(AiCallApiCall call, Validated v) {
        AiCallResponseDTO r = aiCallService.placeCall(toRequest(call, v, ProviderType.MOCK), null, CallTrigger.API);
        if (r != null && r.getCallLogId() != null) {
            call.setCallLogId(r.getCallLogId());
            callRepository.setCallLogIdIfNull(call.getId(), r.getCallLogId());
        }
    }

    private void tryDialNow(AiCallApiCall call) {
        try {
            drainJob.dispatchNowIfLineFree(call.getQueueItemId()).ifPresent(resp -> {
                if (resp.getCallLogId() != null) {
                    call.setCallLogId(resp.getCallLogId());
                    callRepository.setCallLogIdIfNull(call.getId(), resp.getCallLogId());
                }
            });
        } catch (ConflictException e) {
            // Credits ran out between the pre-check and the dial: the queue has parked the
            // call (it resumes after a top-up). GET /v1/calls/{id} shows the reason.
            log.info("ai-calling-api: call {} parked: {}", call.getId(), e.getMessage());
        } catch (RuntimeException e) {
            log.warn("ai-calling-api: immediate dial failed for {} (stays queued): {}", call.getId(), e.getMessage());
        }
    }

    /**
     * Undo a create that failed after the insert: cancel the queue item if one was made
     * (enqueue may have committed it before failing), then drop the row, so nothing dials
     * a call the client was told failed.
     */
    private void abandon(AiCallApiCall call) {
        try {
            queueRepository.findFirstByInstituteIdAndSubjectIdOrderByCreatedAtDesc(call.getInstituteId(), call.getId())
                    .ifPresent(item -> queueRepository.cancelIfQueued(item.getId(), "The API request that created it failed."));
        } catch (RuntimeException e) {
            log.warn("ai-calling-api: could not cancel the queue item of {}: {}", call.getId(), e.getMessage());
        }
        callRepository.delete(call);
    }

    private void requireTestAllowance(String instituteId, int wanted) {
        long used = callRepository.countTestCallsSince(instituteId, Instant.now().minus(java.time.Duration.ofHours(24)));
        if (used + wanted > MAX_TEST_CALLS_PER_DAY) {
            throw new AiCallingApiException(HttpStatus.TOO_MANY_REQUESTS, "test_limit_reached",
                    "At most " + MAX_TEST_CALLS_PER_DAY + " test calls per 24 hours; " + used + " used.",
                    Map.of("limit", MAX_TEST_CALLS_PER_DAY, "used", used), 3600);
        }
    }

    /** One batch row checked: a rejection, or the validated call (its agent included). */
    private record RowCheck(Map<String, Object> rejection, Validated validated) {
    }

    /**
     * The checks a batch row passes before anything is written: its agent (cached in
     * {@code agents} as the agent or the error it raised), validation, and the number not
     * appearing earlier in the batch. Pure apart from the agent lookups, so a replay
     * recomputes exactly the rejections the first request made at this stage.
     */
    private RowCheck checkRow(String instituteId, int i, CallInput row, String batchAgentId,
                              Map<String, Object> agents, Set<String> seenPhones) {
        String rowAgentId = row == null || row.agentId() == null || row.agentId().isBlank()
                ? batchAgentId : row.agentId().trim();
        String rawPhone = row == null ? null : row.phoneNumber();
        Object found = rowAgentId == null ? null : agents.computeIfAbsent(rowAgentId, id -> {
            try {
                return requireAgent(instituteId, id);
            } catch (AiCallingApiException e) {
                return e;
            }
        });
        if (found == null) {
            return new RowCheck(rejection(i, rawPhone, "invalid_request",
                    "agent_id is required. List your agents with GET /v1/agents."), null);
        }
        if (found instanceof AiCallingApiException e) {
            return new RowCheck(rejection(i, rawPhone, e.getCode(), e.getMessage()), null);
        }
        AiAgent rowAgent = (AiAgent) found;
        Validated v = validate(instituteId, withAgent(row, rowAgent.getId()), rowAgent);
        if (!v.errors().isEmpty()) {
            return new RowCheck(rejection(i, rawPhone, "invalid_request", v.errors().get(0).get("message")), null);
        }
        if (!seenPhones.add(v.phone())) {
            return new RowCheck(rejection(i, v.phone(), "duplicate_in_batch", "This number appears earlier in the batch."),
                    null);
        }
        return new RowCheck(null, v);
    }

    private static CallInput withAgent(CallInput row, String agentId) {
        return new CallInput(agentId, row == null ? null : row.phoneNumber(),
                row == null ? null : row.contactName(), row == null ? null : row.contactEmail(),
                row == null ? null : row.externalId(), row == null ? null : row.variables(),
                row == null ? null : row.metadata());
    }

    /**
     * The calls a keyed batch stored, oldest first: rows of a batch whose key is exactly
     * "key#index" (a single call keyed "key#0" by hand is not one of them).
     */
    private List<AiCallApiCall> priorBatchRows(String instituteId, String idem) {
        List<AiCallApiCall> out = new ArrayList<>();
        for (AiCallApiCall c : callRepository.findByInstituteIdAndIdempotencyKeyStartingWithOrderByCreatedAtAsc(
                instituteId, idem + "#")) {
            if (c.getBatchId() != null && batchIndex(c, idem) >= 0) out.add(c);
        }
        return out;
    }

    private static int batchIndex(AiCallApiCall c, String idem) {
        String key = c.getIdempotencyKey();
        if (key == null || !key.startsWith(idem + "#")) return -1;
        String suffix = key.substring(idem.length() + 1);
        if (suffix.isEmpty() || suffix.length() > 4 || !suffix.chars().allMatch(Character::isDigit)) return -1;
        return Integer.parseInt(suffix);
    }

    /**
     * A batch retried with the same Idempotency-Key. The request must be the same one: same
     * test flag, and every stored row's call equal (after normalising) to the row at its
     * index; anything else is 409 idempotency_key_reused, as for a single call. A matching
     * replay places nothing and answers what the first request answered: the stored rows as
     * accepted, and the rejected rows recomputed by {@link #checkRow}.
     *
     * <p>A row that passes those checks but has no stored call was accepted and then
     * dropped by the first request (call_failed, or call_already_queued after enqueue).
     * Only accepted rows are stored (no migration for a response cache), so which of the two
     * is not known: it comes back as call_not_placed. It is NOT placed now: a replay that
     * dialled would turn a retried timeout into a second campaign leg, and the first
     * response already told the client which rows to send again (under a new key).
     *
     * <p>The first request writes one row at a time, so a retry that arrives while it is
     * still running would see only a prefix. A placeable row with no stored call while the
     * newest stored call is under {@link #BATCH_IN_PROGRESS_GRACE} old is therefore 409
     * request_in_progress with Retry-After, never a silently partial batch.
     */
    private Map<String, Object> batchReplay(AiCallingApiAuth.Principal p, String agentId, List<CallInput> rows,
                                            boolean test, String idem, List<AiCallApiCall> prior) {
        AiCallApiCall first = prior.get(0);
        String batchAgentId = agentId == null || agentId.isBlank() ? first.getAgentId() : agentId.trim();
        Map<Integer, AiCallApiCall> stored = new HashMap<>();
        Instant newest = null;
        for (AiCallApiCall c : prior) {
            stored.put(batchIndex(c, idem), c);
            if (c.getCreatedAt() != null && (newest == null || c.getCreatedAt().isAfter(newest))) newest = c.getCreatedAt();
        }
        boolean same = rows != null && !rows.isEmpty() && rows.size() <= MAX_BATCH && first.isTestMode() == test;
        if (same) {
            for (Map.Entry<Integer, AiCallApiCall> e : stored.entrySet()) {
                int i = e.getKey();
                CallInput row = i < rows.size() ? rows.get(i) : null;
                if (row == null || !sameRequest(e.getValue(), withAgent(row, effectiveAgent(row, batchAgentId)))) {
                    same = false;
                    break;
                }
            }
        }
        if (!same) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "idempotency_key_reused",
                    "This Idempotency-Key was already used for a different batch.",
                    Map.of("batch_id", first.getBatchId()));
        }
        List<Map<String, Object>> accepted = new ArrayList<>();
        List<Map<String, Object>> rejected = new ArrayList<>();
        Set<String> seenPhones = new HashSet<>();
        Map<String, Object> agents = new HashMap<>();
        boolean missing = false;
        for (int i = 0; i < rows.size(); i++) {
            AiCallApiCall c = stored.get(i);
            if (c != null) {
                // Passed every check the first time; its number still counts for duplicate_in_batch.
                seenPhones.add(c.getPhoneNumber());
                accepted.add(acceptedRow(i, c, batchAgentId, reservedVariableWarnings(rows.get(i).variables())));
                continue;
            }
            RowCheck rc = checkRow(p.instituteId(), i, rows.get(i), batchAgentId, agents, seenPhones);
            if (rc.rejection() != null) {
                rejected.add(rc.rejection());
                continue;
            }
            missing = true;
            rejected.add(rejection(i, rc.validated().phone(), "call_not_placed",
                    "The first request with this Idempotency-Key did not place this call. Send it again under a new key."));
        }
        if (missing && newest != null && newest.plus(BATCH_IN_PROGRESS_GRACE).isAfter(Instant.now())) {
            throw batchInProgress(first.getBatchId());
        }
        Map<String, Object> out = batchResponse(first.getBatchId(), batchAgentId, first.isTestMode(), accepted, rejected);
        out.put("idempotent_replay", true);
        return out;
    }

    private static String effectiveAgent(CallInput row, String batchAgentId) {
        return row.agentId() == null || row.agentId().isBlank() ? batchAgentId : row.agentId().trim();
    }

    private static AiCallingApiException batchInProgress(String batchId) {
        Map<String, Object> d = new LinkedHashMap<>();
        if (batchId != null) d.put("batch_id", batchId);
        return new AiCallingApiException(HttpStatus.CONFLICT, "request_in_progress",
                "A request with this Idempotency-Key is still being processed. Retry in "
                        + BATCH_IN_PROGRESS_RETRY_AFTER + " seconds.", d, BATCH_IN_PROGRESS_RETRY_AFTER);
    }

    private static Map<String, Object> acceptedRow(int index, AiCallApiCall call, String batchAgentId,
                                                   List<Map<String, String>> warnings) {
        Map<String, Object> a = new LinkedHashMap<>();
        a.put("index", index);
        a.put("id", call.getId());
        a.put("phone_number", call.getPhoneNumber());
        if (call.getExternalId() != null) a.put("external_id", call.getExternalId());
        if (call.getAgentId() != null && !call.getAgentId().equals(batchAgentId)) a.put("agent_id", call.getAgentId());
        if (warnings != null && !warnings.isEmpty()) a.put("warnings", warnings);
        return a;
    }

    private static Map<String, Object> batchResponse(String batchId, String agentId, boolean test,
                                                     List<Map<String, Object>> accepted,
                                                     List<Map<String, Object>> rejected) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", batchId);
        out.put("object", "batch");
        out.put("agent_id", agentId);
        out.put("test", test);
        out.put("accepted_count", accepted.size());
        out.put("rejected_count", rejected.size());
        out.put("calls", accepted);
        out.put("rejected", rejected);
        return out;
    }

    /**
     * Under open-session-in-view the saved row stays managed for the rest of the request,
     * and a setter on it (queue item, call log) is flushed by the next targeted write as a
     * whole-row UPDATE from the row as it was saved, over what the finaliser wrote since
     * (review of v1.1, 2026-10-14). Detached, the setters only feed this request's reply.
     */
    private AiCallApiCall detach(AiCallApiCall call) {
        if (entityManager != null && call != null) {
            try {
                entityManager.detach(call);
            } catch (RuntimeException e) {
                log.debug("ai-calling-api: could not detach {}: {}", call.getId(), e.getMessage());
            }
        }
        return call;
    }

    /**
     * Same Idempotency-Key: the same request gets the first call back; a different one
     * (any field, including test) is refused. Compared after normalising, so "+91 98765
     * 43210" and "+919876543210" are the same request.
     */
    private Map<String, Object> replay(AiCallApiCall prior, CallInput in, boolean test) {
        boolean same = in != null && prior.isTestMode() == test && sameRequest(prior, in);
        if (!same) {
            throw new AiCallingApiException(HttpStatus.CONFLICT, "idempotency_key_reused",
                    "This Idempotency-Key was already used for a different call.",
                    Map.of("call_id", prior.getId()));
        }
        Map<String, Object> view = views.call(prior, false);
        view.put("idempotent_replay", true);
        List<Map<String, String>> warnings = reservedVariableWarnings(in.variables());
        if (!warnings.isEmpty()) view.put("warnings", warnings);
        return view;
    }

    private boolean sameRequest(AiCallApiCall prior, CallInput in) {
        if (!Objects.equals(prior.getPhoneNumber(), normalisePhone(in.phoneNumber()))) return false;
        if (in.agentId() != null && !Objects.equals(prior.getAgentId(), in.agentId().trim())) return false;
        if (!Objects.equals(prior.getContactName(), blankToNull(in.contactName()))) return false;
        if (!Objects.equals(prior.getContactEmail(), blankToNull(in.contactEmail()))) return false;
        if (!Objects.equals(prior.getExternalId(), blankToNull(in.externalId()))) return false;
        Map<String, String> vars = new LinkedHashMap<>();
        if (in.variables() != null) {
            in.variables().forEach((k, val) -> vars.put(k == null ? "" : k.trim(), val == null ? "" : String.valueOf(val).trim()));
        }
        Map<String, String> priorVars = prior.getVariables() == null ? Map.of() : prior.getVariables();
        if (!priorVars.equals(vars)) return false;
        Map<String, Object> md = in.metadata() == null || in.metadata().isEmpty() ? null : in.metadata();
        return Objects.equals(json(prior.getMetadata()), json(md));
    }

    private String json(Object o) {
        if (o == null) return null;
        try {
            return objectMapper.copy().configure(com.fasterxml.jackson.databind.SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true)
                    .writeValueAsString(o);
        } catch (Exception e) {
            return String.valueOf(o);
        }
    }

    private AiCallingApiException alreadyQueued(String instituteId, String queueItemId, String phone) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("phone_number", phone);
        if (queueItemId != null) {
            String existing = existingCallForQueueItem(instituteId, queueItemId);
            if (existing != null) d.put("call_id", existing);
        }
        return new AiCallingApiException(HttpStatus.CONFLICT, "call_already_queued",
                "This number already has a call waiting for a line.", d);
    }

    private String existingCallForQueueItem(String instituteId, String queueItemId) {
        AiCallQueueItem item = queueRepository.findById(queueItemId).orElse(null);
        if (item == null || !instituteId.equals(item.getInstituteId())) return null;
        if (CallSubjectType.API_CONTACT.name().equals(item.getSubjectType())) return item.getSubjectId();
        return null;
    }

    static Set<String> placeholders(String... texts) {
        Set<String> out = new LinkedHashSet<>();
        for (String t : texts) {
            if (t == null) continue;
            Matcher m = PLACEHOLDER.matcher(t);
            while (m.find()) out.add(m.group(1).trim().toLowerCase(Locale.ROOT));
        }
        return out;
    }

    static String normalisePhone(String raw) {
        if (raw == null) return null;
        String s = raw.trim().replaceAll("[\\s\\-().]", "");
        if (s.startsWith("00")) s = "+" + s.substring(2);
        return E164.matcher(s).matches() ? s : null;
    }

    static String normaliseIdempotencyKey(String raw) {
        if (raw == null || raw.isBlank()) return null;
        String k = raw.trim();
        if (k.length() > 255) throw AiCallingApiException.invalid("Idempotency-Key is at most 255 characters.");
        return k;
    }

    static String newId(String prefix) {
        byte[] b = new byte[12];
        RANDOM.nextBytes(b);
        return prefix + HexFormat.of().formatHex(b);
    }

    private static Map<String, String> err(String field, String message) {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("field", field);
        m.put("message", message);
        return m;
    }

    private static Map<String, Object> rejection(int index, String phone, String code, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("index", index);
        if (phone != null) m.put("phone_number", phone);
        m.put("code", code);
        m.put("message", message);
        return m;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
