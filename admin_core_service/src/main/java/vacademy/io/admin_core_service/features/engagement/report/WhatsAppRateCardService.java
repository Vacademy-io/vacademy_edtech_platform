package vacademy.io.admin_core_service.features.engagement.report;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Date;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;

/**
 * Price of one WhatsApp message from the {@code whatsapp_rate_card} table (V632): Meta's webhook
 * says whether a message was billable and its category, never the amount.
 *
 * <p>The recipient's country is the longest country_code in the table that prefixes the
 * recipient's digits (decided across all categories, so a missing category never falls back to a
 * shorter code); the price is that country's row for the category with the latest
 * effective_from on or before the day. No match = null (the report counts it as missing).
 *
 * <p>A rate card that cannot be read THROWS, never "no rates": the report then says WhatsApp cost
 * is unavailable (and is not cached) instead of showing every message as unpriced.
 */
@Service
public class WhatsAppRateCardService {

    private static final String SQL = """
            SELECT country_code, category, currency, price, effective_from
            FROM whatsapp_rate_card
            """;

    record Rate(String countryCode, String category, String currency, double price, LocalDate effectiveFrom) {
    }

    /** One message's rate: per message, in {@code currency}. */
    public record Price(String countryCode, String category, String currency, double rate) {
    }

    private final NamedParameterJdbcTemplate jdbc;
    private final Cache<String, List<Rate>> cache = Caffeine.newBuilder()
            .expireAfterWrite(Duration.ofMinutes(10))
            .maximumSize(1)
            .build();

    public WhatsAppRateCardService(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param recipient phone in any format (digits are read); @param category Meta category, any case
     * @throws org.springframework.dao.DataAccessException the rate card could not be read (not
     *         cached; the next call tries again, e.g. right after the migration runs)
     */
    public Price priceFor(String recipient, String category, LocalDate day) {
        if (recipient == null || category == null || day == null) return null;
        String digits = recipient.replaceAll("\\D", "");
        if (digits.isEmpty()) return null;
        String cat = category.trim().toLowerCase(Locale.ROOT);
        List<Rate> rates = rates();

        String country = null;
        for (Rate r : rates) {
            if (digits.startsWith(r.countryCode())
                    && (country == null || r.countryCode().length() > country.length())) {
                country = r.countryCode();
            }
        }
        if (country == null) return null;

        Rate best = null;
        for (Rate r : rates) {
            if (r.countryCode().equals(country) && r.category().equals(cat) && !r.effectiveFrom().isAfter(day)
                    && (best == null || r.effectiveFrom().isAfter(best.effectiveFrom()))) {
                best = r;
            }
        }
        return best == null ? null : new Price(country, cat, best.currency(), best.price());
    }

    /** A loader that throws caches nothing, so a failed read is retried on the next call. */
    private List<Rate> rates() {
        return cache.get("all", k -> load());
    }

    private List<Rate> load() {
        return jdbc.query(SQL, new MapSqlParameterSource(), (rs, i) -> {
            Date from = rs.getDate("effective_from");
            return new Rate(rs.getString("country_code").trim(),
                    rs.getString("category").trim().toLowerCase(Locale.ROOT),
                    rs.getString("currency"),
                    rs.getBigDecimal("price").doubleValue(),
                    from.toLocalDate());
        });
    }
}
