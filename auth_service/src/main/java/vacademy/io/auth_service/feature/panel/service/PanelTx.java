package vacademy.io.auth_service.feature.panel.service;

import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.function.Supplier;

/**
 * Runs a short unit of panel work in one transaction, so the JPA reads and the panel SQL share a
 * single connection instead of a request holding two. A deadlock or lock failure is retried once in
 * a new transaction; a second failure is reported as TRY_AGAIN.
 */
@Component
public class PanelTx {

    private final TransactionTemplate template;

    public PanelTx(PlatformTransactionManager transactionManager) {
        this.template = new TransactionTemplate(transactionManager);
    }

    public <T> T run(Supplier<T> work) {
        try {
            return template.execute(status -> work.get());
        } catch (ConcurrencyFailureException first) {
            try {
                return template.execute(status -> work.get());
            } catch (ConcurrencyFailureException second) {
                throw PanelApiException.tryAgain();
            }
        }
    }
}
