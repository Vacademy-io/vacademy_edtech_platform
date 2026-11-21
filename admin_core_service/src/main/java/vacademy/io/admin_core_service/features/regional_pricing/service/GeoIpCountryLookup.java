package vacademy.io.admin_core_service.features.regional_pricing.service;

import com.maxmind.db.Reader;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Country of an IP address, from the free DB-IP "IP to Country Lite" database (MaxMind DB
 * format, CC BY 4.0, https://db-ip.com). Lookups are in memory; nothing is called per request.
 *
 * <p>The database is fetched lazily, on the first lookup, in the background: that request and
 * any made while it downloads get no country (so the normal price), never a delay. Nothing is
 * downloaded at all until an option with regional pricing switched on is actually viewed. Each
 * pod keeps its own copy and re-downloads it once it is older than {@code max-age-days}.
 */
@Slf4j
@Component
public class GeoIpCountryLookup {

    /** IPv4 dotted quad or an IPv6 literal: parsed without any DNS lookup. */
    private static final Pattern IP_LITERAL = Pattern.compile("^[0-9a-fA-F:.]+$");

    @Value("${regional.pricing.geoip.url:https://download.db-ip.com/free/dbip-country-lite-%s.mmdb.gz}")
    private String urlTemplate;

    @Value("${regional.pricing.geoip.path:${java.io.tmpdir}/vacademy-geoip/dbip-country-lite.mmdb}")
    private String path;

    @Value("${regional.pricing.geoip.max-age-days:35}")
    private int maxAgeDays;

    private volatile Reader reader;
    private final AtomicBoolean loading = new AtomicBoolean(false);
    private final ExecutorService loader = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "geoip-loader");
        t.setDaemon(true);
        return t;
    });

    /** ISO-3166 alpha-2 country of a public IP, or empty (private IP, unknown, or database not ready). */
    public Optional<String> countryOf(String ip) {
        InetAddress address = parsePublicIp(ip);
        if (address == null) {
            return Optional.empty();
        }
        Reader current = reader;
        if (current == null) {
            loadInBackground();
            return Optional.empty();
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> record = current.get(address, Map.class);
            Object country = record != null ? record.get("country") : null;
            Object iso = country instanceof Map<?, ?> m ? m.get("iso_code") : null;
            return iso instanceof String s && s.length() == 2 ? Optional.of(s.toUpperCase()) : Optional.empty();
        } catch (Exception e) {
            log.debug("[GeoIP] lookup failed for an address: {}", e.getMessage());
            return Optional.empty();
        }
    }

    static InetAddress parsePublicIp(String ip) {
        if (ip == null) {
            return null;
        }
        String candidate = ip.trim();
        if (candidate.isEmpty() || !IP_LITERAL.matcher(candidate).matches()) {
            return null;
        }
        try {
            InetAddress address = InetAddress.getByName(candidate); // literal: no DNS lookup
            if (address.isLoopbackAddress() || address.isSiteLocalAddress() || address.isLinkLocalAddress()
                    || address.isAnyLocalAddress() || address.isMulticastAddress()) {
                return null;
            }
            return address;
        } catch (Exception e) {
            return null;
        }
    }

    /** Starts loading the database once; callers never wait for it. */
    void loadInBackground() {
        if (loading.compareAndSet(false, true)) {
            loader.submit(() -> {
                try {
                    openOrDownload();
                } catch (Exception e) {
                    log.warn("[GeoIP] country database unavailable, regional pricing falls back to base prices: {}",
                            e.getMessage());
                } finally {
                    loading.set(false);
                }
            });
        }
    }

    /** Once a day per pod: refresh a database that is in use and has gone stale. */
    @Scheduled(cron = "${regional.pricing.geoip.refresh-cron:0 40 2 * * ?}")
    void refreshIfStale() {
        if (reader != null && isStale(Path.of(path))) {
            loadInBackground();
        }
    }

    private void openOrDownload() throws IOException {
        Path file = Path.of(path);
        if (!Files.exists(file) || isStale(file)) {
            download(file);
        }
        Reader fresh = new Reader(file.toFile());
        Reader old = reader;
        reader = fresh;
        if (old != null) {
            try {
                old.close();
            } catch (IOException ignored) {
                // the old reader is no longer used
            }
        }
        log.info("[GeoIP] country database loaded from {}", file);
    }

    private boolean isStale(Path file) {
        try {
            Instant modified = Files.getLastModifiedTime(file).toInstant();
            return modified.isBefore(Instant.now().minus(Duration.ofDays(maxAgeDays)));
        } catch (IOException e) {
            return true;
        }
    }

    /** This month's file, or last month's while this month's is not published yet. */
    private void download(Path file) throws IOException {
        Files.createDirectories(file.getParent());
        IOException last = null;
        for (YearMonth month : new YearMonth[]{YearMonth.now(), YearMonth.now().minusMonths(1)}) {
            String url = String.format(urlTemplate, month);
            Path tmp = Files.createTempFile(file.getParent(), "dbip-", ".tmp");
            try {
                HttpURLConnection conn = (HttpURLConnection) URI.create(url).toURL().openConnection();
                conn.setConnectTimeout(15_000);
                conn.setReadTimeout(120_000);
                if (conn.getResponseCode() != 200) {
                    throw new IOException("HTTP " + conn.getResponseCode() + " for " + url);
                }
                try (InputStream in = new GZIPInputStream(conn.getInputStream())) {
                    Files.copy(in, tmp, StandardCopyOption.REPLACE_EXISTING);
                }
                Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                log.info("[GeoIP] downloaded {} ({} bytes)", url, Files.size(file));
                return;
            } catch (IOException e) {
                last = e;
                Files.deleteIfExists(tmp);
            }
        }
        throw last != null ? last : new IOException("country database download failed");
    }

    @PreDestroy
    void close() {
        loader.shutdownNow();
        Reader current = reader;
        if (current != null) {
            try {
                current.close();
            } catch (IOException ignored) {
                // shutting down
            }
        }
    }
}
