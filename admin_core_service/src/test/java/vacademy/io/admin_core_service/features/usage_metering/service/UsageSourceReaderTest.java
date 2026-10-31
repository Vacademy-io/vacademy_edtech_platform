package vacademy.io.admin_core_service.features.usage_metering.service;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.ListObjectsV2Request;
import com.amazonaws.services.s3.model.ListObjectsV2Result;
import com.amazonaws.services.s3.model.S3Object;
import com.amazonaws.services.s3.model.S3ObjectSummary;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import vacademy.io.admin_core_service.features.usage_metering.config.UsageS3Config.UsageS3Client;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.zip.GZIPOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Parsing of the three real source formats, from lines in the shape AWS writes them. */
class UsageSourceReaderTest {

    private AmazonS3 s3;
    private UsageSourceReader reader;
    private final List<String> seen = new ArrayList<>();
    private final List<Long> sizes = new ArrayList<>();

    @BeforeEach
    void setUp() {
        s3 = mock(AmazonS3.class);
        reader = new UsageSourceReader(new UsageS3Client(s3), new ObjectMapper(),
                "reports", "cdn-logs", "DIST");
    }

    /** Answers listObjectsV2 by prefix (and delimiter) from the given listings. */
    private void listings(Map<String, List<String>> keysByPrefix, Map<String, List<String>> prefixesByPrefix) {
        when(s3.listObjectsV2(any(ListObjectsV2Request.class))).thenAnswer(inv -> {
            ListObjectsV2Request req = inv.getArgument(0);
            ListObjectsV2Result res = new ListObjectsV2Result();
            if (req.getDelimiter() != null) {
                res.getCommonPrefixes().addAll(prefixesByPrefix.getOrDefault(req.getPrefix(), List.of()));
            } else {
                for (String k : keysByPrefix.getOrDefault(req.getPrefix(), List.of())) {
                    S3ObjectSummary s = new S3ObjectSummary();
                    s.setKey(k);
                    res.getObjectSummaries().add(s);
                }
            }
            return res;
        });
    }

    private void object(String bucket, String key, byte[] content) {
        when(s3.getObject(eq(bucket), eq(key))).thenAnswer(inv -> {
            S3Object o = new S3Object();
            o.setObjectContent(new ByteArrayInputStream(content));
            return o;
        });
    }

    private static byte[] gzip(String text) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (GZIPOutputStream gz = new GZIPOutputStream(bytes)) {
            gz.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return bytes.toByteArray();
    }

    @Test
    void cdnLogsCountGetBytesPerDecodedKey() throws Exception {
        String log = """
                #Version: 1.0
                #Fields: date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status cs(Referer)
                2026-10-30\t09:24:53\tPNQ50-P3\t1048576\t2401:db8::1\tGET\td1.cloudfront.net\t/inst-1/COURSES/a%20b.mp4\t206\t-
                2026-10-30\t09:24:47\tDEL54-P1\t285\t2409:db8::2\tGET\td1.cloudfront.net\t/inst-1/COURSES/cover.jpg\t304\t-
                2026-10-30\t09:24:48\tDEL54-P1\t500\t2409:db8::2\tHEAD\td1.cloudfront.net\t/inst-1/COURSES/cover.jpg\t200\t-
                """;
        listings(Map.of("DIST/DIST.2026-10-30-", List.of("DIST/DIST.2026-10-30-09.a.gz")), Map.of());
        object("cdn-logs", "DIST/DIST.2026-10-30-09.a.gz", gzip(log));

        reader.readCdnLogs(LocalDate.parse("2026-10-30"), (key, bytes) -> {
            seen.add(key);
            sizes.add(bytes);
        });
        assertEquals(List.of("inst-1/COURSES/a b.mp4", "inst-1/COURSES/cover.jpg"), seen);
        assertEquals(List.of(1048576L, 285L), sizes);
    }

