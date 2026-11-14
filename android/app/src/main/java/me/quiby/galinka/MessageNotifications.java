package me.quiby.galinka;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

/**
 * Message notifications: one per chat, holding its recent messages (MessagingStyle), grouped under
 * one summary, with Reply / Mark-as-read and the chat's unread count for the launcher badge.
 */
final class MessageNotifications {
    static final String CHANNEL = "messages";
    /** Quiet hours or a chat set to no sound: shown, but without sound or vibration. */
    static final String QUIET_CHANNEL = "messages_quiet";
    static final String GROUP = "me.quiby.galinka.MESSAGES";
    static final String SUMMARY_TAG = "galinka-summary";
    static final String KEY_REPLY = "reply";
    static final String ACTION_REPLY = "me.quiby.galinka.REPLY";
    static final String ACTION_READ = "me.quiby.galinka.MARK_READ";
    static final int ID = 1;

    private MessageNotifications() {}

    private static int immutable() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }

    /** Same extras an FCM notification tap carries, so the Capacitor plugin reports it to JS. */
    private static PendingIntent open(Context context, String chatId, String messageId) {
        Intent intent = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("google.message_id", messageId)
            .putExtra("chatId", chatId)
            .putExtra("messageId", messageId);
        return PendingIntent.getActivity(context, chatId.hashCode(), intent, immutable());
    }

    private static Intent action(Context context, String action, String chatId, String messageId) {
        return new Intent(context, NotificationActionReceiver.class).setAction(action)
            .putExtra("chatId", chatId).putExtra("messageId", messageId);
    }

    /** The app's JS creates "messages" when notifications are turned on; make sure both exist. */
    private static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = manager(context);
        if (manager.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL,
                context.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }
        if (manager.getNotificationChannel(QUIET_CHANNEL) == null) {
            NotificationChannel quiet = new NotificationChannel(QUIET_CHANNEL,
                context.getString(R.string.channel_quiet), NotificationManager.IMPORTANCE_LOW);
            quiet.setSound(null, null);
            quiet.enableVibration(false);
            quiet.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(quiet);
        }
    }

    private static NotificationCompat.Builder base(Context context, String channel, String chatId,
                                                   String messageId, String title, String text) {
        boolean quiet = QUIET_CHANNEL.equals(channel);
        return new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .setGroup(GROUP)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // Before Android 8 there are no channels: priority and silence are set per notification.
            .setPriority(quiet ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH)
            .setSilent(quiet)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(context, channel)
                .setSmallIcon(R.drawable.ic_notification).setContentTitle("Galinka")
                .setContentText(context.getString(R.string.new_message)).build())
            .setContentIntent(open(context, chatId, messageId));
    }

    /** The chat's notification as it is now, so a new message is added to it, not put in its place. */
    private static NotificationCompat.MessagingStyle history(Context context, String chatId, String title) {
        for (StatusBarNotification shown : manager(context).getActiveNotifications()) {
            if (shown.getId() != ID || !chatId.equals(shown.getTag())) continue;
            NotificationCompat.MessagingStyle style =
                NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(shown.getNotification());
            if (style != null) return style.setConversationTitle(title);
        }
        return new NotificationCompat.MessagingStyle(new Person.Builder()
            .setName(context.getString(R.string.you)).build()).setConversationTitle(title);
    }

    static void show(Context context, String chatId, String messageId, String title, String text,
                     boolean quiet, int unread) {
        ensureChannels(context);
        String channel = quiet ? QUIET_CHANNEL : CHANNEL;
        // RemoteInput needs a mutable PendingIntent so the system can attach the typed text.
        int mutable = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0);
        PendingIntent reply = PendingIntent.getBroadcast(context, chatId.hashCode(),
            action(context, ACTION_REPLY, chatId, messageId), mutable);
        PendingIntent read = PendingIntent.getBroadcast(context, chatId.hashCode() + 1,
            action(context, ACTION_READ, chatId, messageId), immutable());
        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(0,
            context.getString(R.string.reply), reply)
            .addRemoteInput(new RemoteInput.Builder(KEY_REPLY).setLabel(context.getString(R.string.reply)).build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false).build();
        NotificationCompat.Action readAction = new NotificationCompat.Action.Builder(0,
            context.getString(R.string.mark_read), read)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
            .setShowsUserInterface(false).build();
        NotificationCompat.MessagingStyle style = history(context, chatId, title);
        style.addMessage(new NotificationCompat.MessagingStyle.Message(text, System.currentTimeMillis(),
            new Person.Builder().setName(title).build()));
        // Only the newest few lines fit on a phone screen.
        while (style.getMessages().size() > NotificationLogic.MAX_LINES) style.getMessages().remove(0);
        NotificationCompat.Builder builder = base(context, channel, chatId, messageId, title, text)
            .setStyle(style)
            .setNumber(NotificationLogic.badgeNumber(unread, style.getMessages().size()))
            .addAction(replyAction).addAction(readAction);
        notify(context, chatId, builder);
        summarize(context);
    }

    /** Replaces the notification so the reply spinner stops and the text is not lost. */
    static void showNotSent(Context context, String chatId, String messageId, String draft) {
        ensureChannels(context);
        notify(context, chatId, base(context, CHANNEL, chatId, messageId,
            context.getString(R.string.not_sent), draft));
        summarize(context);
    }

    static void cancel(Context context, String chatId) {
        manager(context).cancel(chatId, ID);
        summarize(context);
    }

    /** Two chats or more: one summary row holds them together; fewer: no summary. */
    private static void summarize(Context context) {
        int chats = 0;
        for (StatusBarNotification shown : manager(context).getActiveNotifications())
            if (shown.getId() == ID && shown.getTag() != null && !SUMMARY_TAG.equals(shown.getTag())) chats++;
        if (chats < 2) {
            manager(context).cancel(SUMMARY_TAG, ID);
            return;
        }
        // The summary never alerts on its own: the chat's notification already did, or stayed quiet.
        NotificationCompat.Builder summary = new NotificationCompat.Builder(context, QUIET_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("Galinka")
            .setContentText(NotificationLogic.chatsText(chats))
            .setGroup(GROUP)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setSilent(true)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        try {
            manager(context).notify(SUMMARY_TAG, ID, summary.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS revoked on Android 13+.
        }
    }

    private static NotificationManager manager(Context context) {
        return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static void notify(Context context, String chatId, NotificationCompat.Builder builder) {
        try {
            manager(context).notify(chatId, ID, builder.build());
        } catch (SecurityException ignored) {
            // POST_NOTIFICATIONS revoked on Android 13+: nothing to show.
        }
    }
}
