package vacademy.io.admin_core_service.features.learner_reports.service;

import java.util.List;
import java.util.Locale;

/**
 * Inline SVG charts for the batch report document (preview, PDF and the parent and teacher
 * copies). Plain shapes only, so iText renders them the same as a browser does.
 */
final class BatchReportCharts {

    static final String GOOD = "#16a34a";
    static final String WARN = "#f59e0b";
    static final String BAD = "#dc2626";
    static final String NEUTRAL = "#cbd5e1";
    static final String INK = "#1f2937";
    static final String MUTED = "#6b7280";
    static final String LINE = "#e5e7eb";
    private static final String FONT = "Helvetica, Arial, sans-serif";

    record Slice(String label, double value, String color) {
    }

    record Point(String label, double value) {
    }

    private BatchReportCharts() {
    }

    /** A donut with a number in the hole. Slices with no value are skipped. */
    static String donut(List<Slice> slices, String center, String centerLabel, int size) {
        double total = slices.stream().mapToDouble(Slice::value).sum();
        double c = size / 2.0, rOuter = c - 2, rInner = c * 0.62;
        StringBuilder s = new StringBuilder();
        if (total <= 0) {
            s.append(ring(c, rOuter, rInner, LINE));
        } else {
            List<Slice> shown = slices.stream().filter(x -> x.value() > 0).toList();
            if (shown.size() == 1) {
                s.append(ring(c, rOuter, rInner, shown.get(0).color()));
            } else {
                double angle = -90;
                for (Slice x : shown) {
                    double sweep = 360.0 * x.value() / total;
                    s.append(arc(c, rOuter, rInner, angle, angle + sweep, x.color()));
                    angle += sweep;
                }
            }
        }
        s.append(text(c, c + (centerLabel == null ? 7 : 3), center, size * 0.15, true, INK, "middle"));
        if (centerLabel != null) {
            s.append(text(c, c + size * 0.13, centerLabel.toUpperCase(Locale.ROOT), size * 0.065, false, MUTED, "middle"));
        }
        return svg(size, size, s);
    }

    /** Ring segment from {@code a0} to {@code a1} degrees, clockwise from three o clock. */
    private static String arc(double c, double ro, double ri, double a0, double a1, String fill) {
        double gap = 1.2; // white spacer between segments
        a0 += gap / 2;
        a1 -= gap / 2;
        if (a1 <= a0) return "";
        boolean large = a1 - a0 > 180;
        double[] p0 = polar(c, ro, a0), p1 = polar(c, ro, a1), p2 = polar(c, ri, a1), p3 = polar(c, ri, a0);
        return "<path d=\"M" + f(p0[0]) + " " + f(p0[1])
                + " A" + f(ro) + " " + f(ro) + " 0 " + (large ? 1 : 0) + " 1 " + f(p1[0]) + " " + f(p1[1])
                + " L" + f(p2[0]) + " " + f(p2[1])
                + " A" + f(ri) + " " + f(ri) + " 0 " + (large ? 1 : 0) + " 0 " + f(p3[0]) + " " + f(p3[1])
                + " Z\" fill=\"" + fill + "\"/>";
    }

    private static String ring(double c, double ro, double ri, String fill) {
        return "<circle cx=\"" + f(c) + "\" cy=\"" + f(c) + "\" r=\"" + f((ro + ri) / 2) + "\" fill=\"none\" stroke=\""
                + fill + "\" stroke-width=\"" + f(ro - ri) + "\"/>";
    }

    private static double[] polar(double c, double r, double deg) {
        double rad = Math.toRadians(deg);
        return new double[]{c + r * Math.cos(rad), c + r * Math.sin(rad)};
    }

    /**
     * Learners per 10-point score range, bars coloured by band. {@code highlight} is the bucket
     * (0-9) drawn in the brand colour with a pill above it, or -1 for none.
     */
    static String histogram(int[] counts, int highlight, String highlightLabel, String brand, int w) {
        int h = 200;
        double x0 = 28, x1 = w - 6, band = (x1 - x0) / counts.length, barW = band * 0.78, base = 160, maxBar = 104;
        int top = 1;
        for (int n : counts) top = Math.max(top, n);
        StringBuilder s = new StringBuilder();
        for (int g = 0; g <= 2; g++) {
            double y = base - maxBar * g / 2.0;
            s.append(line(x0, y, x1, y, LINE, 1));
        }
        for (int i = 0; i < counts.length; i++) {
            double bh = counts[i] == 0 ? 0 : Math.max(3, counts[i] * maxBar / (double) top);
            double bx = x0 + i * band + (band - barW) / 2;
            boolean me = i == highlight;
            String fill = me ? brand : (i >= 6 ? GOOD : i >= 4 ? WARN : BAD);
            if (bh > 0) s.append(rect(bx, base - bh, barW, bh, 4, fill));
            if (counts[i] > 0) {
                s.append(text(bx + barW / 2, base - bh - 5, String.valueOf(counts[i]), 10.5, me, me ? brand : INK, "middle"));
            }
            s.append(text(bx + barW / 2, base + 15, (i * 10) + "-" + (i * 10 + 10), 9.5, me, me ? brand : MUTED, "middle"));
            if (me && highlightLabel != null) {
                double pw = Math.max(46, highlightLabel.length() * 6.4 + 16);
                double px = Math.max(0, Math.min(w - pw, bx + barW / 2 - pw / 2));
                double py = Math.max(0, base - bh - 40);
                s.append(rect(px, py, pw, 20, 10, brand));
                s.append(text(px + pw / 2, py + 14, highlightLabel, 10.5, true, "#ffffff", "middle"));
            }
        }
        s.append(text(x0, h - 6, "Average quiz score (%) · learners in each range", 10, false, MUTED, "start"));
        return svg(w, h, s);
    }

