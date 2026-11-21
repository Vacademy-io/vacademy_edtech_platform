package vacademy.io.notification_service.features.notification_log;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Who sent an outgoing WhatsApp message — a workflow, a chatbot flow — as recorded on
 * {@code notification_log.message_payload}, so the Inbox and the student timeline can say
 * "sent by workflow X".
 *
 * <p>Stored under {@code originType} / {@code originId} / {@code originName}. On the unified send
 * path the values ride from the request options to the log writer inside each recipient's params
 * as {@code _originType} etc.: both providers drop {@code _}-prefixed params before building the
 * template, and the writer lifts them out of the stored bodyParams so a resend of that message can
 * never carry the original sender along.
 */
public final class MessageOriginPayload {

    public static final String TYPE_WORKFLOW = "WORKFLOW";
    public static final String TYPE_CHATBOT_FLOW = "CHATBOT_FLOW";

    public static final String TYPE_KEY = "originType";
    public static final String ID_KEY = "originId";
    public static final String NAME_KEY = "originName";

    private static final String PARAM_PREFIX = "_";

    private MessageOriginPayload() {
    }

    /** Puts the origin on a recipient's params. No-op when there is no origin type. */
    public static void putOnParams(Map<String, String> params, String type, String id, String name) {
        if (params == null || isBlank(type)) return;
        params.put(PARAM_PREFIX + TYPE_KEY, type);
        if (!isBlank(id)) params.put(PARAM_PREFIX + ID_KEY, id);
        if (!isBlank(name)) params.put(PARAM_PREFIX + NAME_KEY, name);
    }

    /** Copies an origin carried on params onto the log payload's top level. */
    public static void liftToPayload(Map<String, String> params, Map<String, Object> payload) {
        if (params == null || payload == null) return;
        for (String key : new String[]{TYPE_KEY, ID_KEY, NAME_KEY}) {
            String value = params.get(PARAM_PREFIX + key);
            if (!isBlank(value)) payload.put(key, value);
        }
    }

    /** The params without the origin keys, for the stored bodyParams. */
    public static Map<String, String> withoutOrigin(Map<String, String> params) {
        if (params == null) return null;
        Map<String, String> copy = new LinkedHashMap<>(params);
        copy.remove(PARAM_PREFIX + TYPE_KEY);
        copy.remove(PARAM_PREFIX + ID_KEY);
        copy.remove(PARAM_PREFIX + NAME_KEY);
        return copy;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
