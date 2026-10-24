package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportCharts.Band;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportCharts.BloomLevel;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportCharts.TopicPoint;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionRow;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.SectionRow;

import java.text.SimpleDateFormat;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static vacademy.io.assessment_service.features.assessment.service.aireport.AiReportCharts.*;
import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.*;

/**
 * The student AI report (learner "AI report" PDF), redesigned 2026-10: up to five A4 pages
 * — result, class, topics and thinking skills, how the test was taken, fix and plan.
 *
 * <p>Written for iText html2pdf: layout is tables and blocks only (no flex/grid), colours
 * are solid hex (no rgba/var), charts are inline SVG from {@link AiReportCharts}. Each
 * section heading states what the data shows, computed here from the numbers; the AI
 * text only fills the narrative parts. A section with no data is left out, and a page
 * with no sections is not printed.
 */
@Component
public class AiReportHtmlBuilderV2 {

    static final int CONTENT_W = 722;
    static final int HALF_W = 340;

    public String build(AiReportModel m) {
        ReportPalette p = new ReportPalette(m.getBrandColor(), m.getAccentColor());
        JsonNode ai = m.getAi();

        List<String> pages = new ArrayList<>();
        pages.add(page1(m, p, ai));
        boolean qw = !m.isHideQuestionWise();
        addIfAny(pages, page(m, p, false, blocks(classBlock(m, p), timeBlock(m, p), qw ? answerMapBlock(m, p) : "")));
        addIfAny(pages, page(m, p, false, topicsBlock(ai, p)));
        addIfAny(pages, page(m, p, false, blocks(bloomBlock(ai, p), qw ? easyMarksBlock(m, p, ai) : "", qw ? expertiseBlock(m, p) : "", potentialBlock(m, p))));
        addIfAny(pages, page(m, p, false, behaviourBlock(m, p, ai)));
        String fix = qw ? fixBlock(ai, p) : "", plan = planBlock(ai, p), cards = cardsAndProgress(m, p, ai);
        if ((qw ? estimateFix(ai) : 0) + estimatePlan(ai) + (cards.isEmpty() ? 0 : 300) <= 960) {
            addIfAny(pages, page(m, p, false, blocks(fix, plan, cards)));
        } else {
            addIfAny(pages, page(m, p, false, fix));
            addIfAny(pages, page(m, p, false, blocks(plan, cards)));
        }

        if (qw) addIfAny(pages, page(m, p, false, questionByQuestion(m, p)));

        StringBuilder html = new StringBuilder(64 * 1024);
        html.append("<!DOCTYPE html><html><head><meta charset=\"UTF-8\"/><style>").append(css(m, p)).append("</style></head><body>");
        for (int i = 0; i < pages.size(); i++) {
            html.append("<div class=\"page").append(i > 0 ? " break" : "").append("\">").append(pages.get(i)).append("</div>");
        }
        html.append("</body></html>");
        return html.toString();
    }

    // ── Page 1: result ──

    private String page1(AiReportModel m, ReportPalette p, JsonNode ai) {
        StringBuilder s = new StringBuilder();
        s.append(band(m, p, true));
        s.append(hero(m, p));
        s.append("<div class=\"body\">");
        String summary = plain(text(ai, "performance_analysis"), 1100);
        if (!summary.isEmpty()) {
            s.append("<table class=\"note\"><tr><td class=\"note-q\"><div class=\"quote\">&#8220;</div></td><td>")
                    .append("<div class=\"note-l\">Summary</div><div class=\"note-t\">").append(esc(summary)).append("</div></td></tr></table>");
        }
        if (m.getSections().size() >= 2) {
            long above = m.getSections().stream().filter(r -> r.classAverage() != null && r.score() > r.classAverage()).count();
            String head = m.hasClass()
                    ? "Above the class in " + above + " of " + m.getSections().size() + " sections"
                    : "Marks in each section";
            s.append(block("Marks by section", head,
                    "Each bar is your score as a share of that section's marks." + (m.hasClass() ? " The dark tick is the class average." : ""),
                    legend(p, m.hasClass(), m.getSections().stream().anyMatch(r -> r.score() < 0))
                            + sectionScorecard(m.getSections(), p, CONTENT_W)));
        } else if (!m.isHideQuestionWise()) {
            s.append(answerMapBlock(m, p));
        }
        s.append("</div>");
        return s.toString();
    }

    private String band(AiReportModel m, ReportPalette p, boolean first) {
        String inst = m.getInstituteName() == null ? "" : m.getInstituteName();
        String logo;
        int cellW = 58; // initials badge: 40px + gaps
        if (m.getLogoDataUri() != null) {
            // The badge is a fixed-size cell sized from the logo's own proportions: an auto-width
            // block stretched to the header cell and left white space beside the logo.
            double aspect = m.getLogoAspect() == null ? 1.0 : Math.max(0.5, Math.min(4.0, m.getLogoAspect()));
            int h = 38, w = (int) Math.round(h * aspect);
            cellW = w + 14;
            logo = "<table class=\"logo-img\"><tr><td style=\"width:" + w + "px;height:" + h + "px;\"><img src=\""
                    + m.getLogoDataUri().replace("\"", "%22") + "\" style=\"width:" + w + "px;height:" + h + "px;\"/></td></tr></table>";
        } else {
            logo = "<div class=\"logo\"><span class=\"logo-t\">" + esc(initials(inst)) + "</span></div>";
        }
        StringBuilder right = new StringBuilder();
        right.append("<div class=\"band-r1\">").append(esc(displayName(m.getStudentName()))).append("</div><div class=\"band-r2\">");
        List<String> bits = new ArrayList<>();
        if (notBlank(m.getEnrollmentNumber())) bits.add("Enrollment no. " + m.getEnrollmentNumber());
        if (first && m.getAttemptDate() != null) bits.add(date(m.getAttemptDate()));
        if (!first || bits.isEmpty()) bits.add(0, m.getAssessmentName());
        right.append(esc(String.join(" · ", bits))).append("</div>");
        return "<table class=\"band\"><tr><td class=\"band-logo\" style=\"width:" + (cellW + 36) + "px;\">" + logo + "</td>"
                + "<td><div class=\"band-i1\">" + esc(inst) + "</div>"
                + (first ? "<div class=\"band-i2\">" + esc(m.getAssessmentName()) + "</div>" : "")
                + "</td><td class=\"band-right\">" + right + "</td></tr></table>";
    }

    private String hero(AiReportModel m, ReportPalette p) {
        StringBuilder s = new StringBuilder("<div class=\"hero\">");
        s.append("<table class=\"hero-t\"><tr><td class=\"hero-l\">");
        s.append("<div class=\"kicker\">").append(esc(possessive(firstName(m.getStudentName())))).append(" result</div>");
        s.append("<div class=\"h1\">").append(esc(heroHeadline(m))).append("</div>");
        String sub = heroSubline(m);
        if (!sub.isEmpty()) s.append("<div class=\"hero-p\">").append(esc(sub)).append("</div>");
        s.append("</td><td class=\"hero-r\"><div class=\"big\">").append(num(m.getScore()))
                .append("<span class=\"big-of\">/").append(num(m.getMaxScore())).append("</span></div>");
        if (m.hasClass() && m.getParticipants() >= 5) {
            s.append("<div class=\"big-sub\">Rank ").append(m.getRank()).append(" of ").append(m.getParticipants()).append("</div>");
        } else if (m.getMaxScore() > 0) {
            s.append("<div class=\"big-sub\">").append(Math.round(pct(m.getScore(), m.getMaxScore()))).append("%</div>");
        }
        s.append("</td></tr></table>");

        if (m.hasClass() && m.getPercentile() != null && m.getParticipants() >= 5) {
            long better = Math.round(m.getPercentile());
            s.append("<table class=\"pct-top\"><tr><td>Better than <b>").append(better).append("%</b> of students who took this test</td>")
                    .append("<td style=\"text-align:right\">Class average ").append(num1(m.getClassAverage()))
                    .append(" · Highest ").append(num(m.getClassHighest())).append("</td></tr></table>");
            s.append("<div class=\"pct-track\"><div class=\"pct-fill\" style=\"width:").append(Math.max(2, Math.min(100, better))).append("%\"></div></div>");
        }

        int correct = m.count(Outcome.CORRECT) + m.count(Outcome.PARTIAL);
        int wrong = m.count(Outcome.WRONG), skipped = m.count(Outcome.SKIPPED), pending = m.count(Outcome.PENDING);
        String penalty = uniformPenalty(m);
        s.append("<table class=\"tiles\"><tr>");
        s.append(tile(String.valueOf(correct), m.count(Outcome.PARTIAL) > 0 ? "right or partly right" : "correct", OK));
        s.append(tile(String.valueOf(wrong), penalty != null ? "wrong (" + penalty + " each)" : "wrong", BAD));
        if (pending > 0) s.append(tile(String.valueOf(pending), "being checked" + (skipped > 0 ? " · " + skipped + " skipped" : ""), INK));
        else s.append(tile(String.valueOf(skipped), "skipped", INK));
        if (m.getTimeTakenSeconds() != null && m.getTimeTakenSeconds() > 0) {
            String used = "minutes used" + (m.getDurationLimitMinutes() != null ? " of " + m.getDurationLimitMinutes() : "")
                    + (m.hasClass() && m.getClassAverageTimeSeconds() != null ? " · class " + mmss(m.getClassAverageTimeSeconds()) : "");
            s.append(tile(mmss(m.getTimeTakenSeconds()), used, INK));
        } else {
            s.append(tile(String.valueOf(m.getQuestions().size()), "questions", INK));
        }
        s.append("</tr></table></div>");
        return s.toString();
    }

