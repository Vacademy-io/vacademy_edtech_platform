package vacademy.io.assessment_service.features.question_core.util;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Read-only helpers for a CBE_RESPONSE learner answer (docs/CBE_RESPONSE_QUESTION.md §4):
 * {@code {parts: {<partId>: {kind: SPREADSHEET, sheet: CbeSheet} | {kind: DOCUMENT, html}}}}.
 *
 * Every method is total: bad or missing JSON gives "blank" / an empty summary, never an
 * exception — these run inside grading, report and PDF paths where one throw costs a
 * whole attempt or report.
 */
@Slf4j
public final class CbeAnswers {

    public static final int DOCUMENT_EXCERPT_CHARS = 500;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CbeAnswers() {
    }

    /**
     * The {@code responseData.answer} object of one attempt question node
     * ({@code question_wise_marks.response_json} or an attempt-JSON question). An answer
     * saved as a JSON string is unwrapped. Null when absent or not an object.
     */
    public static JsonNode answerFromResponseJson(String responseJson) {
        if (responseJson == null || responseJson.isBlank()) return null;
        try {
            JsonNode answer = MAPPER.readTree(responseJson).path("responseData").path("answer");
            return asObject(answer);
        } catch (Exception e) {
            return null;
        }
    }

    /** The {@code data} object of a CBE config (auto_evaluation_json); null when unreadable. */
    public static JsonNode configData(String autoEvaluationJson) {
        if (autoEvaluationJson == null || autoEvaluationJson.isBlank()) return null;
        try {
            JsonNode data = MAPPER.readTree(autoEvaluationJson).path("data");
            return data.isObject() ? data : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** An answer node as an object ({parts: ...}); a JSON string is unwrapped. Null otherwise. */
    public static JsonNode answerObject(JsonNode node) {
        return asObject(node);
    }

    private static JsonNode asObject(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) return null;
        if (node.isObject()) return node;
        if (node.isTextual()) {
            String text = node.asText().trim();
            if (!text.startsWith("{")) return null;
            try {
                JsonNode parsed = MAPPER.readTree(text);
                return parsed != null && parsed.isObject() ? parsed : null;
            } catch (Exception e) {
                return null;
            }
        }
        return null;
    }

    /**
     * "Answered" per the contract: at least one part has a non-empty cell that is not just
     * the template's own cell, or non-blank document text that is not just the template.
     *
     * @param configData the config's {@code data} (templates are read from it); may be null.
     */
    public static boolean isAnswered(JsonNode answer, JsonNode configData) {
        try {
            if (answer == null || !answer.isObject()) return false;
            JsonNode parts = answer.path("parts");
            if (!parts.isObject()) return false;
            Iterator<Map.Entry<String, JsonNode>> it = parts.fields();
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> entry = it.next();
                JsonNode part = entry.getValue();
                if (part == null || !part.isObject()) continue;
                JsonNode template = templateFor(configData, entry.getKey());
                if (part.has("sheet") && filledCellCount(part.path("sheet"), template.path("sheet")) > 0) {
                    return true;
                }
                if (part.has("html")) {
                    String text = flatText(part.path("html").asText(""));
                    String templateText = flatText(template.path("html").asText(""));
                    if (!text.isEmpty() && !text.equals(templateText)) return true;
                }
            }
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Cells with a value or formula that differ from the template's cell at the same
     * sheet + ref. A template cell the learner left alone does not count.
     */
    public static int filledCellCount(JsonNode sheet, JsonNode templateSheet) {
        int count = 0;
        try {
            JsonNode tabs = sheet == null ? null : sheet.path("sheets");
            if (tabs == null || !tabs.isArray()) return 0;
            for (int i = 0; i < tabs.size(); i++) {
                JsonNode tab = tabs.get(i);
                JsonNode cells = tab.path("cells");
                if (!cells.isObject()) continue;
                JsonNode templateCells = templateCellsFor(templateSheet, tab.path("name").asText(null));
                Iterator<Map.Entry<String, JsonNode>> it = cells.fields();
                while (it.hasNext()) {
                    Map.Entry<String, JsonNode> cell = it.next();
                    if (!cellHasContent(cell.getValue())) continue;
                    JsonNode templateCell = templateCells == null ? null : templateCells.get(cell.getKey());
                    if (templateCell != null && sameContent(cell.getValue(), templateCell)) continue;
                    count++;
                }
            }
        } catch (Exception e) {
            return count;
        }
        return count;
    }

    private static JsonNode templateCellsFor(JsonNode templateSheet, String tabName) {
        if (templateSheet == null || !templateSheet.path("sheets").isArray()) return null;
        JsonNode tabs = templateSheet.path("sheets");
        // Matched by tab name only, like the learner app (no index fallback): a renamed or
        // new tab has no template, so all of its content counts.
        if (tabName != null) {
            for (JsonNode tab : tabs) {
                if (tabName.equals(tab.path("name").asText(null))) return tab.path("cells");
            }
        }
        return null;
    }

    private static boolean cellHasContent(JsonNode cell) {
        if (cell == null || !cell.isObject()) return false;
        JsonNode f = cell.path("f");
        if (f.isTextual() && !f.asText().isBlank()) return true;
        JsonNode v = cell.path("v");
        if (v.isMissingNode() || v.isNull()) return false;
        return !(v.isTextual() && v.asText().isBlank());
    }

    /**
     * Same rule as the learner app's {@code sameCellContent} (components/cbe/types.ts): when
     * either cell has a formula, compare the trimmed formulas case-insensitively and ignore
     * {@code v} (the grid recomputes a template formula's value on load, so a changed value
     * alone is not the learner's work); otherwise compare the trimmed value text.
     */
    static boolean sameContent(JsonNode a, JsonNode b) {
        String fa = textOf(a.path("f"));
        String fb = textOf(b.path("f"));
        if (!fa.isEmpty() || !fb.isEmpty()) return fa.equalsIgnoreCase(fb);
        return textOf(a.path("v")).equals(textOf(b.path("v")));
    }

    private static String textOf(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) return "";
        return node.asText("").trim();
    }

    private static JsonNode templateFor(JsonNode configData, String partId) {
        JsonNode part = configPart(configData, partId);
        JsonNode template = part == null ? null : part.path("template");
        return template != null && template.isObject() ? template : MAPPER.createObjectNode();
    }

    private static JsonNode configPart(JsonNode configData, String partId) {
        if (configData == null || partId == null) return null;
        JsonNode parts = configData.path("parts");
        if (!parts.isArray()) return null;
        for (JsonNode part : parts) {
            if (partId.equals(part.path("id").asText(null))) return part;
        }
        return null;
    }

    /**
     * A short readable summary for reports and PDFs, one line per part, in the config's
     * part order (answer-only parts after): "(a) Spreadsheet — 14 cells filled",
     * "(b) Document — IAS 38 prohibits…" (excerpt ≤ 500 chars). Never raw JSON; an empty
     * string when there is nothing readable.
     */
    public static String summary(JsonNode answer, JsonNode configData) {
        try {
            if (answer == null || !answer.path("parts").isObject()) return "";
            JsonNode parts = answer.path("parts");
            List<String> order = new ArrayList<>();
            List<String> labels = new ArrayList<>();
            if (configData != null && configData.path("parts").isArray()) {
                int n = 0;
                for (JsonNode p : configData.path("parts")) {
                    n++;
                    String id = p.path("id").asText(null);
                    if (id == null) continue;
                    order.add(id);
                    String label = p.path("label").asText("").trim();
                    labels.add(label.isEmpty() ? "Part " + n : label);
                }
            }
            Iterator<String> names = parts.fieldNames();
            while (names.hasNext()) {
                String id = names.next();
                if (!order.contains(id)) {
                    order.add(id);
                    labels.add("Part " + order.size());
                }
            }
            List<String> lines = new ArrayList<>();
            for (int i = 0; i < order.size(); i++) {
                JsonNode part = parts.get(order.get(i));
                String label = labels.get(i);
                if (part == null || !part.isObject()) {
                    lines.add(label + " — not answered");
                    continue;
                }
                JsonNode template = templateFor(configData, order.get(i));
                String kind = part.path("kind").asText("").toUpperCase();
                if ("SPREADSHEET".equals(kind) || (kind.isEmpty() && part.has("sheet"))) {
                    int filled = filledCellCount(part.path("sheet"), template.path("sheet"));
                    lines.add(label + " Spreadsheet — " + filled + (filled == 1 ? " cell filled" : " cells filled"));
                } else {
                    String text = htmlToText(part.path("html").asText(""));
                    String flat = text.replaceAll("\\s+", " ").trim();
                    if (flat.isEmpty() || flat.equals(flatText(template.path("html").asText("")))) {
                        lines.add(label + " Document — not answered");
                    } else {
                        if (flat.length() > DOCUMENT_EXCERPT_CHARS) {
                            flat = flat.substring(0, DOCUMENT_EXCERPT_CHARS).trim() + "…";
                        }
                        lines.add(label + " Document — " + flat);
                    }
                }
            }
            return String.join("\n", lines);
        } catch (Exception e) {
            log.warn("[CBE] could not summarise answer: {}", e.getMessage());
            return "";
        }
    }

    /** {@link #summary} straight from a response JSON + the question's config JSON. */
    public static String summaryFromResponseJson(String responseJson, String autoEvaluationJson) {
        return summary(answerFromResponseJson(responseJson), configData(autoEvaluationJson));
    }

    /** One line about the question itself (parts, kinds, marks) — never the solution. */
    public static String configSummary(String autoEvaluationJson) {
        try {
            JsonNode data = configData(autoEvaluationJson);
            if (data == null || !data.path("parts").isArray()) return "";
            List<String> bits = new ArrayList<>();
            int n = 0;
            for (JsonNode p : data.path("parts")) {
                n++;
                String label = p.path("label").asText("").trim();
                String kind = "DOCUMENT".equalsIgnoreCase(p.path("kind").asText("")) ? "Document" : "Spreadsheet";
                String marks = p.path("marks").isNumber()
                        ? " (" + new java.math.BigDecimal(p.path("marks").asText()).stripTrailingZeros().toPlainString() + " marks)"
                        : "";
                bits.add((label.isEmpty() ? "Part " + n : label) + " " + kind + marks);
            }
            return String.join("; ", bits);
        } catch (Exception e) {
            return "";
        }
    }

    /** Document text with all whitespace collapsed (the learner app's htmlToPlainText rule). */
    private static String flatText(String html) {
        return htmlToText(html).replaceAll("\\s+", " ").trim();
    }

    /**
     * HTML → plain text that keeps the structure a reader (or the AI) needs: paragraphs,
     * line breaks and list items on their own lines (no blank lines), table cells separated by " | ".
     */
    public static String htmlToText(String html) {
        if (html == null || html.isBlank()) return "";
        String s = html;
        s = s.replaceAll("(?is)<(script|style)[^>]*>.*?</\\1>", "");
        s = unwrapCellAndListParagraphs(s);
        s = s.replaceAll("(?i)<br\\s*/?>", "\n");
        s = s.replaceAll("(?i)<li[^>]*>", "\n- ");
        s = s.replaceAll("(?i)</t[dh]>", " | ");
        s = s.replaceAll("(?i)</(p|div|li|tr|h[1-6]|blockquote|pre|ul|ol|table)>", "\n");
        s = s.replaceAll("(?i)<(p|div|tr|h[1-6]|blockquote|pre|ul|ol|table)(\\s[^>]*)?>", "\n");
        s = s.replaceAll("<[^>]+>", "");
        s = s.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'").replace("&amp;", "&");
        StringBuilder out = new StringBuilder();
        for (String line : s.split("\n", -1)) {
            String trimmed = line.replaceAll("[ \\t\\x0B\\f\\r]+", " ").trim();
            if (trimmed.endsWith("|")) trimmed = trimmed.substring(0, trimmed.length() - 1).trim();
            out.append(trimmed).append('\n');
        }
        return out.toString().replaceAll("\n{2,}", "\n").trim();
    }

    private static final Pattern TABLE_CELL =
            Pattern.compile("(?is)(<t[dh](?:\\s[^>]*)?>)(.*?)(</t[dh]>)");

    /**
     * TipTap (the admin RichTextEditor and the CBE DocumentEditor) always writes
     * {@code <td><p>x</p></td>} and {@code <li><p>x</p></li>}. Left alone, the block rules
     * below put every cell and every list marker on its own line, so a table row would no
     * longer read "a | b". Paragraphs (and line breaks) inside a cell become spaces; the
     * first paragraph of a list item joins its marker.
     */
    private static String unwrapCellAndListParagraphs(String html) {
        Matcher m = TABLE_CELL.matcher(html);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            String inner = m.group(2)
                    .replaceAll("(?i)</?p(?:\\s[^>]*)?>", " ")
                    .replaceAll("(?i)<br\\s*/?>", " ");
            m.appendReplacement(sb, Matcher.quoteReplacement(m.group(1) + inner + m.group(3)));
        }
        m.appendTail(sb);
        return sb.toString()
                .replaceAll("(?i)(<li(?:\\s[^>]*)?>)\\s*<p(?:\\s[^>]*)?>", "$1")
                .replaceAll("(?i)</p>\\s*(</li>)", "$1");
    }
}
