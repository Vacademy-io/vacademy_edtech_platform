package vacademy.io.assessment_service.features.assessment.service.aireport;

import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.HistoryPoint;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionRow;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.SectionRow;

import java.text.SimpleDateFormat;
import java.util.*;

import static vacademy.io.assessment_service.features.assessment.service.aireport.ReportPalette.*;

/**
 * Inline SVG charts for the student AI report. iText's SVG renderer handles rect, line,
 * polyline, polygon, path, circle and text (with text-anchor) — nothing fancier is used.
 * Every chart takes plain numbers and draws to one scale; nothing here does I/O.
 */
final class AiReportCharts {

    private AiReportCharts() {
    }

    static final String BODY_FONT = "Mukta";
    static final String DISPLAY_FONT = "Baloo 2";

    // ── Marks by section ──

    static String sectionScorecard(List<SectionRow> rows, ReportPalette p, int w) {
        int rowH = 44, top = 8;
        int h = top + rows.size() * rowH + 30;
        double nameW = 150, rightW = 132;
        double trackX = nameW, trackW = w - nameW - rightW;

        double minPct = 0;
        for (SectionRow r : rows) minPct = Math.min(minPct, pct(r.score(), r.max()));
        if (minPct < 0) minPct = Math.max(-100, Math.floor(minPct / 25) * 25);
        final double lo = minPct;
        java.util.function.DoubleUnaryOperator x = v -> trackX + (Math.max(lo, Math.min(100, v)) - lo) / (100 - lo) * trackW;

        StringBuilder s = new StringBuilder();
        double gridBottom = top + rows.size() * rowH;
        s.append(line(x.applyAsDouble(0), top, x.applyAsDouble(0), gridBottom, LINE, 1.5, null));
        s.append(line(x.applyAsDouble(50), top, x.applyAsDouble(50), gridBottom, LINE, 1, "3 4"));
        s.append(line(x.applyAsDouble(100), top, x.applyAsDouble(100), gridBottom, LINE, 1, "3 4"));
        s.append(text(x.applyAsDouble(0), gridBottom + 18, "0", 12, 400, MUTED, "middle"));
        s.append(text(x.applyAsDouble(50), gridBottom + 18, "Half marks", 12, 400, MUTED, "middle"));
        s.append(text(x.applyAsDouble(100), gridBottom + 18, "Full marks", 12, 400, MUTED, "middle"));

        for (int i = 0; i < rows.size(); i++) {
            SectionRow r = rows.get(i);
            double cy = top + i * rowH + 22;
            double pc = pct(r.score(), r.max());
            s.append(circle(6, cy, 5, section(r.index())));
            s.append(text(18, cy + 5, clip(r.name(), 17), 14.5, 700, INK, "start"));
            s.append(rect(trackX, cy - 8, trackW, 16, 8, SOFT));
            if (pc >= 0) {
                double x0 = x.applyAsDouble(0), x1 = x.applyAsDouble(pc);
                if (x1 - x0 > 0.5) s.append(rect(x0, cy - 8, Math.max(8, x1 - x0), 16, 8, p.brand));
            } else {
                double x0 = x.applyAsDouble(pc), x1 = x.applyAsDouble(0);
                s.append(rect(x0, cy - 8, x1 - x0, 16, 8, BAD));
            }
            if (r.classAverage() != null && r.max() > 0) {
                double cx = x.applyAsDouble(pct(r.classAverage(), r.max()));
                s.append(rect(cx - 1.5, cy - 13, 3, 26, 0, INK));
            }
            double tx = trackX + trackW + 16;
            s.append(text(tx, cy + 1, num(r.score()) + " / " + num(r.max()), 15, 700, r.score() < 0 ? BAD : INK, "start"));
            if (r.classAverage() != null) {
                String sub = "class " + num1(r.classAverage()) + (r.classTop() != null ? " · top " + num(r.classTop()) : "");
                s.append(text(tx, cy + 17, sub, 11.5, 400, MUTED, "start"));
            }
        }
        return svg(w, h, s);
    }

    // ── Where you stand ──