    private String tile(String value, String label, String color) {
        return "<td class=\"tile\"><div class=\"tile-v\" style=\"color:" + color + "\">" + esc(value) + "</div><div class=\"tile-l\">" + esc(label) + "</div></td>";
    }

    String heroHeadline(AiReportModel m) {
        double pc = pct(m.getScore(), m.getMaxScore());
        if (m.hasClass() && m.getParticipants() >= 2) {
            int n = m.getParticipants();
            if (m.getRank() != null && m.getRank() == 1) return "Top of the class!";
            if (m.getRank() != null && n >= 5) {
                double share = m.getRank() / (double) n; // 0.1 = rank within the top 10%
                if (share <= 0.10) return "Top 10% of " + n + " students";
                if (share <= 0.25) return "Top quarter of " + n + " students";
                if (share <= 1.0 / 3) return "Top third of " + n + " students";
            }
            if (m.getScore() >= m.getClassAverage()) return "Above the class average";
            return "Let's climb higher next time";
        }
        if (pc >= 85) return "Excellent work!";
        if (pc >= 60) return "Good work";
        return "Let's build on this";
    }

    String heroSubline(AiReportModel m) {
        List<SectionRow> secs = m.getSections();
        if (secs.size() < 2) {
            int n = m.getQuestions().size();
            return n == 0 ? "" : (m.count(Outcome.CORRECT) + " of " + n + " questions right.");
        }
        List<String> full = secs.stream().filter(r -> r.max() > 0 && r.score() >= r.max()).map(SectionRow::name).toList();
        SectionRow weakest = secs.stream().filter(r -> r.max() > 0).min(Comparator.comparingDouble(r -> pct(r.score(), r.max()))).orElse(null);
        SectionRow strongest = secs.stream().filter(r -> r.max() > 0).max(Comparator.comparingDouble(r -> pct(r.score(), r.max()))).orElse(null);
        StringBuilder s = new StringBuilder();
        if (!full.isEmpty()) s.append("Full marks in ").append(joinAnd(full)).append(". ");
        else if (strongest != null) s.append("Strongest in ").append(strongest.name()).append(" (").append(num(strongest.score())).append(" of ").append(num(strongest.max())).append("). ");
        if (weakest != null && pct(weakest.score(), weakest.max()) < 50 && !full.contains(weakest.name())) {
            s.append(weakest.name()).append(" is where the most marks were lost.");
        }
        return s.toString().trim();
    }

    // ── Page 2: class ──

    private String classBlock(AiReportModel m, ReportPalette p) {
        if (!m.hasClass() || m.getParticipants() < 5) return "";
        List<Double> all = new ArrayList<>(m.getClassScores());
        Collections.sort(all);
        double median = all.get(all.size() / 2);
        String head = m.getScore() > median
                ? "Half the class scored " + num(median) + " or less. You scored " + num(m.getScore()) + "."
                : "Where your " + num(m.getScore()) + " sits in the class";
        return block("Where you stand", head,
                "How many of the " + m.getParticipants() + " students scored in each range. Other students are counted, never named.",
                histogram(m.getClassScores(), m.getScore(), m.getMaxScore(), m.getClassAverage(), p, CONTENT_W));
    }

    private String timeBlock(AiReportModel m, ReportPalette p) {
        List<SectionRow> secs = m.getSections();
        if (secs.size() < 2 || secs.stream().mapToLong(SectionRow::timeSeconds).sum() <= 0) return "";
        String chart = timeBySection(secs, m.getDurationLimitMinutes(), p, CONTENT_W);
        if (chart.isEmpty()) return "";
        boolean hasClass = secs.stream().allMatch(r -> r.classAverageTimeSeconds() != null);
        String head = "Where your time went";
        if (hasClass) {
            double you = secs.stream().mapToDouble(SectionRow::timeSeconds).sum();
            double klass = secs.stream().mapToDouble(SectionRow::classAverageTimeSeconds).sum();
            SectionRow most = secs.stream().max(Comparator.comparingDouble(r -> r.timeSeconds() - r.classAverageTimeSeconds())).orElse(null);
            double extraMin = (you - klass) / 60.0;
            if (extraMin >= 1 && most != null) {
                double share = (most.timeSeconds() - most.classAverageTimeSeconds()) / (you - klass);
                head = "You took " + halfMinutes(extraMin) + " longer than the class"
                        + (share >= 0.4 ? ", " + (share >= 0.6 ? "most" : "much") + " of it on " + most.name() : "");
            } else if (extraMin <= -1) {
                head = "You finished " + halfMinutes(-extraMin) + " faster than the class";
            } else {
                head = "You used about the same time as the class";
            }
        }
        return block("Time by section", head,
                "Minutes spent in each section" + (hasClass ? ", compared with the class average." : ".")
                        + (m.getDurationLimitMinutes() != null ? " The test allowed " + m.getDurationLimitMinutes() + " minutes." : ""),
                sectionLegend(secs) + chart);
    }

    private String answerMapBlock(AiReportModel m, ReportPalette p) {
        List<QuestionRow> qs = m.getQuestions();
        if (qs.isEmpty()) return "";
        int right = m.count(Outcome.CORRECT), wrong = m.count(Outcome.WRONG), skipped = m.count(Outcome.SKIPPED);
        int partial = m.count(Outcome.PARTIAL), pending = m.count(Outcome.PENDING);
        List<String> parts = new ArrayList<>();
        parts.add(right + " right");
        if (partial > 0) parts.add(partial + " partly right");
        parts.add(wrong + " wrong");
        parts.add(skipped == 0 ? "none skipped" : skipped + " skipped");
        if (pending > 0) parts.add(pending + " being checked");
        boolean anyFast = qs.stream().anyMatch(q -> q.answered() && q.timeSeconds() != null && q.timeSeconds() < 10);

        StringBuilder s = new StringBuilder("<table class=\"amap\">");
        Map<String, List<QuestionRow>> bySection = new LinkedHashMap<>();
        for (QuestionRow q : qs) bySection.computeIfAbsent(q.sectionId(), k -> new ArrayList<>()).add(q);
        boolean showTime = qs.size() <= 120;
        for (List<QuestionRow> rows : bySection.values()) {
            QuestionRow first = rows.get(0);
            s.append("<tr><td class=\"amap-l\">");
            if (bySection.size() > 1) {
                s.append("<span class=\"sw\" style=\"background:").append(section(first.sectionIndex())).append("\"></span> ")
                        .append(esc(clip(first.sectionName(), 14)));
            } else {
                s.append("Questions");
            }
            s.append("</td><td>");
            for (QuestionRow q : rows) {
                String bg = switch (q.outcome()) {
                    case CORRECT -> OK;
                    case PARTIAL -> AMBER;
                    case WRONG -> BAD;
                    case PENDING -> WAIT;
                    case SKIPPED -> "#c5ccd8";
                };
                boolean fast = q.answered() && q.timeSeconds() != null && q.timeSeconds() < 10;
                s.append("<div class=\"cell\" style=\"background:").append(bg).append(";border-color:").append(fast ? p.accent : bg).append("\">")
                        .append("<div class=\"cell-n\">").append(q.numberInSection()).append("</div>");
                if (showTime) {
                    s.append("<div class=\"cell-t\">").append(q.outcome() == Outcome.SKIPPED ? "skip" : q.timeSeconds() == null ? "" : q.timeSeconds() + "s").append("</div>");
                }
                s.append("</div>");
            }
            s.append("</td></tr>");
        }
        s.append("</table>");
        String lede = "Each box is one question" + (showTime ? ", with the seconds you spent on it." : ".")
                + (anyFast ? " A yellow outline means it was answered in under 10 seconds." : "");
        return block("Every answer", String.join(", ", parts), lede, outcomeLegend(m) + s);
    }

    // ── Page 3: topics and Bloom's ──

