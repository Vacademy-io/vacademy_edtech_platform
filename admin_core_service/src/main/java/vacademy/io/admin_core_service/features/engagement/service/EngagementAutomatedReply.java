package vacademy.io.admin_core_service.features.engagement.service;

import java.util.regex.Pattern;

/**
 * Messages no person wrote: WhatsApp Business greetings and away messages, numbered menus, one-time
 * codes, scam forwards, out-of-office mail, delivery notices and helpdesk ticket notices. The engine does not answer them,
 * does not alert the team about them, and does not count them as the person having replied.
 *
 * <p>Deliberately narrow, because a miss here only costs one model call: ignoring a real person is the
 * expensive mistake. What these patterns miss goes to the reply brain, which can also call it automated
 * ({@link EngagementReplyBrain.ReplyDecision#isAutomated()}). A message that also asks to stop or says
 * "not interested" is never treated as automated, so consent always gets read.
 */
public final class EngagementAutomatedReply {

    private static final String GREETING = "(?:(?:hi|hello|hey|dear|namaste|नमस्ते|नमस्कार|greetings|students?|friends?"
            + "|sir|ma(?:'|’)?am|and)\\W+){0,4}";

    /** "we" or "our team", never "I": "Thanks for your message, I will revert tomorrow" is a person. */
    private static final String BUSINESS_FOLLOW_ON = "(?:unavailable|will respond as soon|we(?:'|’)?ll|we will|we are|we(?:'|’)?re"
            + "|our \\w*\\s*team|how (?:can|may|could) we|please select)";

    /** Only at the very start of the message. These are the only text rules email uses, see isAutomatedEmail. */
    private static final Pattern AUTOMATED_OPENING = Pattern.compile("(?iU)^\\W*(?:"
            + GREETING + "thanks?(?: you)? for (?:contacting|reaching out to|messaging|connecting with)\\s+(?!me\\b|us\\b)\\S"
            + "|" + GREETING + "welcome to\\s+\\S"
            + "|(?:this is an? )?auto(?:matic|mated)?[- ]?(?:reply|response|responder)\\b"
            + "|this is an? auto(?:matic|mated)\\b"
            + "|out of (?:the )?office\\b"
            + ")");

    private static final Pattern AUTOMATED_ANYWHERE = Pattern.compile("(?iUs)"
            + "thanks?(?: you)? for (?:contacting us|reaching out to us|your (?:message|enquiry|inquiry|query)"
            + "|the (?:enquiry|inquiry))\\b.{0,200}?" + BUSINESS_FOLLOW_ON
            + "|(?:we(?:'|’)?re|we are|(?:team|office|desk) is)\\s+(?:currently\\s+|presently\\s+)?"
            + "(?:unavailable|offline|closed|away|out of (?:the )?office)"
            + "|our (?:\\w+\\s+){0,2}team will (?:respond|reply|get back|contact|connect|reach|be in touch)"
            + "|(?:आपका|आपकी|आपले)\\s+(?:\\S+\\s+)?स्वागत"
            // A menu of keycap emoji: 1⃣ ... 2⃣
            + "|1\\uFE0F?\\u20E3.{0,400}?2\\uFE0F?\\u20E3"
            + "|is your (?:\\w+\\s+){0,2}(?:code|otp)\\b|do not share (?:this|the|your) (?:code|otp)"
            + "|system[- ]generated (?:message|mail|email|reply)|please do not reply to this"
            // Hijacked accounts forward these to everyone they know.
            + "|https?://[^\\s/]+\\.(?:buzz|xyz|top)/");

    /** "Reply STOP to unsubscribe" inside a bot's message is an instruction, not someone asking to stop. */
    private static final Pattern STOP_INSTRUCTION = Pattern.compile(
            "(?iU)(?:reply|send|text|type|sms)\\s+\\W*stop\\b|to (?:unsubscribe|opt[ -]?out)\\b"
            // "check your SPAM or JUNK folder" in a helpdesk notice is advice, not someone calling us spam.
            + "|(?:check|look in|see)\\s+(?:your\\s+)?(?:the\\s+)?spam\\b|\\bspam\\s*(?:or|/|and)\\s*junk\\b");

    private static final Pattern ROBOT_SENDER = Pattern.compile(
            "(?i)^(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|auto-?(?:reply|responder|confirm))"
            + "(?:[+.\\-][^@]*)?@");

    /** Raw subject, so "Re: automatic reply" (a person answering one) does not match. */
    private static final Pattern AUTOMATED_SUBJECT = Pattern.compile(
            "(?iU)^\\s*(?:automatic reply|auto[- ]?reply|auto(?:matic|mated)? response|out of (?:the )?office"
            + "|undeliverable|undelivered mail|delivery status notification|delivery failure|mail delivery"
            + "|we(?:'|’)?ve received your|we have received your)\\b");

