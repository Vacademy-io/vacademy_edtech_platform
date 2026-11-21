package vacademy.io.admin_core_service.config.db;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.actuate.health.HealthContributor;
import org.springframework.boot.actuate.jdbc.DataSourceHealthIndicator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * The "db" part of /actuator/health checks the primary only.
 *
 * Spring Boot's default checks every DataSource bean, which includes the read replica (directly
 * and again through the routing data source). The readiness probe calls /actuator/health, so a
 * replica that is slow for everyone took every admin-core pod out of rotation at the same moment
 * (2026-10-23, 2026-11-12) and turned slow pages into a full outage. Reads that cannot get a
 * replica connection fail on their own, while the pod keeps serving everything else.
 * The replica still has its own check at /admin-core-service/health/db/read-replica.
 *
 * The bean name is the one Spring Boot's DataSourceHealthContributorAutoConfiguration backs off for.
 */
@Configuration
public class DatabaseHealthConfiguration {

    @Bean(name = "dbHealthContributor")
    public HealthContributor dbHealthContributor(@Qualifier("masterDataSource") DataSource masterDataSource) {
        return new DataSourceHealthIndicator(masterDataSource);
    }
}
