package vacademy.io.admin_core_service.features.telephony.core;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;
import vacademy.io.admin_core_service.features.institute.repository.InstituteRepository;
import vacademy.io.admin_core_service.features.telephony.enums.ConfigRole;
import vacademy.io.admin_core_service.features.telephony.enums.ProviderType;
import vacademy.io.admin_core_service.features.telephony.persistence.entity.InstituteTelephonyConfig;
import vacademy.io.admin_core_service.features.telephony.persistence.repository.InstituteTelephonyConfigRepository;
import vacademy.io.admin_core_service.features.telephony.providers.exotel.ExotelHttpClient;
import vacademy.io.admin_core_service.features.telephony.providers.plivo.PlivoHttpClient;
import vacademy.io.common.institute.entity.Institute;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.function.LongSupplier;

/**
 * Live balances of every enabled Exotel and Plivo account, for the platform portal's Balance tab.
 *
 * <p>Every figure is what the provider's own account API returns for that account's credentials,
 * never an estimate. Each institute's credentials go only to its own provider. Rows carry no
 * secret: an Exotel Account SID is shown as is (it is an account name, not a credential) and a
 * Plivo Auth ID by its last four characters. Errors say what failed without the provider's body.
 *
 * <p>Plivo subaccounts have no wallet of their own: every one draws on our master account, so each
 * reports the same master balance. Those rows are folded into one, so the master balance is shown
 * (and totalled) once. A subaccount whose check failed keeps its own row.
 *
 * <p>Results are cached for {@link #CACHE}; a forced refresh is honoured at most once per
 * {@link #MIN_REFRESH}, so the portal cannot make us hammer the providers.
 */
@Service
public class TelephonyBalanceService {

    private static final Logger log = LoggerFactory.getLogger(TelephonyBalanceService.class);
    private static final ObjectMapper JSON = new ObjectMapper();

    static final Duration CACHE = Duration.ofMinutes(10);
    static final Duration MIN_REFRESH = Duration.ofSeconds(30);
    /** A bound on one refresh's provider calls. */
    static final int MAX_ACCOUNTS = 200;
    private static final int THREADS = 8;

    @Autowired private InstituteTelephonyConfigRepository configRepo;
    @Autowired private TelephonyConfigCache configCache;
    @Autowired private ExotelHttpClient exotelHttp;
    @Autowired private PlivoHttpClient plivoHttp;
    @Autowired private InstituteRepository instituteRepository;

    LongSupplier clock = System::currentTimeMillis;
    private List<Map<String, Object>> cached;
    private long cachedAt;

    public synchronized List<Map<String, Object>> balances(boolean refresh) {
        long age = clock.getAsLong() - cachedAt;
        boolean stale = cached == null || age >= CACHE.toMillis()
                || (refresh && age >= MIN_REFRESH.toMillis());
        if (stale) {
            cached = fetchAll();
            cachedAt = clock.getAsLong();
        }
        return new ArrayList<>(cached);
    }

    List<Map<String, Object>> fetchAll() {
        List<InstituteTelephonyConfig> configs = new ArrayList<>();
        for (String provider : List.of(ProviderType.EXOTEL, ProviderType.PLIVO)) {
            configRepo.findByProviderType(provider).stream()
                    .filter(c -> Boolean.TRUE.equals(c.getEnabled()))
                    .forEach(configs::add);
        }
        configs.sort(Comparator.comparing(InstituteTelephonyConfig::getProviderType)
                .thenComparing(InstituteTelephonyConfig::getInstituteId));
        if (configs.size() > MAX_ACCOUNTS) {
            log.warn("telephony balances: {} accounts, checking the first {}", configs.size(), MAX_ACCOUNTS);
            configs = configs.subList(0, MAX_ACCOUNTS);
        }
        Map<String, String> names = instituteNames(configs);

        ExecutorService pool = Executors.newFixedThreadPool(THREADS);
        try {
            List<Future<Map<String, Object>>> futures = new ArrayList<>();
            for (InstituteTelephonyConfig cfg : configs) {
                futures.add(pool.submit(() -> check(cfg, names.get(cfg.getInstituteId()))));
            }
            List<Map<String, Object>> rows = new ArrayList<>();
            for (int i = 0; i < futures.size(); i++) {
                try {
                    rows.add(futures.get(i).get());
                } catch (Exception e) {
                    InstituteTelephonyConfig cfg = configs.get(i);
                    rows.add(error(cfg, names.get(cfg.getInstituteId()), "The balance check did not finish. Try again later."));
                }
            }
            return collapsePlivo(rows);
        } finally {
            pool.shutdownNow();
        }
    }

