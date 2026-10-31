package vacademy.io.admin_core_service.features.credits.client;

import lombok.Builder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Optional usage-metering fields that ride along on a {@code /credits/v1/deduct} or
 * {@code /credits/v1/check} body (ai_service writes them to {@code ai_usage_event}).
 *
 * <p>Every field is optional and is OMITTED from the JSON when null or blank, never sent
 * as null, so a body built with no metering fields is byte-for-byte the body the
 * pre-metering overloads send. ai_service's request models ignore keys they do not know,
 * so these fields are also safe to send before ai_service understands them.
 *
 * <p>Two rules keep the ledger exactly as it is today:
 * <ul>
 *   <li>{@link #applyTo} never overwrites a key the base body already carries
 *       (user_id, user_role, subject_user_id, batch_id, idempotency_key ...).</li>
 *   <li>{@link #subjectUserId} is written into {@code usage_context.subject_user_id},
 *       never as the top-level {@code subject_user_id}: the top-level key is a
 *       {@code credit_transactions} column, and setting it on paths that never sent it
 *       would move those charges between users in the per-user usage screens. Paths that
 *       already send a subject keep doing so through their existing parameter.</li>
 * </ul>
 */
@Builder(toBuilder = true)
public record MeteringFields(
        String useCase,
        String actorKind,
        String actorRoleClass,
        List<String> actorRolesRaw,
        String actorDisplayName,
        String subjectUserId,
        String subjectDisplayName,
        String surface,
        String sourceService,
        Map<String, Object> usageContext,
        String router,
        String provider,
        String gatewayKeyId,
        Boolean byoKey,
        String parentEventId,
        String usageEventId) {

    /** ai_service {@code source_service} for everything admin_core reports. */
    public static final String SOURCE_ADMIN_CORE = "admin_core";

    public static final String ACTOR_USER = "USER";
    public static final String ACTOR_SYSTEM = "SYSTEM";

    public static final String ROLE_CLASS_SYSTEM = "SYSTEM";

    public static final String SURFACE_ADMIN_APP = "ADMIN_APP";
    public static final String SURFACE_WHATSAPP = "WHATSAPP";
    public static final String SURFACE_PHONE = "PHONE";
    public static final String SURFACE_SCHEDULED = "SCHEDULED";

    /** Context key that carries the metering subject (see the class note). */
    public static final String CTX_SUBJECT_USER_ID = "subject_user_id";

    /** A scheduled/system job's charge: SYSTEM actor, SCHEDULED surface. */
    public static MeteringFieldsBuilder system(String useCase) {
        return builder()
                .useCase(useCase)
                .actorKind(ACTOR_SYSTEM)
                .actorRoleClass(ROLE_CLASS_SYSTEM)
                .surface(SURFACE_SCHEDULED)
                .sourceService(SOURCE_ADMIN_CORE);
    }

    /** A charge for work a signed-in user started. The role is left for ai_service / the backfill job. */
    public static MeteringFieldsBuilder user(String useCase, String surface) {
        return builder()
                .useCase(useCase)
                .actorKind(ACTOR_USER)
                .surface(surface)
                .sourceService(SOURCE_ADMIN_CORE);
    }

    /**
     * Add the non-empty fields to {@code body} without replacing anything already in it.
     * A null {@code fields} leaves the body untouched.
     */
    public static void applyTo(MeteringFields fields, Map<String, Object> body) {
        if (fields == null || body == null) {
            return;
        }
        putText(body, "use_case", fields.useCase);
        putText(body, "actor_kind", fields.actorKind);
        putText(body, "actor_role_class", fields.actorRoleClass);
        if (fields.actorRolesRaw != null && !fields.actorRolesRaw.isEmpty()) {
            body.putIfAbsent("actor_roles_raw", List.copyOf(fields.actorRolesRaw));
        }
        putText(body, "actor_display_name", clamp(fields.actorDisplayName, 255));
        putText(body, "subject_display_name", clamp(fields.subjectDisplayName, 255));
        putText(body, "surface", fields.surface);
        putText(body, "source_service", fields.sourceService);

        Map<String, Object> context = new LinkedHashMap<>();
        if (fields.usageContext != null) {
            fields.usageContext.forEach((k, v) -> {
                if (k != null && v != null && !(v instanceof String s && s.isBlank())) {
                    context.put(k, v);
                }
            });
        }
        if (notBlank(fields.subjectUserId)) {
            context.putIfAbsent(CTX_SUBJECT_USER_ID, fields.subjectUserId);
        }
        if (!context.isEmpty()) {
            body.putIfAbsent("usage_context", context);
        }

        putText(body, "router", fields.router);
        putText(body, "provider", fields.provider);
        putText(body, "gateway_key_id", fields.gatewayKeyId);
        if (fields.byoKey != null) {
            body.putIfAbsent("byo_key", fields.byoKey);
        }
        putText(body, "parent_event_id", fields.parentEventId);
        putText(body, "usage_event_id", fields.usageEventId);
    }

    private static void putText(Map<String, Object> body, String key, String value) {
        if (notBlank(value)) {
            body.putIfAbsent(key, value);
        }
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String clamp(String s, int max) {
        if (s == null) {
            return null;
        }
        return s.length() <= max ? s : s.substring(0, max);
    }
}