    private String topicsBlock(JsonNode ai, ReportPalette p) {
        JsonNode topics = ai.path("topic_analysis");
        List<String[]> strong = new ArrayList<>(), weak = new ArrayList<>();
        List<Double> strongAcc = new ArrayList<>(), weakAcc = new ArrayList<>();
        if (topics.isArray()) {
            List<JsonNode> list = new ArrayList<>();
            topics.forEach(list::add);
            list.sort(Comparator.comparingDouble((JsonNode t) -> t.path("accuracy").asDouble(0)).reversed());
            for (JsonNode t : list) {
                String name = t.path("topic").asText("");
                if (name.isBlank()) continue;
                double acc = t.path("accuracy").asDouble(0);
                String meta = t.path("correct").asInt(0) + "/" + t.path("questions_count").asInt(0);
                String[] row = {name, meta, t.path("mastery_level").asText("")};
                if (acc >= 75) { strong.add(row); strongAcc.add(acc); } else { weak.add(row); weakAcc.add(acc); }
            }
        }
        if (strong.isEmpty() && weak.isEmpty()) {
            // Older reports only carry {topic: percent} maps.
            ai.path("strengths").fields().forEachRemaining(e -> { strong.add(new String[]{e.getKey(), e.getValue().asInt() + "%", ""}); strongAcc.add(e.getValue().asDouble()); });
            ai.path("weaknesses").fields().forEachRemaining(e -> { weak.add(new String[]{e.getKey(), e.getValue().asInt() + "%", ""}); weakAcc.add(e.getValue().asDouble()); });
        }
        if (strong.isEmpty() && weak.isEmpty()) return "";
        long mastered = strongAcc.stream().filter(a -> a >= 99.5).count();
        long zero = weakAcc.stream().filter(a -> a < 0.5).count();
        String head = mastered > 0
                ? (mastered == 1 ? "One topic mastered" : words(mastered) + " topics mastered")
                + (zero > 0 ? ", " + (zero == 1 ? "one" : words(zero).toLowerCase()) + " to start from scratch" : weak.isEmpty() ? "" : ", " + weak.size() + " to work on")
                : strong.isEmpty() ? "Topics to work on" : strong.size() + " strong " + (strong.size() == 1 ? "topic" : "topics") + ", " + weak.size() + " to work on";
        List<TopicPoint> radar = new ArrayList<>();
        for (int i = 0; i < strong.size(); i++) radar.add(new TopicPoint(strong.get(i)[0], strongAcc.get(i)));
        for (int i = 0; i < weak.size(); i++) radar.add(new TopicPoint(weak.get(i)[0], weakAcc.get(i)));
        String chart = topicRadar(radar, p, CONTENT_W);
        String body = chart + "<table class=\"cols\"><tr><td class=\"col\">" + topicColumn("Strengths", strong, strongAcc, p, true)
                + "</td><td class=\"col-gap\"></td><td class=\"col\">" + topicColumn("Needs work", weak, weakAcc, p, false) + "</td></tr></table>";
        return block("Topic mastery", head, "Questions right in each topic, with a 4-step mastery level: Beginner, Developing, Proficient, Expert.", body);
    }

    private String topicColumn(String title, List<String[]> rows, List<Double> acc, ReportPalette p, boolean strong) {
        if (rows.isEmpty()) return "";
        StringBuilder s = new StringBuilder("<div class=\"colh\">").append(title);
        if (strong && acc.stream().anyMatch(a -> a >= 99.5)) s.append(" <span class=\"badge\">Full marks</span>");
        s.append("</div>");
        for (int i = 0; i < rows.size() && i < 6; i++) {
            String[] r = rows.get(i);
            double a = Math.max(0, Math.min(100, acc.get(i)));
            String color = a >= 75 ? p.brand : a >= 40 ? AMBER : BAD;
            s.append("<table class=\"trow\"><tr><td class=\"tname\">").append(esc(clip(r[0], 34))).append("</td><td class=\"tmeta\">")
                    .append(esc(r[1])).append(pips(r[2], p)).append("</td></tr></table>")
                    .append("<div class=\"bar\"><div class=\"bar-f\" style=\"width:").append(Math.max(3, Math.round(a))).append("%;background:").append(color).append("\"></div></div>");
        }
        return s.toString();
    }

    private String pips(String level, ReportPalette p) {
        int n = switch (level == null ? "" : level.trim().toLowerCase(Locale.ROOT)) {
            case "expert" -> 4;
            case "proficient" -> 3;
            case "developing" -> 2;
            case "beginner" -> 1;
            default -> 0;
        };
        if (n == 0) return "";
        StringBuilder s = new StringBuilder(" ");
        for (int i = 1; i <= 4; i++) {
            s.append("<span class=\"pip\" style=\"background:").append(i <= n ? p.brand : LINE).append("\"></span>");
        }
        return s.toString();
    }

    private static final String[][] BLOOM = {
            {"create", "Create", "designing something new"},
            {"evaluate", "Evaluate", "judging and justifying"},
            {"analyze", "Analyse", "reading figures, data and set-ups"},
            {"apply", "Apply", "solving with methods and formulas"},
            {"understand", "Understand", "explaining ideas"},
            {"remember", "Remember", "recalling facts and names"},
    };

    private String bloomBlock(JsonNode ai, ReportPalette p) {
        JsonNode b = ai.path("blooms_taxonomy");
        if (!b.isObject()) return "";
        Map<String, JsonNode> byKey = new HashMap<>();
        b.fields().forEachRemaining(e -> byKey.put(e.getKey().toLowerCase(Locale.ROOT).replace("analyse", "analyze"), e.getValue()));
        List<BloomLevel> levels = new ArrayList<>();
        int tested = 0;
        BloomLevel best = null, worst = null;
        for (String[] l : BLOOM) {
            JsonNode v = byKey.get(l[0]);
            Integer total = v != null && v.path("total").asInt(0) > 0 ? v.path("total").asInt() : null;
            Integer correct = total != null ? v.path("correct").asInt(0) : null;
            BloomLevel lvl = new BloomLevel(l[1], l[2], correct, total);
            levels.add(lvl);
            if (lvl.percent() != null) {
                tested++;
                // One question is not a pattern: a level needs 3 to headline as a strength, 2 as a weakness.
                if (total >= 3 && (best == null || lvl.percent() > best.percent())) best = lvl;
                if (total >= 2 && (worst == null || lvl.percent() < worst.percent())) worst = lvl;
            }
        }
        if (tested == 0) return "";
        String head = best != null && worst != null && best != worst && best.percent() - worst.percent() >= 20
                ? "Strong at " + verb(best.name()) + ", weaker at " + verb(worst.name())
                : "Thinking skills across the paper";
        return block("Bloom's taxonomy", head,
                "Each question is tagged with the kind of thinking it needs, from remembering at the base to creating at the top.",
                bloomPyramid(levels, p, CONTENT_W));
    }

    private static String verb(String level) {
        return switch (level) {
            case "Remember" -> "recalling facts";
            case "Understand" -> "explaining ideas";
            case "Apply" -> "applying methods";
            case "Analyse" -> "analysing";
            case "Evaluate" -> "evaluating";
            default -> "creating";
        };
    }

    // ── Page 4: how the test was taken ──

    private String behaviourBlock(AiReportModel m, ReportPalette p, JsonNode ai) {
        JsonNode bi = ai.path("behavioral_insights");
        List<QuestionRow> qs = m.getQuestions();
        List<String> cells = new ArrayList<>();

        List<Band> bands = speedBands(qs);
        int timed = bands.stream().mapToInt(Band::total).sum();
        if (timed >= 6) {
            Band fast = bands.get(0);
            Band best = bands.stream().filter(b -> b.total() >= 3).max(Comparator.comparingDouble(Band::percent)).orElse(bands.get(1));
            String head = fast.total() >= 3 && fast.percent() < 40
                    ? "Answers under 10 seconds were " + (fast.right() == 0 ? "all wrong" : "mostly wrong")
                    : "Your best accuracy came at " + best.label() + " a question";
            cells.add(half("Speed vs accuracy", head, speedAccuracy(bands, p, HALF_W), plain(text(bi, "time_management"), 240)));
        }

        double[] q = quarterAccuracy(qs);
        if (q != null) {
            String[] labels = quarterLabels(qs);
            String head;
            if (q[3] >= q[0] + 10 || (q[2] + q[3]) / 2 >= 90) {
                int lastHalf = (int) qs.stream().filter(x -> x.outcome() != Outcome.PENDING).count();
                head = "You finished strong";
                List<QuestionRow> graded = qs.stream().filter(x -> x.outcome() != Outcome.PENDING).toList();
                List<QuestionRow> tail = graded.subList(graded.size() / 2, graded.size());
                long r = tail.stream().filter(x -> x.outcome() == Outcome.CORRECT).count();
                if (lastHalf > 0) head += ": " + r + " of the last " + tail.size() + " right";
            } else if (q[3] <= q[0] - 15) {
                head = "Accuracy dropped towards the end";
            } else {
                head = "Steady from start to finish";
            }
            cells.add(half("Stamina", head, stamina(q, labels, p, HALF_W), plain(text(bi, "fatigue_indicator"), 240)));
        }

        double earned = qs.stream().mapToDouble(QuestionRow::marks).filter(v -> v > 0).sum();
        double lost = qs.stream().mapToDouble(QuestionRow::marks).filter(v -> v < 0).sum();
        if (lost < 0) {
            List<QuestionRow> guesses = qs.stream().filter(x -> x.marks() < 0 && x.timeSeconds() != null && x.timeSeconds() < 10).toList();
            double guessLoss = guesses.stream().mapToDouble(QuestionRow::marks).sum();
            Double without = guesses.isEmpty() ? null : m.getScore() - guessLoss;
            String note = without == null ? "" : "Dashed line: " + num(without) + ", your score without the " + guesses.size()
                    + (guesses.size() == 1 ? " answer" : " answers") + " given in under 10 seconds. ";
            cells.add(half("Negative marking", "Wrong answers cost " + num(-lost) + (Math.abs(lost) == 1 ? " mark" : " marks"),
                    waterfall(earned, lost, m.getScore(), without, guesses.size(), p, HALF_W), (note + plain(text(bi, "skip_pattern"), 220)).trim()));
        }

        String quad = confidenceQuadrant(m, p, ai);
        if (!quad.isEmpty()) cells.add(quad);

        if (cells.isEmpty()) {
            return behaviourTextOnly(bi);
        }
        StringBuilder s = new StringBuilder("<table class=\"cols\">");
        for (int i = 0; i < cells.size(); i += 2) {
            s.append("<tr><td class=\"col\">").append(cells.get(i)).append("</td><td class=\"col-gap\"></td><td class=\"col\">")
                    .append(i + 1 < cells.size() ? cells.get(i + 1) : "").append("</td></tr>");
        }
        s.append("</table>");
        return s.toString();
    }

