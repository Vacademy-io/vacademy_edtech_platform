package vacademy.io.admin_core_service.features.usage_metering.service;

import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.model.ListObjectsV2Request;
import com.amazonaws.services.s3.model.ListObjectsV2Result;
import com.amazonaws.services.s3.model.S3Object;
import com.amazonaws.services.s3.model.S3ObjectSummary;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import vacademy.io.admin_core_service.features.usage_metering.config.UsageS3Config.UsageS3Client;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Streams the raw usage sources out of S3, one object (key + bytes) at a time:
 * <ul>
 *   <li>storage: the latest daily S3 Inventory report of each media bucket;</li>
 *   <li>CDN bandwidth: CloudFront standard access logs for one UTC day;</li>
 *   <li>direct bandwidth: S3 server access logs (presigned and raw-URL downloads)
 *       for one UTC day, excluding CloudFront's own origin fetches.</li>
 * </ul>
 * Keys in all three sources are URL-encoded and are decoded here.
 */
@Slf4j
@Component
public class UsageSourceReader {

    /** Fields of an S3 server access log line, up to the user agent. */
    private static final Pattern S3_ACCESS_LINE = Pattern.compile(
            "^(\\S+) (\\S+) \\[([^\\]]+)\\] (\\S+) (\\S+) (\\S+) (\\S+) (\\S+) \"([^\"]*)\" (\\S+) (\\S+) (\\S+) (\\S+) (\\S+) (\\S+) \"([^\"]*)\" \"([^\"]*)\"");

    private final UsageS3Client client;
    private final ObjectMapper objectMapper;
    private final String reportsBucket;
    private final String cdnLogsBucket;
    private final String cdnDistributionId;

    public UsageSourceReader(UsageS3Client client,
                             ObjectMapper objectMapper,
                             @Value("${usage.s3.reports-bucket:vacademy-usage-reports}") String reportsBucket,
                             @Value("${usage.s3.cdn-logs-bucket:vacademy-cloudfront-logs}") String cdnLogsBucket,
                             @Value("${usage.s3.cdn-distribution-id:E2R7SGQ1KNIW31}") String cdnDistributionId) {
        this.client = client;
        this.objectMapper = objectMapper;
        this.reportsBucket = reportsBucket;
        this.cdnLogsBucket = cdnLogsBucket;
        this.cdnDistributionId = cdnDistributionId;
    }

    public boolean configured() {
        return client.configured();
    }

    @FunctionalInterface
    public interface ObjectSink {
        void accept(String key, long bytes);
    }

    @FunctionalInterface
    public interface RequestSink {
        void accept(String key, long bytesSent);
    }

    /**
     * Reads the newest inventory report of {@code bucket} and feeds every object to the sink.
     *
     * @return the report's date, or empty when the bucket has no report yet
     */
    public Optional<LocalDate> readLatestInventory(String bucket, ObjectSink sink) throws IOException {
        AmazonS3 s3 = client.s3();
        String root = "inventory/" + bucket + "/daily-usage/";
        String latest = null;
        for (String prefix : listCommonPrefixes(s3, reportsBucket, root)) {
            String folder = prefix.substring(root.length(), prefix.length() - 1);
            // Report folders are named like 2026-11-01T01-00Z; skip data/ and hive/.
            if (folder.matches("\\d{4}-\\d{2}-\\d{2}T.*") && (latest == null || folder.compareTo(latest) > 0)) {
                latest = folder;
            }
        }
        if (latest == null) {
            return Optional.empty();
        }
        String manifestKey = root + latest + "/manifest.json";
        JsonNode manifest;
        try (S3Object obj = s3.getObject(reportsBucket, manifestKey)) {
            manifest = objectMapper.readTree(obj.getObjectContent());
        }
        List<String> schema = new ArrayList<>();
        for (String f : manifest.path("fileSchema").asText().split(",")) {
            schema.add(f.trim());
        }
        int keyIdx = schema.indexOf("Key");
        int sizeIdx = schema.indexOf("Size");
        if (keyIdx < 0 || sizeIdx < 0) {
            throw new IOException("Inventory " + manifestKey + " has no Key/Size column: " + schema);
        }
        for (JsonNode file : manifest.path("files")) {
            try (S3Object obj = s3.getObject(reportsBucket, file.path("key").asText());
                 BufferedReader in = gunzip(obj)) {
                String line;
                while ((line = in.readLine()) != null) {
                    // Keys are URL-encoded, so a raw comma or quote never appears inside a field.
                    String[] cols = line.split(",", -1);
                    if (cols.length <= Math.max(keyIdx, sizeIdx)) continue;
                    String size = unquote(cols[sizeIdx]);
                    if (size.isEmpty()) continue; // delete marker
                    sink.accept(decode(unquote(cols[keyIdx])), Long.parseLong(size));
                }
            }
        }
        return Optional.of(LocalDate.parse(latest.substring(0, 10)));
    }

