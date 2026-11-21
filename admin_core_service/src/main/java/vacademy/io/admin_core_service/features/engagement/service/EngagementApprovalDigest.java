package vacademy.io.admin_core_service.features.engagement.service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Words of the daily approvals notice. Pure: the job reads what is open, this turns it into a
 * title and an email body a busy admin can act on in a minute.
 *
 * <p>The body lists people, not counts, wherever a person is needed: who, on which engine, what
 * happened in their own words, how long it has waited, and one link to that exact item. In order:
 * <ol>
 *   <li>people who replied (a reply waiting for an answer, or a task whose reason says the lead
 *       replied);</li>
 *   <li>things a person must decide (hand-overs and escalations: money, anger, doubt);</li>
 *   <li>engines that need a few more approvals before they send by themselves, one line each;</li>
 *   <li>everything else, counted in one short line.</li>
 * </ol>
 * At most {@link #MAX_ITEMS} people are listed; the rest are an "and N more" link.
 */
final class EngagementApprovalDigest {

    private EngagementApprovalDigest() {
    }

    /** Most items listed one by one; the rest are counted behind one link. */
    static final int MAX_ITEMS = 10;
    /** How much of their reply (or the reason) an item quotes. */
    static final int QUOTE_CHARS = 140;
    /** How much of the drafted answer an item shows. */
    static final int DRAFT_CHARS = 110;

    /**
     * Coarse SQL cut for "the reason says the lead replied" (PostgreSQL ~*). {@link #saysReplied}
     * makes the real call, negations included.
     */
    static final String REPLIED_SQL = "replied|wrote back|responded (on|via|by|over|to)";

    private static final Pattern REPLIED = Pattern.compile(
            "\\b(replied|wrote back|responded (on|via|by|over|to))\\b", Pattern.CASE_INSENSITIVE);
    /** "has not replied", "never replied", "no one replied", "yet to reply" ... */
    private static final Pattern NOT_REPLIED = Pattern.compile(
            "\\b(not|never|no one|nobody|hasn't|haven't|hadn't|didn't|did not|yet to|without|no)\\s+"
                    + "((has|have|had|yet|ever|still|once)\\s+)*"
                    + "(replied|reply|responded|wrote back)\\b", Pattern.CASE_INSENSITIVE);
    /** Their own words: the first quoted text after the reply is mentioned. */
    private static final Pattern QUOTED = Pattern.compile("[\"“‘«]([^\"”’»]{2,})[\"”’»]");
    private static final Pattern ESCALATED_PREFIX = Pattern.compile("^\\s*Escalated\\s*(\\([^)]*\\))?\\s*:?\\s*",
            Pattern.CASE_INSENSITIVE);

    private static final Map<String, String> NAMES = Map.of(
            "EMAIL", "Emails", "WHATSAPP", "WhatsApp messages", "IN_APP", "In-app messages",
            EngagementActionTypes.SCHEDULE_AI_CALL, "AI calls", EngagementActionTypes.ADD_NOTE, "Notes",
            EngagementActionTypes.CREATE_FOLLOWUP, "Follow-ups", EngagementActionTypes.ESCALATE, "Hand-overs",
            EngagementActionTypes.UPDATE_STATUS, "Status changes");

    /** What a group of waiting rows needs from a person. */
    enum Need {
        /** Someone wrote in and the engine will not answer by itself. */
        REPLY,
        /** Set to run on its own, but still short of the approvals that earn it. */
        TRIAL,
        /** Not set to run on its own: every one needs a person. */
        MANUAL,
        /** The engine tried to run these by itself and could not. */
        BLOCKED
    }

    /**
     * A group of waiting rows of one engine, counted (the people listed by name are already taken
     * out of {@code count}).
     *
     * @param what      plain name of the thing waiting ("Emails", "AI calls")
     * @param remaining for TRIAL: approvals still needed before the engine sends by itself
     * @param link      the inbox narrowed to this engine and kind of row, or null
     */
    record Line(String engineId, String engineName, String what, Need need, int count, int lapsingSoon,
                int remaining, Instant oldest, String link) {
    }

    /** Where an item sits in the notice. */
    enum Section {
        /** A person replied. */
        REPLIED,
        /** A person must decide. */
        DECIDE
    }

    /**
     * One thing a person must act on, by name.
     *
     * @param who      the lead's name, or null when unknown
     * @param happened what happened, in plain words ("Replied on WhatsApp")
     * @param detail   their words in quotes, or the engine's reason, already trimmed; may be null
     * @param next     what the engine wants to do or send, already trimmed; may be null
     */
    record Item(String id, Section section, String who, String engineName, String happened, String detail,
                String next, Instant since, String link) {
    }

    record Notice(String title, String html) {
    }

    /**
     * Whether a candidate row needs a person by name, and how to say it; null when it is only a
     * draft among many (it stays in the counts).
     */
    static Item classify(EngagementApprovalDigestDao.Candidate c, String who, String engineName, String link) {
        String reason = c.rationale() == null ? "" : c.rationale().trim();
        boolean escalated = ESCALATED_PREFIX.matcher(reason).lookingAt();
        String plainReason = escalated ? ESCALATED_PREFIX.matcher(reason).replaceFirst("") : reason;
        if ("REPLY".equals(c.kind())) {
            String draft = blankToNull(c.draftBody()) == null ? null : quoted(c.draftBody(), DRAFT_CHARS);
            String next = escalated
                    ? "The engine will not answer this one by itself" + (draft != null ? ". Its draft: " + draft : ".")
                    : draft != null ? "Answer drafted, check it and send: " + draft : "No answer drafted yet.";
            return new Item(c.id(), Section.REPLIED, who, engineName, "Replied" + on(c.channel()),
                    plain(plainReason), next, c.created(), link);
        }
        if (!"TASK".equals(c.kind())) return null;
        if (saysReplied(reason)) {
            String words = theirWords(reason);
            return new Item(c.id(), Section.REPLIED, who, engineName, "Replied" + on(channelIn(reason, c.channel())),
                    words != null ? quoted(words, QUOTE_CHARS) : plain(reason), suggestion(c), c.created(), link);
        }
        if (escalated || EngagementActionTypes.ESCALATE.equals(c.actionType())) {
            return new Item(c.id(), Section.DECIDE, who, engineName, "Handed over to you",
                    plain(plainReason), suggestion(c), c.created(), link);
        }
        return null;
    }

    /** True when the reason says the lead replied (and not that they have not). */
    static boolean saysReplied(String reason) {
        if (reason == null || reason.isBlank()) return false;
        return REPLIED.matcher(reason).find() && !NOT_REPLIED.matcher(reason).find();
    }

    /**
     * Their own words from a reason like {@code X replied on WhatsApp saying "send the fees". Offer
     * a call.}: the quoted text after the reply is mentioned. Null when the reason does not quote
     * them (a paraphrase is shown as the reason, never dressed up as their words).
     */
    static String theirWords(String reason) {
        Matcher m = REPLIED.matcher(reason);
        int from = m.find() ? m.end() : 0;
        Matcher q = QUOTED.matcher(reason.substring(from));
        if (!q.find()) return null;
        String s = q.group(1).trim();
        return s.isEmpty() ? null : s;
    }

    /** Null when nothing needs a person. */
    static Notice build(List<Item> items, List<Line> lines, int lapsedYesterday, String inboxUrl, Instant now) {
        List<Item> sorted = new ArrayList<>(items);
        sorted.sort(Comparator.comparing(Item::section).thenComparing(Item::since));
        List<Line> trial = new ArrayList<>();
        List<Line> other = new ArrayList<>();
        for (Line l : lines) {
            if (l.count() <= 0) continue;
            (l.need() == Need.TRIAL ? trial : other).add(l);
        }
        if (sorted.isEmpty() && trial.isEmpty() && other.isEmpty()) return null;

        int replied = (int) sorted.stream().filter(i -> i.section() == Section.REPLIED).count();
        int needYou = sorted.size();
        StringBuilder html = new StringBuilder();
        html.append("<div style=\"font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222\">");
        html.append("<p style=\"margin:0 0 16px\">Nothing here goes out until someone acts on it.</p>");

        List<Item> shown = sorted.subList(0, Math.min(MAX_ITEMS, sorted.size()));
        Section open = null;
        for (Item i : shown) {
            if (i.section() != open) {
                open = i.section();
                heading(html, open == Section.REPLIED
                        ? (replied == 1 ? "1 person replied. Answer first" : replied + " people replied. Answer them first")
                        : "Needs your decision");
            }
            item(html, i, now);
        }
        if (sorted.size() > shown.size()) {
            int more = sorted.size() - shown.size();
            html.append("<p style=\"margin:0 0 16px\">And ").append(more).append(more == 1 ? " more. " : " more. ");
            link(html, inboxUrl, "See all in the inbox");
            html.append("</p>");
        }

        if (!trial.isEmpty()) {
            heading(html, "Almost running by itself");
            for (Map.Entry<String, List<Line>> e : byEngine(trial).entrySet()) trialLine(html, e.getValue(), inboxUrl);
        }

        String rest = rest(other, lapsedYesterday);
        if (!rest.isEmpty() || inboxUrl != null) {
            html.append("<p style=\"margin:16px 0 0;color:#666;font-size:13px\">");
            if (!rest.isEmpty()) html.append(rest).append(' ');
            link(html, inboxUrl, "Open the Engagement inbox");
            html.append("</p>");
        }
        html.append("</div>");
        return new Notice(title(replied, needYou, trial, other), html.toString());
    }

    // ── Pieces ───────────────────────────────────────────────────────────────

    private static String title(int replied, int needYou, List<Line> trial, List<Line> other) {
        if (needYou > 0) {
            if (replied == 0) return needYou + (needYou == 1 ? " item needs" : " items need") + " your decision";
            String who = replied == 1 ? "1 person replied" : replied + " people replied";
            return needYou > replied
                    ? who + " — " + needYou + " items need you"
                    : who + (replied == 1 ? " and is" : " and are") + " waiting for you";
        }
        int drafts = 0;
        for (Line l : trial) drafts += l.count();
        for (Line l : other) drafts += l.count();
        if (!trial.isEmpty()) {
            int engines = byEngine(trial).size();
            return engines == 1
                    ? trial.get(0).engineName() + " needs a few approvals to run by itself"
                    : engines + " engines need a few approvals to run by themselves";
        }
        return drafts + (drafts == 1 ? " draft is" : " drafts are") + " waiting for approval";
    }

    private static void heading(StringBuilder html, String text) {
        html.append("<p style=\"margin:20px 0 8px;font-size:15px\"><b>").append(esc(text)).append("</b></p>");
    }

    private static void item(StringBuilder html, Item i, Instant now) {
        html.append("<p style=\"margin:0 0 14px;padding-left:10px;border-left:3px solid ")
                .append(i.section() == Section.REPLIED ? "#2f80ed" : "#f2994a").append("\">");
        html.append("<b>").append(esc(i.who() != null && !i.who().isBlank() ? i.who().trim() : "A lead")).append("</b>")
                .append(" · ").append(esc(i.engineName()))
                .append(" · <span style=\"color:#666\">waiting ").append(age(i.since(), now)).append("</span><br>");
        html.append(esc(i.happened())).append(i.detail() != null ? ": " + esc(i.detail()) : ".");
        if (i.next() != null) html.append("<br><span style=\"color:#555\">").append(esc(i.next())).append("</span>");
        if (i.link() != null) {
            html.append("<br><a href=\"").append(attr(i.link())).append("\">Open this one</a>");
        }
        html.append("</p>");
    }

    private static void trialLine(StringBuilder html, List<Line> lines, String inboxUrl) {
        List<String> waiting = new ArrayList<>();
        List<String> needed = new ArrayList<>();
        for (Line l : lines) {
            waiting.add(l.count() + " " + (l.count() == 1 ? singular(l.what()) : plural(l.what())));
            needed.add(l.remaining() + " more " + (l.remaining() == 1 ? singular(l.what()) : plural(l.what())));
        }
        String link = lines.size() == 1 ? lines.get(0).link() : engineLink(inboxUrl, lines.get(0).engineId());
        html.append("<p style=\"margin:0 0 10px\"><b>").append(esc(lines.get(0).engineName())).append("</b>: ")
                .append(esc(join(waiting))).append(" waiting. Approve ").append(esc(join(needed)))
                .append(" and it sends the rest by itself. ");
        link(html, link, "Review them");
        html.append("</p>");
    }

    /** The one short line at the bottom: everything that is not a person or a trial. */
    private static String rest(List<Line> other, int lapsedYesterday) {
        List<String> parts = new ArrayList<>();
        for (Line l : other) {
            String what = l.count() + " " + (l.count() == 1 ? singular(l.what()) : plural(l.what()));
            parts.add(esc(what) + " on " + esc(l.engineName()) + switch (l.need()) {
                case MANUAL -> " that need approval each time";
                case BLOCKED -> " the engine could not run by itself";
                case REPLY -> " from people who replied";
                case TRIAL -> "";
            });
        }
        StringBuilder s = new StringBuilder();
        if (!parts.isEmpty()) s.append("Also waiting: ").append(String.join("; ", parts)).append('.');
        if (lapsedYesterday > 0) {
            if (!s.isEmpty()) s.append(' ');
            s.append(lapsedYesterday).append(lapsedYesterday == 1 ? " draft" : " drafts")
                    .append(" expired yesterday without anyone acting.");
        }
        return s.toString();
    }

    private static Map<String, List<Line>> byEngine(List<Line> lines) {
        Map<String, List<Line>> m = new LinkedHashMap<>();
        for (Line l : lines) m.computeIfAbsent(l.engineId() != null ? l.engineId() : l.engineName(), k -> new ArrayList<>()).add(l);
        return m;
    }

    private static void link(StringBuilder html, String url, String text) {
        if (url == null) return;
        html.append("<a href=\"").append(attr(url)).append("\">").append(esc(text)).append("</a>");
    }

    static String engineLink(String inboxUrl, String engineId) {
        return inboxUrl == null || engineId == null ? inboxUrl : inboxUrl + "?engine=" + urlPart(engineId);
    }

    static String taskLink(String inboxUrl, String taskId) {
        return inboxUrl == null ? null : inboxUrl + "?task=" + urlPart(taskId);
    }

    /** The inbox narrowed to one engine's rows of one channel or CRM action. */
    static String groupLink(String inboxUrl, String engineId, String channel, String actionType) {
        if (inboxUrl == null) return null;
        String base = engineLink(inboxUrl, engineId);
        if (EngagementActionTypes.SCHEDULE_AI_CALL.equals(actionType)) return base + "&filter=approvals&channel=AI_CALL";
        if (EngagementActionTypes.isCrmAction(actionType)) return base + "&filter=approvals";
        return channel == null ? base : base + "&kind=TASK&channel=" + urlPart(channel);
    }

    /** Plain name of a channel or CRM action ("Emails", "AI calls"). */
    static String whatOf(String channel, String actionType) {
        String key = EngagementActionTypes.isCrmAction(actionType) ? actionType : channel;
        return key == null ? null : NAMES.getOrDefault(key, key);
    }

    private static String suggestion(EngagementApprovalDigestDao.Candidate c) {
        String what = whatOf(c.channel(), c.actionType());
        String draft = blankToNull(c.draftBody());
        if (draft != null) {
            return (what == null ? "The engine suggests" : "The engine suggests " + article(singular(what))) + ": "
                    + quoted(draft, DRAFT_CHARS);
        }
        // A hand-over with nothing drafted: "Handed over to you" already says it.
        if (what == null || EngagementActionTypes.ESCALATE.equals(c.actionType())) return null;
        return "The engine suggests " + article(singular(what)) + ".";
    }

    private static String on(String channel) {
        if (channel == null) return "";
        return switch (channel) {
            case "WHATSAPP" -> " on WhatsApp";
            case "EMAIL" -> " by email";
            case "IN_APP" -> " in the app";
            case "AI_CALL" -> " on a call";
            default -> "";
        };
    }

    /** The channel the reason names ("replied on WhatsApp"), else the row's own. */
    private static String channelIn(String reason, String fallback) {
        String r = reason.toLowerCase();
        if (r.contains("whatsapp")) return "WHATSAPP";
        if (r.contains("email") || r.contains("e-mail")) return "EMAIL";
        if (r.contains(" call")) return "AI_CALL";
        return EngagementActionTypes.SCHEDULE_AI_CALL.equals(fallback) ? null : fallback;
    }

    private static String article(String s) {
        if (s.startsWith("AI ")) return "an " + s;
        return ("aeiou".indexOf(Character.toLowerCase(s.charAt(0))) >= 0 ? "an " : "a ") + s;
    }

    /** "Emails" → "email", "AI calls" → "AI call". */
    private static String singular(String what) {
        String s = what.endsWith("s") ? what.substring(0, what.length() - 1) : what;
        return s.startsWith("AI ") || s.startsWith("WhatsApp") ? s : s.toLowerCase();
    }

    private static String plural(String what) {
        return what.startsWith("AI ") || what.startsWith("WhatsApp") ? what : what.toLowerCase();
    }

    private static String join(List<String> parts) {
        if (parts.size() <= 1) return String.join("", parts);
        return String.join(", ", parts.subList(0, parts.size() - 1)) + " and " + parts.get(parts.size() - 1);
    }

    static String trim(String s, int max) {
        String t = s.replaceAll("\\s+", " ").trim();
        if (t.length() <= max) return t;
        int cut = t.lastIndexOf(' ', max - 1);
        return t.substring(0, cut > max / 2 ? cut : max - 1).replaceAll("[\\s,.;:]+$", "") + "…";
    }

    private static String quoted(String s, int max) {
        return "“" + trim(s.replaceAll("^[\"'“‘]+|[\"'”’]+$", ""), max) + "”";
    }

    /** The engine's reason, trimmed; null when blank. */
    private static String plain(String reason) {
        return blankToNull(reason) == null ? null : trim(reason, QUOTE_CHARS);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    static String age(Instant since, Instant now) {
        long hours = Math.max(0, Duration.between(since, now).toHours());
        if (hours < 1) return "under an hour";
        if (hours < 24) return hours + (hours == 1 ? " hour" : " hours");
        long days = hours / 24;
        return days + (days == 1 ? " day" : " days");
    }

    private static String urlPart(String s) {
        return java.net.URLEncoder.encode(s, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String attr(String s) {
        return esc(s).replace("\"", "&quot;");
    }

    private static String esc(String s) {
        return EngagementPointsOfContact.esc(s);
    }
}