    private String behaviourTextOnly(JsonNode bi) {
        String[][] keys = {{"time_management", "Time management"}, {"fatigue_indicator", "Stamina"},
                {"difficulty_response", "Difficulty"}, {"skip_pattern", "Skipping and guessing"}};
        StringBuilder s = new StringBuilder();
        for (String[] k : keys) {
            String t = plain(text(bi, k[0]), 400);
            if (!t.isEmpty()) s.append("<div class=\"insight\"><b>").append(k[1]).append(".</b> ").append(esc(t)).append("</div>");
        }
        return s.length() == 0 ? "" : block("Behaviour", "How you took the test", null, s.toString());
    }

    private String confidenceQuadrant(AiReportModel m, ReportPalette p, JsonNode ai) {
        List<QuestionRow> qs = m.getQuestions().stream()
                .filter(q -> q.answered() && q.timeSeconds() != null && (q.outcome() == Outcome.CORRECT || q.outcome() == Outcome.WRONG))
                .toList();
        if (qs.size() < 6) return "";
        List<Long> times = qs.stream().map(QuestionRow::timeSeconds).sorted().toList();
        long median = times.get(times.size() / 2);
        int quickRight = 0, slowRight = 0, quickWrong = 0, slowWrong = 0;
        for (QuestionRow q : qs) {
            double ref = q.classAverageTimeSeconds() != null ? q.classAverageTimeSeconds() : median;
            boolean quick = q.timeSeconds() <= ref;
            boolean right = q.outcome() == Outcome.CORRECT;
            if (quick && right) quickRight++;
            else if (right) slowRight++;
            else if (quick) quickWrong++;
            else slowWrong++;
        }
        int max = Math.max(Math.max(quickRight, slowRight), Math.max(quickWrong, slowWrong));
        String head = max == quickRight ? "Mostly quick and right"
                : max == quickWrong ? "Rushing cost you marks"
                : max == slowRight ? "You worked carefully" : "Some questions had you stuck";
        boolean classRef = qs.stream().anyMatch(q -> q.classAverageTimeSeconds() != null);
        String quad = "<table class=\"quad\"><tr>"
                + qd(quickRight, "Confident", "quick and right", OK, PAPER)
                + qd(slowRight, "Worked it out", "slow and right", OK_50, OK)
                + "</tr><tr>"
                + qd(quickWrong, "Rushed", "quick and wrong", BAD, PAPER)
                + qd(slowWrong, "Stuck", "slow and wrong", BAD_50, BAD)
                + "</tr></table><div class=\"cap\">Quick means faster than " + (classRef ? "the class average for that question" : "your usual pace")
                + ". \"Rushed\" answers are the easiest marks to win back.</div>";
        String insight = plain(text(ai.path("confidence_estimation"), "insight"), 240);
        return half("Confidence", head, quad, insight);
    }

    private String qd(int n, String title, String sub, String bg, String fg) {
        return "<td class=\"qd\" style=\"background:" + bg + ";color:" + fg + "\"><div class=\"qd-n\">" + n + "</div><div class=\"qd-t\">"
                + title + "</div><div class=\"qd-s\">" + sub + "</div></td>";
    }

    private String easyMarksBlock(AiReportModel m, ReportPalette p, JsonNode ai) {
        if (!m.hasClass() || m.getParticipants() < 5) return "";
        List<QuestionRow> missed = m.getQuestions().stream()
                .filter(q -> (q.outcome() == Outcome.WRONG || q.outcome() == Outcome.SKIPPED)
                        && q.classCorrectPercent() != null && q.classCorrectPercent() >= 60)
                .sorted(Comparator.comparingDouble(QuestionRow::classCorrectPercent).reversed())
                .limit(3).toList();
        if (missed.isEmpty()) return "";
        StringBuilder s = new StringBuilder("<table class=\"miss\">");
        for (QuestionRow q : missed) {
            String title = questionTitle(m, q, 60);
            String sub = q.outcome() == Outcome.SKIPPED ? "You skipped it" : q.timeSeconds() == null ? "" : "You took " + q.timeSeconds() + " seconds";
            long pc = Math.round(q.classCorrectPercent());
            s.append("<tr><td class=\"miss-l\"><div class=\"miss-t\">").append(esc(title)).append("</div><div class=\"miss-s\">").append(esc(sub))
                    .append("</div></td><td class=\"miss-r\"><div class=\"bar\"><div class=\"bar-f\" style=\"width:").append(pc)
                    .append("%;background:").append(WAIT).append("\"></div></div><div class=\"miss-p\">").append(pc).append("% of class right</div></td></tr>");
        }
        s.append("</table>");
        String caption = plain(text(ai.path("behavioral_insights"), "difficulty_response"), 260);
        return block("Easy marks missed", "Most of the class got " + (missed.size() == 1 ? "this one" : "these") + " right",
                "Questions you missed that at least 3 in 5 classmates answered correctly.",
                s + (caption.isEmpty() ? "" : "<div class=\"cap\">" + esc(caption) + "</div>"));
    }

    private String expertiseBlock(AiReportModel m, ReportPalette p) {
        if (!m.hasClass() || m.getParticipants() < 5) return "";
        List<QuestionRow> rows = m.getQuestions().stream()
                .filter(q -> q.outcome() == Outcome.CORRECT && q.classCorrectPercent() != null && q.classCorrectPercent() <= 30)
                .sorted(Comparator.comparingDouble(QuestionRow::classCorrectPercent))
                .limit(5).toList();
        if (rows.isEmpty()) return "";
        StringBuilder s = new StringBuilder("<table class=\"miss\">");
        for (QuestionRow q : rows) {
            long pc = Math.round(q.classCorrectPercent());
            s.append("<tr><td class=\"miss-l\"><div class=\"miss-t\">").append(esc(questionTitle(m, q, 60))).append("</div>")
                    .append("<div class=\"miss-s\" style=\"color:").append(OK).append("\">You got it right</div></td>")
                    .append("<td class=\"miss-r\"><div class=\"bar\"><div class=\"bar-f\" style=\"width:").append(Math.max(3, pc))
                    .append("%;background:").append(p.brand).append("\"></div></div><div class=\"miss-p\">only ").append(pc)
                    .append("% of class right</div></td></tr>");
        }
        s.append("</table>");
        String head = rows.size() == 1 ? "You got one right that most of the class missed"
                : "You got " + rows.size() + " right that most of the class missed";
        return block("Your expertise", head, "Questions 30% or fewer of your classmates answered correctly, and you did.", s.toString());
    }

