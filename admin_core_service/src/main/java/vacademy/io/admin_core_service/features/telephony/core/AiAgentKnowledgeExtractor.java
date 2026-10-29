package vacademy.io.admin_core_service.features.telephony.core;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.extractor.XWPFWordExtractor;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import vacademy.io.admin_core_service.features.telephony.core.dto.AiAgentKnowledgeDocument;
import vacademy.io.common.exceptions.VacademyException;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

/**
 * Text of a document an admin adds to an AI agent (PDF, DOCX, TXT/MD/CSV). Nothing is
 * stored here: the editor shows the text, the admin can trim it, and saving the agent
 * stores it. A scanned PDF has no text layer and is refused with a message rather than
 * stored empty — OCR is not attempted.
 */
@Component
public class AiAgentKnowledgeExtractor {

    private static final Logger log = LoggerFactory.getLogger(AiAgentKnowledgeExtractor.class);

    /** Larger files are almost always brochures with images; their text fits well below. */
    static final long MAX_FILE_BYTES = 10L * 1024 * 1024;
    static final int MAX_PDF_PAGES = 60;

    public AiAgentKnowledgeDocument extract(MultipartFile file) {
        if (file == null || file.isEmpty()) throw new VacademyException("Choose a file to upload.");
        if (file.getSize() > MAX_FILE_BYTES) throw new VacademyException("Files up to 10 MB.");
        String name = file.getOriginalFilename() == null ? "Document" : file.getOriginalFilename().trim();
        String kind = kindOf(name, file.getContentType());
        String text;
        try (InputStream in = file.getInputStream()) {
            text = switch (kind) {
                case "PDF" -> pdfText(in);
                case "DOCX" -> docxText(in);
                default -> new String(in.readAllBytes(), StandardCharsets.UTF_8);
            };
        } catch (VacademyException e) {
            throw e;
        } catch (Exception e) {
            log.warn("ai-agent knowledge: could not read {} ({}): {}", name, kind, e.getMessage());
            throw new VacademyException("Could not read this file. Upload a PDF, Word (.docx) or text file.");
        }
        text = AiAgentService.cleanKnowledgeText(text);
        if (text.isEmpty()) {
            throw new VacademyException("PDF".equals(kind)
                    ? "No text found in this PDF. It may be a scanned image; paste the text instead."
                    : "No text found in this file.");
        }
        boolean trimmed = text.length() > AiAgentService.MAX_KNOWLEDGE_CHARS;
        if (trimmed) text = text.substring(0, AiAgentService.MAX_KNOWLEDGE_CHARS);
        return AiAgentKnowledgeDocument.builder()
                .id(UUID.randomUUID().toString())
                .name(name.length() > 120 ? name.substring(0, 120) : name)
                .kind(kind)
                .text(text)
                .chars(text.length())
                .addedAt(Instant.now().toString())
                .build();
    }

    static String kindOf(String name, String contentType) {
        String n = name.toLowerCase(Locale.ROOT);
        String ct = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        if (n.endsWith(".pdf") || ct.equals("application/pdf")) return "PDF";
        if (n.endsWith(".docx") || ct.contains("wordprocessingml")) return "DOCX";
        if (n.endsWith(".txt") || n.endsWith(".md") || n.endsWith(".csv") || ct.startsWith("text/")) return "TXT";
        if (n.endsWith(".doc")) {
            throw new VacademyException("Old Word (.doc) files are not supported. Save it as .docx or PDF.");
        }
        throw new VacademyException("Upload a PDF, Word (.docx) or text file.");
    }

    private static String pdfText(InputStream in) throws Exception {
        try (PDDocument doc = PDDocument.load(in)) {
            if (doc.isEncrypted()) {
                throw new VacademyException("This PDF is password-protected. Remove the password and upload it again.");
            }
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            stripper.setEndPage(Math.min(doc.getNumberOfPages(), MAX_PDF_PAGES));
            return stripper.getText(doc);
        }
    }

    private static String docxText(InputStream in) throws Exception {
        try (XWPFDocument doc = new XWPFDocument(in);
             XWPFWordExtractor ex = new XWPFWordExtractor(doc)) {
            return ex.getText();
        }
    }
}