    static String histogram(List<Double> scores, double student, double max, double avg, ReportPalette p, int w) {
        if (max <= 0 || scores == null || scores.isEmpty()) return "";
        boolean neg = scores.stream().anyMatch(v -> v < 0) || student < 0;
        int nb = 10 + (neg ? 1 : 0);
        int[] counts = new int[nb];
        for (double v : scores) counts[bucket(v, max, neg)]++;
        int mine = bucket(student, max, neg);

        int h = 250;
        double x0 = 36, x1 = w - 8, band = (x1 - x0) / nb, barW = band * 0.8, base = 196, maxBar = 136;
        int top = Arrays.stream(counts).max().orElse(1);
        StringBuilder s = new StringBuilder();
        s.append(line(x0 - 4, base, x1, base, LINE, 1.5, null));
        for (int i = 0; i < nb; i++) {
            double bh = counts[i] == 0 ? 0 : Math.max(3, counts[i] * maxBar / (double) top);
            double bx = x0 + i * band + (band - barW) / 2;
            boolean me = i == mine;
            if (bh > 0) s.append(rect(bx, base - bh, barW, bh, 4, me ? p.brand : p.brand100));
            s.append(text(bx + barW / 2, base - bh - 6, String.valueOf(counts[i]), 11.5, me ? 700 : 400, me ? p.brandInk : MUTED, "middle"));
            String label;
            if (neg && i == 0) label = "below 0";
            else {
                int k = neg ? i - 1 : i;
                label = num(max * k / 10.0) + "–" + num(max * (k + 1) / 10.0);
            }
            s.append(text(bx + barW / 2, base + 17, label, nb > 10 ? 10.5 : 11.5, me ? 700 : 400, me ? p.brandInk : MUTED, "middle"));
        }
        // Class average
        double region0 = x0 + (neg ? band : 0);
        double xa = region0 + Math.max(0, Math.min(1, avg / max)) * 10 * band;
        s.append(line(xa, 34, xa, base, INK, 1.5, "4 4"));
        boolean labelLeft = xa > w - 170;
        s.append(text(labelLeft ? xa - 6 : xa + 6, 46, "Class average " + num1(avg), 12.5, 400, INK, labelLeft ? "end" : "start"));
        // "You" pill above the student's bar
        double barTop = base - (counts[mine] == 0 ? 0 : Math.max(3, counts[mine] * maxBar / (double) top));
        double xc = x0 + mine * band + band / 2;
        double pillW = 96, pillY = Math.max(2, barTop - 50);
        double px = Math.max(0, Math.min(w - pillW, xc - pillW / 2));
        s.append(rect(px, pillY, pillW, 26, 13, p.brand));
        s.append(text(px + pillW / 2, pillY + 17.5, "You · " + num(student), 13.5, 700, p.onBrand, "middle"));
        s.append("<path d=\"M").append(f(xc - 6)).append(' ').append(f(pillY + 26)).append(" L").append(f(xc + 6)).append(' ')
                .append(f(pillY + 26)).append(" L").append(f(xc)).append(' ').append(f(pillY + 33)).append(" Z\" fill=\"").append(p.brand).append("\"/>");
        s.append(text(x0 - 4, h - 6, "Marks out of " + num(max) + " · students in each range", 12, 400, MUTED, "start"));
        return svg(w, h, s);
    }

    private static int bucket(double v, double max, boolean neg) {
        if (v < 0) return 0;
        int k = (int) Math.floor(v / max * 10);
        k = Math.max(0, Math.min(9, k));
        return neg ? k + 1 : k;
    }

    // ── Time by section ──