    private String potentialBlock(AiReportModel m, ReportPalette p) {
        AiReportModel.Potential pot = m.getPotential();
        if (pot == null) return "";
        StringBuilder s = new StringBuilder("<table class=\"tiles pot\"><tr>");
        s.append(potTile("Score", num(m.getScore()), num(pot.score()), p));
        if (pot.rank() != null && m.getRank() != null && m.hasClass() && m.getParticipants() >= 5) {
            s.append(potTile("Rank", "#" + m.getRank(), "#" + pot.rank(), p));
        }
        if (pot.percentile() != null && m.getPercentile() != null && m.hasClass() && m.getParticipants() >= 5) {
            s.append(potTile("Better than", Math.round(m.getPercentile()) + "%", Math.round(pot.percentile()) + "%", p));
        }
        s.append("</tr></table>");
        String n = pot.skippedConsidered() == 1 ? "the 1 question" : "the " + pot.skippedConsidered() + " questions";
        return block("Your potential", "Attempting " + n + " you skipped could have taken you to " + num(pot.score()),
                "If you had answered them as well as the class did on each one.", s.toString());
    }

    private String potTile(String label, String from, String to, ReportPalette p) {
        return "<td class=\"tile\" style=\"background:" + p.brand50 + "\"><div class=\"tile-l\">" + esc(label) + "</div>"
                + "<div class=\"tile-v\"><span style=\"color:" + MUTED + "\">" + esc(from) + "</span>"
                + "<span style=\"color:" + MUTED + ";font-size:18px\"> &#8594; </span>"
                + "<span style=\"color:" + p.brandInk + "\">" + esc(to) + "</span></div></td>";
    }

    // ── Question by question ──

    private String questionByQuestion(AiReportModel m, ReportPalette p) {
        if (m.getDetails() == null || m.getDetails().isEmpty() || m.getQuestions().isEmpty()) return "";
        StringBuilder s = new StringBuilder();
        s.append("<div class=\"tag\">Question by question</div><div class=\"h3\">All ").append(m.getQuestions().size())
                .append(" questions, with your answers</div><div class=\"lede\">What you answered, the right answer where you missed it, ")
                .append(m.hasClass() ? "how the class did, " : "").append("and the explanation.</div>");
        String currentSection = null;
        for (QuestionRow q : m.getQuestions()) {
            if (m.getSections().size() > 1 && !q.sectionId().equals(currentSection)) {
                currentSection = q.sectionId();
                s.append("<div class=\"qsec\"><span class=\"sw\" style=\"background:").append(section(q.sectionIndex())).append("\"></span> ")
                        .append(esc(q.sectionName())).append("</div>");
            }
            s.append(questionCard(m, p, q, m.getDetails().get(AiReportDataService.key(q.questionId(), q.sectionId()))));
        }
        return s.toString();
    }

    private String questionCard(AiReportModel m, ReportPalette p, QuestionRow q, AiReportModel.QuestionDetail d) {
        String[] status = switch (q.outcome()) {
            case CORRECT -> new String[]{"Correct", OK, OK_50};
            case PARTIAL -> new String[]{"Partly right", AMBER, AMBER_50};
            case WRONG -> new String[]{"Wrong", BAD, BAD_50};
            case PENDING -> new String[]{"Being checked", MUTED, WAIT_50};
            case SKIPPED -> new String[]{"Skipped", MUTED, WAIT_50};
        };
        StringBuilder s = new StringBuilder("<table class=\"qc\">");
        String type = d == null ? "" : vacademy.io.assessment_service.features.assessment.service.HtmlBuilderService.formatQuestionType(d.type());
        s.append("<tr><td class=\"qc-h\"><table class=\"qc-ht\"><tr><td><span class=\"qc-n\">Q").append(q.numberInSection()).append("</span>");
        if (!type.isBlank()) s.append(" <span class=\"qc-type\">").append(esc(type)).append("</span>");
        s.append("</td><td style=\"text-align:right\"><span class=\"qc-st\" style=\"background:").append(status[2]).append(";color:")
                .append(status[1]).append("\">").append(status[0]).append("</span></td></tr></table></td></tr>");
        if (d != null && notBlank(d.text())) s.append("<tr><td class=\"qc-t\">").append(esc(d.text())).append("</td></tr>");

        String yours = d == null ? null : d.yourAnswer();
        String right = d == null ? null : d.correctAnswer();
        boolean showRight = right != null && q.outcome() != Outcome.CORRECT;
        s.append("<tr><td class=\"qc-a\"><table class=\"qc-at\"><tr>");
        s.append("<td class=\"qc-you\" style=\"background:").append(q.outcome() == Outcome.CORRECT ? OK_50 : q.outcome() == Outcome.WRONG ? BAD_50 : SOFT)
                .append("\"><div class=\"lbl\" style=\"color:").append(status[1]).append("\">Your answer</div>")
                .append(esc(yours != null ? yours : q.outcome() == Outcome.SKIPPED ? "Not attempted" : "-")).append("</td>");
        if (showRight) {
            s.append("<td class=\"qc-right\"><div class=\"lbl\" style=\"color:").append(OK).append("\">Right answer</div>")
                    .append(esc(right)).append("</td>");
        }
        s.append("</tr></table></td></tr>");

        if (d != null && notBlank(d.feedback())) {
            s.append("<tr><td class=\"qc-f\"><b>Feedback:</b> ").append(esc(d.feedback())).append("</td></tr>");
        }
        if (d != null && d.criteria() != null && !d.criteria().isEmpty()) {
            s.append("<tr><td class=\"qc-f\"><b>How it was marked</b>");
            for (AiReportModel.Criterion c : d.criteria()) {
                s.append("<div>").append(esc(c.name())).append(" (").append(esc(c.marks())).append(" marks)")
                        .append(notBlank(c.reason()) ? ": " + esc(c.reason()) : "").append("</div>");
            }
            s.append("</td></tr>");
        }

        List<String> meta = new ArrayList<>();
        meta.add((q.marks() > 0 ? "+" : "") + num(q.marks()) + " of " + num(q.max()) + (q.max() == 1 ? " mark" : " marks"));
        if (q.timeSeconds() != null && q.timeSeconds() > 0) meta.add(q.timeSeconds() + " s");
        if (m.hasClass() && q.classCorrectPercent() != null) meta.add(Math.round(q.classCorrectPercent()) + "% of class right");
        if (m.hasClass() && q.classAverageTimeSeconds() != null) meta.add("class average " + Math.round(q.classAverageTimeSeconds()) + " s");
        s.append("<tr><td class=\"qc-m\">").append(esc(String.join("  ·  ", meta))).append("</td></tr>");

        if (d != null && notBlank(d.explanation())) {
            s.append("<tr><td class=\"qc-x\"><b style=\"color:").append(p.brandInk).append("\">Explanation:</b> ").append(esc(d.explanation())).append("</td></tr>");
        }
        return s.append("</table>").toString();
    }

    private String questionTitle(AiReportModel m, QuestionRow q, int max) {
        return (m.getSections().size() > 1 ? q.sectionName() + " " : "Question ") + q.numberInSection()
                + (notBlank(q.shortText()) ? " · " + clip(q.shortText(), max) : "");
    }

    // ── Page 5: fix and plan ──

    private String fixBlock(JsonNode ai, ReportPalette p) {
        JsonNode items = ai.path("misconception_analysis");
        if (!items.isArray() || items.isEmpty()) return "";
        StringBuilder s = new StringBuilder();
        int n = 0;
        for (JsonNode it : items) {
            if (n++ >= 3) break;
            s.append("<table class=\"fix\"><tr><td colspan=\"2\" class=\"fix-h\">").append(esc(clip(text(it, "question_summary"), 140))).append("</td></tr>")
                    .append("<tr><td class=\"fix-you\"><div class=\"lbl\" style=\"color:").append(BAD).append("\">You answered</div>")
                    .append(esc(clip(text(it, "student_answer"), 160))).append("</td>")
                    .append("<td class=\"fix-right\"><div class=\"lbl\" style=\"color:").append(OK).append("\">Right answer</div>")
                    .append(esc(clip(text(it, "correct_answer"), 160))).append("</td></tr>")
                    .append("<tr><td colspan=\"2\" class=\"fix-w\">").append(esc(plain(text(it, "misconception"), 360)));
            String fix = plain(text(it, "remediation"), 240);
            if (!fix.isEmpty()) s.append("<div class=\"fix-try\" style=\"color:").append(p.brandInk).append("\"><b>Try this:</b> ").append(esc(fix)).append("</div>");
            s.append("</td></tr></table>");
        }
        int count = Math.min(3, items.size());
        return block("Mistakes explained", count == 1 ? "1 thing to fix" : count + " things to fix", null, s.toString());
    }

    private String planBlock(JsonNode ai, ReportPalette p) {
        JsonNode steps = ai.path("recommended_learning_path");
        if (!steps.isArray() || steps.isEmpty()) return "";
        StringBuilder s = new StringBuilder("<table class=\"plan\">");
        int minutes = 0, n = 0;
        for (JsonNode st : steps) {
            if (n++ >= 5) break;
            String time = text(st, "estimated_time");
            minutes += firstNumber(time);
            s.append("<tr><td class=\"plan-box\"><div class=\"box\" style=\"border-color:").append(p.brand).append("\"></div></td><td class=\"plan-t\"><div class=\"plan-h\">")
                    .append(esc(clip(text(st, "topic"), 80))).append("</div><div class=\"plan-s\">").append(esc(plain(text(st, "suggestion"), 260)))
                    .append("</div></td><td class=\"plan-time\">");
            if (!time.isBlank()) s.append("<span class=\"pill\">").append(esc(shortTime(time))).append("</span>");
            s.append("</td></tr>");
        }
        s.append("</table>");
        String head = minutes >= 20 ? "About " + hoursLabel(minutes) + " to win back the lost marks" : "Your plan for this week";
        return block("This week's plan", head, "Tick each step when it's done.", s.toString());
    }

