package vacademy.io.admin_core_service.features.telephony.controller;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyBalanceParser;
import vacademy.io.admin_core_service.features.telephony.core.TelephonyConfigCache;
import vacademy.io.admin_core_service.features.telephony.providers.exotel.ExotelHttpClient;
import vacademy.io.common.exceptions.VacademyException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Provider-specific read-only endpoints used by the admin UI to bootstrap
 * configuration. Today this is just the "list all ExoPhones on the Exotel
 * account" call — drives the Numbers card's "Sync from Exotel" button so
 * admins don't have to manually copy ExoPhone Sids out of the dashboard.
 *
 * Each provider gets its own controller path so the wire shape stays
 * native — the UI calls one endpoint per provider, the response is the
 * provider's own data with friendly aliases mapped in.
 */
@RestController
@RequestMapping("/admin-core-service/v1/telephony/exotel")
public class TelephonyExotelSyncController {

    @Autowired private TelephonyConfigCache configCache;
    @Autowired private ExotelHttpClient exotelHttp;

    /**
     * List every ExoPhone visible to the institute's Exotel account. The
     * response shape mirrors Exotel's: each row carries {@code sid},
     * {@code phone_number}, {@code friendly_name}, and {@code voice_url}
     * (whose tail identifies the currently-attached flow). The UI uses
     * these to either pre-fill the "Add number" form or detect numbers
     * already on file.
     */
    @GetMapping("/exophones")
    public ResponseEntity<List<Map<String, Object>>> listExoPhones(
            @RequestParam("instituteId") String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        var resolved = configCache.get(instituteId)
                .orElseThrow(() -> new VacademyException(
                        "Telephony is not configured for this institute"));

        Map<String, Object> raw;
        try {
            raw = exotelHttp.listExoPhones(resolved.getCredentials());
        } catch (Exception e) {
            // Surface the Exotel-side message so the admin can act on it
            // (most common case is wrong API key/token).
            throw new VacademyException("Could not fetch ExoPhones from Exotel: "
                    + (e.getMessage() == null ? "unknown" : e.getMessage()));
        }

        return ResponseEntity.ok(extractRows(raw));
    }

    /**
     * Pull the {@code incoming_phone_numbers} array out of Exotel's envelope.
     * Defensive about shape — Exotel has changed envelope structure between
     * API versions and we don't want this controller to be brittle to that.
     */
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> extractRows(Map<String, Object> envelope) {
        if (envelope == null) return List.of();
        Object rows = envelope.get("incoming_phone_numbers");
        if (rows == null) rows = envelope.get("IncomingPhoneNumbers");
        if (!(rows instanceof List<?> list)) return List.of();
        List<Map<String, Object>> out = new ArrayList<>(list.size());
        for (Object item : list) {
            if (item instanceof Map<?, ?> m) {
                Map<String, Object> tidy = new LinkedHashMap<>();
                copyIfPresent(m, tidy, "sid", "Sid");
                copyIfPresent(m, tidy, "phone_number", "PhoneNumber");
                copyIfPresent(m, tidy, "friendly_name", "FriendlyName");
                copyIfPresent(m, tidy, "voice_url", "VoiceUrl");
                copyIfPresent(m, tidy, "capabilities", "Capabilities");
                copyIfPresent(m, tidy, "date_created", "DateCreated");
                out.add(tidy);
            }
        }
        return out;
    }

    private static void copyIfPresent(Map<?, ?> src, Map<String, Object> dst,
                                      String snakeKey, String pascalKey) {
        Object v = src.get(snakeKey);
        if (v == null) v = src.get(pascalKey);
        if (v != null) dst.put(snakeKey, v);
    }

    /**
     * Current balance on the institute's Exotel account. Surfaced on the
     * Calling settings page so the admin sees how many credits are left
     * without leaving the dashboard. Response is a tidy slice of Exotel's
     * envelope:
     *   { "balance": "1543.75", "currency": "INR",
     *     "pricingPlan": "Pay As You Go", "dateUpdated": "..." }
     */
    @GetMapping("/balance")
    @SuppressWarnings("unchecked")
    public ResponseEntity<Map<String, Object>> getBalance(
            @RequestParam("instituteId") String instituteId) {
        if (instituteId == null || instituteId.isBlank()) {
            throw new VacademyException("instituteId is required");
        }
        var resolved = configCache.get(instituteId)
                .orElseThrow(() -> new VacademyException(
                        "Telephony is not configured for this institute"));

        String rawBody;
        try {
            rawBody = exotelHttp.getBalanceRaw(resolved.getCredentials());
        } catch (Exception e) {
            throw new VacademyException("Could not fetch balance from Exotel: "
                    + (e.getMessage() == null ? "unknown" : e.getMessage()));
        }

        // Log the raw bytes EXACTLY as Exotel sent them — sidesteps any
        // silent JSON-binder coercion that would mask the real payload.
        org.slf4j.LoggerFactory.getLogger(TelephonyExotelSyncController.class)
                .info("exotel balance raw response body: [{}]", rawBody);

        Map<String, Object> out = new LinkedHashMap<>();
        if (rawBody == null || rawBody.isBlank()) return ResponseEntity.ok(out);

        // Parse the body with a plain Jackson reader — Spring's RestTemplate
        // binding can drop the payload if content-type negotiation goes
        // sideways (e.g. CBOR negotiation), but the raw String parse is direct.
        Map<String, Object> raw;
        try {
            raw = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(rawBody, Map.class);
        } catch (Exception e) {
            throw new VacademyException("Exotel returned a non-JSON balance body: "
                    + (rawBody.length() > 200 ? rawBody.substring(0, 200) + "…" : rawBody));
        }
        if (raw == null || raw.isEmpty()) return ResponseEntity.ok(out);

        // Exotel's actual production response (verified against shikshanation1
        // account on 2026-06-05) is dramatically simpler than their public
        // docs claim: just {"Balance": {"Amount": 618.3}}. No Account wrapper,
        // no Currency / PricingPlan / DateUpdated. Extract Amount directly
        // first; fall through to the docs-shape (Account.BalanceData.*) for
        // accounts on different tiers that match the legacy envelope.
        Object balance = TelephonyBalanceParser.exotelAmount(raw);
        if (balance != null) {
            out.put("balance", balance);
        }
        Object currency = extractFromPaths(raw, "Currency",
                new String[] { "Account", "BalanceData", "Currency" });
        if (currency != null) out.put("currency", currency);
        Object pricingPlan = extractFromPaths(raw, "PricingPlan",
                new String[] { "Account", "BalanceData", "PricingPlan" });
        if (pricingPlan != null) out.put("pricingPlan", pricingPlan);
        Object dateUpdated = extractFromPaths(raw, "DateUpdated",
                new String[] { "Account", "BalanceData", "DateUpdated" });
        if (dateUpdated != null) out.put("dateUpdated", dateUpdated);
        return ResponseEntity.ok(out);
    }

    /**
     * Look for {@code topKey} at top level first, then walk the given
     * {@code nestedPath} as a fallback. Returns the first scalar found, or
     * null if nothing matches.
     */
    private static Object extractFromPaths(Map<String, Object> raw, String topKey,
                                            String[] nestedPath) {
        Object v = raw.get(topKey);
        if (v instanceof String || v instanceof Number || v instanceof Boolean) return v;
        Map<?, ?> cur = raw;
        for (String step : nestedPath) {
            if (cur == null) return null;
            Object next = cur.get(step);
            if (next instanceof String || next instanceof Number || next instanceof Boolean) {
                return next;
            }
            cur = next instanceof Map<?, ?> m ? m : null;
        }
        return null;
    }

}
