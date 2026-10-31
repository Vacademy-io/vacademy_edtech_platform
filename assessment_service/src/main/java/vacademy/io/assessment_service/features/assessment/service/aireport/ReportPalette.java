package vacademy.io.assessment_service.features.assessment.service.aireport;

/**
 * Report colours derived from the institute's two brand colours. iText cannot read CSS
 * variables or rgba(), so every tint is pre-mixed here as a solid #rrggbb.
 *
 * <p>Text colours are chosen for contrast, not taken as given: a pale brand colour gets
 * dark text in the header, and brand-coloured text is darkened until it reads at 4.5:1 on
 * white.
 */
public final class ReportPalette {

    public static final String INK = "#161d2c";
    public static final String MUTED = "#5b6678";
    public static final String LINE = "#e3e7ee";
    public static final String SOFT = "#f4f6f9";
    public static final String PAPER = "#ffffff";
    public static final String OK = "#17935f";
    public static final String OK_50 = "#e3f4ec";
    public static final String BAD = "#d9473b";
    public static final String BAD_50 = "#fce9e7";
    public static final String AMBER = "#e5962b";
    public static final String AMBER_50 = "#fbecd6";
    public static final String WAIT = "#8b95a7";
    public static final String WAIT_50 = "#eef0f4";

    /** Section colours, used for the same section everywhere in one report. */
    private static final String[] SECTION_COLORS = {
            "#4c6fe6", "#e8922a", "#2aa073", "#dd5272", "#8760d0", "#1a9fb5", "#b5852a", "#6b7a99"};

    public final String brand;
    public final String brand50;
    public final String brand100;
    public final String brandDeep;
    public final String brandInk;
    public final String onBrand;
    public final String accent;
    public final String onAccent;

    public ReportPalette(String brandHex, String accentHex) {
        int[] b = rgb(brandHex);
        this.brand = hex(b);
        this.brand50 = hex(mix(b, new int[]{255, 255, 255}, 0.9));
        this.brand100 = hex(mix(b, new int[]{255, 255, 255}, 0.7));
        this.brandDeep = hex(mix(b, new int[]{0, 0, 0}, 0.22));
        int[] ink = b;
        double t = 0;
        while (contrast(ink, new int[]{255, 255, 255}) < 4.5 && t < 0.9) {
            t += 0.05;
            ink = mix(b, new int[]{0, 0, 0}, t);
        }
        this.brandInk = hex(ink);
        this.onBrand = contrast(b, new int[]{255, 255, 255}) >= 3 ? PAPER : INK;
        int[] a = rgb(accentHex);
        this.accent = hex(a);
        this.onAccent = contrast(a, rgb(INK)) >= contrast(a, new int[]{255, 255, 255}) ? INK : PAPER;
    }

    public static String section(int index) {
        return SECTION_COLORS[Math.floorMod(index, SECTION_COLORS.length)];
    }

    /** Light background for a semantic colour (blend with white). */
    public static String tint(String hex, double keep) {
        return hex(mix(rgb(hex), new int[]{255, 255, 255}, 1 - keep));
    }

    private static int[] rgb(String hex) {
        String h = hex == null ? "" : hex.trim();
        if (!h.matches("#[0-9a-fA-F]{6}")) h = "#0F9A83";
        return new int[]{Integer.parseInt(h.substring(1, 3), 16), Integer.parseInt(h.substring(3, 5), 16),
                Integer.parseInt(h.substring(5, 7), 16)};
    }

    private static int[] mix(int[] a, int[] b, double t) {
        return new int[]{(int) Math.round(a[0] + (b[0] - a[0]) * t), (int) Math.round(a[1] + (b[1] - a[1]) * t),
                (int) Math.round(a[2] + (b[2] - a[2]) * t)};
    }

    private static String hex(int[] c) {
        return String.format("#%02x%02x%02x", clamp(c[0]), clamp(c[1]), clamp(c[2]));
    }

    private static int clamp(int v) {
        return Math.max(0, Math.min(255, v));
    }

    private static double luminance(int[] c) {
        double[] l = new double[3];
        for (int i = 0; i < 3; i++) {
            double v = c[i] / 255.0;
            l[i] = v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        }
        return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
    }

    private static double contrast(int[] a, int[] b) {
        double x = luminance(a), y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }
}