    static String timeBySection(List<SectionRow> rows, Integer limitMinutes, ReportPalette p, int w) {
        double you = rows.stream().mapToDouble(SectionRow::timeSeconds).sum();
        boolean hasClass = rows.stream().allMatch(r -> r.classAverageTimeSeconds() != null);
        double klass = hasClass ? rows.stream().mapToDouble(SectionRow::classAverageTimeSeconds).sum() : 0;
        double limit = limitMinutes != null ? limitMinutes * 60.0 : 0;
        double total = Math.max(limit, Math.max(you, klass));
        if (you <= 0 || total <= 0) return "";

        double x0 = 70, tw = w - x0 - 64;
        int h = hasClass ? 128 : 86;
        StringBuilder s = new StringBuilder();
        double[] ys = hasClass ? new double[]{18, 60} : new double[]{18};
        String[] names = hasClass ? new String[]{"You", "Class"} : new String[]{"You"};
        for (int row = 0; row < ys.length; row++) {
            double y = ys[row];
            s.append(text(0, y + 19, names[row], 14, 700, INK, "start"));
            s.append(rect(x0, y, tw, 28, 6, SOFT));
            double cx = x0;
            for (SectionRow r : rows) {
                double sec = row == 0 ? r.timeSeconds() : r.classAverageTimeSeconds();
                double sw = sec / total * tw;
                if (sw <= 0) continue;
                s.append(rect(cx, y, sw, 28, 0, section(r.index())));
                if (row == 0 && sw > 30) s.append(text(cx + sw / 2, y + 19, num1(sec / 60.0), 12.5, 700, PAPER, "middle"));
                cx += sw;
            }
            double sum = row == 0 ? you : klass;
            s.append(text(cx + 8, y + 19, Math.round(sum / 60.0) + " min", 13, 700, INK, "start"));
        }
        double axisY = ys[ys.length - 1] + 50;
        double totalMin = total / 60.0;
        double step = niceStep(totalMin / 3);
        for (double m = 0; m <= totalMin + 0.01; m += step) {
            double tx = x0 + m * 60 / total * tw;
            s.append(text(tx, axisY, (int) Math.round(m) + (m == 0 ? "" : " min"), 11.5, 400, MUTED, "middle"));
        }
        if (limit > 0) {
            double lx = x0 + limit / total * tw;
            s.append(line(lx, 12, lx, ys[ys.length - 1] + 34, INK, 2, null));
            s.append(text(lx, axisY + 16, limitMinutes + " min limit", 11.5, 700, INK, "end"));
        }
        return svg(w, h + 14, s);
    }

    private static double niceStep(double raw) {
        double[] steps = {1, 2, 5, 10, 15, 20, 30, 60, 90, 120};
        for (double st : steps) if (st >= raw) return st;
        return Math.ceil(raw / 60) * 60;
    }

    // ── Speed vs accuracy ──

    record Band(String label, int right, int total) {
        double percent() {
            return total == 0 ? 0 : 100.0 * right / total;
        }
    }

    static List<Band> speedBands(List<QuestionRow> qs) {
        String[] labels = {"under 10s", "10–30s", "31–60s", "over 60s"};
        int[] right = new int[4], total = new int[4];
        for (QuestionRow q : qs) {
            if (q.timeSeconds() == null || !q.answered() || q.outcome() == Outcome.PENDING) continue;
            long t = q.timeSeconds();
            int b = t < 10 ? 0 : t <= 30 ? 1 : t <= 60 ? 2 : 3;
            total[b]++;
            if (q.outcome() == Outcome.CORRECT) right[b]++;
        }
        List<Band> out = new ArrayList<>();
        for (int i = 0; i < 4; i++) out.add(new Band(labels[i], right[i], total[i]));
        return out;
    }

    static String speedAccuracy(List<Band> bands, ReportPalette p, int w) {
        int h = 222;
        double base = 170, top = 34, bw = (w - 40) / 4.0;
        StringBuilder s = new StringBuilder();
        s.append(line(16, base, w - 4, base, LINE, 1.5, null));
        s.append(line(16, top, w - 4, top, LINE, 1, "3 4"));
        s.append(text(16, top - 6, "100% right", 11, 400, MUTED, "start"));
        double best = bands.stream().filter(b -> b.total() > 0).mapToDouble(Band::percent).max().orElse(0);
        for (int i = 0; i < bands.size(); i++) {
            Band b = bands.get(i);
            double cx = 24 + i * bw + bw / 2;
            if (b.total() > 0) {
                double bh = Math.max(4, b.percent() / 100 * (base - top));
                String fill = b.percent() < 40 ? BAD : b.percent() >= best ? p.brand : p.brand100;
                s.append(rect(cx - 23, base - bh, 46, bh, 6, fill));
                boolean inside = bh > 30;
                String color = !inside ? (b.percent() < 40 ? BAD : p.brandInk) : fill.equals(p.brand) ? p.onBrand : fill.equals(BAD) ? PAPER : p.brandInk;
                s.append(textD(cx, inside ? base - bh + 22 : base - bh - 8, Math.round(b.percent()) + "%", 16, color));
            } else {
                s.append(text(cx, base - 8, "–", 14, 700, MUTED, "middle"));
            }
            s.append(text(cx, base + 18, b.label(), 11.5, 400, MUTED, "middle"));
            s.append(text(cx, base + 34, b.right() + " of " + b.total(), 11.5, 400, MUTED, "middle"));
        }
        return svg(w, h, s);
    }

