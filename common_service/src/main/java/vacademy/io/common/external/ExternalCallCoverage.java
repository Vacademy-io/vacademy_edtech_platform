package vacademy.io.common.external;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Finds HTTP clients built without {@link ExternalCallLog}, so a new integration cannot fail out
 * of sight of the health dashboard. Each service runs it from its {@code ExternalCallCoverageTest};
 * the build fails and names the file.
 *
 * <p>A client counts as covered when:
 * <ul>
 *   <li>{@code new RestTemplate(...)} sits inside {@code ExternalCallLog.attach(...)};</li>
 *   <li>a file calling {@code WebClient.builder()} or {@code RestClient.builder()/create()} passes
 *       the builder to {@code ExternalCallLog.attach};</li>
 *   <li>a file building a {@code java.net.http.HttpClient} sends through
 *       {@code ExternalCallLog.send/sendAsync};</li>
 *   <li>a file opening an {@code HttpURLConnection} calls {@code ExternalCallLog.connectionFailed}.</li>
 * </ul>
 * A file that never calls a vendor (our own services, S3 files, images) can say so with the comment
 * {@value #NOT_A_VENDOR} followed by the reason; that is visible in review.
 */
public final class ExternalCallCoverage {

    public static final String NOT_A_VENDOR = "external-call-log: not a vendor";

    private static final Pattern NEW_REST_TEMPLATE = Pattern.compile("new\\s+RestTemplate\\s*\\(");

    private ExternalCallCoverage() {
    }

    /** "path: what is missing" for every uncovered client under {@code sourceRoot}. */
    public static List<String> uncovered(Path sourceRoot) throws IOException {
        List<String> out = new ArrayList<>();
        try (Stream<Path> files = Files.walk(sourceRoot)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).sorted().toList()) {
                String src = Files.readString(file);
                if (src.contains(NOT_A_VENDOR)) continue;
                String name = sourceRoot.relativize(file).toString().replace('\\', '/');
                for (String problem : problems(src)) out.add(name + ": " + problem);
            }
        }
        return out;
    }

    static List<String> problems(String src) {
        String code = stripComments(src);
        List<String> out = new ArrayList<>();
        Matcher m = NEW_REST_TEMPLATE.matcher(code);
        while (m.find()) {
            String before = code.substring(Math.max(0, m.start() - 60), m.start()).replaceAll("\\s+", "");
            if (!before.endsWith("ExternalCallLog.attach(")) {
                out.add("new RestTemplate(...) not wrapped in ExternalCallLog.attach(...)");
            }
        }
        boolean attaches = code.contains("ExternalCallLog.attach(");
        if ((code.contains("WebClient.builder()") || code.contains("WebClient.create(")) && !attaches) {
            out.add("WebClient built without ExternalCallLog.attach(WebClient.builder())");
        }
        if ((code.contains("RestClient.builder()") || code.contains("RestClient.create(")) && !attaches) {
            out.add("RestClient built without ExternalCallLog.attach");
        }
        if ((code.contains("HttpClient.newHttpClient()") || code.contains("HttpClient.newBuilder()"))
                && !code.contains("ExternalCallLog.send") && !code.contains("ExternalCallLog.attach(")) {
            out.add("java.net.http.HttpClient used without ExternalCallLog.send/sendAsync");
        }
        if (code.contains(".openConnection(") && !code.contains("ExternalCallLog.connectionFailed(")
                && !code.contains("ExternalCallLog.openStream(")) {
            out.add("HttpURLConnection used without ExternalCallLog.connectionFailed");
        }
        return out;
    }

    private static String stripComments(String src) {
        return src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)(^|\\s)//.*$", "$1");
    }
}
