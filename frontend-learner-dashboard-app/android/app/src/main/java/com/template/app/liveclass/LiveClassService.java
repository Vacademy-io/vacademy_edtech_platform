package io.vacademy.student.app.liveclass;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import io.vacademy.student.app.MainActivity;
import io.vacademy.student.app.R;

/**
 * Foreground service held for the length of a live class (started by LiveClassPlugin.enterClass,
 * stopped by exitClass). It owns no class logic — it only marks the process as user-visible so:
 *  - the microphone keeps capturing when the app is backgrounded / the screen locks (Android 9+
 *    silences the mic for background apps; on 11+ that needs a "microphone"-type FGS), and
 *  - the WebView's audio/JS are not frozen (Android 12+ freezes cached processes).
 *
 * Types: microphone|mediaPlayback (manifest). The microphone type is only claimed when
 * RECORD_AUDIO is granted (API 34+ throws SecurityException otherwise); if the microphone type is
 * still refused we fall back to mediaPlayback only, and if even that is refused the service just
 * stops — the class carries on, only without background protection.
 *
 * Started with startService (not startForegroundService), so a refused startForeground can never
 * crash the app with "did not then call startForeground".
 */
public class LiveClassService extends Service {

    public static final String EXTRA_TITLE = "title";

    private static final String TAG = "LiveClassService";
    private static final String CHANNEL_ID = "live_class";
    private static final int NOTIFICATION_ID = 4721;

    private boolean inForeground = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent == null ? null : intent.getStringExtra(EXTRA_TITLE);
        ensureChannel(this);
        Notification notification = buildNotification(this, title);

        if (!goForeground(notification)) {
            inForeground = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        inForeground = true;
        // Never restart after a process kill: the WebView (and the class) died with the process.
        return START_NOT_STICKY;
    }

    private boolean goForeground(Notification notification) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            try {
                startForeground(NOTIFICATION_ID, notification);
                return true;
            } catch (Exception e) {
                Log.w(TAG, "startForeground failed", e);
                return false;
            }
        }

        boolean micGranted =
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        int playback = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK; // API 29
        if (micGranted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                startForeground(NOTIFICATION_ID, notification, playback | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                return true;
            } catch (Exception e) {
                // SecurityException / ForegroundServiceStartNotAllowedException (API 31+).
                Log.w(TAG, "microphone-type FGS refused, falling back to mediaPlayback", e);
            }
        }
        try {
            startForeground(NOTIFICATION_ID, notification, playback);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "mediaPlayback-type FGS refused", e);
            return false;
        }
    }

    /** Learner swiped the app away: the WebView and the class are gone, so is this service. */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopForegroundCompat();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopForegroundCompat();
        super.onDestroy();
    }

    private void stopForegroundCompat() {
        if (!inForeground) return;
        inForeground = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(Service.STOP_FOREGROUND_REMOVE);
            } else {
                stopForegroundLegacy();
            }
        } catch (Exception ignored) {}
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundLegacy() {
        stopForeground(true);
    }

    private static Notification buildNotification(Context context, String title) {
        Intent open = new Intent(context, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        boolean hasTitle = title != null && !title.trim().isEmpty();
        return new NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(hasTitle ? title.trim() : "Live class in progress")
            .setContentText(hasTitle ? "Live class in progress · tap to return" : "Tap to return to the class")
            .setSmallIcon(R.drawable.ic_stat_live_class)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Live class", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while you are in a live class");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