    /** Average score per assessment as a line with dots and value labels, on a 0-100 scale. */
    static String trend(List<Point> points, String brand, int w) {
        int h = 190;
        double x0 = 34, x1 = w - 14, top = 18, base = 150;
        StringBuilder s = new StringBuilder();
        for (int g = 0; g <= 4; g++) {
            double y = base - (base - top) * g / 4.0;
            s.append(line(x0, y, x1, y, LINE, 1));
            s.append(text(x0 - 6, y + 3, (g * 25) + "%", 9, false, MUTED, "end"));
        }
        int n = points.size();
        if (n == 0) return svg(w, h, s);
        double step = n == 1 ? 0 : (x1 - x0 - 20) / (n - 1);
        StringBuilder path = new StringBuilder();
        double[][] xy = new double[n][2];
        for (int i = 0; i < n; i++) {
            double x = n == 1 ? (x0 + x1) / 2 : x0 + 10 + step * i;
            double y = base - (base - top) * Math.max(0, Math.min(100, points.get(i).value())) / 100.0;
            xy[i][0] = x;
            xy[i][1] = y;
            path.append(i == 0 ? "M" : " L").append(f(x)).append(' ').append(f(y));
        }
        if (n > 1) {
            s.append("<path d=\"").append(path).append(" L").append(f(xy[n - 1][0])).append(' ').append(f(base))
                    .append(" L").append(f(xy[0][0])).append(' ').append(f(base)).append(" Z\" fill=\"").append(brand)
                    .append("\" fill-opacity=\"0.12\"/>");
            s.append("<path d=\"").append(path).append("\" fill=\"none\" stroke=\"").append(brand).append("\" stroke-width=\"2.5\"/>");
        }
        int labelEvery = n > 8 ? 2 : 1;
        for (int i = 0; i < n; i++) {
            s.append("<circle cx=\"").append(f(xy[i][0])).append("\" cy=\"").append(f(xy[i][1])).append("\" r=\"4\" fill=\"")
                    .append(brand).append("\" stroke=\"#ffffff\" stroke-width=\"1.5\"/>");
            s.append(text(xy[i][0], xy[i][1] - 8, Math.round(points.get(i).value()) + "%", 9.5, true, INK, "middle"));
            if (i % labelEvery == 0) s.append(text(xy[i][0], base + 15, points.get(i).label(), 9, false, MUTED, "middle"));
        }
        return svg(w, h, s);
    }

    static int bucketOf(double pct) {
        return Math.max(0, Math.min(9, (int) Math.floor(pct / 10)));
    }

    // ── primitives ──

    static String svg(int w, int h, CharSequence body) {
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"" + w + "\" height=\"" + h + "\" viewBox=\"0 0 " + w + " " + h
                + "\">" + body + "</svg>";
    }

    static String rect(double x, double y, double w, double h, double rx, String fill) {
        double r = Math.min(rx, Math.min(w, h) / 2);
        return "<rect x=\"" + f(x) + "\" y=\"" + f(y) + "\" width=\"" + f(w) + "\" height=\"" + f(h) + "\""
                + (r > 0 ? " rx=\"" + f(r) + "\"" : "") + " fill=\"" + fill + "\"/>";
    }

    static String line(double x1, double y1, double x2, double y2, String stroke, double width) {
        return "<line x1=\"" + f(x1) + "\" y1=\"" + f(y1) + "\" x2=\"" + f(x2) + "\" y2=\"" + f(y2) + "\" stroke=\"" + stroke
                + "\" stroke-width=\"" + f(width) + "\"/>";
    }

    static String text(double x, double y, String t, double size, boolean bold, String fill, String anchor) {
        return "<text x=\"" + f(x) + "\" y=\"" + f(y) + "\" font-family=\"" + FONT + "\" font-size=\"" + f(size)
                + "\" font-weight=\"" + (bold ? "bold" : "normal") + "\" fill=\"" + fill + "\" text-anchor=\"" + anchor + "\">"
                + esc(t) + "</text>";
    }

    static String f(double v) {
        if (Math.abs(v - Math.rint(v)) < 0.005) return String.valueOf((long) Math.rint(v));
        return String.format(Locale.ROOT, "%.1f", v);
    }

    static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
