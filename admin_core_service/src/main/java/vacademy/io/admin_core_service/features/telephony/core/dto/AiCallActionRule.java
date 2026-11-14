package vacademy.io.admin_core_service.features.telephony.core.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * One "when X happens on a call, do Y" rule authored on an AI agent.
 *
 * <p>Stored as a JSON array in {@code ai_agent.send_rules} (V462) and evaluated by
 * {@link vacademy.io.admin_core_service.features.telephony.core.AiCallActionService}.
 * See docs/crm/AI_CALL_ACTIONS.md.
 *
 * <p>The predicate vocabulary is deliberately NOT a new rule language: it keys off
 * {@code dispositions} and {@code extraction_questions}, which the agent already
 * defines and the analyser already populates. The one new term is {@code promised},
 * which the post-call analyser fills from what the caller ACCEPTED on the call.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@JsonIgnoreProperties(ignoreUnknown = true)
public class AiCallActionRule {

    /**
     * Stable per-agent id. This is HALF THE IDEMPOTENCY KEY (the other half is the
     * call log id), so it must survive an edit of the rule's label or template — if
     * the UI regenerated it on every save, an edited rule would re-send to every
     * lead whose call was reprocessed. Generated once on create and never rewritten.
     */
    private String id;

    /** Admin-facing name, shown in the rules table and on the call detail panel. */
    private String label;

    /** Null is treated as enabled; the UI writes it explicitly. */
    private Boolean enabled;

    /** POST_CALL (default) | MID_CALL. MID_CALL rules are the ones the bot may fire live. */
    private String timing;

    /**
     * The artefact key this rule delivers ("scholarship_quiz"). It is the vocabulary
     * the analyser is allowed to use in {@code promisedSends} and the token the bot
     * puts in a mid-call sentinel, so it must be stable and free of whitespace.
     */
    private String artefact;

    /** SHARE_LINK | SEND_MESSAGE | BOOK_MEETING. */
    private String actionType;

    /** WHATSAPP | EMAIL. Ignored (and left null) for BOOK_MEETING. */
    private String channel;

    /** Meta-approved template name for WhatsApp; the notification template for email. */
    private String template;

    /**
     * WhatsApp only: what goes into the template's placeholders, in order.
     *
     * <p>Each entry is either a variable name we can resolve for this lead (name, phone, a
     * captured form field) or a literal to send as-is.
     *
     * <p>The count MUST equal the template's parameter count. Meta rejects the whole send
     * otherwise - "(#132000) number of localizable_params (10) does not match the expected
     * number of params (2)", which is what killed calls 09394294 and 42309d27. We used to
     * hand UnifiedSendService the entire variable map, and anything it cannot match to a
     * declared template name it keeps verbatim ("might be positional already"), so every
     * extra key became an extra parameter.
     *
     * <p>Empty means the template takes no parameters.
     */
    private List<String> templateParams;

    /** Meta identifies a template by name + language, so both travel to the action row. */
    private String templateLanguage;

    /**
     * WhatsApp only: the image or document a media-header template renders above its body.
     *
     * <p>A template whose HEADER format is IMAGE or DOCUMENT will not send without one —
     * Meta answers "(#132012) Parameter format does not match format in the created
     * template ... header: Format mismatch, expected IMAGE, received UNKNOWN". That is
     * what sn_unlockx did on every Shikshanation call once its body parameters were
     * corrected: the caller agreed on the call and the promised WhatsApp never arrived.
     *
     * <p>Travels to the action as the {@code _headerUrl} entry in variables_json.
     * UnifiedSendService reads that key per recipient, and both provider paths
     * (WhatsAppService, WatiService) filter {@code _}-prefixed keys out of the body
     * parameters, so it cannot disturb the positional count that {@link #templateParams}
     * has to match exactly.
     *
     * <p>VIDEO headers are NOT supported here: they need options.headerType="video" on the
     * send request, which the AI-call dispatcher does not set. IMAGE and DOCUMENT both
     * take the default link path, which is why they work without one.
     */
    private String templateHeaderUrl;

    /**
     * "image" or "document" — which kind of file {@link #templateHeaderUrl} points at.
     *
     * <p>Derived by the editor from the chosen template's HEADER format, never typed by an
     * admin. It exists because the type is not inferable downstream:
     * WhatsAppService.buildHeaderConfig decides with
     * {@code "image".equalsIgnoreCase(headerType) ? "image" : "document"}, so a missing
     * type silently becomes a document — filename and all — and Meta rejects the send with
     * "(#132012) header: Format mismatch, expected IMAGE, received DOCUMENT".
     *
     * <p>Travels as {@code _headerType} in variables_json, next to {@code _headerUrl}.
     */
    private String templateHeaderType;

    /**
     * EMAIL only: what the person actually receives.
     *
     * <p>Email has no Meta template — EngagementDispatcher emails {@code draft_body}
     * verbatim and derives the SUBJECT from its first line. So this field is the message,
     * and its first line is the subject. Supports {@code {{name}}}.
     *
     * <p>Required for an email rule. Without it the dispatcher would email whatever is in
     * draft_body, which for a call-originated action is an internal note ("Send X to Y
     * (promised on the AI call)") — an internal sentence, with itself as the subject line,
     * delivered to a parent.
     */
    private String messageBody;

    /** phone | email — which contact the send is addressed to. */
    private String to;

    /** BOOK_MEETING only: overrides the agent's own booking page. Null = agent default. */
    private String bookingPageId;

    /**
     * The offer the agent makes out loud, in the agent's own language:
     * "kya main aapko WhatsApp par quiz ka link bhej doon?".
     *
     * <p>Injected into the call prompt so a rule is SELF-CONTAINED — the admin does not
     * have to hand-write the same offer into the system prompt and keep the two in sync.
     * Blank = the agent is never told to offer this, so the rule only fires if the caller
     * raises it themselves.
     */
    private String askLine;

    /** The predicate. All non-null members must hold (AND), an all-null When never fires. */
    private When when;

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class When {
        /** The classified disposition equals this (case-insensitive). */
        private String disposition;
        /** This artefact key appeared in the analyser's promisedSends. */
        private String promised;
        /**
         * This artefact key appeared in the analyser's declinedSends - the agent offered
         * it and the caller REFUSED. Lets a rule answer a "no" ("they turned the quiz
         * down, send the brochure instead") rather than only a "yes".
         */
        private String declined;
        /**
         * A statement the admin wrote, which the post-call analyser judged true of this
         * call ("the parent asked about fees"). The analyser may only echo back conditions
         * we published, never one it composed, so a rule cannot fire on invented text.
         *
         * <p>Post-call only: it is judged from the whole transcript, which does not exist
         * while the call is still running.
         */
        private String custom;
        /** The analyser reported an agreed meeting. */
        private Boolean meetingRequested;
        /**
         * Extraction answers: key -> "present" (any non-blank answer) or an exact
         * value to match case-insensitively.
         */
        private Map<String, String> extracted;
    }
}
