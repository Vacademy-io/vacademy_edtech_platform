package vacademy.io.admin_core_service.features.engagement.service;

import java.util.regex.Pattern;

/**
 * Messages no person wrote: WhatsApp Business greetings and away messages, numbered menus, one-time
 * codes, scam forwards, out-of-office mail and delivery notices. The engine does not answer them,
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
            "(?iU)(?:reply|send|text|type|sms)\\s+\\W*stop\\b|to (?:unsubscribe|opt[ -]?out)\\b");

    private static final Pattern ROBOT_SENDER = Pattern.compile(
            "(?i)^(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|auto-?(?:reply|responder|confirm))"
            + "(?:[+.\\-][^@]*)?@");

    /** Raw subject, so "Re: automatic reply" (a person answering one) does not match. */
    private static final Pattern AUTOMATED_SUBJECT = Pattern.compile(
            "(?iU)^\\s*(?:automatic reply|auto[- ]?reply|auto(?:matic|mated)? response|out of (?:the )?office"
            + "|undeliverable|undelivered mail|delivery status notification|delivery failure|mail delivery"
            + "|we(?:'|’)?ve received your|we have received your)\\b");

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
        if (subject != null && AUTOMATED_SUBJECT.matcher(subject).find()) return true;
        return body != null && !body.isBlank() && !asksToStop(body) && AUTOMATED_OPENING.matcher(body).find();
    }

    private static boolean asksToStop(String text) {
        String theirWords = STOP_INSTRUCTION.matcher(text).replaceAll(" ");
        return EngagementReplyResponder.OPT_OUT.matcher(theirWords).find()
                || EngagementReplyResponder.STOP_MENTION.matcher(theirWords).find()
                || EngagementReplyResponder.NOT_INTERESTED_CLEAR.matcher(theirWords).find();
    }
}