    private String cardsAndProgress(AiReportModel m, ReportPalette p, JsonNode ai) {
        JsonNode cards = ai.path("flashcards");
        boolean hasCards = cards.isArray() && !cards.isEmpty();
        boolean hasHistory = m.getHistory() != null && m.getHistory().size() >= 2;
        if (!hasCards && !hasHistory) return "";
        String cardsHtml = hasCards ? flashcards(cards, p, hasHistory ? 2 : 4, hasHistory ? 1 : 2) : "";
        String progressHtml = "";
        if (hasHistory) {
            List<AiReportModel.HistoryPoint> h = m.getHistory();
            double first = h.get(0).percent(), last = h.get(h.size() - 1).percent();
            String head = last >= first + 5 ? "Your scores are rising" : last <= first - 5 ? "Lower than your earlier tests" : "Holding steady";
            progressHtml = titled("Progress", head, "Your score as a percentage in your last " + h.size() + " tests here.",
                    progress(h, p, hasCards ? HALF_W : CONTENT_W));
        }
        if (hasCards && hasHistory) {
            return "<table class=\"cols\"><tr><td class=\"col\">" + titled("Flashcards", "Cut, fold, test yourself", null, cardsHtml)
                    + "</td><td class=\"col-gap\"></td><td class=\"col\">" + progressHtml + "</td></tr></table>";
        }
        return hasCards ? block("Flashcards", "Cut, fold, test yourself", null, cardsHtml) : "<div class=\"block\">" + progressHtml + "</div>";
    }

    private String flashcards(JsonNode cards, ReportPalette p, int max, int perRow) {
        StringBuilder s = new StringBuilder("<table class=\"cards\">");
        int i = 0;
        for (JsonNode c : cards) {
            if (i >= max) break;
            if (i % perRow == 0) s.append("<tr>");
            s.append("<td class=\"card-cell\"><div class=\"card\" style=\"border-color:").append(p.brand).append("\"><div class=\"card-f\" style=\"background:")
                    .append(p.brand50).append("\">").append(esc(clip(text(c, "front"), 120))).append("</div>")
                    .append("<div class=\"fold\" style=\"border-top-color:").append(p.brand).append("\"><span class=\"fold-t\">Fold</span></div>")
                    .append("<div class=\"card-b\">").append(esc(clip(text(c, "back"), 200))).append("</div></div></td>");
            i++;
            if (i % perRow == 0) s.append("</tr>");
        }
        if (i % perRow != 0) {
            for (int k = i % perRow; k < perRow; k++) s.append("<td class=\"card-cell\"></td>");
            s.append("</tr>");
        }
        return s.append("</table>").toString();
    }

    /** Rough rendered heights (px) so the fix and plan blocks only share a page when they fit. */
    private static int estimateFix(JsonNode ai) {
        JsonNode items = ai.path("misconception_analysis");
        if (!items.isArray() || items.isEmpty()) return 0;
        int h = 60, n = 0;
        for (JsonNode it : items) {
            if (n++ >= 3) break;
            h += 40 + (text(it, "question_summary").length() > 75 ? 20 : 0)
                    + 46 + 18 * Math.max(0, lines(Math.max(text(it, "student_answer").length(), text(it, "correct_answer").length()), 50) - 1)
                    + 20 * lines(Math.min(360, text(it, "misconception").length()), 110)
                    + 20 * lines(Math.min(240, text(it, "remediation").length()), 110) + 22;
        }
        return h;
    }

    private static int estimatePlan(JsonNode ai) {
        JsonNode steps = ai.path("recommended_learning_path");
        if (!steps.isArray() || steps.isEmpty()) return 0;
        int h = 70, n = 0;
        for (JsonNode st : steps) {
            if (n++ >= 5) break;
            h += 50 + 17 * Math.max(0, lines(Math.min(260, text(st, "suggestion").length()), 95) - 1) + 8;
        }
        return h;
    }

    private static int lines(int chars, int perLine) {
        return Math.max(1, (chars + perLine - 1) / perLine);
    }

    // ── Building blocks ──

    private String page(AiReportModel m, ReportPalette p, boolean first, String content) {
        if (content.isBlank()) return "";
        return band(m, p, first) + "<div class=\"body\">" + content + "</div>";
    }

    private static void addIfAny(List<String> pages, String page) {
        if (page != null && !page.isBlank()) pages.add(page);
    }

    private static String blocks(String... parts) {
        StringBuilder s = new StringBuilder();
        for (String part : parts) if (part != null && !part.isBlank()) s.append(part);
        return s.toString();
    }

    private String block(String tag, String head, String lede, String body) {
        return "<div class=\"block\">" + titled(tag, head, lede, body) + "</div>";
    }

    private String titled(String tag, String head, String lede, String body) {
        return "<div class=\"tag\">" + esc(tag) + "</div><div class=\"h3\">" + esc(head) + "</div>"
                + (lede == null ? "" : "<div class=\"lede\">" + esc(lede) + "</div>") + body;
    }

    private String half(String tag, String head, String body, String caption) {
        return titled(tag, head, null, body) + (caption == null || caption.isEmpty() ? "" : "<div class=\"cap\">" + esc(caption) + "</div>");
    }

    private String legend(ReportPalette p, boolean klass, boolean negative) {
        StringBuilder s = new StringBuilder("<div class=\"legend\">");
        s.append(key(p.brand, "You"));
        if (klass) s.append("<span class=\"key\"><span class=\"tick\" style=\"background:").append(INK).append("\"></span> Class average</span>");
        if (negative) s.append(key(BAD, "Below zero from negative marking"));
        return s.append("</div>").toString();
    }

    private String sectionLegend(List<SectionRow> secs) {
        StringBuilder s = new StringBuilder("<div class=\"legend\">");
        for (SectionRow r : secs) s.append(key(section(r.index()), clip(r.name(), 18)));
        return s.append("</div>").toString();
    }

    private String outcomeLegend(AiReportModel m) {
        StringBuilder s = new StringBuilder("<div class=\"legend\">").append(key(OK, "Correct"));
        if (m.count(Outcome.PARTIAL) > 0) s.append(key(AMBER, "Partly right"));
        s.append(key(BAD, "Wrong"));
        if (m.count(Outcome.SKIPPED) > 0) s.append(key("#c5ccd8", "Skipped"));
        if (m.count(Outcome.PENDING) > 0) s.append(key(WAIT, "Teacher is checking"));
        return s.append("</div>").toString();
    }

    private static String key(String color, String label) {
        return "<span class=\"key\"><span class=\"sw\" style=\"background:" + color + "\"></span> " + esc(label) + "</span>";
    }

    // ── CSS (iText subset: no flex/grid/rgba/var) ──

