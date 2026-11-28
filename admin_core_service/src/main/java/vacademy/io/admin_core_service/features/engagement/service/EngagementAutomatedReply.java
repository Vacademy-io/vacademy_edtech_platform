package vacademy.io.admin_core_service.features.engagement.service;

import java.util.List;
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
            // The ticket's title in quotes: Your ticket "12345 Re: your offer" has been closed.
            + "(?:[\"\u201C\u2018'][^\"\u201D\u2019\\n]{1,200}[\"\u201D\u2019']\\s+)?"
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
            + "|\\b(?:please )?(?:do not|don'?t|kindly do not) reply to this (?:email|e-mail|mail|message)\\b"
            + "|\\bthis (?:mailbox|inbox|e-?mail address|address) is (?:not monitored|unmonitored)\\b"
            + "|\\bunmonitored (?:mailbox|inbox|e-?mail address)\\b");

    /**
     * A mail server saying the message did not arrive, or failed. At the opening of the email (after an
     * optional greeting), because a person can mention a failed delivery further down in their own words.
     */
    private static final Pattern BOUNCE_OPENING = Pattern.compile("(?iU)^\\W*(?:"
            + "error (?:while )?(?:processing|delivering|sending|handling) (?:your |the |this )?(?:e-?mail|message|mail)\\b"
            + "|(?:mail )?delivery (?:status notification|failure|failed|has failed|incomplete|unsuccessful)\\b"
            + "|undeliverable\\b|undelivered mail\\b|returned mail\\b|address not found\\b"
            + "|(?:your |the |this )?(?:e-?mail |message )(?:could ?not|couldn['\u2019]t|was not|wasn['\u2019]t|cannot|can['\u2019]t) (?:be )?delivered\\b"
            + ")");

    /** Mail-server wording no person writes, searched in the head of the email. */
    private static final Pattern BOUNCE_ANYWHERE = Pattern.compile("(?iUs)"
            + "\\bthis is the mail system at host\\b"
            + "|\\bdelivery to the following recipients? (?:failed|has been delayed)\\b"
            + "|\\bdelivery has failed to these recipients\\b"
            + "|\\bdiagnostic-code:"
            + "|\\bremote server returned ['\"]?[45]\\d\\d\\b"
            + "|\\b55[0-4][ -]#?5\\.\\d{1,3}\\.\\d{1,3}\\b");

    /**
     * Challenge-response spam filters: "verify that you are a real live human being and not a spam
     * source". They say "spam", which would otherwise read as a person calling us spam (a stop-mention).
     */
    private static final Pattern SPAM_CHALLENGE = Pattern.compile("(?iUs)"
            + "\\bverify (?:that )?you(?:['\u2019]re| are) (?:a )?(?:real |live |actual )*(?:human(?: being)?|person)\\b"
            + "|\\bnot a spam source\\b"
            + "|\\bchallenge[- ]response\\b"
            + "|\\b(?:click|follow|visit) (?:on )?the (?:link|url) below to (?:verify|confirm|prove)\\b.{0,160}?"
            + "\\b(?:deliver(?:ed|y)?|whitelist(?:ed)?|approved senders?|spam)\\b");

    private EngagementAutomatedReply() {
    }

    /**
     * A WhatsApp message that no person wrote, or one that is only a signature (name, role, number)
     * with nothing to answer. Neither makes a task, wakes the engine or counts as them replying.
     */
    public static boolean isAutomated(String text) {
        if (text == null || text.isBlank() || asksToStop(text)) return false;
        return AUTOMATED_OPENING.matcher(text).find() || AUTOMATED_ANYWHERE.matcher(text).find()
                || isSignatureOnly(text);
    }

    // ── signature-only messages ─────────────────────────────────────────────

    private static final Pattern SIGN_OFF = Pattern.compile("(?iU)^\\W*(?:"
            + "(?:(?:thanks?|thank you|thanx|thnx|tnx)\\s*(?:&|and|n|,)?\\s*)?(?:best |warm |warmest |kind |kindest |with |many )?regards"
            + "|sincerely|yours (?:truly|faithfully|sincerely)|--|sent from my\\b.*)\\W*$");

    /** A phone number, an email address or a link, optionally after a label ("Mob:", "Email -"). */
    private static final Pattern CONTACT_LINE = Pattern.compile("(?iU)^(?:[\\p{L} .]{1,12}[:\\-]\\s*)?(?:"
            + "\\+?[\\d()\\s.\\-/]{8,}"
            + "|[\\w.%+-]+@[\\w.-]+\\.[a-z]{2,}"
            + "|(?:https?://|www\\.)\\S+|[a-z0-9-]{2,}(?:\\.[a-z0-9-]{2,})*\\.(?:com|in|org|net|edu|co|io|ac\\.in)\\S*)$");

    /** Words that make a short line a message, not a name or a job title. */
    private static final Pattern INTENT_WORD = Pattern.compile("(?iU)(?:^|[^\\p{L}])(?:yes|yeah|yep|no|nope|ok|okay|sure"
            + "|interested|call|calling|want|need|please|pls|plz|kindly|when|what|how|why|where|which|who"
            + "|fees?|price|cost|send|share|tell|details?|info|demo|course|admission|batch|class|time|tomorrow"
            + "|today|later|busy|meeting|available|haan|han|nahi|nhi|kya|kab|kaise|batao|bhejo|chahiye)(?:$|[^\\p{L}])");

    /** "Anita Verma", "Principal", "SUNRISE PUBLIC SCHOOL", "Head - Admissions": every word capitalised. */
    private static final Pattern TITLE_LINE = Pattern.compile(
            "^(?:(?:\\p{Lu}[\\p{L}.'\u2019]*|of|and|the|for|&|-|\\||/|,|\\(|\\))\\s*){1,6}$");

    private static final int SIGNATURE_MAX_CHARS = 400;
    private static final int SIGNATURE_MAX_LINES = 8;

    /**
     * Only a signature: a sign-off line ("Regards") or a contact line, and otherwise nothing but
     * capitalised name/title lines and contact lines. No question mark and no word that asks for
     * something, so "Yes call me\n98xxxxxxxx" or "Thanks, will revert\nRavi\n98xxxxxxxx" stay a person.
     */
    static boolean isSignatureOnly(String text) {
        if (text == null) return false;
        String t = text.strip();
        if (t.isEmpty() || t.length() > SIGNATURE_MAX_CHARS || t.indexOf('?') >= 0) return false;
        List<String> lines = new java.util.ArrayList<>();
        for (String l : t.split("\\R")) {
            String s = l.strip();
            if (!s.isEmpty()) lines.add(s);
        }
        if (lines.isEmpty() || lines.size() > SIGNATURE_MAX_LINES) return false;
        if (EngagementReplyResponder.isCallRequest(t)) return false;
        boolean signedOff = SIGN_OFF.matcher(lines.get(0)).matches();
        boolean anyContact = false;
        for (int i = signedOff ? 1 : 0; i < lines.size(); i++) {
            String l = lines.get(i).replaceAll("[,;]+$", "");
            if (CONTACT_LINE.matcher(l).matches()) {
                anyContact = true;
            } else if (!TITLE_LINE.matcher(l).matches() || INTENT_WORD.matcher(l).find()) {
                return false;
            }
        }
        return signedOff || (anyContact && lines.size() >= 2);
    }

    /**
     * An email that no person wrote. The body is judged by how it opens only: a reply can carry our own
     * mail quoted further down when EmailReplyText could not cut it, and that must not condemn the reply.
     */
    public static boolean isAutomatedEmail(String from, String subject, String body) {
        return automatedEmailKind(from, subject, body, false) != null;
    }

    /**
     * What kind of machine sent this email ("bounce", "out-of-office or auto-reply", "helpdesk notice",
     * "spam-filter check"), or null when a person may have written it.
     *
     * @param autoSubmittedHeader the mail carried an RFC 3834 Auto-Submitted (or X-Autoreply,
     *                            Precedence: auto_reply/junk) header, as notification-service recorded it
     */
    public static String automatedEmailKind(String from, String subject, String body, boolean autoSubmittedHeader) {
        if (from != null && ROBOT_SENDER.matcher(from.trim()).find()) {
            return from.toLowerCase(java.util.Locale.ROOT).matches("(?s)^(?:mailer-daemon|postmaster|bounces?).*")
                    ? "bounce" : "no-reply sender";
        }
        if (subject != null && AUTOMATED_SUBJECT.matcher(subject).find()) return "out-of-office, auto-reply or delivery notice";
        if (subject != null && HELPDESK_SUBJECT.matcher(subject).find()) return "helpdesk notice";
        if (body == null || body.isBlank()) return autoSubmittedHeader ? "auto-submitted" : null;
        String head = body.length() > HELPDESK_HEAD ? body.substring(0, HELPDESK_HEAD) : body;
        // Machine notices first, vetoed only by an explicit opt-out: they often contain "spam" or quote
        // our mail, which the stop-mention check below would read as the person's words.
        if (!explicitOptOut(body)) {
            if (autoSubmittedHeader) return "auto-submitted";
            if (SPAM_CHALLENGE.matcher(body).find()) return "spam-filter check";
            if (BOUNCE_OPENING.matcher(body).find() || BOUNCE_ANYWHERE.matcher(head).find()) return "bounce";
        }
        if (asksToStop(body)) return null;
        if (AUTOMATED_OPENING.matcher(body).find()) return "out-of-office or auto-reply";
        if (HELPDESK_BODY.matcher(head).find()) return "helpdesk notice";
        if (SYSTEM_GENERATED.matcher(body).find()) return "system-generated notice";
        return null;
    }

    /** "STOP" / "unsubscribe me" in the person's own words, not in an instruction or our quoted footer. */
    private static boolean explicitOptOut(String text) {
        String theirWords = EngagementReplyResponder.OWN_UNSUBSCRIBE_LINE.matcher(
                STOP_INSTRUCTION.matcher(text).replaceAll(" ")).replaceAll(" ");
        return EngagementReplyResponder.OPT_OUT.matcher(theirWords).find();
    }

    private static boolean asksToStop(String text) {
        String theirWords = STOP_INSTRUCTION.matcher(text).replaceAll(" ");
        return EngagementReplyResponder.OPT_OUT.matcher(theirWords).find()
                || EngagementReplyResponder.STOP_MENTION.matcher(theirWords).find()
                || EngagementReplyResponder.NOT_INTERESTED_CLEAR.matcher(theirWords).find();
    }
}
