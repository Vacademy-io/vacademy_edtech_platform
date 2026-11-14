package vacademy.io.common.core.utils;

/**
 * Partner strings are plain text (public API rule, gate G15): markup a partner sends is shown
 * literally, never rendered. Where a value lands in a field the dashboard renders as rich
 * text, store {@link #escape(String)} of it; when handing such a value back to the partner,
 * {@link #unescape(String)} restores what they sent.
 */
public final class PlainText {

    private PlainText() {
    }

    /**
     * HTML-escapes {@code & < > " '} and turns each line break ({@code \r\n}, {@code \r} or
     * {@code \n}) into {@code <br>}. Null stays null.
     *
     * <p>{@code "a < b\nc"} becomes {@code "a &lt; b<br>c"}.
     */
    public static String escape(String text) {
        if (text == null) {
            return null;
        }
        StringBuilder out = new StringBuilder(text.length() + 16);
        int length = text.length();
        for (int i = 0; i < length; i++) {
            char c = text.charAt(i);
            switch (c) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                case '\'' -> out.append("&#39;");
                case '\r' -> {
                    out.append("<br>");
                    if (i + 1 < length && text.charAt(i + 1) == '\n') {
                        i++;
                    }
                }
                case '\n' -> out.append("<br>");
                default -> out.append(c);
            }
        }
        return out.toString();
    }

    /**
     * Reverses {@link #escape(String)}: {@code <br>} (also {@code <br/>}, {@code <br />}) back to
     * {@code \n} and the five entities back to their characters. Line breaks come back as
     * {@code \n} whatever the partner sent. Only meant for values produced by
     * {@link #escape(String)}; it does not strip other markup. Null stays null.
     */
    public static String unescape(String html) {
        if (html == null) {
            return null;
        }
        String text = html.replaceAll("(?i)<br\\s*/?>", "\n");
        // &amp; last, so "&amp;lt;" (an escaped literal "&lt;") comes back as "&lt;".
        return text.replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&amp;", "&");
    }
}
