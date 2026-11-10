package io.vacademy.admin.app.panel.update;

import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;
import android.util.Log;

/**
 * Receives the PackageInstaller session status for {@link PanelUpdaterPlugin}. Declared
 * {@code exported="false"} in src/direct/AndroidManifest.xml and addressed by an explicit
 * intent, so only the platform installer (through our PendingIntent) reaches it.
 *
 * <p>STATUS_PENDING_USER_ACTION carries Android's own confirm screen, which is started here;
 * every other status is recorded for the page.
 */
public class PanelUpdateStatusReceiver extends BroadcastReceiver {

    static final String ACTION_STATUS = "io.vacademy.classroom.UPDATE_STATUS";
    static final String EXTRA_VERSION_CODE = "io.vacademy.classroom.UPDATE_VERSION_CODE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_STATUS.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        long code = intent.getLongExtra(EXTRA_VERSION_CODE, 0L);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = confirmIntent(intent);
            if (confirm == null) {
                PanelUpdaterPlugin.onInstallStatus(context, "FAILURE", "No confirm screen", code);
                return;
            }
            confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                context.startActivity(confirm);
                PanelUpdaterPlugin.onInstallStatus(context, "PENDING_USER_ACTION", null, code);
            } catch (ActivityNotFoundException | SecurityException e) {
                Log.w(PanelUpdaterPlugin.TAG, "Could not open the install confirm screen", e);
                PanelUpdaterPlugin.onInstallStatus(context, "FAILURE", "Could not open the confirm screen", code);
            }
            return;
        }
        PanelUpdaterPlugin.onInstallStatus(context, statusName(status), message, code);
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmIntent(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }

    static String statusName(int status) {
        switch (status) {
            case PackageInstaller.STATUS_SUCCESS:
                return "SUCCESS";
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                return "FAILURE_ABORTED";
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                return "FAILURE_BLOCKED";
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
                return "FAILURE_CONFLICT";
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                return "FAILURE_INCOMPATIBLE";
            case PackageInstaller.STATUS_FAILURE_INVALID:
                return "FAILURE_INVALID";
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                return "FAILURE_STORAGE";
            default:
                return "FAILURE";
        }
    }
}
