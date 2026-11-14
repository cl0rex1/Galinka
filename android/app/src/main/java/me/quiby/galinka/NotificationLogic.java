package me.quiby.galinka;

import java.util.Map;
import java.util.regex.Pattern;

/** Android-free rules for message notifications and their Reply / Mark-as-read actions. */
final class NotificationLogic {
    static final String ORIGIN = "https://mess.quiby.me";
    static final String API = ORIGIN + "/messenger";
    static final int MAX_BODY = 8000;
    private static final Pattern UUID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");

    private NotificationLogic() {}

    static boolean isUuid(String value) {
        return value != null && UUID.matcher(value).matches();
    }

    /** Only data messages from a server that knows we draw the notification ourselves. */
    static boolean drawsOwnNotification(Map<String, String> data) {
        return data != null && isUuid(data.get("chatId")) && isUuid(data.get("messageId"))
            && "1".equals(data.get("actions"));
    }

    /** Lines of one chat kept in its notification. */
    static final int MAX_LINES = 6;

    /** Quiet hours or a chat set to no sound. */
    static boolean quiet(Map<String, String> data) {
        return "1".equals(data.get("quiet"));
    }

    /** Unread messages in the chat, as the server counted them; 0 when unknown. */
    static int unread(Map<String, String> data) {
        try {
            return Math.max(0, Integer.parseInt(data.get("unread")));
        } catch (RuntimeException e) {
            return 0;
        }
    }

    /** The number launchers show on the icon: the server's count, at least the lines shown. */
    static int badgeNumber(int unread, int lines) {
        return Math.max(unread, lines);
    }

    /** "Сообщения из 2 чатов" for the group summary. */
    static String chatsText(int chats) {
        boolean one = chats % 10 == 1 && chats % 100 != 11;
        return "Сообщения из " + chats + (one ? " чата" : " чатов");
    }

    static String title(Map<String, String> data) {
        String value = data.get("title");
        return value == null || value.trim().isEmpty() ? "Galinka" : value;
    }

    static String text(Map<String, String> data) {
        String value = data.get("body");
        return value == null || value.trim().isEmpty() ? "Новое сообщение" : value;
    }

    /** Reply text as the server will accept it; null when there is nothing to send. */
    static String replyText(CharSequence input) {
        if (input == null) return null;
        String value = input.toString().trim();
        if (value.isEmpty()) return null;
        return value.length() > MAX_BODY ? value.substring(0, MAX_BODY) : value;
    }

    static String messagesUrl(String chatId) {
        return API + "/chats/" + chatId + "/messages";
    }

    static String readUrl(String chatId) {
        return API + "/chats/" + chatId + "/read";
    }

    static String replyJson(String body, String nonce, String replyTo) {
        return "{\"body\":" + quote(body) + ",\"nonce\":" + quote(nonce) + ",\"replyTo\":" + quote(replyTo) + "}";
    }

    static String readJson(String lastMessageId) {
        return "{\"lastMessageId\":" + quote(lastMessageId) + "}";
    }

    static String quote(String value) {
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
            }
        }
        return out.append('"').toString();
    }
}