    /** Readable Plivo rows all show the shared master balance, so they become one row. */
    static List<Map<String, Object>> collapsePlivo(List<Map<String, Object>> rows) {
        List<Map<String, Object>> out = new ArrayList<>();
        Map<String, Object> master = null;
        int subaccounts = 0;
        for (Map<String, Object> r : rows) {
            if (!"Plivo".equals(r.get("vendor")) || !"ok".equals(r.get("status"))) {
                out.add(r);
                continue;
            }
            subaccounts++;
            if (master == null) master = r;
        }
        if (master != null) {
            Map<String, Object> m = new LinkedHashMap<>(master);
            m.put("account", "Vacademy master account");
            m.put("institute_id", null);
            m.put("institute_name", null);
            m.put("shared_by", subaccounts);
            m.put("message", "Every institute's Plivo subaccount draws on this one balance ("
                    + subaccounts + (subaccounts == 1 ? " subaccount" : " subaccounts") + ").");
            out.add(0, m);
        }
        return out;
    }

    private Map<String, String> instituteNames(List<InstituteTelephonyConfig> configs) {
        Map<String, String> names = new HashMap<>();
        try {
            for (Institute i : instituteRepository.findAllById(
                    configs.stream().map(InstituteTelephonyConfig::getInstituteId).distinct().toList())) {
                names.put(i.getId(), i.getInstituteName());
            }
        } catch (Exception e) {
            log.warn("telephony balances: institute names unavailable ({})", e.getClass().getSimpleName());
        }
        return names;
    }

    /** One account's balance. Never throws: a failure is a row with a message. */
    Map<String, Object> check(InstituteTelephonyConfig cfg, String instituteName) {
        Optional<TelephonyConfigCache.Resolved> resolved = ConfigRole.AI_VOICE.equals(cfg.getRole())
                ? configCache.getForAi(cfg.getInstituteId())
                : configCache.get(cfg.getInstituteId());
        // getForAi falls back to the primary line; only this row's own credentials will do.
        if (resolved.isEmpty() || resolved.get().getConfig() == null
                || !cfg.getId().equals(resolved.get().getConfig().getId())
                || resolved.get().getCredentials() == null) {
            return error(cfg, instituteName, "This institute's saved credentials could not be read");
        }
        String vendor = vendorName(cfg);
        try {
            if (ProviderType.EXOTEL.equals(cfg.getProviderType())) {
                Map<String, Object> raw = parse(exotelHttp.getBalanceRaw(resolved.get().getCredentials()));
                Double amount = TelephonyBalanceParser.toDouble(TelephonyBalanceParser.exotelAmount(raw));
                if (amount == null) return error(cfg, instituteName, "Exotel's response had no balance");
                return row(cfg, instituteName, "ok", amount, TelephonyBalanceParser.exotelCurrency(raw), null);
            }
            Map<String, Object> raw = parse(plivoHttp.getAccountRaw(resolved.get().getCredentials()));
            Double credits = TelephonyBalanceParser.plivoCashCredits(raw);
            if (credits == null) return error(cfg, instituteName, "Plivo's response had no cash credits");
            return row(cfg, instituteName, "ok", credits, "USD", null);
        } catch (HttpStatusCodeException e) {
            int code = e.getStatusCode().value();
            return error(cfg, instituteName, code == 401 || code == 403
                    ? vendor + " refused this institute's saved credentials. They may have been changed in " + vendor + "."
                    : vendor + " returned an error (" + code + "). Try again later.");
        } catch (ResourceAccessException e) {
            return error(cfg, instituteName, "Could not reach " + vendor);
        } catch (Exception e) {
            // The message is left out: it can carry provider text or a URL.
            log.warn("telephony balance for institute {} failed: {}", cfg.getInstituteId(), e.getClass().getSimpleName());
            return error(cfg, instituteName, vendor + " balance could not be read");
        }
    }

    private static Map<String, Object> parse(String body) throws Exception {
        if (body == null || body.isBlank()) return Map.of();
        return JSON.readValue(body, new TypeReference<Map<String, Object>>() {});
    }

    static String vendorName(InstituteTelephonyConfig cfg) {
        return ProviderType.EXOTEL.equals(cfg.getProviderType()) ? "Exotel" : "Plivo";
    }

    /** Exotel's SID names the account; a Plivo Auth ID doubles as the Basic-auth user, so only its tail. */
    static String accountLabel(InstituteTelephonyConfig cfg) {
        String id = cfg.getApiAccountId();
        if (id == null || id.isBlank()) return null;
        String role = ConfigRole.AI_VOICE.equals(cfg.getRole()) ? " (AI line)" : "";
        if (ProviderType.EXOTEL.equals(cfg.getProviderType())) return id.trim() + role;
        String t = id.trim();
        return "subaccount …" + (t.length() <= 4 ? t : t.substring(t.length() - 4)) + role;
    }

    private static Map<String, Object> row(InstituteTelephonyConfig cfg, String instituteName, String status,
                                           Double balance, String currency, String message) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("vendor", vendorName(cfg));
        r.put("account", accountLabel(cfg));
        r.put("institute_id", cfg.getInstituteId());
        r.put("institute_name", instituteName);
        r.put("status", status);
        r.put("kind", "account_balance");
        r.put("balance", balance);
        r.put("currency", currency);
        r.put("spend_per_hour", null);
        r.put("message", message);
        r.put("checked_at", Instant.now().toString());
        return r;
    }

    private static Map<String, Object> error(InstituteTelephonyConfig cfg, String instituteName, String message) {
        return row(cfg, instituteName, "error", null, null, message);
    }
}
