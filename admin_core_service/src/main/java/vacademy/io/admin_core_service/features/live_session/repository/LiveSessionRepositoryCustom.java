package vacademy.io.admin_core_service.features.live_session.repository;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import vacademy.io.admin_core_service.features.live_session.dto.LiveSessionVisibilityScope;
import vacademy.io.admin_core_service.features.live_session.dto.SessionSearchRequest;

public interface LiveSessionRepositoryCustom {
    /**
     * @param scope the caller's resolved live-session visibility. An
     *              unrestricted scope adds no predicate, so search behaves
     *              exactly as it did before V524. Pass null for callers that
     *              have no user context.
     */
    Page<LiveSessionRepository.LiveSessionListProjection> searchSessions(SessionSearchRequest request,
                                                                        Pageable pageable,
                                                                        LiveSessionVisibilityScope scope);
}

