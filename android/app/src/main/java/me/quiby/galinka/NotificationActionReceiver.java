package me.quiby.galinka;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;
import androidx.core.app.RemoteInput;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Runs Reply / Mark-as-read from the notification with the WebView's session, without opening the app. */
public class NotificationActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String chatId = intent.getStringExtra("chatId");
        String messageId = intent.getStringExtra("messageId");
        if (!NotificationLogic.isUuid(chatId) || !NotificationLogic.isUuid(messageId)) return;
        Context app = context.getApplicationContext();
        boolean reply = MessageNotifications.ACTION_REPLY.equals(intent.getAction());
        boolean read = MessageNotifications.ACTION_READ.equals(intent.getAction());
        String text = null;
        if (reply) {
            Bundle input = RemoteInput.getResultsFromIntent(intent);
            text = NotificationLogic.replyText(input == null ? null : input.getCharSequence(MessageNotifications.KEY_REPLY));
            if (text == null) { MessageNotifications.cancel(app, chatId); return; }
        } else if (!read) return;
        final String body = text;
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                boolean ok = reply
                    ? post(NotificationLogic.messagesUrl(chatId), NotificationLogic.replyJson(body, UUID.randomUUID().toString(), messageId))
                    : post(NotificationLogic.readUrl(chatId), NotificationLogic.readJson(messageId));
                if (ok) MessageNotifications.cancel(app, chatId);
                else if (reply) MessageNotifications.showNotSent(app, chatId, messageId, body);
                // A failed "read" keeps the original notification; the user can retry.
            } finally {
                pending.finish();
            }
        }).start();
    }

    private static boolean post(String url, String json) {
        HttpURLConnection connection = null;
        try {
            String cookie = CookieManager.getInstance().getCookie(NotificationLogic.ORIGIN);
            if (cookie == null || cookie.isEmpty()) return false;
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000); // a broadcast may run only ~10 s
            connection.setDoOutput(true);
            connection.setRequestProperty("Cookie", cookie);
            connection.setRequestProperty("Origin", NotificationLogic.ORIGIN);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            }
            int code = connection.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
