package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.fasterxml.jackson.databind.JsonNode;
import com.itextpdf.barcodes.qrcode.ByteMatrix;
import com.itextpdf.barcodes.qrcode.EncodeHintType;
import com.itextpdf.barcodes.qrcode.ErrorCorrectionLevel;
import com.itextpdf.barcodes.qrcode.QRCodeWriter;
import com.itextpdf.html2pdf.ConverterProperties;
import com.itextpdf.html2pdf.HtmlConverter;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfReader;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.kernel.utils.PdfMerger;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.Outcome;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.QuestionRow;
import vacademy.io.assessment_service.features.assessment.service.aireport.AiReportModel.SectionRow;
import vacademy.io.assessment_service.features.assessment.service.aireport.ReportProfileService.Profile;
import vacademy.io.common.media.service.FileService;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Wraps a student's report in the pages of a report profile: template pages (HTML with
 * live values, e.g. a scholarship letter), uploaded PDFs and images, before and after.
 */
@Slf4j
@Service
public class ReportComposer {

    private final FileService fileService;
    private final AiReportFonts fonts;

    /** Uploaded page files rarely change and are reused for every student of a release. */
    private final Map<String, byte[]> fileCache = new ConcurrentHashMap<>();

    public ReportComposer(FileService fileService, AiReportFonts fonts) {
        this.fileService = fileService;
        this.fonts = fonts;
    }

    public byte[] compose(Profile profile, AiReportModel model, byte[] core) throws Exception {
        if (profile == null || !profile.hasPages()) return core;
        Map<String, Object> ctx = context(model, profile);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (PdfDocument target = new PdfDocument(new PdfWriter(out))) {
            PdfMerger merger = new PdfMerger(target);
            for (JsonNode page : iterable(profile.before())) appendPage(merger, page, ctx, profile);
            append(merger, core);
            for (JsonNode page : iterable(profile.after())) appendPage(merger, page, ctx, profile);
        }
        return out.toByteArray();
    }

    /** Renders one template page alone, for previews. */
    public byte[] renderTemplate(String html, AiReportModel model, Profile profile) {
        return htmlToPdf(fullDocument(ReportTemplateEngine.render(html, context(model, profile))));
    }

    // ── Pages ──

    private void appendPage(PdfMerger merger, JsonNode page, Map<String, Object> ctx, Profile profile) throws Exception {
        String type = page.path("type").asText("");
        switch (type) {
            case "TEMPLATE" -> append(merger, htmlToPdf(fullDocument(templateBody(page, ctx))));
            case "PDF" -> {
                String uri = page.path("data_uri").asText("");
                append(merger, uri.startsWith("data:application/pdf;base64,") ? inlinePdf(uri) : file(page.path("file_id").asText()));
            }
            case "IMAGE" -> {
                String uri = page.path("data_uri").asText("");
                if (uri.isBlank()) uri = dataUri(file(page.path("file_id").asText()));
                append(merger, htmlToPdf(fullDocument("<img src=\"" + uri + "\" style=\"width:100%;\"/>")));
            }
            default -> log.warn("[report-profile] unknown page type {} in profile {}", type, profile.id());
        }
    }

    /**
     * A template page's filled HTML. Pages written in the wizard's simple editor get normal page
     * margins and text size; designed pages (e.g. a styled scholarship letter) bring their own layout.
     */
    static String templateBody(JsonNode page, Map<String, Object> ctx) {
        String body = ReportTemplateEngine.render(page.path("html").asText(""), ctx);
        if (!"simple".equals(page.path("editor").asText(""))) return body;
        return "<div style=\"padding:48px 56px;font-size:13px;line-height:1.55;color:#1f2937;\">" + body + "</div>";
    }

    private static void append(PdfMerger merger, byte[] pdf) throws Exception {
        try (PdfDocument src = new PdfDocument(new PdfReader(new ByteArrayInputStream(pdf)))) {
            merger.merge(src, 1, src.getNumberOfPages());
        }
    }

    private byte[] file(String fileId) {
        return fileCache.computeIfAbsent(fileId, id -> {
            try {
                byte[] b = fileService.getFileFromFileId(id);
                if (b == null || b.length == 0) throw new IllegalStateException("empty file");
                return b;
            } catch (Exception e) {
                throw new IllegalStateException("Report page file " + id + " could not be read: " + e.getMessage(), e);
            }
        });
    }

