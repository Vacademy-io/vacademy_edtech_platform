package vacademy.io.admin_core_service.features.workflow.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Answers two questions about a workflow seed context, both needed before an execution
 * row is written:
 *
 * <ol>
 *   <li><b>Who is this run for?</b> — {@link #resolveSubjectUserId(Map)} picks the auth
 *       user id out of the context so the run can be listed on that learner's Workflows
 *       tab. Trigger emitters have never agreed on one key: the lead paths put
 *       {@code userId} (see {@code LeadTriggerContextBuilder}), the enrollment path puts a
 *       whole {@code user} DTO ({@code StudentRegistrationManager}), others use
 *       {@code studentUserId} or {@code learnerId}. Rather than force a rename across ~40
 *       call sites, this reads them in priority order.</li>
 *
 *   <li><b>Can it be stored?</b> — {@link #toStorableContext(Map)} strips the context down
 *       to what Postgres can hold as {@code jsonb}. Contexts routinely carry live JPA
 *       entities ({@code subOrg} is an {@code Institute}); serializing one can drag in a
 *       lazy proxy and blow up, and it must never take the trigger down with it. Values
 *       that will not serialize are dropped individually, keeping the rest of the context
 *       usable for a retry.</li>
 * </ol>
 */
@Slf4j
@Component
public class WorkflowSubjectResolver {

    /**
     * Context keys that name the subject, most specific first. Deliberately excludes
     * actor-ish keys ({@code counselorId}, {@code statusChangedByUserId},
     * {@code createdByUserId}): those are who DID it, not who it was FOR — attributing a
     * run to a counsellor would put every one of their leads' automations on their own
     * profile.
     */
    private static final List<String> SUBJECT_KEYS = List.of(
            "subjectUserId",
            "userId",
            "studentUserId",
            "learnerId",
            "user_id");

    /**
     * Nested objects that carry the subject under an {@code id} field, checked after the
     * flat keys above. {@code user} is a {@code UserDTO} on the enrollment path.
     */
    private static final List<String> SUBJECT_OBJECT_KEYS = List.of("user", "learner", "student");

    /**
     * Per-value ceiling on the stored context, in serialized characters. A QUERY node's
     * result list can run to megabytes; a retry needs the trigger's own inputs, not a
     * cached result set that will be recomputed anyway.
     */
    private static final int MAX_VALUE_CHARS = 32_000;

    private final ObjectMapper objectMapper;

    public WorkflowSubjectResolver(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** @return the auth user id this run is for, or null when the run has no single subject. */
    public String resolveSubjectUserId(Map<String, Object> context) {
        if (context == null || context.isEmpty()) {
            return null;
        }

        for (String key : SUBJECT_KEYS) {
            String value = asId(context.get(key));
            if (value != null) {
                return value;
            }
        }

        for (String key : SUBJECT_OBJECT_KEYS) {
            String value = idOf(context.get(key));
            if (value != null) {
                return value;
            }
        }

        return null;
    }

    /**
     * Reduce a seed context to a map Jackson can write as {@code jsonb}, dropping any entry
     * that will not serialize or is too large. Returns null when nothing survives, which the
     * caller stores as a NULL {@code seed_context} — i.e. "this run cannot be retried".
     */
    public Map<String, Object> toStorableContext(Map<String, Object> context) {
        if (context == null || context.isEmpty()) {
            return null;
        }

        Map<String, Object> storable = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : context.entrySet()) {
            if (entry.getValue() == null) {
                continue;
            }
            try {
                String json = objectMapper.writeValueAsString(entry.getValue());
                if (json.length() > MAX_VALUE_CHARS) {
                    log.debug("Workflow seed context: dropping oversized key '{}' ({} chars)",
                            entry.getKey(), json.length());
                    continue;
                }
                // Round-trip so the stored map holds plain maps/lists/scalars rather than
                // entities Hibernate would have to re-serialize on write.
                storable.put(entry.getKey(), objectMapper.readValue(json, Object.class));
            } catch (Exception e) {
                log.debug("Workflow seed context: dropping unserializable key '{}': {}",
                        entry.getKey(), e.getMessage());
            }
        }

        return storable.isEmpty() ? null : storable;
    }

    /**
     * The context a retry should re-run with: the stored seed minus the bookkeeping the
     * engine stamps per-run. Leaving {@code executionId} in would make the retry log its
     * nodes against the ORIGINAL execution, and leaving the resume markers in would make it
     * skip straight to a node from a pause that is not happening this time.
     */
    public Map<String, Object> toRetryContext(Map<String, Object> storedSeedContext) {
        Map<String, Object> ctx = new HashMap<>(storedSeedContext == null ? Map.of() : storedSeedContext);
        ctx.remove("executionId");
        ctx.remove("dryRun");
        ctx.remove("__workflow_paused");
        ctx.remove("__resumed_at_node");
        ctx.remove("__resumed_from_delay");
        ctx.remove("__executed_notification_nodes");
        return ctx;
    }

    private String asId(Object value) {
        if (value == null) {
            return null;
        }
        String text = value.toString().trim();
        return text.isEmpty() ? null : text;
    }

    @SuppressWarnings("unchecked")
    private String idOf(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Map<?, ?> map) {
            String id = asId(((Map<String, Object>) map).get("id"));
            return id != null ? id : asId(((Map<String, Object>) map).get("userId"));
        }
        // A DTO/entity — read its id reflectively rather than binding this utility to
        // every context payload type there is.
        try {
            return asId(value.getClass().getMethod("getId").invoke(value));
        } catch (Exception e) {
            return null;
        }
    }
}