    /** CloudFront standard logs for one UTC day: object key and bytes sent per request. */
    public void readCdnLogs(LocalDate day, RequestSink sink) throws IOException {
        AmazonS3 s3 = client.s3();
        String prefix = cdnDistributionId + "/" + cdnDistributionId + "." + day + "-";
        for (String key : listKeys(s3, cdnLogsBucket, prefix)) {
            try (S3Object obj = s3.getObject(cdnLogsBucket, key); BufferedReader in = gunzip(obj)) {
                String line;
                while ((line = in.readLine()) != null) {
                    if (line.startsWith("#")) continue;
                    String[] f = line.split("\t", 10);
                    // date time x-edge-location sc-bytes c-ip cs-method cs(Host) cs-uri-stem sc-status ...
                    if (f.length < 9 || !"GET".equals(f[5])) continue;
                    long bytes = parseLong(f[3]);
                    if (bytes <= 0) continue;
                    String uri = f[7].startsWith("/") ? f[7].substring(1) : f[7];
                    sink.accept(decode(uri), bytes);
                }
            }
        }
    }

    /**
     * S3 server access logs of {@code bucket} for one UTC day: successful object GETs
     * that left AWS. CloudFront's origin fetches (user agent "Amazon CloudFront") are
     * skipped, as the CDN logs already count what CloudFront delivered.
     */
    public void readS3AccessLogs(String bucket, LocalDate day, RequestSink sink) throws IOException {
        AmazonS3 s3 = client.s3();
        // Partitioned layout: s3-access/<bucket>/<account>/<region>/<bucket>/YYYY/MM/DD/<file>
        String base = "s3-access/" + bucket + "/";
        String datePath = String.format("%04d/%02d/%02d/", day.getYear(), day.getMonthValue(), day.getDayOfMonth());
        for (String account : listCommonPrefixes(s3, reportsBucket, base)) {
            for (String region : listCommonPrefixes(s3, reportsBucket, account)) {
                for (String key : listKeys(s3, reportsBucket, region + bucket + "/" + datePath)) {
                    try (S3Object obj = s3.getObject(reportsBucket, key);
                         BufferedReader in = new BufferedReader(
                                 new InputStreamReader(obj.getObjectContent(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = in.readLine()) != null) {
                            Matcher m = S3_ACCESS_LINE.matcher(line);
                            if (!m.find()) continue;
                            String operation = m.group(7);
                            String status = m.group(10);
                            String userAgent = m.group(17);
                            if (!operation.startsWith("REST.GET.OBJECT")
                                    || !(status.equals("200") || status.equals("206"))
                                    || userAgent.contains("Amazon CloudFront")) continue;
                            long bytes = parseLong(m.group(12));
                            if (bytes <= 0) continue;
                            sink.accept(decode(m.group(8)), bytes);
                        }
                    }
                }
            }
        }
    }

    private static BufferedReader gunzip(S3Object obj) throws IOException {
        return new BufferedReader(new InputStreamReader(new GZIPInputStream(obj.getObjectContent()), StandardCharsets.UTF_8));
    }

    private static List<String> listCommonPrefixes(AmazonS3 s3, String bucket, String prefix) {
        List<String> prefixes = new ArrayList<>();
        ListObjectsV2Request req = new ListObjectsV2Request().withBucketName(bucket).withPrefix(prefix).withDelimiter("/");
        ListObjectsV2Result res;
        do {
            res = s3.listObjectsV2(req);
            prefixes.addAll(res.getCommonPrefixes());
            req.setContinuationToken(res.getNextContinuationToken());
        } while (res.isTruncated());
        return prefixes;
    }

    private static List<String> listKeys(AmazonS3 s3, String bucket, String prefix) {
        List<String> keys = new ArrayList<>();
        ListObjectsV2Request req = new ListObjectsV2Request().withBucketName(bucket).withPrefix(prefix);
        ListObjectsV2Result res;
        do {
            res = s3.listObjectsV2(req);
            for (S3ObjectSummary s : res.getObjectSummaries()) {
                keys.add(s.getKey());
            }
            req.setContinuationToken(res.getNextContinuationToken());
        } while (res.isTruncated());
        return keys;
    }

    private static String unquote(String s) {
        return s.length() >= 2 && s.startsWith("\"") && s.endsWith("\"") ? s.substring(1, s.length() - 1) : s;
    }

    static String decode(String s) {
        try {
            return URLDecoder.decode(s, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return s; // a stray '%' — attribution only needs the path segments
        }
    }

    private static long parseLong(String s) {
        try {
            return Long.parseLong(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