    // ── Stamina through the paper ──

    static double[] quarterAccuracy(List<QuestionRow> qs) {
        List<QuestionRow> graded = qs.stream().filter(q -> q.outcome() != Outcome.PENDING).toList();
        if (graded.size() < 8) return null;
        double[] out = new double[4];
        for (int k = 0; k < 4; k++) {
            int from = graded.size() * k / 4, to = graded.size() * (k + 1) / 4;
            int right = 0;
            for (int i = from; i < to; i++) if (graded.get(i).outcome() == Outcome.CORRECT) right++;
            out[k] = to > from ? 100.0 * right / (to - from) : 0;
        }
        return out;
    }

    static String stamina(double[] acc, String[] labels, ReportPalette p, int w) {
        int h = 222;
        double base = 170, top = 34;
        double[] xs = new double[4];
        StringBuilder s = new StringBuilder();
        s.append(line(16, base, w - 4, base, LINE, 1.5, null));
        s.append(line(16, top, w - 4, top, LINE, 1, "3 4"));
        s.append(text(16, top - 6, "100% right", 11, 400, MUTED, "start"));
        StringBuilder pts = new StringBuilder();
        for (int i = 0; i < 4; i++) {
            xs[i] = 40 + i * (w - 80) / 3.0;
            double y = base - acc[i] / 100 * (base - top);
            pts.append(f(xs[i])).append(',').append(f(y)).append(' ');
        }
        String poly = pts.toString().trim();
        s.append("<polygon points=\"").append(poly).append(' ').append(f(xs[3])).append(',').append(f(base)).append(' ')
                .append(f(xs[0])).append(',').append(f(base)).append("\" fill=\"").append(p.brand50).append("\"/>");
        s.append("<polyline points=\"").append(poly).append("\" fill=\"none\" stroke=\"").append(p.brand)
                .append("\" stroke-width=\"4\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>");
        for (int i = 0; i < 4; i++) {
            double y = base - acc[i] / 100 * (base - top);
            s.append(circle(xs[i], y, 6, i == 3 ? p.brand : PAPER, p.brand, 3));
            boolean below = y < top + 14;
            s.append(textD(xs[i], below ? y + 24 : y - 12, Math.round(acc[i]) + "%", 13, INK));
            s.append(text(xs[i], base + 18, labels[i], 11.5, 400, MUTED, "middle"));
        }
        return svg(w, h, s);
    }

    // ── Negative marking ──

    static String waterfall(double earned, double lost, double score, Double withoutGuesses, int guesses,
                            ReportPalette p, int w) {
        int h = 222;
        double base = 180, maxV = Math.max(earned, 1), scale = 150 / maxV;
        double bw = 64, gap = (w - 3 * bw) / 4;
        double xa = gap, xb = gap * 2 + bw, xc = gap * 3 + bw * 2;
        StringBuilder s = new StringBuilder();
        s.append(line(8, base, w - 4, base, LINE, 1.5, null));
        double ha = earned * scale, hl = Math.abs(lost) * scale, hc = Math.max(0, score) * scale;
        s.append(rect(xa, base - ha, bw, ha, 6, OK));
        s.append(rect(xb, base - ha, bw, Math.max(3, hl), 3, BAD));
        if (hc > 0) s.append(rect(xc, base - hc, bw, hc, 6, p.brand));
        s.append(line(xa + bw, base - ha, xb, base - ha, MUTED, 1, "2 3"));
        s.append(line(xb + bw, base - ha + hl, xc, base - ha + hl, MUTED, 1, "2 3"));
        s.append(textD(xa + bw / 2, base - ha - 8, num(earned), 16, OK));
        s.append(textD(xb + bw / 2, base - ha - 8, "−" + num(Math.abs(lost)), 16, BAD));
        s.append(textD(xc + bw / 2, hc > 40 ? base - hc + 24 : base - hc - 8, num(score), 16, hc > 40 ? p.onBrand : INK));
        if (withoutGuesses != null && guesses > 0) {
            double yg = base - withoutGuesses * scale;
            s.append(line(xc - 6, yg, xc + bw + 6, yg, INK, 1.5, "4 3"));
            s.append(text(xc + bw + 10, yg + 4, num(withoutGuesses), 12.5, 700, INK, "start"));
        }
        s.append(text(xa + bw / 2, base + 18, "right answers", 11.5, 400, MUTED, "middle"));
        s.append(text(xb + bw / 2, base + 18, "wrong answers", 11.5, 400, MUTED, "middle"));
        s.append(text(xc + bw / 2, base + 18, "your score", 11.5, 400, MUTED, "middle"));
        return svg(w, h, s);
    }

