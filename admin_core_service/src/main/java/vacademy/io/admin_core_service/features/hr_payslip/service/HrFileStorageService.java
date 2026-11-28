package vacademy.io.admin_core_service.features.hr_payslip.service;

import com.itextpdf.styledxmlparser.jsoup.Jsoup;
import com.itextpdf.styledxmlparser.jsoup.nodes.Document;
import com.itextpdf.styledxmlparser.jsoup.nodes.Entities;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.media_service.service.MediaService;
import vacademy.io.common.exceptions.VacademyException;
import vacademy.io.common.media.dto.FileDetailsDTO;
import vacademy.io.common.media.dto.InMemoryMultipartFile;

import java.io.ByteArrayOutputStream;

/**
 * HR payslip / bank-export file plumbing: HTML → PDF rendering (same
 * openhtmltopdf pattern as {@code InvoiceService} / {@code StudentReportPdfService}),
 * byte upload to media_service, and byte download back by file id.
 */
@Slf4j
@Service
public class HrFileStorageService {

    @Autowired
    private MediaService mediaService;

    /**
     * Converts an HTML string to PDF bytes using openhtmltopdf (PdfRendererBuilder).
     * Mirrors {@code StudentReportPdfService#generatePdfFromHtml} minus the SVG/image
     * handling (payslips contain neither).
     */
    public byte[] htmlToPdf(String htmlContent) {
        try {
            boolean isCompleteHtml = htmlContent.trim().toLowerCase().startsWith("<!doctype")
                    || htmlContent.trim().toLowerCase().startsWith("<html");
            String htmlWithCss = isCompleteHtml ? htmlContent
                    : "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"/></head><body>" + htmlContent + "</body></html>";

            String xhtml = escapeBareAmpersands(sanitizeToXhtml(htmlWithCss));

            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            builder.withHtmlContent(xhtml, "file:///");
            builder.useDefaultPageSize(210f, 297f, PdfRendererBuilder.PageSizeUnits.MM);
            builder.toStream(outputStream);
            builder.run();

            return outputStream.toByteArray();
        } catch (Exception e) {
            log.error("[HR-FILE] Error generating PDF from HTML", e);
            throw new VacademyException("Failed to generate PDF: " + e.getMessage());
        }
    }

    /** Uploads raw bytes to media_service and returns the file details (id + url). */
    public FileDetailsDTO uploadBytes(String fileName, String contentType, byte[] bytes) {
        try {
            InMemoryMultipartFile file = new InMemoryMultipartFile(fileName, fileName, contentType, bytes);
            FileDetailsDTO details = mediaService.uploadFileV2(file);
            if (details == null || !StringUtils.hasText(details.getId())) {
                throw new VacademyException("media_service returned no file id for " + fileName);
            }
            return details;
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            log.error("[HR-FILE] Failed to upload {} to media_service: {}", fileName, e.getMessage());
            throw new VacademyException("Failed to store file " + fileName + ": " + e.getMessage());
        }
    }

    /**
     * Downloads a stored file's bytes back from media_service by file id.
     * Returns {@code null} when the id cannot be resolved (expired / missing) so
     * callers can decide whether to re-render.
     */
    public byte[] downloadBytes(String fileId) {
        if (!StringUtils.hasText(fileId)) {
            return null;
        }
        try {
            String url = mediaService.getFilePublicUrlById(fileId);
            if (!StringUtils.hasText(url)) return null;
            java.net.URL u = new java.net.URL(url);
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(30000);
            if (conn.getResponseCode() == 200) {
                try (java.io.InputStream is = conn.getInputStream();
                     ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) != -1) baos.write(buf, 0, n);
                    return baos.toByteArray();
                }
            }
        } catch (Exception e) {
            log.warn("[HR-FILE] Could not download bytes for fileId={}: {}", fileId, e.getMessage());
        }
        return null;
    }

    private String sanitizeToXhtml(String html) {
        Document doc = Jsoup.parse(html);
        doc.outputSettings().syntax(Document.OutputSettings.Syntax.xml);
        doc.outputSettings().escapeMode(Entities.EscapeMode.xhtml);
        return doc.html();
    }

    private static String escapeBareAmpersands(String xhtml) {
        if (xhtml == null) return null;
        return xhtml.replaceAll("&(?![A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#x[0-9A-Fa-f]+;)", "&amp;");
    }
}
