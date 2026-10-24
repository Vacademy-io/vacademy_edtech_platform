package vacademy.io.notification_service.features.email_inbox.service;

import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure text helpers for the email inbox (no Spring, no I/O).
 *
 * <p>Marketing HTML ships a hidden "preheader" (<code>&lt;div style="display:none"&gt;</code>) padded
 * with entity-encoded zero-width characters (<code>&amp;#847; &amp;#8199; &amp;#65279;</code>) so mail
 * clients show a chosen snippet. The old strip-tags preview surfaced that padding verbatim; this
 * class produces the text a human would read.
 */
public final class EmailTextUtils {

    private EmailTextUtils() {}

    /** Whole element + content for blocks that never render as text. */
    private static final Pattern NON_TEXT_BLOCKS =
            Pattern.compile("(?is)<(style|script|head|title)\\b[^>]*>.*?</\\1\\s*>");

    /**
     * Opening tag whose inline style hides it (MJML/marketing preheaders). Conservative: the
     * element is dropped only when a closing tag of the same name follows; nested same-name
     * children are handled by a manual depth scan in {@link #removeHiddenElements}.
     */
    private static final Pattern HIDDEN_OPEN_TAG = Pattern.compile(
            "(?is)<([a-z][a-z0-9]*)\\b[^>]*\\bstyle\\s*=\\s*([\"'])[^\"']*?"
                    + "(?:display\\s*:\\s*none|visibility\\s*:\\s*hidden)[^\"']*?\\2[^>]*>");

    private static final Pattern ANY_TAG = Pattern.compile("<[^>]+>");
    private static final Pattern NUMERIC_ENTITY = Pattern.compile("&#(x[0-9a-fA-F]{1,6}|[0-9]{1,7});");
    private static final Pattern NAMED_ENTITY = Pattern.compile("&(amp|lt|gt|quot|apos|nbsp);");
    private static final Map<String, String> NAMED = Map.of(
            "amp", "&", "lt", "<", "gt", ">", "quot", "\"", "apos", "'", "nbsp", "\u00A0");

    /** Zero-width / formatting code points that carry no visible text. */
    private static final Pattern INVISIBLE = Pattern.compile(
            "[\\u034F\\u061C\\u180E\\u200B-\\u200F\\u2028\\u2029\\u2060-\\u2064\\uFEFF]");
    /** Non-breaking / figure / narrow no-break spaces → plain space. */
    private static final Pattern EXOTIC_SPACE = Pattern.compile("[\\u00A0\\u2007\\u202F]");
    private static final Pattern WHITESPACE = Pattern.compile("\\s+");

    /**
     * Local parts that only ever belong to a mail system, never a person. Deliberately narrow:
     * "noreply@business.com" is a real business sender and must NOT match.
     */
    private static final Pattern SYSTEM_LOCAL_PART =
            Pattern.compile("(?i)^(mailer-daemon|postmaster|no-reply-aws|bounce|bounces)$");
    private static final String[] SYSTEM_SUBJECT_PREFIXES = {
            "delivery status notification",
            "undeliverable",
            "undelivered mail",
            "mail delivery failed",
            "amazon ses setup notification",
    };

    /**
     * HTML (or plain text) → readable plain text: hidden/non-text blocks removed, tags stripped,
     * entities decoded, invisible characters dropped, whitespace collapsed. Null-safe.
     */
    public static String toPlainText(String html) {
        if (html == null) return null;
        String s = NON_TEXT_BLOCKS.matcher(html).replaceAll(" ");
        s = removeHiddenElements(s);
        s = ANY_TAG.matcher(s).replaceAll(" ");
        return cleanText(s);
    }

    /**
     * Text that is ALREADY plain (a subject line, an inbound text/plain body) → readable preview
     * text: entities decoded, invisible characters dropped, whitespace collapsed — but nothing
     * in angle brackets is stripped, so {@code <https://...>} URLs, {@code a <b and c> d} and a
     * title like {@code Reminder: <Batch A>} keep their words. Inbound html-only bodies were
     * tag-stripped at ingest but kept their entities, which is why decoding stays on. Null-safe.
     */
    public static String cleanText(String text) {
        if (text == null) return null;
        String s = decodeEntities(text);
        s = INVISIBLE.matcher(s).replaceAll("");
        s = EXOTIC_SPACE.matcher(s).replaceAll(" ");
        s = WHITESPACE.matcher(s).replaceAll(" ");
        return s.trim();
    }

    /**
     * Mail-system sender rule shared with the FE fallback: the local part is a daemon/postmaster
     * style mailbox, or the subject is a delivery notification.
     */
    public static boolean isSystemSender(String email, String subject) {
        if (email != null) {
            String addr = email.trim();
            int lt = addr.indexOf('<');
            int gt = addr.lastIndexOf('>');
            if (lt >= 0 && gt > lt) addr = addr.substring(lt + 1, gt).trim();
            int at = addr.indexOf('@');
            String local = at >= 0 ? addr.substring(0, at) : addr;
            if (SYSTEM_LOCAL_PART.matcher(local).matches()) return true;
        }
        if (subject != null) {
            String s = subject.trim().toLowerCase(Locale.ROOT);
            for (String prefix : SYSTEM_SUBJECT_PREFIXES) {
                if (s.startsWith(prefix)) return true;
            }
        }
        return false;
    }

    /** Null-safe truncate with a trailing ellipsis marker. */
    public static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max) + "...";
    }

    // ---- internals ------------------------------------------------------------------------

    /**
     * Drop every element whose opening tag carries display:none / visibility:hidden, together
     * with its content. Skipped (left as-is, later tag-stripped) when no matching close tag
     * follows, so a malformed template never loses visible text.
     */
    static String removeHiddenElements(String s) {
        StringBuilder out = new StringBuilder(s.length());
        int pos = 0;
        Matcher m = HIDDEN_OPEN_TAG.matcher(s);
        while (m.find(pos)) {
            String name = m.group(1).toLowerCase(Locale.ROOT);
            int end = findMatchingClose(s, name, m.end());
            out.append(s, pos, m.start());
            if (end < 0) {
                // No closing tag — keep the tag text (stripped later) and continue after it.
                out.append(s, m.start(), m.end());
                pos = m.end();
            } else {
                out.append(' ');
                pos = end;
            }
            if (pos >= s.length()) break;
        }
        if (pos < s.length()) out.append(s, pos, s.length());
        return out.toString();
    }

    /** Index just past the closing tag balancing an already-consumed opening tag, or -1. */
    private static int findMatchingClose(String s, String name, int from) {
        Pattern tag = Pattern.compile("(?is)<(/?)" + Pattern.quote(name) + "\\b[^>]*>");
        Matcher m = tag.matcher(s);
        int depth = 1;
        int pos = from;
        while (m.find(pos)) {
            boolean closing = !m.group(1).isEmpty();
            boolean selfClosing = !closing && m.group().endsWith("/>");
            if (closing) {
                depth--;
                if (depth == 0) return m.end();
            } else if (!selfClosing) {
                depth++;
            }
            pos = m.end();
        }
        return -1;
    }

    static String decodeEntities(String s) {
        if (s.indexOf('&') < 0) return s;
        Matcher m = NUMERIC_ENTITY.matcher(s);
        StringBuilder sb = new StringBuilder(s.length());
        while (m.find()) {
            String ref = m.group(1);
            String replacement;
            try {
                int cp = (ref.charAt(0) == 'x' || ref.charAt(0) == 'X')
                        ? Integer.parseInt(ref.substring(1), 16)
                        : Integer.parseInt(ref, 10);
                replacement = Character.isValidCodePoint(cp) ? new String(Character.toChars(cp)) : "";
            } catch (RuntimeException e) {
                replacement = m.group();
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        m.appendTail(sb);
        String numericDecoded = sb.toString();

        Matcher n = NAMED_ENTITY.matcher(numericDecoded);
        StringBuilder nb = new StringBuilder(numericDecoded.length());
        while (n.find()) {
            n.appendReplacement(nb, Matcher.quoteReplacement(NAMED.get(n.group(1))));
        }
        n.appendTail(nb);
        return nb.toString();
    }
}
