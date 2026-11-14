package me.quiby.galinka;

import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class NotificationLogicTest {
    private static final String ID = "123e4567-e89b-12d3-a456-426614174000";

    private static Map<String, String> data(String chat, String message, String actions) {
        Map<String, String> data = new HashMap<>();
        data.put("chatId", chat);
        data.put("messageId", message);
        if (actions != null) data.put("actions", actions);
        return data;
    }

    @Test
    public void onlyActionDataWithRealIdsIsDrawnByUs() {
        assertTrue(NotificationLogic.drawsOwnNotification(data(ID, ID, "1")));
        assertFalse(NotificationLogic.drawsOwnNotification(data(ID, ID, null)));
        assertFalse(NotificationLogic.drawsOwnNotification(data("../x", ID, "1")));
        assertFalse(NotificationLogic.drawsOwnNotification(data(ID, null, "1")));
        assertFalse(NotificationLogic.drawsOwnNotification(null));
    }

    @Test
    public void quietUnreadAndSummaryWording() {
        Map<String, String> data = data(ID, ID, "1");
        assertFalse(NotificationLogic.quiet(data));
        assertEquals(0, NotificationLogic.unread(data));
        data.put("quiet", "1");
        data.put("unread", "7");
        assertTrue(NotificationLogic.quiet(data));
        assertEquals(7, NotificationLogic.unread(data));
        data.put("unread", "много");
        assertEquals(0, NotificationLogic.unread(data));
        assertEquals(3, NotificationLogic.badgeNumber(0, 3));
        assertEquals(9, NotificationLogic.badgeNumber(9, 3));
        assertEquals("Сообщения из 2 чатов", NotificationLogic.chatsText(2));
        assertEquals("Сообщения из 21 чата", NotificationLogic.chatsText(21));
        assertEquals("Сообщения из 11 чатов", NotificationLogic.chatsText(11));
    }

    @Test
    public void textFallsBackToGenericWording() {
        Map<String, String> data = data(ID, ID, "1");
        assertEquals("Galinka", NotificationLogic.title(data));
        assertEquals("Новое сообщение", NotificationLogic.text(data));
        data.put("title", "Неля");
        data.put("body", "Привет");
        assertEquals("Неля", NotificationLogic.title(data));
        assertEquals("Привет", NotificationLogic.text(data));
    }

    @Test
    public void replyTextIsTrimmedAndCapped() {
        assertNull(NotificationLogic.replyText(null));
        assertNull(NotificationLogic.replyText("  \n "));
        assertEquals("ок", NotificationLogic.replyText("  ок "));
        assertEquals(NotificationLogic.MAX_BODY, NotificationLogic.replyText(new String(new char[9000]).replace('\0', 'a')).length());
    }

    @Test
    public void jsonEscapesAndUrlsPointAtTheApi() {
        assertEquals("{\"body\":\"a\\\"b\\\\\\n\",\"nonce\":\"n\",\"replyTo\":\"r\"}", NotificationLogic.replyJson("a\"b\\\n", "n", "r"));
        assertEquals("\"\\u0001\"", NotificationLogic.quote("\u0001"));
        assertEquals("{\"lastMessageId\":\"m\"}", NotificationLogic.readJson("m"));
        assertEquals("https://mess.quiby.me/messenger/chats/" + ID + "/messages", NotificationLogic.messagesUrl(ID));
        assertEquals("https://mess.quiby.me/messenger/chats/" + ID + "/read", NotificationLogic.readUrl(ID));
    }
}
