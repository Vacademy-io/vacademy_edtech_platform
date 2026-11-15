package vacademy.io.admin_core_service.features.commerce.storefront.redirect;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.List;
import java.util.Optional;

/**
 * Old URLs of a shop that moved here: {@code site_redirect}. A row answers 301 with a path
 * on the same site, or 410 with none.
 *
 * <p>Lookup order: an EXACT row for the path with its query string, an EXACT row for the path
 * alone, then the longest PREFIX row the path (with its query string) starts with. Each is one
 * read on the unique key {@code (institute_id, match_type, from_path)}; the PREFIX read walks
 * only the PREFIX rows of the institute, which are a handful of pattern rows.
 */
@Service
public class SiteRedirectResolver {

    static final int MAX_PATH_LENGTH = 1024;
    static final int MAX_CODE_LENGTH = 100;

    /** What the edge does: 301 to {@code toPath}, or 410 when {@code toPath} is null. */
    public record Redirect(int statusCode, String toPath) {
    }

    @PersistenceContext
    private EntityManager entityManager;

    @Transactional(readOnly = true)
    public Optional<Redirect> resolve(String instituteId, String rawPath) {
        String full = normalise(rawPath);
        if (instituteId == null || instituteId.isBlank() || full == null) {
            return Optional.empty();
        }
        int query = full.indexOf('?');
        String pathOnly = query < 0 ? full : full.substring(0, query);
        Optional<Redirect> found = exact(instituteId, full);
        if (found.isEmpty() && query >= 0) {
            found = exact(instituteId, pathOnly);
        }
        if (found.isEmpty()) {
            found = first(entityManager.createNativeQuery("""
                            SELECT r.status_code, r.to_path FROM site_redirect r
                            WHERE r.institute_id = :instituteId AND r.match_type = 'PREFIX'
                              AND left(:path, length(r.from_path)) = r.from_path
                            ORDER BY length(r.from_path) DESC
                            """)
                    .setParameter("instituteId", instituteId)
                    .setParameter("path", full)
                    .setMaxResults(1)
                    .getResultList());
        }
        return found.filter(redirect -> safe(redirect, pathOnly));
    }

    /** Where a printed label leads: the product page of the variant the code names. */
    public record ScanTarget(String slug, String sku) {
    }

    /**
     * The code of a printed label ({@code /q/<code>}): the label
     * code, SKU or barcode of a variant, or the code of a single piece. Only a product and a
     * variant that are both ACTIVE are answered, so the route names nothing the shop does not
     * already show; piece and stock detail are not part of the answer.
     */
    @Transactional(readOnly = true)
    public Optional<ScanTarget> scan(String instituteId, String rawCode) {
        String code = rawCode == null ? "" : rawCode.trim();
        if (instituteId == null || instituteId.isBlank() || code.isEmpty() || code.length() > MAX_CODE_LENGTH) {
            return Optional.empty();
        }
        List<?> rows = entityManager.createNativeQuery("""
                        SELECT p.slug, v.sku FROM commerce_variant v
                        JOIN commerce_product p ON p.package_id = v.package_id AND p.institute_id = v.institute_id
                        WHERE v.institute_id = :instituteId AND v.status = 'ACTIVE' AND p.status = 'ACTIVE'
                          AND (v.label_code = :code OR v.sku = :code OR v.barcode = :code
                               OR v.package_session_id IN (SELECT pc.package_session_id FROM commerce_piece pc
                                                           WHERE pc.institute_id = :instituteId AND pc.code = :code))
                        ORDER BY (v.label_code = :code) DESC NULLS LAST, (v.sku = :code) DESC NULLS LAST, v.sku
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("code", code)
                .setMaxResults(1)
                .getResultList();
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Object[] row = (Object[]) rows.get(0);
        return row[0] == null ? Optional.empty()
                : Optional.of(new ScanTarget(row[0].toString(), row[1] == null ? null : row[1].toString()));
    }

    private Optional<Redirect> exact(String instituteId, String path) {
        return first(entityManager.createNativeQuery("""
                        SELECT r.status_code, r.to_path FROM site_redirect r
                        WHERE r.institute_id = :instituteId AND r.match_type = 'EXACT' AND r.from_path = :path
                        """)
                .setParameter("instituteId", instituteId)
                .setParameter("path", path)
                .setMaxResults(1)
                .getResultList());
    }

    private static Optional<Redirect> first(List<?> rows) {
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Object[] row = (Object[]) rows.get(0);
        int status = ((Number) row[0]).intValue();
        return Optional.of(new Redirect(status, row[1] == null ? null : row[1].toString()));
    }

    /**
     * A target is handed out only when it is a path on the same site and not the path that was
     * asked: an absolute or protocol-relative URL would be an open redirect, and a row that
     * points at itself a loop.
     */
    static boolean safe(Redirect redirect, String askedPath) {
        if (redirect.statusCode() == 410) {
            return redirect.toPath() == null;
        }
        String to = redirect.toPath();
        if (redirect.statusCode() != 301 || to == null || !to.startsWith("/") || to.startsWith("//")
                || to.indexOf('\\') >= 0 || to.indexOf('\r') >= 0 || to.indexOf('\n') >= 0) {
            return false;
        }
        int query = to.indexOf('?');
        String target = normalise(query < 0 ? to : to.substring(0, query));
        return target != null && !target.equals(askedPath);
    }

    /**
     * A path as {@code from_path} stores it: percent-decoded (either hex case), Unicode NFC,
     * ASCII lower-cased, slashes collapsed, no trailing slash. The query string is kept as
     * sent. Null for a path that is empty, does not start with a slash or is too long.
     */
    public static String normalise(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim();
        if (value.isEmpty() || value.charAt(0) != '/' || value.length() > MAX_PATH_LENGTH) {
            return null;
        }
        int at = value.indexOf('?');
        String path = at < 0 ? value : value.substring(0, at);
        String query = at < 0 || at == value.length() - 1 ? "" : value.substring(at);
        try {
            // A plus sign is a plus sign in a path, not a space.
            path = URLDecoder.decode(path.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            // A malformed escape: the raw path is compared.
        }
        path = Normalizer.normalize(path, Normalizer.Form.NFC);
        StringBuilder out = new StringBuilder(path.length());
        char last = 0;
        for (int i = 0; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c == '/' && last == '/') {
                continue;
            }
            if (c < 0x20 || c == 0x7F) {
                return null;
            }
            out.append(c >= 'A' && c <= 'Z' ? (char) (c + 32) : c);
            last = c;
        }
        while (out.length() > 1 && out.charAt(out.length() - 1) == '/') {
            out.setLength(out.length() - 1);
        }
        return out + query;
    }
}
