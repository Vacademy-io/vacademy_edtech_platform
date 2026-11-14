package vacademy.io.assessment_service.features.assessment.service;

import lombok.extern.slf4j.Slf4j;
import org.jfree.chart.ChartFactory;
import org.jfree.chart.JFreeChart;
import org.jfree.chart.labels.StandardCategoryItemLabelGenerator;
import org.jfree.chart.labels.StandardPieSectionLabelGenerator;
import org.jfree.chart.plot.SpiderWebPlot;
import org.jfree.chart.plot.CategoryPlot;
import org.jfree.chart.plot.PiePlot;
import org.jfree.chart.plot.PlotOrientation;
import org.jfree.chart.plot.RingPlot;
import org.jfree.chart.renderer.category.BarRenderer;
import org.jfree.chart.renderer.category.StandardBarPainter;
import org.jfree.chart.axis.NumberAxis;
import org.jfree.chart.axis.NumberTickUnit;
import org.jfree.chart.title.LegendTitle;
import org.jfree.chart.ui.RectangleInsets;
import org.jfree.data.category.DefaultCategoryDataset;
import org.jfree.data.general.DefaultPieDataset;
import org.springframework.stereotype.Service;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.Map;

/**
 * Generates chart images (PNG, Base64-encoded) for embedding in PDF reports.
 * Uses JFreeChart for server-side rendering.
 */
@Service
@Slf4j
public class AiReportChartGenerator {

    private static final Color PRIMARY = new Color(0x49, 0x8C, 0xFF);
    private static final Color BG = Color.WHITE;
    private static final Color GRID_COLOR = new Color(0xE0, 0xE0, 0xE0);
    private static final Font LABEL_FONT = new Font("SansSerif", Font.PLAIN, 11);
    private static final Font TITLE_FONT = new Font("SansSerif", Font.BOLD, 13);