    /** An inline PDF page (data:application/pdf;base64,...), decoded once and reused for every student. */
    private byte[] inlinePdf(String uri) {
        return fileCache.computeIfAbsent("inline:" + Integer.toHexString(uri.hashCode()) + ":" + uri.length(),
                k -> Base64.getDecoder().decode(uri.substring(uri.indexOf(',') + 1)));
    }

    private static String dataUri(byte[] bytes) {
        boolean png = bytes.length > 4 && (bytes[0] & 0xff) == 0x89 && bytes[1] == 'P';
        return "data:image/" + (png ? "png" : "jpeg") + ";base64," + Base64.getEncoder().encodeToString(bytes);
    }

    private static String fullDocument(String body) {
        if (body.trim().toLowerCase(Locale.ROOT).startsWith("<!doctype") || body.trim().toLowerCase(Locale.ROOT).startsWith("<html")) {
            return body;
        }
        return "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"/><style>@page{size:A4;margin:0;}body{margin:0;font-family:Mukta,sans-serif;}</style></head><body>"
                + body + "</body></html>";
    }

    private byte[] htmlToPdf(String html) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ConverterProperties props = new ConverterProperties();
        props.setFontProvider(fonts.newProvider());
        // Templates may only use inline assets: no base URI, and absolute URLs are refused too,
        // because admins write these pages in the assessment wizard.
        props.setResourceRetriever(NO_NETWORK);
        HtmlConverter.convertToPdf(html, out, props);
        return out.toByteArray();
    }

    /** Fetches nothing: data: images are decoded by iText itself, any other URL resolves to nothing. */
    static final com.itextpdf.styledxmlparser.resolver.resource.IResourceRetriever NO_NETWORK =
            new com.itextpdf.styledxmlparser.resolver.resource.IResourceRetriever() {
                @Override
                public java.io.InputStream getInputStreamByUrl(java.net.URL url) {
                    return null;
                }

                @Override
                public byte[] getByteArrayByUrl(java.net.URL url) {
                    return null;
                }
            };

    // ── Template values ──

    public Map<String, Object> context(AiReportModel m, Profile profile) {
        JsonNode cfg = profile != null ? profile.config() : null;
        Map<String, Object> c = new HashMap<>();
        String name = AiReportHtmlBuilderV2.displayName(m.getStudentName());
        c.put("student_name", name);
        c.put("first_name", AiReportHtmlBuilderV2.firstName(m.getStudentName()));
        c.put("enrollment_number", m.getEnrollmentNumber() == null ? "" : m.getEnrollmentNumber());
        c.put("has_enrollment_number", m.getEnrollmentNumber() != null && !m.getEnrollmentNumber().isBlank());
        c.put("assessment_name", m.getAssessmentName());
        c.put("institute_name", m.getInstituteName() == null ? "" : m.getInstituteName());

        double pct = m.getMaxScore() > 0 ? 100.0 * m.getScore() / m.getMaxScore() : 0;
        c.put("score", AiReportCharts.oneDecimal(m.getScore()));
        c.put("max_score", AiReportCharts.oneDecimal(m.getMaxScore()));
        c.put("percentage", AiReportCharts.oneDecimal(pct));
        c.put("percentage_whole", String.valueOf((long) Math.floor(Math.max(0, pct))));
        boolean ranked = m.getParticipants() != null && m.getParticipants() >= 2 && m.getRank() != null;
        c.put("has_rank", ranked);
        c.put("rank", ranked ? String.valueOf(m.getRank()) : "");
        c.put("participants", m.getParticipants() == null ? "" : String.valueOf(m.getParticipants()));

        List<QuestionRow> qs = m.getQuestions() == null ? List.of() : m.getQuestions();
        int correct = count(qs, Outcome.CORRECT) + count(qs, Outcome.PARTIAL);
        int wrong = count(qs, Outcome.WRONG), skipped = count(qs, Outcome.SKIPPED);
        c.put("questions_count", String.valueOf(qs.size()));
        c.put("attempted", String.valueOf(qs.size() - skipped));
        c.put("correct", String.valueOf(correct));
        c.put("wrong", String.valueOf(wrong));
        c.put("skipped", String.valueOf(skipped));

        List<Map<String, Object>> sections = new ArrayList<>();
        for (SectionRow s : m.getSections() == null ? List.<SectionRow>of() : m.getSections()) {
            List<QuestionRow> sq = qs.stream().filter(q -> q.sectionId().equals(s.id())).toList();
            int sSkipped = count(sq, Outcome.SKIPPED);
            Map<String, Object> row = new HashMap<>();
            row.put("name", s.name());
            row.put("questions", String.valueOf(sq.size()));
            row.put("attempted", String.valueOf(sq.size() - sSkipped));
            row.put("correct", String.valueOf(count(sq, Outcome.CORRECT) + count(sq, Outcome.PARTIAL)));
            row.put("wrong", String.valueOf(count(sq, Outcome.WRONG)));
            row.put("marks", AiReportCharts.oneDecimal(s.score()));
            row.put("max", AiReportCharts.oneDecimal(s.max()));
            sections.add(row);
        }
        c.put("sections", sections);
        c.put("marking_note", m.getMarkingNote() == null ? "" : m.getMarkingNote());

        String resultDate = cfg != null ? cfg.path("result_date").asText("") : "";
        if (resultDate.isBlank()) {
            SimpleDateFormat f = new SimpleDateFormat("d MMMM yyyy", Locale.ENGLISH);
            f.setTimeZone(TimeZone.getTimeZone("Asia/Kolkata"));
            resultDate = f.format(new Date());
        }
        c.put("result_date", resultDate);

        Map<String, Object> assets = new HashMap<>();
        if (cfg != null) cfg.path("assets").fields().forEachRemaining(e -> {
            String v = e.getValue().asText("");
            if (v.startsWith("data:image/")) assets.put(e.getKey(), v);
        });
        if (m.getLogoDataUri() != null) assets.putIfAbsent("institute_logo", m.getLogoDataUri());
        c.put("asset", assets);

        // Ready-made blocks for pages written in the wizard's simple editor, built here as raw
        // HTML ({{{sections_table}}}, {{{logo_img}}}, {{{asset_img.signature}}}).
        c.put("sections_table", sectionsTable(sections));
        c.put("logo_img", m.getLogoDataUri() == null ? "" : img(m.getLogoDataUri(), 64, 200));
        Map<String, Object> assetImages = new HashMap<>();
        assets.forEach((k, v) -> assetImages.put(k, img((String) v, 90, 260)));
        c.put("asset_img", assetImages);

        // Registration answers chosen in the report settings (report_options.student_fields):
        // all on one line ({{student_details}}) or one by one ({{detail.student_roll_number}}).
        List<ReportStudentDetail> details = m.getStudentDetails() == null ? List.of() : m.getStudentDetails();
        List<String> detailParts = new ArrayList<>();
        Map<String, Object> byKey = new HashMap<>();
        for (ReportStudentDetail d : details) {
            if (d == null || d.value() == null || d.value().isBlank()) continue;
            detailParts.add((d.label() == null || d.label().isBlank() ? "" : d.label() + ": ") + d.value());
            String key = detailKey(d.label());
            if (!key.isEmpty()) byKey.putIfAbsent(key, d.value());
        }
        c.put("student_details", String.join(" \u00b7 ", detailParts));
        c.put("detail", byKey);

        String qrUrl = cfg != null ? cfg.path("qr_url").asText("") : "";
        c.put("qr_svg", qrUrl.isBlank() ? "" : qrSvg(qrUrl, cfg.path("qr_size").asInt(128)));

        if (cfg != null) {
            Map<String, Double> basis = Map.of("percentage", pct, "score", m.getScore());
            cfg.path("variables").fields().forEachRemaining(e -> {
                Double v = evaluate(e.getValue(), basis);
                c.put(e.getKey(), v == null ? "" : AiReportCharts.oneDecimal(v));
                c.put("has_" + e.getKey(), v != null && v > 0);
            });
        }
        return c;
    }

    /** "Student Roll Number" -> student_roll_number: the key of {{detail.*}} (the wizard builds the same key). */
    static String detailKey(String label) {
        if (label == null) return "";
        return label.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", "_").replaceAll("^_+|_+$", "");
    }

    private static String img(String dataUri, int maxHeight, int maxWidth) {
        return "<img src=\"" + dataUri.replace("\"", "%22") + "\" style=\"max-height:" + maxHeight + "px;max-width:" + maxWidth + "px;\"/>";
    }

    private static String escHtml(Object v) {
        return v == null ? "" : v.toString().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    /** Section-wise marks as a plain table, for {{{sections_table}}}. Empty when the paper has no sections. */
    static String sectionsTable(List<Map<String, Object>> sections) {
        if (sections == null || sections.isEmpty()) return "";
        String th = "border:1px solid #cbd5e1;padding:5px 8px;background:#f1f5f9;text-align:left;font-size:11px;";
        String td = "border:1px solid #cbd5e1;padding:5px 8px;font-size:11px;";
        StringBuilder t = new StringBuilder("<table style=\"border-collapse:collapse;width:100%;\"><tr>");
        for (String h : new String[]{"Section", "Questions", "Attempted", "Correct", "Wrong", "Marks"}) {
            t.append("<th style=\"").append(th).append("\">").append(h).append("</th>");
        }
        t.append("</tr>");
        for (Map<String, Object> row : sections) {
            t.append("<tr>");
            t.append("<td style=\"").append(td).append("\">").append(escHtml(row.get("name"))).append("</td>");
            for (String k : new String[]{"questions", "attempted", "correct", "wrong"}) {
                t.append("<td style=\"").append(td).append("\">").append(escHtml(row.get(k))).append("</td>");
            }
            t.append("<td style=\"").append(td).append("\">").append(escHtml(row.get("marks"))).append(" / ")
                    .append(escHtml(row.get("max"))).append("</td>");
            t.append("</tr>");
        }
        return t.append("</table>").toString();
    }

    /**
     * A banded value: the first band whose range holds the basis (percentage by default)
     * gives either a number or the name of a basis value. Bands are [from, to), except a band
     * reaching 100 or more also includes its top. Rounded per "round" (DOWN by default).
     */
    static Double evaluate(JsonNode spec, Map<String, Double> basisValues) {
        double basis = basisValues.getOrDefault(spec.path("basis").asText("percentage"), basisValues.get("percentage"));
        for (JsonNode band : iterable(spec.path("bands"))) {
            double from = band.path("from").asDouble(Double.NEGATIVE_INFINITY);
            double to = band.path("to").asDouble(Double.POSITIVE_INFINITY);
            boolean inside = basis >= from && (basis < to || (to >= 100 && basis <= to));
            if (!inside) continue;
            JsonNode value = band.path("value");
            double v = value.isNumber() ? value.asDouble()
                    : basisValues.getOrDefault(value.asText(""), 0.0);
            if (spec.has("max")) v = Math.min(v, spec.path("max").asDouble());
            v = Math.max(v, spec.path("min").asDouble(0));
            return switch (spec.path("round").asText("DOWN").toUpperCase(Locale.ROOT)) {
                case "UP" -> Math.ceil(v);
                case "NEAREST" -> (double) Math.round(v);
                case "NONE" -> v;
                default -> Math.floor(v);
            };
        }
        return null;
    }

    /** A QR code as inline SVG squares (crisp at any size). */
    static String qrSvg(String text, int size) {
        try {
            Map<EncodeHintType, Object> hints = new HashMap<>();
            hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
            ByteMatrix bm = new QRCodeWriter().encode(text, 1, 1, hints);
            // iText's matrix already carries the 4-module quiet zone; 0 = dark, -1 = light.
            int n = bm.getWidth(), quiet = 0, total = n;
            StringBuilder s = new StringBuilder("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"").append(size).append("\" height=\"")
                    .append(size).append("\" viewBox=\"0 0 ").append(total).append(' ').append(total).append("\">")
                    .append("<rect x=\"0\" y=\"0\" width=\"").append(total).append("\" height=\"").append(total).append("\" fill=\"#ffffff\"/>");
            for (int y = 0; y < n; y++) {
                for (int x = 0; x < n; x++) {
                    if (bm.get(x, y) == 0) {
                        s.append("<rect x=\"").append(x + quiet).append("\" y=\"").append(y + quiet)
                                .append("\" width=\"1.02\" height=\"1.02\" fill=\"#000000\"/>");
                    }
                }
            }
            return s.append("</svg>").toString();
        } catch (Exception e) {
            log.warn("[report-profile] QR code could not be made for {}: {}", text, e.getMessage());
            return "";
        }
    }

    private static int count(List<QuestionRow> qs, Outcome o) {
        return (int) qs.stream().filter(q -> q.outcome() == o).count();
    }

    private static Iterable<JsonNode> iterable(JsonNode arr) {
        List<JsonNode> out = new ArrayList<>();
        if (arr != null && arr.isArray()) arr.forEach(out::add);
        return out;
    }
}