    private String css(AiReportModel m, ReportPalette p) {
        String footLeft = cssString((m.getInstituteName() == null ? "" : m.getInstituteName() + " · ") + displayName(m.getStudentName()));
        return "@page{size:A4;margin:0 0 30px 0;"
                + "@bottom-left{content:\"" + footLeft + "\";font-family:Mukta;font-size:9px;color:" + MUTED + ";padding-left:36px;vertical-align:top;}"
                + "@bottom-right{content:\"Page \" counter(page) \" of \" counter(pages);font-family:Mukta;font-size:9px;color:" + MUTED + ";padding-right:36px;vertical-align:top;}}"
                + "body{margin:0;font-family:Mukta,sans-serif;font-size:13px;line-height:1.45;color:" + INK + ";}"
                + ".break{page-break-before:always;}"
                + "table{border-collapse:collapse;}"
                + ".band{width:100%;background:" + p.brand + ";color:" + p.onBrand + ";}"
                + ".band td{padding:12px 0;vertical-align:middle;}"
                + ".band-logo{padding-left:36px !important;padding-right:0 !important;}"
                + ".logo-img{background:#ffffff;border-radius:9px;border-collapse:separate;}"
                + ".logo-img td{padding:5px 7px !important;line-height:0;}"
                + ".logo{width:40px;height:40px;background:#ffffff;border-radius:10px;text-align:center;line-height:40px;}"
                + ".logo img{vertical-align:middle;}"
                + ".logo-t{font-family:'Baloo 2';font-weight:800;font-size:16px;color:" + p.brandInk + ";}"
                + ".band-i1{font-family:'Baloo 2';font-weight:700;font-size:15px;line-height:1.1;}"
                + ".band-i2{font-size:11.5px;line-height:1.3;}"
                + ".band-right{text-align:right;padding-right:36px !important;}"
                + ".band-r1{font-family:'Baloo 2';font-weight:700;font-size:15px;line-height:1.1;}"
                + ".band-r2{font-size:11.5px;line-height:1.3;}"
                + ".hero{background:" + p.brand + ";color:" + p.onBrand + ";padding:2px 36px 22px 36px;border-top:1px solid " + p.brandDeep + ";}"
                + ".hero-t{width:100%;}"
                + ".hero-l{vertical-align:bottom;padding-right:20px;}"
                + ".hero-r{vertical-align:bottom;text-align:right;width:230px;}"
                + ".kicker{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:bold;margin-top:12px;}"
                + ".h1{font-family:'Baloo 2';font-weight:800;font-size:38px;line-height:1.02;margin:4px 0 8px 0;}"
                + ".hero-p{font-size:14px;line-height:1.4;}"
                + ".big{font-family:'Baloo 2';font-weight:800;font-size:96px;line-height:0.95;}"
                + ".big-of{font-size:30px;font-weight:700;}"
                + ".big-sub{font-family:'Baloo 2';font-weight:700;font-size:16px;line-height:1.2;}"
                + ".pct-top{width:100%;margin-top:16px;font-size:12.5px;}"
                + ".pct-top b{font-family:'Baloo 2';font-weight:800;font-size:16px;}"
                + ".pct-track{height:14px;background:" + p.brandDeep + ";border-radius:7px;margin-top:4px;}"
                + ".pct-fill{height:14px;background:" + p.accent + ";border-radius:7px;}"
                + ".tiles{width:100%;border-collapse:separate;border-spacing:8px 0;margin:16px -8px 0 -8px;table-layout:fixed;}"
                + ".tile{background:#ffffff;border-radius:12px;padding:9px 12px;vertical-align:top;}"
                + ".tile-v{font-family:'Baloo 2';font-weight:800;font-size:26px;line-height:1.05;}"
                + ".tile-l{font-size:11.5px;color:" + MUTED + ";line-height:1.3;}"
                + ".body{padding:20px 36px 0 36px;}"
                + ".block{margin-bottom:22px;page-break-inside:avoid;}"
                + ".tag{display:inline-block;font-weight:bold;font-size:9.5px;letter-spacing:1.2px;text-transform:uppercase;color:" + p.brandInk
                + ";background:" + p.brand50 + ";padding:4px 8px;border-radius:5px;}"
                + ".h3{font-family:'Baloo 2';font-weight:800;font-size:21px;line-height:1.12;margin:6px 0 2px 0;color:" + INK + ";}"
                + ".lede{color:" + MUTED + ";font-size:12px;margin:0 0 8px 0;}"
                + ".cap{color:" + MUTED + ";font-size:11px;line-height:1.4;margin-top:6px;}"
                + ".legend{font-size:11.5px;color:" + MUTED + ";margin:2px 0 6px 0;}"
                + ".key{margin-right:14px;}"
                + ".sw{display:inline-block;width:10px;height:10px;border-radius:3px;}"
                + ".tick{display:inline-block;width:3px;height:11px;}"
                + ".note{width:100%;background:" + p.brand50 + ";border-radius:14px;margin-bottom:22px;}"
                + ".note td{padding:14px 16px 14px 0;vertical-align:top;}"
                + ".note-q{width:56px;padding-left:16px !important;}"
                + ".quote{width:40px;height:40px;border-radius:20px;background:" + p.brand + ";color:" + p.onBrand
                + ";text-align:center;font-family:'Baloo 2';font-weight:800;font-size:30px;line-height:48px;}"
                + ".note-l{font-weight:bold;font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;color:" + p.brandInk + ";}"
                + ".note-t{font-size:13.5px;line-height:1.5;margin-top:3px;}"
                + ".amap{width:100%;}"
                + ".amap td{vertical-align:top;padding:3px 0;}"
                + ".amap-l{width:110px;font-family:'Baloo 2';font-weight:700;font-size:13px;padding-top:9px !important;}"
                + ".cell{display:inline-block;width:34px;margin:0 4px 4px 0;border-radius:8px;border:2px solid #ffffff;text-align:center;color:#ffffff;padding:2px 0 1px 0;}"
                + ".cell-n{font-family:'Baloo 2';font-weight:700;font-size:12.5px;line-height:1.1;}"
                + ".cell-t{font-size:8.5px;line-height:1.2;}"
                + ".cols{width:100%;table-layout:fixed;}"
                + ".col{vertical-align:top;width:" + HALF_W + "px;padding-bottom:20px;page-break-inside:avoid;}"
                + ".col-gap{width:42px;}"
                + ".colh{font-family:'Baloo 2';font-weight:700;font-size:14px;margin:4px 0 6px 0;}"
                + ".badge{font-family:Mukta;font-weight:bold;font-size:9px;letter-spacing:0.6px;text-transform:uppercase;padding:2px 6px;border-radius:4px;background:"
                + p.accent + ";color:" + p.onAccent + ";}"
                + ".trow{width:100%;margin-top:6px;}"
                + ".tname{font-weight:bold;font-size:12.5px;}"
                + ".tmeta{text-align:right;font-size:11.5px;color:" + MUTED + ";white-space:nowrap;}"
                + ".pip{display:inline-block;width:10px;height:5px;border-radius:2px;margin-left:2px;}"
                + ".bar{height:10px;background:" + SOFT + ";border-radius:5px;margin-top:3px;}"
                + ".bar-f{height:10px;border-radius:5px;}"
                + ".quad{width:100%;border-collapse:separate;border-spacing:6px;margin:0 -6px;table-layout:fixed;}"
                + ".qd{border-radius:12px;padding:9px 12px;vertical-align:top;}"
                + ".qd-n{font-family:'Baloo 2';font-weight:800;font-size:28px;line-height:1;}"
                + ".qd-t{font-family:'Baloo 2';font-weight:700;font-size:13.5px;line-height:1.2;margin-top:3px;}"
                + ".qd-s{font-size:11px;}"
                + ".miss{width:100%;}"
                + ".miss td{padding:6px 0;vertical-align:middle;}"
                + ".miss-l{padding-right:16px !important;}"
                + ".miss-t{font-weight:bold;font-size:12.5px;line-height:1.3;}"
                + ".miss-s{color:" + MUTED + ";font-size:11.5px;}"
                + ".miss-r{width:150px;}"
                + ".miss-p{font-size:11px;color:" + MUTED + ";text-align:right;margin-top:2px;}"
                + ".fix{width:100%;margin-bottom:12px;border:1.5px solid " + LINE + ";page-break-inside:avoid;}"
                + ".fix-h{background:" + INK + ";color:#ffffff;font-family:'Baloo 2';font-weight:700;font-size:14.5px;line-height:1.25;padding:10px 14px;}"
                + ".fix-you{background:" + BAD_50 + ";padding:9px 14px;width:50%;vertical-align:top;font-size:12.5px;}"
                + ".fix-right{background:" + OK_50 + ";padding:9px 14px;width:50%;vertical-align:top;font-size:12.5px;}"
                + ".lbl{font-size:9.5px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;}"
                + ".fix-w{padding:9px 14px 11px 14px;font-size:12.5px;line-height:1.45;}"
                + ".fix-try{margin-top:4px;}"
                + ".plan{width:100%;border-collapse:separate;border-spacing:0 8px;}"
                + ".plan td{background:" + SOFT + ";vertical-align:top;padding:11px 0;}"
                + ".plan-box{width:44px;padding-left:14px !important;border-radius:12px 0 0 12px;}"
                + ".box{width:18px;height:18px;border:2.5px solid;border-radius:5px;margin-top:2px;}"
                + ".plan-h{font-family:'Baloo 2';font-weight:700;font-size:14.5px;line-height:1.25;}"
                + ".plan-s{font-size:12px;color:" + MUTED + ";line-height:1.4;}"
                + ".plan-time{width:96px;text-align:right;padding-right:14px !important;border-radius:0 12px 12px 0;}"
                + ".pill{display:inline-block;background:" + p.brand + ";color:" + p.onBrand + ";font-weight:bold;font-size:11px;padding:4px 9px;border-radius:10px;}"
                + ".cards{width:100%;border-collapse:separate;border-spacing:0 10px;}"
                + ".card-cell{vertical-align:top;padding-right:10px;}"
                + ".card{border:2px dashed;border-radius:12px;}"
                + ".card-f{padding:10px 12px;font-family:'Baloo 2';font-weight:700;font-size:13.5px;line-height:1.3;border-radius:10px 10px 0 0;}"
                + ".fold{border-top:2px dashed;text-align:right;height:0;}"
                + ".fold-t{position:relative;top:-8px;margin-right:10px;background:" + p.accent + ";color:" + p.onAccent
                + ";font-weight:bold;font-size:8px;letter-spacing:1px;text-transform:uppercase;padding:1px 6px;border-radius:3px;}"
                + ".card-b{padding:8px 12px 10px 12px;font-size:12px;color:" + MUTED + ";}"
                + ".insight{font-size:12.5px;margin-bottom:6px;}"
                + ".pot{margin:4px -8px 0 -8px;}"
                + ".qsec{font-family:'Baloo 2';font-weight:800;font-size:16px;margin:16px 0 6px 0;}"
                + ".qc{width:100%;border:1.5px solid " + LINE + ";margin-bottom:10px;page-break-inside:avoid;}"
                + ".qc td{padding:0 12px;}"
                + ".qc-h{background:" + SOFT + ";padding:7px 12px !important;}"
                + ".qc-ht{width:100%;}"
                + ".qc-ht td{padding:0 !important;vertical-align:middle;}"
                + ".qc-n{font-family:'Baloo 2';font-weight:800;font-size:15px;}"
                + ".qc-type{font-size:10.5px;color:" + MUTED + ";text-transform:uppercase;letter-spacing:0.8px;}"
                + ".qc-st{font-weight:bold;font-size:10.5px;padding:3px 9px;border-radius:9px;}"
                + ".qc-t{font-size:12.5px;line-height:1.45;padding-top:8px !important;padding-bottom:6px !important;}"
                + ".qc-a{padding-bottom:6px !important;}"
                + ".qc-at{width:100%;border-collapse:separate;border-spacing:0;}"
                + ".qc-you{padding:7px 10px;font-size:12px;vertical-align:top;}"
                + ".qc-right{padding:7px 10px;font-size:12px;vertical-align:top;background:" + OK_50 + ";}"
                + ".qc-f{font-size:11.5px;color:" + INK + ";padding-bottom:5px !important;}"
                + ".qc-m{font-size:11px;color:" + MUTED + ";padding-bottom:7px !important;}"
                + ".qc-x{font-size:11.5px;line-height:1.45;color:" + INK + ";background:" + p.brand50 + ";padding:7px 12px !important;}";
    }