    @Test
    void s3AccessLogsCountSuccessfulGetsButNotCloudFrontOriginFetches() throws Exception {
        String base = "s3-access/media/";
        String day = "s3-access/media/111/ap-south-1/media/2026/10/30/";
        String log = String.join("\n",
                "owner media [30/Oct/2026:09:00:01 +0000] 1.2.3.4 - REQ1 REST.GET.OBJECT BBB_RECORDING/m1/rec%20one.mp4 \"GET /BBB_RECORDING/m1/rec%20one.mp4?X-Amz-Signature=x HTTP/1.1\" 206 - 5000000 300000000 120 30 \"https://learner.example\" \"Mozilla/5.0 (Windows NT 10.0)\" - hid SigV4 ECDHE AuthHeader media.s3.ap-south-1.amazonaws.com TLSv1.3 - -",
                "owner media [30/Oct/2026:09:00:02 +0000] 1.2.3.5 - REQ2 REST.GET.OBJECT inst-1/a.pdf \"GET /inst-1/a.pdf HTTP/1.1\" 200 - 2000 2000 10 5 \"-\" \"Amazon CloudFront\" - hid SigV4 ECDHE AuthHeader media.s3.ap-south-1.amazonaws.com TLSv1.3 - -",
                "owner media [30/Oct/2026:09:00:03 +0000] 1.2.3.6 - REQ3 REST.GET.OBJECT inst-1/b.pdf \"GET /inst-1/b.pdf HTTP/1.1\" 403 AccessDenied 243 - 10 - \"-\" \"curl/8\" - hid - - - media.s3.ap-south-1.amazonaws.com - - -",
                "owner media [30/Oct/2026:09:00:04 +0000] 1.2.3.7 arn:aws:iam::111:user/x REQ4 REST.PUT.OBJECT inst-1/c.pdf \"PUT /inst-1/c.pdf HTTP/1.1\" 200 - - 9000 10 5 \"-\" \"aws-sdk-java\" - hid SigV4 ECDHE AuthHeader media.s3.ap-south-1.amazonaws.com TLSv1.3 - -");
        listings(Map.of(day, List.of(day + "2026-10-30-09-00-00-ABC")),
                Map.of(base, List.of("s3-access/media/111/"),
                        "s3-access/media/111/", List.of("s3-access/media/111/ap-south-1/")));
        object("reports", day + "2026-10-30-09-00-00-ABC", log.getBytes(StandardCharsets.UTF_8));

        reader.readS3AccessLogs("media", LocalDate.parse("2026-10-30"), (key, bytes) -> {
            seen.add(key);
            sizes.add(bytes);
        });
        assertEquals(List.of("BBB_RECORDING/m1/rec one.mp4"), seen);
        assertEquals(List.of(5000000L), sizes);
    }

    @Test
    void inventoryUsesTheNewestReportAndSkipsDeleteMarkers() throws Exception {
        String root = "inventory/media/daily-usage/";
        listings(Map.of(), Map.of(root, List.of(root + "2026-10-31T01-00Z/", root + "2026-11-01T01-00Z/",
                root + "data/", root + "hive/")));
        object("reports", root + "2026-11-01T01-00Z/manifest.json", """
                {"sourceBucket":"media","fileFormat":"CSV",
                 "fileSchema":"Bucket, Key, Size, LastModifiedDate, StorageClass, IntelligentTieringAccessTier",
                 "files":[{"key":"inventory/media/daily-usage/data/f1.csv.gz","size":1}]}
                """.getBytes(StandardCharsets.UTF_8));
        object("reports", "inventory/media/daily-usage/data/f1.csv.gz", gzip(
                "\"media\",\"inst-1/PDF_DOCUMENTS/my+notes%282%29.pdf\",\"1234\",\"2026-10-01T00:00:00.000Z\",\"INTELLIGENT_TIERING\",\"FREQUENT\"\n"
                        + "\"media\",\"inst-1/deleted.pdf\",\"\",\"\",\"\",\"\"\n"));

        Optional<LocalDate> date = reader.readLatestInventory("media", (key, bytes) -> {
            seen.add(key);
            sizes.add(bytes);
        });
        assertEquals(Optional.of(LocalDate.parse("2026-11-01")), date);
        assertEquals(List.of("inst-1/PDF_DOCUMENTS/my notes(2).pdf"), seen);
        assertEquals(List.of(1234L), sizes);
    }
}
