package vacademy.io.admin_core_service.features.common.listener;

import jakarta.persistence.PostPersist;
import jakarta.persistence.PostUpdate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.StringUtils;
import vacademy.io.admin_core_service.features.common.entity.CustomFieldValues;
import vacademy.io.admin_core_service.features.common.service.FieldSyncService;
import vacademy.io.admin_core_service.features.common.service.FieldSyncService.CustomFieldValueChange;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Pushes saved custom field values into their mapped system fields
 * (system_field_custom_field_mapping), so a mapping such as City → student.city
 * applies to every save path without each one calling FieldSyncService.
 *
 * Values are collected per transaction and synced once after it commits: writing the
 * student row from inside the flush that persists the value is unsafe, and a rolled-back
 * save must not reach the system field.
 */
@Component
public class CustomFieldValueSyncListener {

    private static final Logger logger = LoggerFactory.getLogger(CustomFieldValueSyncListener.class);

    private static final Object PENDING_KEY = new Object();

    @Autowired
    @Lazy
    private FieldSyncService fieldSyncService;

    @PostPersist
    @PostUpdate
    public void onSaved(CustomFieldValues value) {
        if (value == null || !StringUtils.hasText(value.getValue())) {
            return;
        }
        CustomFieldValueChange change = new CustomFieldValueChange(value.getCustomFieldId(),
                value.getSourceType(), value.getSourceId(), value.getValue());

        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            sync(List.of(change));
            return;
        }
        pendingChanges().put(change.customFieldId() + ":" + change.sourceType() + ":" + change.sourceId(), change);
    }

    @SuppressWarnings("unchecked")
    private Map<String, CustomFieldValueChange> pendingChanges() {
        Map<String, CustomFieldValueChange> pending =
                (Map<String, CustomFieldValueChange>) TransactionSynchronizationManager.getResource(PENDING_KEY);
        if (pending != null) {
            return pending;
        }
        Map<String, CustomFieldValueChange> created = new LinkedHashMap<>();
        TransactionSynchronizationManager.bindResource(PENDING_KEY, created);
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                // Unbind first so a value saved while syncing starts a fresh batch
                // instead of mutating the one being iterated.
                TransactionSynchronizationManager.unbindResourceIfPossible(PENDING_KEY);
                sync(created.values());
            }

            @Override
            public void afterCompletion(int status) {
                TransactionSynchronizationManager.unbindResourceIfPossible(PENDING_KEY);
            }
        });
        return created;
    }

    private void sync(Collection<CustomFieldValueChange> changes) {
        if (changes.isEmpty()) {
            return;
        }
        try {
            fieldSyncService.syncCustomFieldValuesAfterCommit(List.copyOf(changes));
        } catch (Exception e) {
            // The values themselves are saved; a failed system-field sync must never surface
            // as an error on the save that triggered it.
            logger.error("Custom field to system field sync failed for {} values: {}", changes.size(), e.getMessage());
        }
    }
}
