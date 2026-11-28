package vacademy.io.admin_core_service.features.admin_activity_logs;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The two `@Auditable` expressions whose *meaning* decides whether a row is
 * written at all, evaluated for real.
 *
 * <p>{@link AuditableAnnotationContractTest} proves every expression parses and
 * references real variables. It cannot prove they behave — and both of these
 * fail silently if they don't: a throwing expression makes the aspect skip the
 * row (audit lost, business call untouched), and a wrong branch stamps an
 * action that never happened.
 */
class AuditableExpressionSemanticsTest {

    private final SpelExpressionParser parser = new SpelExpressionParser();

    /** Copied verbatim from AudienceController#assignCounselor. */
    private static final String ASSIGN_ACTION_EXPR =
            "(#counselorId == null or #counselorId.isBlank()) ? 'UNASSIGN' : 'ASSIGN'";

    /** Copied verbatim from CounsellorWorkbenchController#assign / #reassign. */
    private static final String NOT_A_DRY_RUN = "#result?.body?.dryRun != true";

    /** Copied verbatim from AudienceController#assignCounselor. */
    private static final String ASSIGN_CONDITION =
            "(#counselorId != null and !#counselorId.isBlank()) or #before != null";

    @Test
    @DisplayName("a blank or missing counsellor id resolves to UNASSIGN, without dereferencing null")
    void assignActionExprHandlesBothBranches() {
        assertEquals("UNASSIGN", evaluate(ASSIGN_ACTION_EXPR, ctx -> ctx.setVariable("counselorId", null)));
        assertEquals("UNASSIGN", evaluate(ASSIGN_ACTION_EXPR, ctx -> ctx.setVariable("counselorId", "  ")));
        assertEquals("ASSIGN", evaluate(ASSIGN_ACTION_EXPR, ctx -> ctx.setVariable("counselorId", "user-1")));
    }

    @Test
    @DisplayName("the dry-run guard skips previews and passes real runs, including a null flag")
    void dryRunGuardOnlySkipsPreviews() {
        assertFalse(condition(NOT_A_DRY_RUN, resultWithDryRun(Boolean.TRUE)),
                "a preview must not be recorded as a completed assignment");
        assertTrue(condition(NOT_A_DRY_RUN, resultWithDryRun(Boolean.FALSE)));
        // A DTO that never set the flag must still be logged — the guard exists
        // to exclude previews, not to drop everything it is unsure about.
        assertTrue(condition(NOT_A_DRY_RUN, resultWithDryRun(null)));
        assertTrue(condition(NOT_A_DRY_RUN, null), "a null response must not silently drop the row");
    }

    @Test
    @DisplayName("removing a counsellor from a lead that has none is not recorded")
    void assignConditionSkipsTheUnassignNoOp() {
        // Assigning always counts, whatever was there before.
        assertTrue(assignCondition("user-1", null));
        assertTrue(assignCondition("user-1", "previous-counsellor"));
        // Removing a counsellor that exists is a real change …
        assertTrue(assignCondition(null, "previous-counsellor"));
        assertTrue(assignCondition("   ", "previous-counsellor"));
        // … removing one that was never there is the endpoint's early return.
        assertFalse(assignCondition(null, null));
        assertFalse(assignCondition("  ", null));
    }

    private boolean assignCondition(String counselorId, String before) {
        StandardEvaluationContext ctx = new StandardEvaluationContext();
        ctx.setVariable("counselorId", counselorId);
        ctx.setVariable("before", before);
        return Boolean.TRUE.equals(parser.parseExpression(ASSIGN_CONDITION).getValue(ctx));
    }

    private static Object resultWithDryRun(Boolean dryRun) {
        return new Response(new Body(dryRun));
    }

    /** Stand-ins shaped like ResponseEntity + the assign result DTO. */
    public record Response(Body body) {
        public Body getBody() {
            return body;
        }
    }

    public record Body(Boolean dryRun) {
        public Boolean getDryRun() {
            return dryRun;
        }
    }

    private Object evaluate(String expression, java.util.function.Consumer<StandardEvaluationContext> setup) {
        StandardEvaluationContext ctx = new StandardEvaluationContext();
        setup.accept(ctx);
        return parser.parseExpression(expression).getValue(ctx);
    }

    /**
     * Mirrors {@code AuditableAspect#passesCondition}: only an explicit
     * {@code true} writes the row.
     */
    private boolean condition(String expression, Object result) {
        StandardEvaluationContext ctx = new StandardEvaluationContext();
        ctx.setVariable("result", result);
        return Boolean.TRUE.equals(parser.parseExpression(expression).getValue(ctx));
    }
}
