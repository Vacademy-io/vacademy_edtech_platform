package vacademy.io.assessment_service.features.assessment.omr.layout;

import lombok.Builder;
import lombok.Getter;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The geometry of one OMR sheet, in millimetres on an A4 page, and the OMRChecker
 * template that reads it.
 *
 * <p>Everything the sheet prints that the reader looks at - corner markers, roll and
 * set grids, question bubbles, the orientation bar, the name box - is placed here
 * once. {@link OmrSheetPdfRenderer} draws from these numbers and
 * {@link #toTemplate()} writes OMRChecker's {@code template.json} from the same
 * numbers, so the two can never disagree about where a bubble is.
 *
 * <p>How OMRChecker sees the page (vendor/omrchecker/src): the scan is resized to the
 * processing size, the four corner markers are found by template matching, and the
 * page is warped so the marker CENTRES become the corners of an image of
 * {@code pageDimensions}. Template coordinates are therefore measured from the
 * top-left marker centre, at {@link #PX_PER_MM} pixels per millimetre.
 *
 * <p>Bump {@link #LAYOUT_VERSION} whenever any number here changes: sets store the
 * version they were printed with, and a scan is always read with the template of the
 * layout its sheet was printed from.
 */
@Getter
public final class OmrSheetLayout {

    public static final int LAYOUT_VERSION = 1;

    public static final double PAGE_W = 210.0;
    public static final double PAGE_H = 297.0;

    /** Marker centres sit this far in from each page edge. */
    public static final double MARKER_INSET = 10.0;
    public static final double MARKER_OUTER = 8.0;
    public static final double MARKER_INNER = 5.2;
    public static final double MARKER_CORE = 2.4;
    /** White margin around the marker in the image the reader matches against. */
    public static final double MARKER_PAD = 1.5;

    /** Template pixels per millimetre. */
    public static final double PX_PER_MM = 6.0;
    /** Scans are resized to this before the markers are searched (about 150 dpi on A4). */
    public static final int PROCESSING_WIDTH = 1240;
    public static final int PROCESSING_HEIGHT = 1754;

    /** The part of a bubble the reader averages: its middle, not the printed ring. */
    private static final double SAMPLE_FRACTION = 0.8;

    public static final int MAX_QUESTIONS = 200;
    public static final int LARGE_MAX_QUESTIONS = 100;
    public static final int MAX_OPTIONS = 5;
    public static final int MIN_OPTIONS = 2;
    public static final int MAX_ROLL_DIGITS = 12;
    public static final int MAX_SETS = 8;

    public static final String LARGE = "LARGE";
    public static final String DENSE = "DENSE";

    static final String[] LETTERS = {"A", "B", "C", "D", "E"};

    // Header
    public static final Rect ORIENTATION_BAR = new Rect(20, 12.5, 14, 3);
    public static final Rect NAME_BOX = new Rect(16, 38, 104, 10);

    // Roll grid
    static final double ROLL_X0 = 16;
    static final double ROLL_WRITE_Y = 55;     // top of the write-in boxes
    static final double ROLL_WRITE_H = 6;
    static final double ROLL_COL_PITCH = 6.5;
    static final double ROLL_ROW0_Y = 66;      // centre of the "0" row
    static final double ROLL_ROW_PITCH = 5.0;
    static final double ROLL_BUBBLE = 4.2;

    // Set grid
    static final double SET_X0 = 128;
    static final double SET_ROW_Y = 66;
    static final double SET_PITCH = 7.0;
    static final double SET_BUBBLE = 4.6;

    // Questions
    static final double Q_TOP = 120;
    static final double Q_BOTTOM = 278;
    static final double Q_LEFT = 16;
    static final double Q_RIGHT = 196;

    /** A rectangle in millimetres, top-left origin. */
    public record Rect(double x, double y, double w, double h) {
    }

    /** One printed bubble: centre and diameter in millimetres, and the value it stands for. */
    public record Bubble(double cx, double cy, double d, String value) {
    }

    /** One question row as printed. */
    public record QuestionRow(int no, double labelRightX, double cy, List<Bubble> bubbles) {
    }

    /** Bubble sizes of one density. */
    record Density(String name, int columns, double bubble, double pitch, double rowPitch, double labelWidth) {
    }

    static final Density LARGE_DENSITY = new Density(LARGE, 4, 4.4, 6.2, 6.0, 9.0);
    static final Density DENSE_DENSITY = new Density(DENSE, 5, 3.4, 4.5, 3.9, 7.0);

    private final int rollDigits;
    private final List<String> setCodes;
    private final String printedSetCode;
    private final String density;
    private final List<List<Bubble>> rollColumns;
    private final List<Bubble> setBubbles;
    private final List<QuestionRow> questions;
    private final double questionBubbleDiameter;

    /**
     * @param rollDigits     digits in the roll-number grid (1..12)
     * @param setCodes       all set codes of the assessment; one code = no set grid
     * @param printedSetCode the set this sheet is printed for
     * @param optionCounts   options of each question in printed order (2..5 each)
     */
    @Builder
    private OmrSheetLayout(int rollDigits, List<String> setCodes, String printedSetCode, List<Integer> optionCounts) {
        if (rollDigits < 1 || rollDigits > MAX_ROLL_DIGITS) {
            throw new IllegalArgumentException("Roll numbers must have 1 to " + MAX_ROLL_DIGITS + " digits");
        }
        if (setCodes == null || setCodes.isEmpty() || setCodes.size() > MAX_SETS) {
            throw new IllegalArgumentException("1 to " + MAX_SETS + " sets are supported");
        }
        if (optionCounts == null || optionCounts.isEmpty() || optionCounts.size() > MAX_QUESTIONS) {
            throw new IllegalArgumentException("An OMR sheet holds 1 to " + MAX_QUESTIONS + " questions");
        }
        for (Integer n : optionCounts) {
            if (n == null || n < MIN_OPTIONS || n > MAX_OPTIONS) {
                throw new IllegalArgumentException("Every question needs " + MIN_OPTIONS + " to " + MAX_OPTIONS + " options");
            }
        }
        this.rollDigits = rollDigits;
        this.setCodes = List.copyOf(setCodes);
        this.printedSetCode = printedSetCode;

        Density dens = optionCounts.size() <= LARGE_MAX_QUESTIONS ? LARGE_DENSITY : DENSE_DENSITY;
        this.density = dens.name();
        this.questionBubbleDiameter = dens.bubble();

        List<List<Bubble>> roll = new ArrayList<>();
        for (int c = 0; c < rollDigits; c++) {
            double cx = ROLL_X0 + ROLL_COL_PITCH * c + ROLL_COL_PITCH / 2;
            List<Bubble> col = new ArrayList<>();
            for (int digit = 0; digit <= 9; digit++) {
                col.add(new Bubble(cx, ROLL_ROW0_Y + ROLL_ROW_PITCH * digit, ROLL_BUBBLE, String.valueOf(digit)));
            }
            roll.add(col);
        }
        this.rollColumns = roll;

        List<Bubble> sets = new ArrayList<>();
        if (setCodes.size() > 1) {
            for (int i = 0; i < setCodes.size(); i++) {
                sets.add(new Bubble(SET_X0 + 3 + SET_PITCH * i, SET_ROW_Y, SET_BUBBLE, setCodes.get(i)));
            }
        }
        this.setBubbles = sets;

        int rowsMax = (int) Math.floor((Q_BOTTOM - Q_TOP) / dens.rowPitch());
        int rows = Math.min(rowsMax, (int) Math.ceil(optionCounts.size() / (double) dens.columns()));
        double colWidth = dens.labelWidth() + MAX_OPTIONS * dens.pitch();
        double gap = (Q_RIGHT - Q_LEFT - dens.columns() * colWidth) / (dens.columns() - 1);
        List<QuestionRow> qs = new ArrayList<>();
        for (int i = 0; i < optionCounts.size(); i++) {
            int col = i / rows;
            int row = i % rows;
            double colX = Q_LEFT + col * (colWidth + gap);
            double cy = Q_TOP + dens.rowPitch() * (row + 0.5);
            List<Bubble> bubbles = new ArrayList<>();
            for (int k = 0; k < optionCounts.get(i); k++) {
                double cx = colX + dens.labelWidth() + dens.pitch() * k + dens.pitch() / 2;
                bubbles.add(new Bubble(cx, cy, dens.bubble(), LETTERS[k]));
            }
            qs.add(new QuestionRow(i + 1, colX + dens.labelWidth() - 1.2, cy, bubbles));
        }
        this.questions = qs;
    }

    public boolean hasSetGrid() {
        return !setBubbles.isEmpty();
    }

    // ------------------------------------------------------------ marker spec

    /** Corner marker centres (top-left, top-right, bottom-left, bottom-right). */
    public static List<double[]> markerCentres() {
        return List.of(
                new double[]{MARKER_INSET, MARKER_INSET},
                new double[]{PAGE_W - MARKER_INSET, MARKER_INSET},
                new double[]{MARKER_INSET, PAGE_H - MARKER_INSET},
                new double[]{PAGE_W - MARKER_INSET, PAGE_H - MARKER_INSET});
    }

    /** The marker sizes ai_service needs to draw the image it matches against. */
    public static Map<String, Object> markerSpec() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("outer_mm", MARKER_OUTER);
        m.put("inner_mm", MARKER_INNER);
        m.put("core_mm", MARKER_CORE);
        m.put("pad_mm", MARKER_PAD);
        return m;
    }

    // --------------------------------------------------------------- template

    static double tx(double xMm) {
        return (xMm - MARKER_INSET) * PX_PER_MM;
    }

    static double ty(double yMm) {
        return (yMm - MARKER_INSET) * PX_PER_MM;
    }

    static List<Integer> pageDimensions() {
        return List.of((int) Math.round((PAGE_W - 2 * MARKER_INSET) * PX_PER_MM),
                (int) Math.round((PAGE_H - 2 * MARKER_INSET) * PX_PER_MM));
    }

    private static int sample(double diameterMm) {
        return (int) Math.round(diameterMm * SAMPLE_FRACTION * PX_PER_MM);
    }

    /** Top-left of the sampled square of a bubble, in template pixels. */
    private static List<Integer> origin(Bubble b) {
        double half = b.d() * SAMPLE_FRACTION / 2;
        return List.of((int) Math.round(tx(b.cx() - half)), (int) Math.round(ty(b.cy() - half)));
    }

    /** Field label of question {@code no} in the template and in the reader's output. */
    public static String questionLabel(int no) {
        return "q" + no;
    }

    public static String rollLabel(int digitIndex) {
        return "roll" + (digitIndex + 1);
    }

    public static final String SET_LABEL = "set";

    /** OMRChecker {@code template.json} for this sheet. */
    public Map<String, Object> toTemplate() {
        Map<String, Object> blocks = new LinkedHashMap<>();

        List<String> rollLabels = new ArrayList<>();
        for (int c = 0; c < rollDigits; c++) rollLabels.add(rollLabel(c));
        Bubble roll0 = rollColumns.get(0).get(0);
        Map<String, Object> rollBlock = new LinkedHashMap<>();
        rollBlock.put("origin", origin(roll0));
        rollBlock.put("fieldLabels", rollLabels);
        rollBlock.put("bubbleValues", List.of("0", "1", "2", "3", "4", "5", "6", "7", "8", "9"));
        rollBlock.put("direction", "vertical");
        rollBlock.put("bubblesGap", ROLL_ROW_PITCH * PX_PER_MM);
        rollBlock.put("labelsGap", ROLL_COL_PITCH * PX_PER_MM);
        rollBlock.put("bubbleDimensions", List.of(sample(ROLL_BUBBLE), sample(ROLL_BUBBLE)));
        blocks.put("Roll", rollBlock);

        if (hasSetGrid()) {
            Map<String, Object> setBlock = new LinkedHashMap<>();
            setBlock.put("origin", origin(setBubbles.get(0)));
            setBlock.put("fieldLabels", List.of(SET_LABEL));
            setBlock.put("bubbleValues", setCodes);
            setBlock.put("direction", "horizontal");
            setBlock.put("bubblesGap", SET_PITCH * PX_PER_MM);
            setBlock.put("labelsGap", 0);
            setBlock.put("bubbleDimensions", List.of(sample(SET_BUBBLE), sample(SET_BUBBLE)));
            blocks.put("Set", setBlock);
        }

        for (QuestionRow q : questions) {
            List<String> values = new ArrayList<>();
            for (Bubble b : q.bubbles()) values.add(b.value());
            Map<String, Object> block = new LinkedHashMap<>();
            block.put("origin", origin(q.bubbles().get(0)));
            block.put("fieldLabels", List.of(questionLabel(q.no())));
            block.put("bubbleValues", values);
            block.put("direction", "horizontal");
            block.put("bubblesGap", questionPitch() * PX_PER_MM);
            block.put("labelsGap", 0);
            block.put("bubbleDimensions", List.of(sample(q.bubbles().get(0).d()), sample(q.bubbles().get(0).d())));
            blocks.put("Q" + q.no(), block);
        }

        Map<String, Object> markerOptions = new LinkedHashMap<>();
        markerOptions.put("relativePath", "marker.png");
        // OMRChecker resizes the marker image to processing_width / ratio (int).
        markerOptions.put("sheetToMarkerWidthRatio", (int) Math.round(PAGE_W / (MARKER_OUTER + 2 * MARKER_PAD)));
        // Scanners fill the frame (~100%); phone photos show the sheet smaller.
        markerOptions.put("marker_rescale_range", List.of(45, 115));
        markerOptions.put("marker_rescale_steps", 14);

        Map<String, Object> template = new LinkedHashMap<>();
        template.put("pageDimensions", pageDimensions());
        template.put("bubbleDimensions", List.of(sample(questionBubbleDiameter), sample(questionBubbleDiameter)));
        template.put("emptyValue", "");
        template.put("preProcessors", List.of(Map.of("name", "CropOnMarkers", "options", markerOptions)));
        template.put("fieldBlocks", blocks);
        return template;
    }

    private double questionPitch() {
        return LARGE.equals(density) ? LARGE_DENSITY.pitch() : DENSE_DENSITY.pitch();
    }

    /** What ai_service needs besides the template (sizes in template pixels). */
    public Map<String, Object> readerLayout() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("processing_width", PROCESSING_WIDTH);
        m.put("processing_height", PROCESSING_HEIGHT);
        m.put("render_dpi", 200);
        // Confidence rules (ai_service reader._suspect_fields), calibrated on synthetic
        // sheets: real marks sit 50-100 grey levels from the threshold; light pencil
        // lands within 20 of it, or reads empty yet 15+ darker than its row's blanks.
        m.put("low_margin", 20);
        m.put("faint_delta", 15);
        m.put("name_box", toPx(NAME_BOX));
        m.put("orientation_box", toPx(ORIENTATION_BAR));
        return m;
    }

    private static List<Double> toPx(Rect r) {
        return List.of(tx(r.x()), ty(r.y()), r.w() * PX_PER_MM, r.h() * PX_PER_MM);
    }
}