    /**
     * Helpdesk software (Freshdesk, Zendesk, LeadSquared portals and the like) turns an outreach email
     * into a ticket and mails a notice at every step: received, assigned, closed. Each one used to
     * become a "lead is waiting for your reply" alert; one helpdesk stuck in a loop sent six in twenty
     * minutes (2026-11-13). Raw subject, as for AUTOMATED_SUBJECT. Only a status at the start counts:
     * a person can answer from inside a helpdesk, and "[Ticket #123] Re: your offer" is them writing.
     */
    private static final Pattern HELPDESK_SUBJECT = Pattern.compile(
            "(?iU)^\\s*(?:\\[[^\\]]{0,60}\\]\\s*)?(?:(?:support|service|help\\s?desk)\\s+)?(?:ticket|case|service request)\\b"
            + "[^\\n]{0,30}?\\b(?:received|created|opened|logged|raised|assigned|updated|closed|resolved|acknowledg\\w*)\\b");

    /**
     * The same notices by their body. Searched in the first {@link #HELPDESK_HEAD} characters, not only
     * at the opening: they start with "Dear <name>," which the greeting rule cannot skip. Our own mail
     * never talks about tickets, so a quoted copy of it cannot match.
     */
    private static final Pattern HELPDESK_BODY = Pattern.compile("(?iUs)"
            + "\\b(?:a|your|the)\\s+(?:new\\s+)?(?:support\\s+|service\\s+)?(?:ticket|case)\\s+(?:\\(?#?\\s*[\\w-]*\\d[\\w-]*\\)?\\s+)?"
            + "(?:has been|was|is now|have been)\\s+(?:successfully\\s+)?(?:created|raised|logged|opened|generated|assigned|closed|resolved)"
            + "|\\b(?:service request|request|case)\\s+with\\s+ticket\\s*(?:id|no\\.?|number)\\b"
            + "|\\bnew\\s+(?:support\\s+|service\\s+)?(?:ticket|case)\\s+(?:created|raised|generated|logged|opened)\\b"
            + "|\\bwe (?:would like to |wish to )?acknowledge (?:that we have )?(?:the )?(?:receipt of|received) your"
            + "|\\breceived your (?:request|email|e-mail|message|query|enquiry|inquiry) outside (?:of )?(?:our )?"
            + "(?:business|working|office) hours");

    private static final int HELPDESK_HEAD = 600;

    /**
     * Says outright that no person wrote it. Searched in the whole email, because banks and helpdesks
     * put it at the bottom; our own mail never says it, so a quoted copy cannot match.
     */
    private static final Pattern SYSTEM_GENERATED = Pattern.compile("(?iUs)"
            + "\\bthis is an?\\s+(?:system|computer|auto(?:matically|mated)?)[- ]?generated\\s+"
            + "(?:response|message|mail|email|e-mail|reply|notification)\\b"
            + "|\\bplease do not reply to this (?:email|e-mail|mail|message)\\b");

    private EngagementAutomatedReply() {
    }

    /** A WhatsApp message that no person wrote. */
    public static boolean isAutomated(String text) {
        if (text == null || text.isBlank() || asksToStop(text)) return false;
        return AUTOMATED_OPENING.matcher(text).find() || AUTOMATED_ANYWHERE.matcher(text).find();
    }

    /**
     * An email that no person wrote. The body is judged by how it opens only: a reply can carry our own
     * mail quoted further down when EmailReplyText could not cut it, and that must not condemn the reply.
     */
    public static boolean isAutomatedEmail(String from, String subject, String body) {
        if (from != null && ROBOT_SENDER.matcher(from.trim()).find()) return true;
        if (subject != null && (AUTOMATED_SUBJECT.matcher(subject).find() || HELPDESK_SUBJECT.matcher(subject).find())) {
            return true;
        }
        if (body == null || body.isBlank() || asksToStop(body)) return false;
        if (AUTOMATED_OPENING.matcher(body).find()) return true;
        String head = body.length() > HELPDESK_HEAD ? body.substring(0, HELPDESK_HEAD) : body;
        return HELPDESK_BODY.matcher(head).find() || SYSTEM_GENERATED.matcher(body).find();
    }

    private static boolean asksToStop(String text) {
        String theirWords = STOP_INSTRUCTION.matcher(text).replaceAll(" ");
        return EngagementReplyResponder.OPT_OUT.matcher(theirWords).find()
                || EngagementReplyResponder.STOP_MENTION.matcher(theirWords).find()
                || EngagementReplyResponder.NOT_INTERESTED_CLEAR.matcher(theirWords).find();
    }
}
