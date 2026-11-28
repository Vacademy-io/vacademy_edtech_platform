package vacademy.io.assessment_service.features.assessment.service.aireport;

import com.itextpdf.html2pdf.resolver.font.DefaultFontProvider;
import com.itextpdf.layout.font.FontProvider;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Bundled fonts for the student AI report (classpath {@code fonts/report/}). Read once at
 * startup; each conversion gets its own {@link FontProvider} built from the cached bytes,
 * because iText caches per-document font state on the provider.
 */
@Slf4j
@Component
public class AiReportFonts {

    private static final String[] FILES = {
            "fonts/report/Mukta-Regular.ttf",
            "fonts/report/Mukta-Bold.ttf",
            "fonts/report/Baloo2-SemiBold.ttf",
            "fonts/report/Baloo2-Bold.ttf",
            "fonts/report/Baloo2-ExtraBold.ttf",
            "fonts/report/NotoSansMath-Regular.ttf",
    };

    private final List<byte[]> fonts = new ArrayList<>();

    public AiReportFonts() {
        for (String path : FILES) {
            try (InputStream in = new ClassPathResource(path).getInputStream()) {
                fonts.add(in.readAllBytes());
            } catch (Exception e) {
                log.warn("[ai-report] font {} missing; the PDF will fall back to standard fonts: {}", path, e.getMessage());
            }
        }
    }

    public FontProvider newProvider() {
        // Standard PDF fonts stay registered as the fallback for any glyph the bundled faces lack.
        DefaultFontProvider provider = new DefaultFontProvider(true, false, false);
        for (byte[] font : fonts) provider.addFont(font);
        return provider;
    }
}
