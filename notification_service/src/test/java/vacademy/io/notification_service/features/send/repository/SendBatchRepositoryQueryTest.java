package vacademy.io.notification_service.features.send.repository;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import vacademy.io.notification_service.features.send.entity.SendBatch;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/** Runs the new update queries for real: they are invalid-at-boot if the JPQL is wrong. */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.datasource.url=jdbc:h2:mem:sendbatch;MODE=PostgreSQL",
        "spring.datasource.driver-class-name=org.h2.Driver",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
@ContextConfiguration(classes = SendBatchRepositoryQueryTest.Config.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class SendBatchRepositoryQueryTest {

    @SpringBootConfiguration
    @EnableAutoConfiguration
    @EntityScan(basePackageClasses = SendBatch.class)
    @EnableJpaRepositories(basePackageClasses = SendBatchRepository.class)
    static class Config {
    }

    @Autowired
    private SendBatchRepository repository;

    private SendBatch saved(String id, String source, String status) {
        return repository.save(SendBatch.builder().id(id).instituteId("i").channel("EMAIL").source(source)
                .status(status).totalRecipients(100).requestPayload("{}").build());
    }

    @Test
    void claimRunsForExactlyOneCaller() {
        saved("claim", "WORKFLOW", "QUEUED");
        assertThat(repository.claimBatch("claim", LocalDateTime.now())).isEqualTo(1);
        assertThat(repository.claimBatch("claim", LocalDateTime.now())).isZero();
        assertThat(repository.findById("claim").orElseThrow().getStatus()).isEqualTo("PROCESSING");
    }

    @Test
    void progressAndFinishKeepThePayload() {
        saved("finish", "WORKFLOW", "PROCESSING");
        repository.updateProgress("finish", 50, 2, LocalDateTime.now());
        assertThat(repository.findById("finish").orElseThrow().getSentCount()).isEqualTo(50);

        repository.finishBatch("finish", "COMPLETED", 98, 2, null, "[]", LocalDateTime.now());

        SendBatch batch = repository.findById("finish").orElseThrow();
        assertThat(batch.getStatus()).isEqualTo("COMPLETED");
        assertThat(batch.getFailedCount()).isEqualTo(2);
        assertThat(batch.getErrorMessage()).isNull();
        assertThat(batch.getCompletedAt()).isNotNull();
        assertThat(batch.getRequestPayload()).isEqualTo("{}");
    }

    @Test
    void staleLookupFindsOnlyPacedUnfinishedRecentBatches() {
        saved("stale-paced", "WORKFLOW", "PROCESSING");
        saved("stale-live", "ADMIN_CORE", "PROCESSING");
        saved("stale-done", "WORKFLOW", "COMPLETED");
        LocalDateTime now = LocalDateTime.now();

        List<Object[]> rows = repository.findStaleEmailBatches(
                Set.of("WORKFLOW"), now.plusMinutes(1), now.minusHours(24));

        assertThat(rows).extracting(row -> row[0]).contains("stale-paced")
                .doesNotContain("stale-live", "stale-done");
        assertThat(repository.findStaleEmailBatches(Set.of("WORKFLOW"), now.plusMinutes(1), now.plusMinutes(1))
                .stream().map(row -> row[0])).doesNotContain("stale-paced");
    }

    @Test
    void requeueOnlyTakesAStaleUnfinishedBatch() {
        saved("requeue", "WORKFLOW", "PROCESSING");
        LocalDateTime now = LocalDateTime.now();
        assertThat(repository.requeueStaleBatch("requeue", now.minusMinutes(5), now)).isZero();
        assertThat(repository.requeueStaleBatch("requeue", now.plusMinutes(1), now)).isEqualTo(1);
        assertThat(repository.findById("requeue").orElseThrow().getStatus()).isEqualTo("QUEUED");

        saved("stopped", "WORKFLOW", "STOPPED");
        assertThat(repository.requeueStaleBatch("stopped", now.plusMinutes(1), now)).isZero();
    }
}
