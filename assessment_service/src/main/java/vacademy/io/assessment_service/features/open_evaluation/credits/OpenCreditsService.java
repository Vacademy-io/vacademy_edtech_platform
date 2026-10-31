package vacademy.io.assessment_service.features.open_evaluation.credits;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import vacademy.io.assessment_service.features.assessment.client.AiServiceCreditClient;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCharge;
import vacademy.io.assessment_service.features.assessment.service.evaluation_ai.billing.AiEvaluationCreditGate;
import vacademy.io.assessment_service.features.open_evaluation.error.ApiErrorCode;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiErrors;
import vacademy.io.assessment_service.features.open_evaluation.error.OpenApiException;
import vacademy.io.assessment_service.features.open_evaluation.submission.RateSources;
import vacademy.io.assessment_service.features.open_evaluation.submission.dto.SubmissionInputs;
import vacademy.io.assessment_service.features.open_evaluation.upload.EvalApiUploadStore;
import vacademy.io.assessment_service.features.open_evaluation.upload.OpenUploadService;
import vacademy.io.common.auth.apikey.ApiKeyPrincipal;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * {@code GET /credits} and {@code POST /credits/quote} (spec 7.11, T1.28).
 *
 * <p>Prices come from ai_service ({@code /credits/v1/estimate-tool} with the institute, so an
 * institute's own price applies) for {@code copy_check_evaluation_api}: per page for
 * handwritten copies, per non-blank long answer for typed ones, fixed price. The balance comes
 * with the same answer. {@code committed} is what this institute's queued and running checks
 * were quoted; {@code available = balance + credit_limit − committed}. A credit service that
 * cannot be reached is 503 {@code engine_unavailable} (never a guess).
 */
@Service
public class OpenCreditsService {

    public static final int MAX_QUOTE_UPLOADS = 100;
    public static final long MAX_QUOTE_UNITS = 10_000_000L;
    static final String NOTE = "Fixed price: 1 credit per page of a graded copy at the standard rate. "
            + "Failed, cancelled and unreadable copies are free.";
    static final String TYPED_NOTE = "Fixed price per non-blank long answer. Failed and cancelled submissions are free.";

    private final AiServiceCreditClient creditClient;
    private final AiEvaluationCreditGate creditGate;
    private final EvalApiUploadStore uploadStore;
    private final OpenUploadService uploads;
    private final NamedParameterJdbcTemplate jdbc;
    private Clock clock = Clock.systemUTC();

    @Autowired
    public OpenCreditsService(AiServiceCreditClient creditClient, AiEvaluationCreditGate creditGate,
            EvalApiUploadStore uploadStore, OpenUploadService uploads, JdbcTemplate jdbcTemplate) {
        this(creditClient, creditGate, uploadStore, uploads, new NamedParameterJdbcTemplate(jdbcTemplate));
    }

    OpenCreditsService(AiServiceCreditClient creditClient, AiEvaluationCreditGate creditGate,
            EvalApiUploadStore uploadStore, OpenUploadService uploads, NamedParameterJdbcTemplate jdbc) {
        this.creditClient = creditClient;
        this.creditGate = creditGate;
        this.uploadStore = uploadStore;
        this.uploads = uploads;
        this.jdbc = jdbc;
    }

    void setClock(Clock clock) {
        this.clock = clock;
    }

    // ------------------------------------------------------------------ GET /credits

    public Map<String, Object> credits(ApiKeyPrincipal key) {
        AiServiceCreditClient.ToolEstimate perPage = estimate(key, AiEvaluationCharge.apiHandwritten(1));
        Object typedPerAnswer = param(perPage, "typed_per_answer");
        if (typedPerAnswer == null) {
            AiServiceCreditClient.ToolEstimate typed = estimate(key, AiEvaluationCharge.apiTyped(1));
            typedPerAnswer = typed.credits() == null ? null : OpenApiErrors.plain(typed.credits());
        }
        Balance b = balance(key, perPage);

        Map<String, Object> rateCard = new LinkedHashMap<>();
        rateCard.put("tool", AiEvaluationCharge.API_TOOL_KEY);
        rateCard.put("unit", "page");
        rateCard.put("credits_per_page", perPage.credits() == null ? null : OpenApiErrors.plain(perPage.credits()));
        rateCard.put("typed_credits_per_answer", typedPerAnswer);
        Object fixed = param(perPage, "fixed_price");
        rateCard.put("fixed_price", fixed == null || Boolean.TRUE.equals(fixed) || "true".equals(String.valueOf(fixed)));
        rateCard.put("rate_source", RateSources.publicName(str(perPage.rateSnapshot().get("rate_source"))));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("balance", OpenApiErrors.plain(b.balance()));
        out.put("credit_limit", OpenApiErrors.plain(b.creditLimit()));
        out.put("committed", OpenApiErrors.plain(b.committed()));
        out.put("available", OpenApiErrors.plain(b.available()));
        out.put("rate_card", rateCard);
        out.put("spent_30d", spent30d(key.getInstituteId()));
        return out;
    }

    // ------------------------------------------------------------------ POST /exams quote

    /** The create response must not wait on ai_service: a slow or absent price omits the block. */
    static final Duration EXAM_RATE_TIMEOUT = Duration.ofSeconds(2);

    /**
     * The {@code quote} block of the POST /exams response (spec 7.1): the rate of the exam's
     * unit, from the same ai_service estimate the submission quote and GET /credits use.
     * {@code {"unit":"page","credits_per_page":1,"rate_source":"standard"}} for a handwritten
     * exam, {@code {"unit":"answer","credits_per_answer":1,…}} for a typed one. Best effort:
     * null (block left out) when the credit service does not answer within
     * {@link #EXAM_RATE_TIMEOUT}; creating the exam never fails on it.
     */
    public Map<String, Object> examRate(ApiKeyPrincipal key, boolean typed) {
        try {
            AiEvaluationCharge charge = typed ? AiEvaluationCharge.apiTyped(1) : AiEvaluationCharge.apiHandwritten(1);
            AiServiceCreditClient.ToolEstimate est = creditClient.estimate(charge.toolKey(), charge.params(),
                    key.getInstituteId(), EXAM_RATE_TIMEOUT);
            if (est == null || !est.reachable() || est.credits() == null) {
                return null;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("unit", typed ? "answer" : "page");
            out.put(typed ? "credits_per_answer" : "credits_per_page", OpenApiErrors.plain(est.credits()));
            out.put("rate_source", RateSources.publicName(str(est.rateSnapshot().get("rate_source"))));
            return out;
        } catch (RuntimeException e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ POST /credits/quote

    public Map<String, Object> quote(ApiKeyPrincipal key, SubmissionInputs.Quote body) {
        int given = (body != null && body.getPages() != null ? 1 : 0)
                + (body != null && body.getUploadIds() != null ? 1 : 0)
                + (body != null && body.getTypedAnswers() != null ? 1 : 0);
        if (given != 1) {
            throw OpenApiException.validation("pages", "required", "Send exactly one of pages, upload_ids or typed_answers.");
        }
        if (body.getTypedAnswers() != null) {
            long answers = units("typed_answers", body.getTypedAnswers());
            AiServiceCreditClient.ToolEstimate est = estimate(key, AiEvaluationCharge.apiTyped((int) answers));
            Balance b = balance(key, est);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("unit", "answer");
            out.put("credits_per_answer", perUnit(est, answers));
            out.put("typed_answers", answers);
            putTotals(out, est, b, TYPED_NOTE);
            return out;
        }
        long pages;
        if (body.getPages() != null) {
            pages = units("pages", body.getPages());
        } else {
            pages = pagesOfUploads(key, body.getUploadIds());
        }
        AiServiceCreditClient.ToolEstimate est = estimate(key, AiEvaluationCharge.apiHandwritten((int) pages));
        Balance b = balance(key, est);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("unit", "page");
        out.put("credits_per_page", perUnit(est, pages));
        out.put("pages", pages);
        putTotals(out, est, b, NOTE);
        return out;
    }

    /** Exact page count of ready uploads; pending ones are checked first (HEAD + page count). */
    long pagesOfUploads(ApiKeyPrincipal key, List<String> uploadIds) {
        if (uploadIds.isEmpty() || uploadIds.size() > MAX_QUOTE_UPLOADS) {
            throw OpenApiException.validation("upload_ids", "out_of_range", "Send 1 to " + MAX_QUOTE_UPLOADS + " upload_ids.");
        }
        Set<String> unique = new LinkedHashSet<>(uploadIds);
        Map<String, EvalApiUploadStore.UploadRow> byId = new LinkedHashMap<>();
        uploadStore.findByIds(key.getInstituteId(), unique).forEach(r -> byId.put(r.id(), r));
        List<String> missing = new ArrayList<>();
        for (String id : unique) {
            if (!byId.containsKey(id)) {
                missing.add(id);
            }
        }
        if (!missing.isEmpty()) {
            throw new OpenApiException(HttpStatus.NOT_FOUND, ApiErrorCode.UPLOAD_NOT_FOUND,
                    missing.size() + " upload id(s) are unknown.", Map.of("upload_ids", missing));
        }
        long pages = 0;
        for (String id : unique) {
            EvalApiUploadStore.UploadRow row = byId.get(id);
            if (row.isPending()) {
                uploads.get(key, id); // validates
                row = uploadStore.find(key.getInstituteId(), id).orElse(row);
            }
            if (row.isRejected()) {
                OpenUploadService.refuseUnusable(row);
            }
            if (!row.isReady() || row.pages() == null) {
                throw new OpenApiException(HttpStatus.UNPROCESSABLE_ENTITY, ApiErrorCode.UPLOAD_REJECTED,
                        "Upload " + id + " has not been uploaded yet; PUT it to upload_url first.",
                        Map.of("upload_id", id, "reason", "not_uploaded"));
            }
            pages += row.pages();
        }
        return pages;
    }

    // ------------------------------------------------------------------ helpers

    record Balance(BigDecimal balance, BigDecimal creditLimit, BigDecimal committed, BigDecimal available) {
    }

    Balance balance(ApiKeyPrincipal key, AiServiceCreditClient.ToolEstimate est) {
        BigDecimal balance = est.currentBalance() == null ? BigDecimal.ZERO : est.currentBalance();
        BigDecimal limit = key.getCreditLimit() == null || key.getCreditLimit().signum() < 0 ? BigDecimal.ZERO
                : key.getCreditLimit();
        BigDecimal committed = creditGate.committed(key.getInstituteId());
        return new Balance(balance, limit, committed, balance.add(limit).subtract(committed));
    }

    private AiServiceCreditClient.ToolEstimate estimate(ApiKeyPrincipal key, AiEvaluationCharge charge) {
        AiServiceCreditClient.ToolEstimate est = creditClient.estimate(charge.toolKey(), charge.params(),
                key.getInstituteId());
        if (est == null || !est.reachable() || est.credits() == null) {
            throw OpenApiErrors.engineUnavailable(30);
        }
        return est;
    }

    private static void putTotals(Map<String, Object> out, AiServiceCreditClient.ToolEstimate est, Balance b, String note) {
        out.put("total", OpenApiErrors.plain(est.credits()));
        out.put("available", OpenApiErrors.plain(b.available()));
        out.put("committed", OpenApiErrors.plain(b.committed()));
        out.put("sufficient", b.available().compareTo(est.credits()) >= 0);
        out.put("rate_source", RateSources.publicName(str(est.rateSnapshot().get("rate_source"))));
        out.put("note", note);
    }

    /** The per-unit rate when ai_service sent it, else total / units. */
    static Number perUnit(AiServiceCreditClient.ToolEstimate est, long units) {
        Object perUnit = est.rateSnapshot().get("per_unit_credits");
        if (perUnit != null) {
            try {
                return OpenApiErrors.plain(new BigDecimal(perUnit.toString()));
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }
        if (units <= 0) {
            return null;
        }
        return OpenApiErrors.plain(est.credits().divide(BigDecimal.valueOf(units), 4, RoundingMode.HALF_UP));
    }

    private static long units(String field, Long value) {
        if (value == null || value < 1 || value > MAX_QUOTE_UNITS) {
            throw OpenApiException.validation(field, "out_of_range", field + " must be between 1 and " + MAX_QUOTE_UNITS + ".");
        }
        return value;
    }

    private static Object param(AiServiceCreditClient.ToolEstimate est, String name) {
        Object params = est.rateSnapshot().get("params");
        return params instanceof Map<?, ?> m ? m.get(name) : null;
    }

    private static String str(Object value) {
        return value == null ? null : value.toString();
    }

    /** Completed API checks of the last 30 days (fixed price: the quote is the charge). */
    Map<String, Object> spent30d(String instituteId) {
        Map<String, Object> out = new LinkedHashMap<>();
        Timestamp since = Timestamp.from(clock.instant().minus(Duration.ofDays(30)));
        jdbc.query("""
                SELECT COUNT(*) AS copies, COALESCE(SUM(page_count), 0) AS pages,
                       COALESCE(SUM(quoted_credits), 0) AS credits
                FROM ai_evaluation_process
                WHERE institute_id = :inst AND api_key_id IS NOT NULL AND status = 'COMPLETED'
                  AND completed_at >= :since
                """, new MapSqlParameterSource().addValue("inst", instituteId).addValue("since", since), rs -> {
            out.put("copies", rs.getLong("copies"));
            out.put("pages", rs.getLong("pages"));
            out.put("credits", OpenApiErrors.plain(rs.getBigDecimal("credits")));
        });
        if (out.isEmpty()) {
            out.put("copies", 0);
            out.put("pages", 0);
            out.put("credits", 0);
        }
        return out;
    }
}
