package vacademy.io.admin_core_service.features.assignment_ai_evaluation.service;

import org.apache.pdfbox.io.MemoryUsageSetting;
import org.apache.pdfbox.multipdf.PDFMergerUtility;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.springframework.stereotype.Component;
import vacademy.io.common.exceptions.VacademyException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Locale;

/**
 * Turns a learner's assignment upload - any mix of PDFs and photos - into the single
 * PDF the copy-check grader reads. Photos become one A4-wide page each, in upload order.
 */
@Component
public class AssignmentCopyPdfBuilder {

    /** ai_service refuses copies above 60 MB; stop well before downloading that much. */
    static final long MAX_TOTAL_BYTES = 50L * 1024 * 1024;

    public record SourceFile(String name, String fileType, String url) {
    }

    enum Kind { PDF, IMAGE, UNSUPPORTED }

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    public byte[] build(List<SourceFile> files) {
        if (files == null || files.isEmpty()) {
            throw new VacademyException("This submission has no uploaded files to evaluate");
        }
        for (SourceFile file : files) {
            if (kindOf(file) == Kind.UNSUPPORTED) {
                throw new VacademyException("The AI Evaluator reads PDF and image (JPG, PNG) uploads only - \""
                        + file.name() + "\" cannot be checked");
            }
        }
        long total = 0;
        try (PDDocument out = new PDDocument(MemoryUsageSetting.setupTempFileOnly())) {
            PDFMergerUtility merger = new PDFMergerUtility();
            for (SourceFile file : files) {
                byte[] bytes = download(file, MAX_TOTAL_BYTES - total);
                total += bytes.length;
                if (kindOf(file) == Kind.PDF) {
                    try (PDDocument part = PDDocument.load(bytes)) {
                        merger.appendDocument(out, part);
                    }
                } else {
                    addImagePage(out, bytes, file.name());
                }
            }
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            out.save(buffer);
            return buffer.toByteArray();
        } catch (IOException e) {
            throw new VacademyException("Could not read the submitted files: " + e.getMessage());
        }
    }

    static Kind kindOf(SourceFile file) {
        String type = file.fileType() == null ? "" : file.fileType().toLowerCase(Locale.ROOT);
        String name = file.name() == null ? "" : file.name().toLowerCase(Locale.ROOT);
        if (type.contains("pdf") || name.endsWith(".pdf")) {
            return Kind.PDF;
        }
        if (type.contains("jpeg") || type.contains("jpg") || type.contains("png")
                || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png")) {
            return Kind.IMAGE;
        }
        return Kind.UNSUPPORTED;
    }

    /** True when the upload is already one PDF and can be graded as it is. */
    public static boolean isSinglePdf(List<SourceFile> files) {
        return files != null && files.size() == 1 && kindOf(files.get(0)) == Kind.PDF;
    }

    private static void addImagePage(PDDocument doc, byte[] bytes, String name) throws IOException {
        PDImageXObject image = PDImageXObject.createFromByteArray(doc, bytes, name);
        // Page as wide as A4, as tall as the photo's aspect needs: the pixels stay as
        // they are, only the page they sit on is scaled.
        float width = PDRectangle.A4.getWidth();
        float height = width * image.getHeight() / Math.max(1, image.getWidth());
        PDPage page = new PDPage(new PDRectangle(width, height));
        doc.addPage(page);
        try (PDPageContentStream content = new PDPageContentStream(doc, page)) {
            content.drawImage(image, 0, 0, width, height);
        }
    }

    private byte[] download(SourceFile file, long budget) throws IOException {
        if (file.url() == null || file.url().isBlank()) {
            throw new VacademyException("Could not get a link to \"" + file.name() + "\"");
        }
        HttpRequest request = HttpRequest.newBuilder(URI.create(file.url()))
                .timeout(Duration.ofSeconds(60))
                .GET()
                .build();
        try {
            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() / 100 != 2) {
                throw new VacademyException("Could not download \"" + file.name() + "\" (HTTP " + response.statusCode() + ")");
            }
            try (InputStream in = response.body()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[64 * 1024];
                long read = 0;
                int n;
                while ((n = in.read(chunk)) != -1) {
                    read += n;
                    if (read > budget) {
                        throw new VacademyException("The submitted files are larger than 50 MB together - too big for the AI Evaluator");
                    }
                    buffer.write(chunk, 0, n);
                }
                return buffer.toByteArray();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("download interrupted", e);
        }
    }
}