    /**
     * Generate a radar/spider chart for topic analysis.
     * @param topicAccuracies Map of topic name → accuracy (0-100)
     * @return Base64-encoded PNG data URI
     */
    public String generateRadarChart(Map<String, Double> topicAccuracies) {
        try {
            DefaultCategoryDataset dataset = new DefaultCategoryDataset();
            for (Map.Entry<String, Double> entry : topicAccuracies.entrySet()) {
                dataset.addValue(entry.getValue(), "Student", entry.getKey());
            }

            SpiderWebPlot plot = new SpiderWebPlot(dataset);
            plot.setSeriesPaint(0, PRIMARY);
            plot.setSeriesOutlineStroke(0, new BasicStroke(2.0f));
            plot.setWebFilled(true);
            plot.setBackgroundPaint(BG);
            plot.setOutlinePaint(null);
            plot.setLabelFont(LABEL_FONT);
            plot.setMaxValue(100.0);
            plot.setInteriorGap(0.3);

            JFreeChart chart = new JFreeChart("", TITLE_FONT, plot, false);
            chart.setBackgroundPaint(BG);

            return chartToBase64(chart, 500, 400);
        } catch (Exception e) {
            log.warn("Failed to generate radar chart: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Generate a horizontal bar chart for Bloom's taxonomy.
     * @param bloomsData Map of level → accuracy (0-100)
     * @return Base64-encoded PNG data URI
     */
    public String generateBloomsBarChart(Map<String, Double> bloomsData) {
        try {
            // Each level as its own series so we can color them individually
            DefaultCategoryDataset dataset = new DefaultCategoryDataset();
            String[] levels = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"};
            Color[] colors = {
                    new Color(0x00, 0xD6, 0x8F), // Remember - green
                    new Color(0x54, 0xA0, 0xFF), // Understand - blue
                    new Color(0x6C, 0x5C, 0xE7), // Apply - purple
                    new Color(0xFE, 0xCA, 0x57), // Analyze - yellow
                    new Color(0xFF, 0x9F, 0x43), // Evaluate - orange
                    new Color(0xFF, 0x6B, 0x6B), // Create - red
            };

            for (int i = 0; i < levels.length; i++) {
                String key = levels[i].toLowerCase();
                double val = bloomsData.getOrDefault(key, 0.0);
                // Use level name as both series and category for individual coloring
                dataset.addValue(val, levels[i], levels[i]);
            }

            JFreeChart chart = ChartFactory.createBarChart(
                    "", "", "Accuracy %",
                    dataset, PlotOrientation.VERTICAL, false, false, false);

            chart.setBackgroundPaint(BG);
            CategoryPlot plot = chart.getCategoryPlot();
            plot.setBackgroundPaint(BG);
            plot.setOutlinePaint(null);
            plot.setRangeGridlinePaint(GRID_COLOR);
            plot.getRangeAxis().setRange(0, 100);
            plot.getRangeAxis().setLabelFont(LABEL_FONT);
            plot.getDomainAxis().setTickLabelFont(LABEL_FONT);

            BarRenderer renderer = (BarRenderer) plot.getRenderer();
            renderer.setBarPainter(new StandardBarPainter());
            renderer.setShadowVisible(false);
            renderer.setMaximumBarWidth(0.5);
            renderer.setItemMargin(0.0);
            plot.getDomainAxis().setCategoryMargin(0.05);
            plot.getDomainAxis().setLowerMargin(0.01);
            plot.getDomainAxis().setUpperMargin(0.01);

            // Color each series (level) with its unique color
            for (int i = 0; i < levels.length; i++) {
                renderer.setSeriesPaint(i, colors[i]);
            }

            return chartToBase64(chart, 500, 280);
        } catch (Exception e) {
            log.warn("Failed to generate Bloom's bar chart: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Generate a grouped bar chart for Bloom's taxonomy (student vs class).
     * @param studentData Map of level → accuracy
     * @param classData Map of level → accuracy (can be null)
     * @return Base64-encoded PNG data URI
     */
    public String generateBloomsComparisonChart(Map<String, Double> studentData, Map<String, Double> classData) {
        try {
            DefaultCategoryDataset dataset = new DefaultCategoryDataset();
            String[] levels = {"Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"};

            for (String level : levels) {
                String key = level.toLowerCase();
                dataset.addValue(studentData.getOrDefault(key, 0.0), "Student", level);
                if (classData != null) {
                    dataset.addValue(classData.getOrDefault(key, 0.0), "Class Avg", level);
                }
            }

            JFreeChart chart = ChartFactory.createBarChart(
                    "", "", "Accuracy %",
                    dataset, PlotOrientation.VERTICAL, true, false, false);

            chart.setBackgroundPaint(BG);
            CategoryPlot plot = chart.getCategoryPlot();
            plot.setBackgroundPaint(BG);
            plot.setOutlinePaint(null);
            plot.setRangeGridlinePaint(GRID_COLOR);
            plot.getRangeAxis().setRange(0, 100);
            plot.getDomainAxis().setTickLabelFont(LABEL_FONT);

            BarRenderer renderer = (BarRenderer) plot.getRenderer();
            renderer.setBarPainter(new StandardBarPainter());
            renderer.setShadowVisible(false);
            renderer.setSeriesPaint(0, PRIMARY);
            renderer.setSeriesPaint(1, new Color(0xCC, 0xCC, 0xCC));

            LegendTitle legend = chart.getLegend();
            if (legend != null) {
                legend.setItemFont(LABEL_FONT);
            }

            return chartToBase64(chart, 500, 280);
        } catch (Exception e) {
            log.warn("Failed to generate Bloom's comparison chart: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Generate a confidence grid as an image.
     * @param questionConfidences Map of question label → confidence % (0-100)
     * @return Base64-encoded PNG data URI
     */
    public String generateConfidenceGrid(Map<String, Integer> questionConfidences) {
        try {
            int cols = 5;
            int rows = (int) Math.ceil(questionConfidences.size() / (double) cols);
            int cellW = 90, cellH = 70, pad = 4;
            int imgW = cols * (cellW + pad) + pad;
            int imgH = rows * (cellH + pad) + pad;

            BufferedImage img = new BufferedImage(imgW, imgH, BufferedImage.TYPE_INT_ARGB);
            Graphics2D g = img.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setColor(BG);
            g.fillRect(0, 0, imgW, imgH);

            int idx = 0;
            for (Map.Entry<String, Integer> entry : questionConfidences.entrySet()) {
                int row = idx / cols;
                int col = idx % cols;
                int x = pad + col * (cellW + pad);
                int y = pad + row * (cellH + pad);

                int conf = entry.getValue();
                Color bgColor = conf >= 70 ? new Color(0xE8, 0xF5, 0xE9) :
                        conf >= 40 ? new Color(0xFF, 0xF8, 0xE1) :
                                new Color(0xFF, 0xEB, 0xEE);
                Color textColor = conf >= 70 ? new Color(0x2E, 0x7D, 0x32) :
                        conf >= 40 ? new Color(0xF5, 0x7F, 0x17) :
                                new Color(0xC6, 0x28, 0x28);
                String badge = conf >= 70 ? "HIGH" : conf >= 40 ? "MEDIUM" : "LOW";

                g.setColor(bgColor);
                g.fillRoundRect(x, y, cellW, cellH, 8, 8);
                g.setColor(new Color(0xE0, 0xE0, 0xE0));
                g.drawRoundRect(x, y, cellW, cellH, 8, 8);

                // Question label
                g.setColor(new Color(0x99, 0x99, 0x99));
                g.setFont(new Font("SansSerif", Font.PLAIN, 10));
                FontMetrics fm = g.getFontMetrics();
                String qLabel = entry.getKey();
                g.drawString(qLabel, x + (cellW - fm.stringWidth(qLabel)) / 2, y + 16);

                // Confidence %
                g.setColor(textColor);
                g.setFont(new Font("SansSerif", Font.BOLD, 18));
                fm = g.getFontMetrics();
                String pctStr = conf + "%";
                g.drawString(pctStr, x + (cellW - fm.stringWidth(pctStr)) / 2, y + 40);

                // Badge
                g.setFont(new Font("SansSerif", Font.BOLD, 9));
                fm = g.getFontMetrics();
                g.drawString(badge, x + (cellW - fm.stringWidth(badge)) / 2, y + 58);

                idx++;
            }
            g.dispose();

            return imageToBase64(img);
        } catch (Exception e) {
            log.warn("Failed to generate confidence grid: {}", e.getMessage());
            return null;
        }
    }

    // ==================================================================
    // Teacher diagnostic report charts
    //
    // The four below are consumed by TeacherAiReportHtmlBuilder. They are kept
    // deliberately generic (ordered maps in, data URI out) because the teacher
    // report decides its own ordering and banding — e.g. topics are handed over
    // weakest-first so the chart reads top-down as a remediation queue.
    // ==================================================================

    /**
     * Donut (ring) chart for the response breakdown — correct / partial /
     * incorrect / unattempted.
     *
     * @param slices ordered slice label -> count; zero-valued slices are dropped
     *               so an all-correct attempt does not render four empty legend
     *               entries
     * @param hexColors per-slice colors, parallel to {@code slices}' iteration order
     * @return Base64-encoded PNG data URI, or null if the chart could not be built
     */
    public String generateDonutChart(Map<String, Double> slices, String[] hexColors) {
        try {
            DefaultPieDataset<String> dataset = new DefaultPieDataset<>();
            java.util.List<Color> used = new java.util.ArrayList<>();
            int i = 0;
            for (Map.Entry<String, Double> e : slices.entrySet()) {
                double v = e.getValue() != null ? e.getValue() : 0.0;
                if (v > 0) {
                    dataset.setValue(e.getKey(), v);
                    used.add(hex(hexColors != null && i < hexColors.length ? hexColors[i] : "#888888"));
                }
                i++;
            }
            if (dataset.getItemCount() == 0) return null;

            JFreeChart chart = ChartFactory.createRingChart("", dataset, true, false, false);
            chart.setBackgroundPaint(BG);
            chart.setPadding(new RectangleInsets(2, 2, 2, 2));

            RingPlot plot = (RingPlot) chart.getPlot();
            plot.setBackgroundPaint(BG);
            plot.setOutlinePaint(null);
            plot.setShadowPaint(null);
            plot.setSectionDepth(0.42);
            plot.setSeparatorsVisible(false);
            plot.setLabelGenerator(new StandardPieSectionLabelGenerator("{1} ({2})"));
            plot.setLabelFont(LABEL_FONT);
            plot.setLabelBackgroundPaint(BG);
            plot.setLabelOutlinePaint(null);
            plot.setLabelShadowPaint(null);
            plot.setSimpleLabels(false);

            int idx = 0;
            for (String key : dataset.getKeys()) {
                plot.setSectionPaint(key, used.get(idx++));
            }

            LegendTitle legend = chart.getLegend();
            if (legend != null) legend.setItemFont(LABEL_FONT);

            return chartToBase64(chart, 520, 300);
        } catch (Exception e) {
            log.warn("Failed to generate donut chart: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Pie chart — used for "where the marks were lost", i.e. each section's share
     * of the total marks the student did not score. Slices are labelled with the
     * percentage so a teacher can read it without the legend.
     */
    public String generatePieChart(Map<String, Double> slices, String[] hexColors) {
        try {
            DefaultPieDataset<String> dataset = new DefaultPieDataset<>();
            java.util.List<Color> used = new java.util.ArrayList<>();
            int i = 0;
            for (Map.Entry<String, Double> e : slices.entrySet()) {
                double v = e.getValue() != null ? e.getValue() : 0.0;
                if (v > 0) {
                    dataset.setValue(e.getKey(), v);
                    used.add(hex(hexColors != null && i < hexColors.length ? hexColors[i % hexColors.length] : "#888888"));
                }
                i++;
            }
            if (dataset.getItemCount() == 0) return null;

            JFreeChart chart = ChartFactory.createPieChart("", dataset, true, false, false);
            chart.setBackgroundPaint(BG);
            chart.setPadding(new RectangleInsets(2, 2, 2, 2));

            @SuppressWarnings("unchecked")
            PiePlot<String> plot = (PiePlot<String>) chart.getPlot();
            plot.setBackgroundPaint(BG);
            plot.setOutlinePaint(null);
            plot.setShadowPaint(null);
            plot.setLabelFont(LABEL_FONT);
            plot.setLabelBackgroundPaint(BG);
            plot.setLabelOutlinePaint(null);
            plot.setLabelShadowPaint(null);
            plot.setLabelGenerator(new StandardPieSectionLabelGenerator("{0} \u2014 {2}"));

            int idx = 0;
            for (String key : dataset.getKeys()) {
                plot.setSectionPaint(key, used.get(idx++));
            }

            LegendTitle legend = chart.getLegend();
            if (legend != null) legend.setItemFont(LABEL_FONT);

            return chartToBase64(chart, 520, 300);
        } catch (Exception e) {
            log.warn("Failed to generate pie chart: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Grouped vertical bar chart comparing the student against the class on the
     * same categories (sections, typically). {@code classValues} may be null, in
     * which case only the student series is drawn.
     */
    public String generateComparisonBarChart(String valueAxisLabel,
                                             Map<String, Double> studentValues,
                                             Map<String, Double> classValues,
                                             String studentSeriesLabel,
                                             String classSeriesLabel,
                                             String studentHexColor,
                                             int width, int height) {
        try {
            if (studentValues == null || studentValues.isEmpty()) return null;
            DefaultCategoryDataset dataset = new DefaultCategoryDataset();
            for (Map.Entry<String, Double> e : studentValues.entrySet()) {
                dataset.addValue(e.getValue() != null ? e.getValue() : 0.0, studentSeriesLabel, e.getKey());
                if (classValues != null) {
                    Double cv = classValues.get(e.getKey());
                    dataset.addValue(cv != null ? cv : 0.0, classSeriesLabel, e.getKey());
                }
            }

            JFreeChart chart = ChartFactory.createBarChart(
                    "", "", valueAxisLabel, dataset, PlotOrientation.VERTICAL,
                    classValues != null, false, false);
            // Headroom above 100: the value label sits ON TOP of the bar, so a
            // 97% bar against a 0-100 axis has its label clipped by the plot edge.
            // Ticks stay on the 20s so the extra range is invisible.
            styleCategoryChart(chart, 0, 112);
            ((NumberAxis) chart.getCategoryPlot().getRangeAxis()).setTickUnit(new NumberTickUnit(20));

            BarRenderer renderer = (BarRenderer) chart.getCategoryPlot().getRenderer();
            renderer.setSeriesPaint(0, hex(studentHexColor));
            if (classValues != null) renderer.setSeriesPaint(1, new Color(0xA9, 0x84, 0x67));
            renderer.setDefaultItemLabelGenerator(new StandardCategoryItemLabelGenerator());
            renderer.setDefaultItemLabelFont(new Font("SansSerif", Font.BOLD, 9));
            renderer.setDefaultItemLabelsVisible(true);

            LegendTitle legend = chart.getLegend();
            if (legend != null) legend.setItemFont(LABEL_FONT);

            return chartToBase64(chart, width, height);
        } catch (Exception e) {
            log.warn("Failed to generate comparison bar chart: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Horizontal bar chart for topic accuracy, each bar coloured by its own
     * band (weak / borderline / strong) so the weakest topics are visually
     * obvious. Pass topics in the order they should be drawn — weakest first
     * reads best on a diagnostic report.
     *
     * <p>Colouring goes through a {@link BarRenderer} that overrides
     * {@code getItemPaint} rather than one-series-per-topic: with N series the
     * renderer reserves a slot per series inside every category, which would
     * stagger the bars and shrink each one to 1/N of its category.
     */
    public String generateBandedHorizontalBarChart(Map<String, Double> values, int height) {
        try {
            if (values == null || values.isEmpty()) return null;

            DefaultCategoryDataset dataset = new DefaultCategoryDataset();
            final java.util.List<Color> colors = new java.util.ArrayList<>();
            // Categories render top-down in insertion order on a horizontal plot,
            // so the caller's "weakest first" ordering lands as "weakest at top".
            for (Map.Entry<String, Double> e : values.entrySet()) {
                double v = e.getValue() != null ? e.getValue() : 0.0;
                dataset.addValue(v, "Accuracy", e.getKey());
                colors.add(bandColor(v));
            }

            JFreeChart chart = ChartFactory.createBarChart(
                    "", "", "Accuracy %", dataset, PlotOrientation.HORIZONTAL, false, false, false);

            BarRenderer renderer = new BarRenderer() {
                @Override
                public Paint getItemPaint(int row, int column) {
                    return column >= 0 && column < colors.size() ? colors.get(column) : PRIMARY;
                }
            };
            chart.getCategoryPlot().setRenderer(renderer);
            styleCategoryChart(chart, 0, 112);
            ((NumberAxis) chart.getCategoryPlot().getRangeAxis()).setTickUnit(new NumberTickUnit(20));

            renderer.setDefaultItemLabelGenerator(new StandardCategoryItemLabelGenerator());
            renderer.setDefaultItemLabelFont(new Font("SansSerif", Font.BOLD, 9));
            renderer.setDefaultItemLabelsVisible(true);
            renderer.setMaximumBarWidth(0.16);

            return chartToBase64(chart, 520, height);
        } catch (Exception e) {
            log.warn("Failed to generate banded bar chart: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Vertical bar chart of raw counts with an auto-scaled axis — the class
     * score distribution ("how many students in each mark band"), where the
     * value is a headcount, not a percentage, so the 0-100 axis the other
     * charts share would be meaningless.
     */
    public String generateCountBarChart(String valueAxisLabel, Map<String, Double> counts,
                                        String hexColor, int width, int height) {
        try {
            if (counts == null || counts.isEmpty()) return null;
            DefaultCategoryDataset dataset = new DefaultCategoryDataset();
            double max = 0;
            for (Map.Entry<String, Double> e : counts.entrySet()) {
                double v = e.getValue() != null ? e.getValue() : 0.0;
                dataset.addValue(v, "Students", e.getKey());
                max = Math.max(max, v);
            }

            JFreeChart chart = ChartFactory.createBarChart(
                    "", "", valueAxisLabel, dataset, PlotOrientation.VERTICAL, false, false, false);
            // Headroom so the value labels above the tallest bar are not clipped.
            styleCategoryChart(chart, 0, Math.max(1, Math.ceil(max * 1.25)));

            BarRenderer renderer = (BarRenderer) chart.getCategoryPlot().getRenderer();
            renderer.setSeriesPaint(0, hex(hexColor));
            renderer.setDefaultItemLabelGenerator(new StandardCategoryItemLabelGenerator());
            renderer.setDefaultItemLabelFont(new Font("SansSerif", Font.BOLD, 9));
            renderer.setDefaultItemLabelsVisible(true);
            renderer.setMaximumBarWidth(0.12);

            return chartToBase64(chart, width, height);
        } catch (Exception e) {
            log.warn("Failed to generate count bar chart: {}", e.getMessage());
            return null;
        }
    }

    /** Red below 40%, amber below 70%, green at or above — the report's one weakness banding. */
    private static Color bandColor(double accuracyPercent) {
        if (accuracyPercent < 40) return new Color(0xC6, 0x28, 0x28);
        if (accuracyPercent < 70) return new Color(0xF5, 0x7F, 0x17);
        return new Color(0x2E, 0x7D, 0x32);
    }

    /** Shared axis/grid/bar styling so every teacher-report chart looks like one family. */
    private void styleCategoryChart(JFreeChart chart, double axisMin, double axisMax) {
        chart.setBackgroundPaint(BG);
        chart.setPadding(new RectangleInsets(2, 2, 2, 2));
        CategoryPlot plot = chart.getCategoryPlot();
        plot.setBackgroundPaint(BG);
        plot.setOutlinePaint(null);
        plot.setRangeGridlinePaint(GRID_COLOR);
        plot.getRangeAxis().setRange(axisMin, axisMax);
        plot.getRangeAxis().setLabelFont(LABEL_FONT);
        plot.getRangeAxis().setTickLabelFont(LABEL_FONT);
        plot.getDomainAxis().setTickLabelFont(LABEL_FONT);
        plot.getDomainAxis().setMaximumCategoryLabelWidthRatio(2.2f);

        BarRenderer renderer = (BarRenderer) plot.getRenderer();
        renderer.setBarPainter(new StandardBarPainter());
        renderer.setShadowVisible(false);
        renderer.setItemMargin(0.06);
        renderer.setMaximumBarWidth(0.18);
    }

    /** Parse a #rrggbb string, falling back to grey rather than throwing mid-render. */
    private static Color hex(String value) {
        try {
            return Color.decode(value.trim());
        } catch (Exception e) {
            return new Color(0x88, 0x88, 0x88);
        }
    }

    private String chartToBase64(JFreeChart chart, int width, int height) throws Exception {
        BufferedImage img = chart.createBufferedImage(width, height);
        return imageToBase64(img);
    }

    private String imageToBase64(BufferedImage img) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        ImageIO.write(img, "png", baos);
        return "data:image/png;base64," + Base64.getEncoder().encodeToString(baos.toByteArray());
    }
}
