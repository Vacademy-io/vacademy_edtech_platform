package vacademy.io.admin_core_service.features.assignment_ai_evaluation;

import com.sun.net.httpserver.HttpServer;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.service.AssignmentCopyPdfBuilder;
import vacademy.io.admin_core_service.features.assignment_ai_evaluation.service.AssignmentCopyPdfBuilder.SourceFile;
import vacademy.io.common.exceptions.VacademyException;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AssignmentCopyPdfBuilderTest {

    @Test
    void singlePdfIsUsedAsItIs() {
        assertTrue(AssignmentCopyPdfBuilder.isSinglePdf(List.of(new SourceFile("a.pdf", "application/pdf", "u"))));
        assertTrue(AssignmentCopyPdfBuilder.isSinglePdf(List.of(new SourceFile("a.PDF", null, "u"))));
        assertFalse(AssignmentCopyPdfBuilder.isSinglePdf(List.of(new SourceFile("a.jpg", "image/jpeg", "u"))));
        assertFalse(AssignmentCopyPdfBuilder.isSinglePdf(List.of(
                new SourceFile("a.pdf", "application/pdf", "u"), new SourceFile("b.pdf", "application/pdf", "u"))));
    }

    @Test
    void unsupportedFilesAreRefusedBeforeAnyDownload() {
        AssignmentCopyPdfBuilder builder = new AssignmentCopyPdfBuilder();
        VacademyException e = assertThrows(VacademyException.class, () -> builder.build(List.of(
                new SourceFile("page.jpg", "image/jpeg", "http://unreachable.invalid/a"),
                new SourceFile("essay.docx", "application/vnd.openxmlformats", "http://unreachable.invalid/b"))));
        assertTrue(e.getMessage().contains("essay.docx"));
    }

    @Test
    void emptyUploadIsRefused() {
        assertThrows(VacademyException.class, () -> new AssignmentCopyPdfBuilder().build(List.of()));
    }

    @Test
    void photosAndPdfsAreMergedInUploadOrder() throws Exception {
        byte[] twoPagePdf;
        try (PDDocument doc = new PDDocument()) {
            doc.addPage(new PDPage());
            doc.addPage(new PDPage());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            doc.save(out);
            twoPagePdf = out.toByteArray();
        }
        Map<String, byte[]> served = Map.of(
                "/a.jpg", image("jpg", 400, 800),
                "/b.pdf", twoPagePdf,
                "/c.png", image("png", 800, 400));
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            byte[] body = served.get(exchange.getRequestURI().getPath());
            exchange.sendResponseHeaders(body == null ? 404 : 200, body == null ? -1 : body.length);
            if (body != null) {
                exchange.getResponseBody().write(body);
            }
            exchange.close();
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            byte[] merged = new AssignmentCopyPdfBuilder().build(List.of(
                    new SourceFile("a.jpg", "image/jpeg", base + "/a.jpg"),
                    new SourceFile("b.pdf", "application/pdf", base + "/b.pdf"),
                    new SourceFile("c.png", "image/png", base + "/c.png")));
            try (PDDocument doc = PDDocument.load(merged)) {
                assertEquals(4, doc.getNumberOfPages());
                // Photos sit on A4-wide pages that keep their aspect ratio.
                assertEquals(2.0, doc.getPage(0).getMediaBox().getHeight() / doc.getPage(0).getMediaBox().getWidth(), 0.01);
                assertEquals(0.5, doc.getPage(3).getMediaBox().getHeight() / doc.getPage(3).getMediaBox().getWidth(), 0.01);
            }
        } finally {
            server.stop(0);
        }
    }

    private static byte[] image(String format, int width, int height) throws IOException {
        BufferedImage img = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, format, out);
        return out.toByteArray();
    }
}