    // ── Topic radar ──

    record TopicPoint(String name, double accuracy) {
    }

    /**
     * Accuracy per topic as a radar (3 to 10 topics). Labels sit outside the rings and wrap
     * onto two lines instead of being cut off, anchored by which side of the chart they are on.
     */
    static String topicRadar(List<TopicPoint> topics, ReportPalette p, int w) {
        int n = Math.min(10, topics.size());
        if (n < 3) return "";
        int h = 372;
        double cx = w / 2.0, cy = 180, r = 112;
        StringBuilder s = new StringBuilder();
        // rings at 25/50/75/100%
        for (int ring = 1; ring <= 4; ring++) {
            double rr = r * ring / 4.0;
            StringBuilder pts = new StringBuilder();
            for (int i = 0; i < n; i++) {
                double a = angle(i, n);
                pts.append(f(cx + rr * Math.cos(a))).append(',').append(f(cy + rr * Math.sin(a))).append(' ');
            }
            s.append("<polygon points=\"").append(pts.toString().trim()).append("\" fill=\"").append(ring == 4 ? SOFT : "none")
                    .append("\" stroke=\"").append(LINE).append("\" stroke-width=\"").append(ring == 4 ? "1.5" : "1").append("\"/>");
        }
        for (int i = 0; i < n; i++) {
            double a = angle(i, n);
            s.append(line(cx, cy, cx + r * Math.cos(a), cy + r * Math.sin(a), LINE, 1, null));
        }
        s.append(text(cx + 4, cy - r / 2 - 2, "50%", 9.5, 400, MUTED, "start"));
        // the student's shape
        StringBuilder pts = new StringBuilder();
        double[][] xy = new double[n][2];
        for (int i = 0; i < n; i++) {
            double a = angle(i, n), v = Math.max(0.04, Math.min(1, topics.get(i).accuracy() / 100.0));
            xy[i][0] = cx + r * v * Math.cos(a);
            xy[i][1] = cy + r * v * Math.sin(a);
            pts.append(f(xy[i][0])).append(',').append(f(xy[i][1])).append(' ');
        }
        s.append("<polygon points=\"").append(pts.toString().trim()).append("\" fill=\"").append(p.brand100)
                .append("\" stroke=\"").append(p.brand).append("\" stroke-width=\"2.5\" stroke-linejoin=\"round\"/>");
        for (int i = 0; i < n; i++) {
            double acc = topics.get(i).accuracy();
            s.append(circle(xy[i][0], xy[i][1], 4.5, acc < 40 ? BAD : acc < 75 ? AMBER : p.brand, PAPER, 1.5));
        }
        // labels
        for (int i = 0; i < n; i++) {
            double a = angle(i, n), lx = cx + (r + 16) * Math.cos(a), ly = cy + (r + 16) * Math.sin(a);
            double cos = Math.cos(a);
            String anchor = Math.abs(cos) < 0.25 ? "middle" : cos > 0 ? "start" : "end";
            List<String> lines = wrap(topics.get(i).name(), 22, 2);
            double sin = Math.sin(a);
            double y0 = sin < -0.5 ? ly - 14 * (lines.size()) + 4 : sin > 0.5 ? ly + 10 : ly - 7 * (lines.size() - 1) + 3;
            for (int k = 0; k < lines.size(); k++) {
                s.append(text(lx, y0 + k * 13, lines.get(k), 11.5, 600, INK, anchor));
            }
            double acc = topics.get(i).accuracy();
            s.append(text(lx, y0 + lines.size() * 13, Math.round(acc) + "%", 11.5, 700,
                    acc < 40 ? BAD : acc < 75 ? "#a8651a" : p.brandInk, anchor));
        }
        return svg(w, h, s);
    }

    private static double angle(int i, int n) {
        return -Math.PI / 2 + 2 * Math.PI * i / n;
    }

