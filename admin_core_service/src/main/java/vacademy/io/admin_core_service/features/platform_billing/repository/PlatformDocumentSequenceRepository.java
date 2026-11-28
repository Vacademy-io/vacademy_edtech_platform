package vacademy.io.admin_core_service.features.platform_billing.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformDocumentSequence;
import vacademy.io.admin_core_service.features.platform_billing.entity.PlatformDocumentSequenceId;

/**
 * Read access to {@code platform_document_sequence}. Numbers are allocated only through
 * {@code PlatformDocumentSequenceService#next} (one atomic upsert ... RETURNING inside the
 * document's own transaction), never through save().
 */
public interface PlatformDocumentSequenceRepository
        extends JpaRepository<PlatformDocumentSequence, PlatformDocumentSequenceId> {
}
