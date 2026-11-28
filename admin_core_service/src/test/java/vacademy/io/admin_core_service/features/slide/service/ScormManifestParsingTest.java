package vacademy.io.admin_core_service.features.slide.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.w3c.dom.Document;
import org.w3c.dom.Element;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** SCORM manifests are parsed without resolving external entities or DTDs. */
class ScormManifestParsingTest {

    private static Document parse(String xml) throws Exception {
        return ScormService.newManifestDocumentBuilder()
                .parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void ordinaryScorm12ManifestStillParses() throws Exception {
        String xml = """
                <?xml version="1.0" encoding="UTF-8"?>
                <manifest identifier="m1" version="1.0"
                    xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
                    xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
                    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                    xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd">
                  <resources>
                    <resource identifier="r1" type="webcontent" adlcp:scormType="sco" href="index_lms.html"/>
                  </resources>
                </manifest>
                """;
        Document doc = parse(xml);
        Element resource = (Element) doc.getElementsByTagName("resource").item(0);
        assertEquals("index_lms.html", resource.getAttribute("href"));
        assertEquals("sco", resource.getAttribute("adlcp:scormType"));
    }

    @Test
    void manifestWithDoctypeToUnreachableDtdStillParses() throws Exception {
        String xml = """
                <?xml version="1.0"?>
                <!DOCTYPE manifest SYSTEM "http://127.0.0.1:1/never.dtd">
                <manifest><resources><resource href="story.html"/></resources></manifest>
                """;
        Document doc = parse(xml);
        assertEquals("story.html",
                ((Element) doc.getElementsByTagName("resource").item(0)).getAttribute("href"));
    }

    @Test
    void externalFileEntityIsNotRead(@TempDir Path dir) throws Exception {
        Path secret = dir.resolve("local.txt");
        Files.writeString(secret, "LOCAL-FILE-CONTENT");
        String xml = "<?xml version=\"1.0\"?>"
                + "<!DOCTYPE manifest [<!ENTITY ext SYSTEM \"" + secret.toUri() + "\">]>"
                + "<manifest><resources><resource href=\"a.html\">&ext;</resource></resources></manifest>";
        Document doc;
        try {
            doc = parse(xml);
        } catch (Exception refused) {
            return; // refusing the document is also acceptable
        }
        assertFalse(doc.getDocumentElement().getTextContent().contains("LOCAL-FILE-CONTENT"));
    }
}
