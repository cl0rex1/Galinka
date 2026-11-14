package me.quiby.galinka;

import android.app.ActivityManager;
import android.content.Context;
import androidx.annotation.NonNull;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.List;
import java.util.Map;

/**
 * Replaces the Capacitor plugin's service (its manifest entry is removed). Everything is still
 * forwarded to super, so token refresh and foreground events reach JS as before. Data messages
 * marked actions=1 are drawn here, with Reply and Mark-as-read, when the app is not in front.
 */
public class GalinkaMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        // In front, the web UI already shows the message; the old notification messages behaved the same.
        if (message.getNotification() != null || !NotificationLogic.drawsOwnNotification(data) || inForeground()) return;
        MessageNotifications.show(this, data.get("chatId"), data.get("messageId"),
            NotificationLogic.title(data), NotificationLogic.text(data),
            NotificationLogic.quiet(data), NotificationLogic.unread(data));
    }

    private boolean inForeground() {
        ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        List<ActivityManager.RunningAppProcessInfo> processes = manager == null ? null : manager.getRunningAppProcesses();
        if (processes == null) return false;
        for (ActivityManager.RunningAppProcessInfo p : processes)
            if (p.pid == android.os.Process.myPid())
                return p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND;
        return false;
    }
}