    // ── Text helpers ──

    static String text(JsonNode node, String field) {
        if (node == null) return "";
        JsonNode v = node.path(field);
        return v.isMissingNode() || v.isNull() ? "" : v.asText("");
    }

    /** Markdown-ish AI text to one plain paragraph, cut at a sentence near {@code max}. */
    static String plain(String md, int max) {
        if (md == null || md.isBlank()) return "";
        String t = md.replaceAll("(?m)^#{1,6}\\s*", "")
                .replaceAll("\\*\\*(.+?)\\*\\*", "$1").replaceAll("(?<![\\w*])\\*(?!\\s)(.+?)\\*", "$1")
                .replaceAll("(?m)^\\s*(?:[-•*]|\\d+\\.)\\s+", "")
                .replace("\\n", " ").replaceAll("\\s+", " ").trim();
        if (t.length() <= max) return t;
        int cut = t.lastIndexOf(". ", max);
        return cut > max / 2 ? t.substring(0, cut + 1) : t.substring(0, max).trim() + "…";
    }

    static String displayName(String name) {
        if (name == null || name.isBlank()) return "Student";
        String n = name.trim();
        if (n.contains("@")) n = n.substring(0, n.indexOf('@'));
        if (n.length() > 3 && n.equals(n.toUpperCase(Locale.ROOT)) && n.matches(".*[A-Z].*")) {
            StringBuilder b = new StringBuilder();
            for (String w : n.toLowerCase(Locale.ROOT).split("\\s+")) {
                if (w.isEmpty()) continue;
                if (b.length() > 0) b.append(' ');
                b.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
            }
            n = b.toString();
        }
        return n;
    }

    static String firstName(String name) {
        String d = displayName(name);
        String first = d.split("\\s+")[0];
        return first.length() >= 2 ? first : d;
    }

    static String possessive(String name) {
        return name.endsWith("s") ? name + "'" : name + "'s";
    }

    private static String initials(String inst) {
        if (inst == null || inst.isBlank()) return "";
        StringBuilder b = new StringBuilder();
        for (String w : inst.trim().split("\\s+")) {
            if (!w.isEmpty() && Character.isLetterOrDigit(w.charAt(0))) b.append(Character.toUpperCase(w.charAt(0)));
            if (b.length() == 2) break;
        }
        return b.toString();
    }

    private static String date(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("d MMM yyyy", Locale.ENGLISH);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        return f.format(d);
    }

    static String mmss(long seconds) {
        return (seconds / 60) + ":" + String.format("%02d", seconds % 60);
    }

    private static String halfMinutes(double minutes) {
        double r = Math.round(minutes * 2) / 2.0;
        long whole = (long) Math.floor(r);
        String s = (r - whole) > 0 ? (whole == 0 ? "½" : whole + "½") : String.valueOf(whole);
        return s + (r == 1 ? " minute" : " minutes");
    }

    private static String hoursLabel(int minutes) {
        if (minutes < 75) return minutes + " minutes";
        double h = Math.round(minutes / 30.0) / 2.0;
        return (h == Math.floor(h) ? String.valueOf((long) h) : String.valueOf(h).replace(".5", "½")) + " hours";
    }

    private static final Pattern NUMBER = Pattern.compile("(\\d+)");

    private static int firstNumber(String s) {
        if (s == null) return 0;
        Matcher m = NUMBER.matcher(s);
        if (!m.find()) return 0;
        int v = Integer.parseInt(m.group(1));
        return s.toLowerCase(Locale.ROOT).contains("hour") ? v * 60 : v;
    }

    private static String shortTime(String s) {
        int min = firstNumber(s);
        return min > 0 ? (min >= 60 && min % 60 == 0 ? (min / 60) + " hr" : min + " min") : clip(s, 12);
    }

    /** "−0.5" when every wrong answer lost the same amount; null otherwise. */
    private static String uniformPenalty(AiReportModel m) {
        Set<Double> losses = new HashSet<>();
        for (QuestionRow q : m.getQuestions()) if (q.outcome() == Outcome.WRONG && q.marks() < 0) losses.add(q.marks());
        return losses.size() == 1 ? num(losses.iterator().next()) : null;
    }

    private static String[] quarterLabels(List<QuestionRow> qs) {
        int n = (int) qs.stream().filter(q -> q.outcome() != Outcome.PENDING).count();
        String[] out = new String[4];
        for (int k = 0; k < 4; k++) out[k] = "Q" + (n * k / 4 + 1) + "–" + (n * (k + 1) / 4);
        return out;
    }

    private static String joinAnd(List<String> items) {
        if (items.size() == 1) return items.get(0);
        return String.join(", ", items.subList(0, items.size() - 1)) + " and " + items.get(items.size() - 1);
    }

    private static String words(long n) {
        String[] w = {"Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"};
        return n < w.length ? w[(int) n] : String.valueOf(n);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    /**
     * HTML-escapes text and wraps symbols the body fonts lack (Greek, arrows, maths, primes,
     * geometric shapes) in Noto Sans Math. Without this iText switches the whole rest of the
     * run to whichever font has the symbol, e.g. Baloo 2 Bold after a "→".
     */
    static String esc(String text) {
        if (text == null || text.isEmpty()) return "";
        StringBuilder out = new StringBuilder(text.length() + 16);
        boolean inSym = false;
        for (int i = 0; i < text.length(); ) {
            int cp = text.codePointAt(i);
            i += Character.charCount(cp);
            boolean sym = isSymbol(cp);
            if (sym && !inSym) { out.append("<span style=\"font-family:'Noto Sans Math'\">"); inSym = true; }
            if (!sym && inSym) { out.append("</span>"); inSym = false; }
            switch (cp) {
                case '&' -> out.append("&amp;");
                case '<' -> out.append("&lt;");
                case '>' -> out.append("&gt;");
                case '"' -> out.append("&quot;");
                default -> out.appendCodePoint(cp);
            }
        }
        if (inSym) out.append("</span>");
        return out.toString();
    }

    static boolean isSymbol(int cp) {
        return (cp >= 0x0370 && cp <= 0x03FF)      // Greek
                || (cp >= 0x2032 && cp <= 0x2037)   // primes
                || (cp >= 0x2100 && cp <= 0x214F)   // letterlike
                || (cp >= 0x2190 && cp <= 0x22FF)   // arrows, maths operators
                || (cp >= 0x25A0 && cp <= 0x25FF)   // geometric shapes
                || (cp >= 0x27C0 && cp <= 0x27FF)   // maths symbols, long arrows
                || (cp >= 0x2900 && cp <= 0x2AFF);  // more arrows and operators
    }

    private static String cssString(String s) {
        return s.replace("\\", "").replace("\"", "'").replace("\n", " ");
    }
}
