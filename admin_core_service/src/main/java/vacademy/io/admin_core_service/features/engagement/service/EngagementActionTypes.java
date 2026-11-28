package vacademy.io.admin_core_service.features.engagement.service;

import java.util.List;
import java.util.Set;

/**
 * B6: the one list of action types the brain may choose (the "Action kinds/types" contract the
 * CRM track owns; the templates track never adds one).
 *
 * <p>Message types go through a channel (WhatsApp, email, in-app, AI-call task) as before. CRM
 * types act on the lead in the CRM through an {@link EngagementActionHandler}; each engine allows
 * them one by one in {@code channels.actions} (S4, checked on the server, not only in the prompt),
 * and every one starts as an inbox task that a person approves (autonomy per type is B7).
 */
public final class EngagementActionTypes {

    private EngagementActionTypes() {}

    // Messages (unchanged).
    public static final String SEND_MESSAGE = "SEND_MESSAGE";
    public static final String SHARE_LINK = "SHARE_LINK";
    public static final String CALL = "CALL";

    // CRM actions.
    public static final String CREATE_FOLLOWUP = "CREATE_FOLLOWUP";
    public static final String ADD_NOTE = "ADD_NOTE";
    public static final String ESCALATE = "ESCALATE";
    public static final String SCHEDULE_AI_CALL = "SCHEDULE_AI_CALL";
    public static final String UPDATE_STATUS = "UPDATE_STATUS";
    /** Not an action: the brain chose to wait. Recorded as a NO_OP. */
    public static final String WAIT = "WAIT";

    public static final Set<String> MESSAGE_TYPES = Set.of(SEND_MESSAGE, SHARE_LINK, CALL);

    /** In the order the brain sees them. */
    public static final List<String> CRM_TYPES = List.of(
            ADD_NOTE, CREATE_FOLLOWUP, ESCALATE, UPDATE_STATUS, SCHEDULE_AI_CALL);

    public static boolean isCrmAction(String type) {
        return type != null && CRM_TYPES.contains(type);
    }

    /** Lead statuses the engine may never set: Converted is a person's call (a payment, an enrolment). */
    public static final Set<String> FORBIDDEN_STATUS_KEYS = Set.of("CONVERTED");

    /** Lead statuses the engine may set only with a note that explains why (it ends the lead's pipeline). */
    public static final Set<String> STATUS_KEYS_NEEDING_NOTE = Set.of("LOST", "NOT_INTERESTED");
}
