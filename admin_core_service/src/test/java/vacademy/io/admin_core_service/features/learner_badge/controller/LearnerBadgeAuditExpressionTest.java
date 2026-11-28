package vacademy.io.admin_core_service.features.learner_badge.controller;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import org.springframework.http.ResponseEntity;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.learner_badge.dto.AwardBadgeRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinition;
import vacademy.io.admin_core_service.features.learner_badge.dto.BadgeDefinitionRequest;
import vacademy.io.admin_core_service.features.learner_badge.dto.CatalogueBadgeResponse;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Evaluates the learner-badge {@code @Auditable} SpEL for real, reading the strings off the
 * controller so they cannot drift from what is tested. The revoke guard in particular was
 * first written with a null-safe indexer ({@code body?['revoked']}) that SpEL does not have —
 * it parsed as a selection and the contract test caught it; this pins the working form and
 * its meaning (a no-op revoke writes no row, a null response writes no row).
 */
class LearnerBadgeAuditExpressionTest {

    private final SpelExpressionParser parser = new SpelExpressionParser();

    private static Auditable annotationOf(String methodName) {
        for (Method m : LearnerBadgeController.class.getDeclaredMethods()) {
            if (m.getName().equals(methodName) && m.isAnnotationPresent(Auditable.class)) {
                return m.getAnnotation(Auditable.class);
            }
        }
        throw new AssertionError("no @Auditable on LearnerBadgeController#" + methodName);
    }

    private Object evaluate(String expression, Map<String, Object> variables) {
        StandardEvaluationContext ctx = new StandardEvaluationContext();
        variables.forEach(ctx::setVariable);
        return parser.parseExpression(expression).getValue(ctx);
    }

    @Test
    @DisplayName("revoke: the row is written only when the response says revoked=true")
    void revokeCondition() {
        String condition = annotationOf("revoke").conditionExpr();
        assertEquals(Boolean.TRUE, evaluate(condition, Map.of("result", ResponseEntity.ok(Map.of("revoked", true)))));
        assertEquals(Boolean.FALSE, evaluate(condition, Map.of("result", ResponseEntity.ok(Map.of("revoked", false)))));
        Map<String, Object> nullResult = new java.util.HashMap<>();
        nullResult.put("result", null);
        assertEquals(Boolean.FALSE, evaluate(condition, nullResult));

        Map<String, Object> vars = Map.of("badgeId", "badge_x", "userId", "u-1");
        assertEquals("badge_x", evaluate(annotationOf("revoke").entityIdExpr(), vars));
        assertEquals("revoked badge badge_x from learner u-1", evaluate(annotationOf("revoke").descriptionExpr(), vars));
    }

    @Test
    @DisplayName("award: description prefers the badge name, falls back to the id, counts learners")
    void awardDescription() {
        Auditable a = annotationOf("award");
        AwardBadgeRequest named = new AwardBadgeRequest(List.of("u1", "u2"), "badge_x", "Helper", null, null, null);
        assertEquals("awarded badge Helper to 2 learner(s)", evaluate(a.descriptionExpr(), Map.of("request", named)));
        assertEquals("badge_x", evaluate(a.entityIdExpr(), Map.of("request", named)));

        AwardBadgeRequest unnamed = new AwardBadgeRequest(List.of("u1"), "badge_x", null, null, null, null);
        assertEquals("awarded badge badge_x to 1 learner(s)", evaluate(a.descriptionExpr(), Map.of("request", unnamed)));

        Map<String, Object> nullRequest = new java.util.HashMap<>();
        nullRequest.put("request", null);
        // A null request (the aspect still runs when binding failed) must not throw — the aspect
        // would otherwise drop the row; the sentence just degrades.
        assertTrue(String.valueOf(evaluate(a.descriptionExpr(), nullRequest)).endsWith("to 0 learner(s)"));
    }

    @Test
    @DisplayName("catalogue: entity id comes from the created badge in the response body")
    void catalogueExpressions() {
        Auditable a = annotationOf("createCatalogueBadge");
        BadgeDefinition badge = new BadgeDefinition("badge_new", "Kindness", "", "Star", "manual", 0L, true, false);
        CatalogueBadgeResponse body = new CatalogueBadgeResponse(badge, List.of(badge), true);
        assertEquals("badge_new", evaluate(a.entityIdExpr(), Map.of("result", ResponseEntity.ok(body))));
        Map<String, Object> nullResult = new java.util.HashMap<>();
        nullResult.put("result", null);
        assertNull(evaluate(a.entityIdExpr(), nullResult));

        BadgeDefinitionRequest request = new BadgeDefinitionRequest(null, "Kindness", null, null, null, null, null, null);
        assertEquals("created badge Kindness", evaluate(a.descriptionExpr(), Map.of("request", request)));
        assertTrue(a.action().equals("CREATE"));
        assertFalse(a.entityType().isBlank());
    }
}