    /** Word-wraps into at most maxLines lines of about width chars; the last line gets an ellipsis if cut. */
    static List<String> wrap(String text, int width, int maxLines) {
        List<String> out = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        String[] words = (text == null ? "" : text.trim()).split("\\s+");
        int i = 0;
        for (; i < words.length; i++) {
            String w = words[i];
            if (line.length() > 0 && line.length() + 1 + w.length() > width) {
                out.add(line.toString());
                line = new StringBuilder();
                if (out.size() == maxLines) break;
            }
            if (line.length() > 0) line.append(' ');
            line.append(w);
        }
        if (out.size() < maxLines && line.length() > 0) out.add(line.toString());
        if (i < words.length || (out.size() == maxLines && out.get(maxLines - 1).length() > width)) {
            String last = out.get(out.size() - 1);
            out.set(out.size() - 1, clip(last, width));
            if (i < words.length && !out.get(out.size() - 1).endsWith("…")) out.set(out.size() - 1, clip(last + " …", width + 1));
        }
        return out;
    }

    // ── Bloom's pyramid ──

    record BloomLevel(String name, String note, Integer correct, Integer total) {
        Double percent() {
            return total == null || total == 0 ? null : 100.0 * correct / total;
        }
    }

    /** Levels top (Create) to bottom (Remember). */
    static String bloomPyramid(List<BloomLevel> levels, ReportPalette p, int w) {
        int levelH = 34, gap = 4, top = 8;
        int h = top + levels.size() * (levelH + gap) + 6;
        double apex = 150, halfTop = 20, halfBase = 130;
        double height = levels.size() * (levelH + gap) - gap;
        java.util.function.DoubleUnaryOperator half = y -> halfTop + (y - top) / height * (halfBase - halfTop);
        StringBuilder s = new StringBuilder();
        for (int i = 0; i < levels.size(); i++) {
            BloomLevel l = levels.get(i);
            double y0 = top + i * (levelH + gap), y1 = y0 + levelH;
            double a = half.applyAsDouble(y0), b = half.applyAsDouble(y1);
            Double pc = l.percent();
            String fill = pc == null ? LINE : pc >= 80 ? p.brand : pc >= 60 ? p.brand100 : pc >= 40 ? AMBER_50 : BAD;
            String ink = pc == null ? MUTED : pc >= 80 ? p.onBrand : pc >= 60 ? p.brandInk : pc >= 40 ? "#7a4a0c" : PAPER;
            s.append("<polygon points=\"").append(f(apex - a)).append(',').append(f(y0)).append(' ').append(f(apex + a)).append(',').append(f(y0))
                    .append(' ').append(f(apex + b)).append(',').append(f(y1)).append(' ').append(f(apex - b)).append(',').append(f(y1))
                    .append("\" fill=\"").append(fill).append("\"/>");
            if (pc != null && b > 24) s.append(textD(apex, y0 + 23, Math.round(pc) + "%", 13, ink));
            double cy = (y0 + y1) / 2;
            s.append(line(apex + half.applyAsDouble(cy) + 4, cy, 300, cy, LINE, 1, "2 4"));
            s.append(text(310, cy - 1, l.name(), 15, 700, INK, "start"));
            String sub = pc == null ? "Not tested in this paper"
                    : l.correct() + " of " + l.total() + (l.note() == null ? "" : " · " + l.note());
            s.append(text(310, cy + 14, clip(sub, 56), 12.5, 400, MUTED, "start"));
        }
        return svg(w, h, s);
    }

    // ── Progress over time ──

    static String progress(List<HistoryPoint> points, ReportPalette p, int w) {
        int h = 186;
        double base = 150, top = 30;
        int n = points.size();
        double min = points.stream().mapToDouble(HistoryPoint::percent).min().orElse(0);
        double lo = Math.min(0, Math.floor(min / 10) * 10);
        StringBuilder s = new StringBuilder();
        s.append(line(16, base, w - 4, base, LINE, 1.5, null));
        StringBuilder pts = new StringBuilder();
        double[] xs = new double[n], ys = new double[n];
        SimpleDateFormat fmt = new SimpleDateFormat("d MMM", Locale.ENGLISH);
        fmt.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
        for (int i = 0; i < n; i++) {
            xs[i] = n == 1 ? w / 2.0 : 36 + i * (w - 72) / (double) (n - 1);
            ys[i] = base - (points.get(i).percent() - lo) / (100 - lo) * (base - top);
            pts.append(f(xs[i])).append(',').append(f(ys[i])).append(' ');
        }
        s.append("<polyline points=\"").append(pts.toString().trim()).append("\" fill=\"none\" stroke=\"").append(p.brand)
                .append("\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>");
        for (int i = 0; i < n; i++) {
            boolean last = i == n - 1;
            s.append(circle(xs[i], ys[i], last ? 8 : 6, p.brand));
            s.append(textD(xs[i], ys[i] - 12, Math.round(points.get(i).percent()) + "%", 14, INK));
            Date d = points.get(i).date();
            s.append(text(xs[i], base + 18, last ? "This test" : d == null ? "" : fmt.format(d), 11.5, last ? 700 : 400, last ? INK : MUTED, "middle"));
        }
        return svg(w, h, s);
    }

