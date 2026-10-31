package vacademy.io.admin_core_service.features.live_session.controller;

import org.junit.jupiter.api.Test;
import org.springframework.expression.spel.standard.SpelExpressionParser;
import org.springframework.expression.spel.support.StandardEvaluationContext;
import vacademy.io.admin_core_service.features.admin_activity_logs.annotation.Auditable;
import vacademy.io.admin_core_service.features.live_session.dto.DeleteLiveSessionRequest;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionDeleteAuditDTO;
import vacademy.io.admin_core_service.features.live_session.service.GetLiveSessionService;
import vacademy.io.common.auth.model.CustomUserDetails;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Evaluates the real {@code @Auditable} strings on the delete endpoint. The aspect
 * swallows SpEL errors, so a typo here would not fail anything — it would just
 * quietly log the old "deleted 1 live session(s)" line. This pins the wording.
 */
class LiveSessionDeleteAuditExpressionTest {

    private static final SpelExpressionParser PARSER = new SpelExpressionParser();

    private static Auditable auditable() throws Exception {
        return LiveSessionController.class
                .getMethod("deleteLiveSessions", DeleteLiveSessionRequest.class, CustomUserDetails.class)
                .getAnnotation(Auditable.class);
    }

    private static StandardEvaluationContext ctx(DeleteLiveSessionRequest request, Object before) {
        StandardEvaluationContext ctx = new StandardEvaluationContext();
        ctx.setVariable("request", request);
        ctx.setVariable("before", before);
        return ctx;
    }

    @Test
    void captureBeforeCallsTheSnapshotBean() throws Exception {
        GetLiveSessionService service = mock(GetLiveSessionService.class);
        LiveSessionDeleteAuditDTO snapshot = new LiveSessionDeleteAuditDTO("ses-1", "x", List.of());
        when(service.deleteAuditSnapshot(List.of("sch-1"), "schedule")).thenReturn(snapshot);

        StandardEvaluationContext ctx = ctx(new DeleteLiveSessionRequest(List.of("sch-1"), "schedule", false), null);
        ctx.setBeanResolver((context, beanName) -> {
            assertEquals("getLiveSessionService", beanName);
            return service;
        });

        assertSame(snapshot, PARSER.parseExpression(auditable().captureBefore()).getValue(ctx));
    }

    @Test
    void descriptionAndEntityIdUseTheSnapshot() throws Exception {
        LiveSessionDeleteAuditDTO before = new LiveSessionDeleteAuditDTO(
                "ses-1", "live class \"robotics intro\" on 08 Sep 2026 at 10:00 (Asia/Kolkata)", List.of());
        StandardEvaluationContext ctx = ctx(new DeleteLiveSessionRequest(List.of("sch-1"), "schedule", false), before);

        assertEquals("deleted live class \"robotics intro\" on 08 Sep 2026 at 10:00 (Asia/Kolkata)",
                PARSER.parseExpression(auditable().descriptionExpr()).getValue(ctx, String.class));
        assertEquals("ses-1", PARSER.parseExpression(auditable().entityIdExpr()).getValue(ctx, String.class));
    }

    @Test
    void fallsBackToTheOldCountWhenThereIsNoSnapshot() throws Exception {
        StandardEvaluationContext ctx = ctx(new DeleteLiveSessionRequest(List.of("a", "b"), "schedule", null), null);

        assertEquals("deleted 2 live session(s)",
                PARSER.parseExpression(auditable().descriptionExpr()).getValue(ctx, String.class));
        assertNull(PARSER.parseExpression(auditable().entityIdExpr()).getValue(ctx, String.class));
    }
}
