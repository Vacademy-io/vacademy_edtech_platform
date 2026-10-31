package vacademy.io.notification_service.features.engagement_ledger.service;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The part of an email reply the person actually wrote. Mail clients put the earlier thread below
 * the reply ("On Tue, 28 Oct, X wrote:", "-----Original Message-----", "> quoted" lines, an
 * Outlook "From: ... Sent: ..." block); reading that as the person's words would let our own
 * earlier email ("reply STOP to stop") look like their opt-out.
 */
final class EmailReplyText {

    static final int MAX_CHARS = 2000;

    /** The first line that starts the quoted thread or a signature. */
    private static final Pattern QUOTE_START = Pattern.compile(
            "(?im)^[ \\t]*(?:"
            + "on\\b[^\\n]{0,300}(?:\\n[^\\n]{0,300})?\\bwrote:[ \\t]*$"
            + "|-{2,}[ \\t]*(?:original message|forwarded message)[ \\t]*-{2,}"
            + "|from:[ \\t].+\\n(?:[^\\n]*\\n){0,3}?[ \\t]*(?:sent|date):[ \\t]"
            + "|>"
            + "|sent from my\\b"
            + "|--[ \\t]*$"
            + ")");

    private EmailReplyText() {
    }

    static String newPart(String body) {
        if (body == null) return null;
        String text = body.replace("\r\n", "\n").replace('\r', '\n');
        Matcher m = QUOTE_START.matcher(text);
        if (m.find()) text = text.substring(0, m.start());
        text = text.strip();
        if (text.length() > MAX_CHARS) text = text.substring(0, MAX_CHARS);
        return text.isEmpty() ? null : text;
    }
}