    // ── SVG primitives ──

    static String svg(int w, int h, CharSequence body) {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + w + "\" height=\"" + h + "\" viewBox=\"0 0 " + w + " " + h
                + "\">" + body + "</svg>";
    }

    static String rect(double x, double y, double w, double h, double rx, String fill) {
        double r = Math.min(rx, Math.min(w, h) / 2);
        return "<rect x=\"" + f(x) + "\" y=\"" + f(y) + "\" width=\"" + f(w) + "\" height=\"" + f(h) + "\""
                + (r > 0 ? " rx=\"" + f(r) + "\"" : "") + " fill=\"" + fill + "\"/>";
    }

    static String line(double x1, double y1, double x2, double y2, String stroke, double width, String dash) {
        return "<line x1=\"" + f(x1) + "\" y1=\"" + f(y1) + "\" x2=\"" + f(x2) + "\" y2=\"" + f(y2) + "\" stroke=\"" + stroke
                + "\" stroke-width=\"" + f(width) + "\"" + (dash != null ? " stroke-dasharray=\"" + dash + "\"" : "") + "/>";
    }

    static String circle(double cx, double cy, double r, String fill) {
        return "<circle cx=\"" + f(cx) + "\" cy=\"" + f(cy) + "\" r=\"" + f(r) + "\" fill=\"" + fill + "\"/>";
    }

    static String circle(double cx, double cy, double r, String fill, String stroke, double sw) {
        return "<circle cx=\"" + f(cx) + "\" cy=\"" + f(cy) + "\" r=\"" + f(r) + "\" fill=\"" + fill + "\" stroke=\"" + stroke
                + "\" stroke-width=\"" + f(sw) + "\"/>";
    }

    static String text(double x, double y, String t, double size, int weight, String fill, String anchor) {
        return "<text x=\"" + f(x) + "\" y=\"" + f(y) + "\" font-family=\"" + BODY_FONT + "\" font-size=\"" + f(size)
                + "\" font-weight=\"" + (weight >= 600 ? "bold" : "normal") + "\" fill=\"" + fill + "\" text-anchor=\"" + anchor + "\">"
                + esc(t) + "</text>";
    }

    /** Big chart number in the display face. */
    static String textD(double x, double y, String t, double size, String fill) {
        return "<text x=\"" + f(x) + "\" y=\"" + f(y) + "\" font-family=\"" + DISPLAY_FONT + "\" font-size=\"" + f(size)
                + "\" font-weight=\"800\" fill=\"" + fill + "\" text-anchor=\"middle\">" + esc(t) + "</text>";
    }

    static String f(double v) {
        if (Math.abs(v - Math.rint(v)) < 0.005) return String.valueOf((long) Math.rint(v));
        return String.format(Locale.ROOT, "%.1f", v);
    }

    // ── Number formatting shared with the builder ──

    static double pct(double score, double max) {
        return max > 0 ? 100.0 * score / max : 0;
    }

    /** Marks: whole numbers without a decimal, otherwise one decimal; a real minus sign. */
    static String num(double v) {
        double r = Math.round(v * 10) / 10.0;
        String s = Math.abs(r - Math.rint(r)) < 0.001 ? String.valueOf((long) Math.rint(Math.abs(r)))
                : String.format(Locale.ROOT, "%.1f", Math.abs(r));
        return (r < 0 ? "−" : "") + s;
    }

    /** Always one decimal (averages). */
    static String num1(double v) {
        String s = String.format(Locale.ROOT, "%.1f", Math.abs(v));
        return (v < -0.05 ? "−" : "") + s;
    }

    static String clip(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max - 1).trim() + "…";
    }

    static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
