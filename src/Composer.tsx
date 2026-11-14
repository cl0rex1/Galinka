import { useEffect, useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart2,
  BellOff,
  CalendarClock,
  Check,
  Clock3,
  FileText,
  Images,
  LoaderCircle,
  Paperclip,
  Pencil,
  Reply,
  Smile,
  X,
} from 'lucide-react';
import { lookPrefs } from './Appearance';
import { AttachmentPreview } from './AttachmentPreview';
import { Avatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';
import { fileLabel } from './MediaAttachment';
import { plainText } from './MessageText';
import { VideoNoteRecorder } from './VideoNoteRecorder';
import { VoiceRecorder } from './VoiceRecorder';
import { closeMenu, IconButton, toggleMenu, usePresence } from './ui';
import type { ComposerState } from './useComposer';
import type { Chat, Message } from './types';

export function Composer({
  active,
  meId,
  messages,
  awayFromBottom,
  onJumpToLatest,
  onTyping,
  onError,
  onOpenPoll,
  onOpenSchedule,
  onOpenScheduledList,
  composer,
}: {
  active: Chat;
  meId: string;
  messages: Message[];
  awayFromBottom: boolean;
  onJumpToLatest: () => void;
  onTyping: (action: 'voice' | 'video') => void;
  onError: (message: string) => void;
  onOpenPoll: () => void;
  onOpenSchedule: () => void;
  onOpenScheduledList: () => void;
  composer: ComposerState;
}) {
  const {
    draft,
    attachment,
    attachmentSource,
    transfer,
    sending,
    reply,
    edit,
    savingCurrentEdit,
    composerValue,
    mentionOptions,
    mentionIndex,
    setMentionIndex,
    setMentionCursor,
    selectedMention,
    emojiOpen,
    setEmojiOpen,
    sendOptions,
    setSendOptions,
    textarea,
    fileInput,
  } = composer;

  const mentionPanel = usePresence(mentionOptions.length > 0, 160);
  const previousMentionOptions = useRef(mentionOptions);
  if (mentionOptions.length) previousMentionOptions.current = mentionOptions;
  const shownMentionOptions = mentionPanel.closing
    ? previousMentionOptions.current
    : mentionOptions;
  const mentionList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = mentionList.current;
    const selected = list?.querySelector<HTMLElement>('.selected');
    if (!list || !selected) return;
    const top = selected.offsetTop;
    const bottom = top + selected.offsetHeight;
    const visibleBottom = list.scrollTop + list.clientHeight;
    if (top < list.scrollTop || bottom > visibleBottom)
      list.scrollTo({
        top: top < list.scrollTop ? top : bottom - list.clientHeight,
        behavior: 'auto',
      });
  }, [selectedMention?.id]);

  // Keep the last reply and edit on screen while their bar folds away.
  const context = edit || reply ? { edit, reply } : null;
  const lastContext = useRef(context);
  if (context) lastContext.current = context;
  const contextBar = usePresence(Boolean(context), 160);
  const shownContext = context || lastContext.current;

  return (
    <div className="composer-wrap">
      {/* Always rendered so it can fade out as well as in. Inside the composer block, so it
        always sits above it, however tall the reply bar and draft make it. */}
      <button
        type="button"
        className={`jump-to-latest ${awayFromBottom ? 'shown' : ''}`}
        inert={!awayFromBottom}
        onClick={onJumpToLatest}
        aria-label="К последним сообщениям"
      >
        <ArrowDown size={20} />
        {active.unread > 0 && <b key={active.unread}>{active.unread}</b>}
      </button>
      {contextBar.mounted && shownContext && (
        <div
          className={`composer-context ${shownContext.edit ? 'editing' : ''} ${contextBar.closing ? 'closing' : ''}`}
        >
          {shownContext.edit ? <Pencil size={18} /> : <Reply size={18} />}
          <div>
            <strong>
              {shownContext.edit ? 'Редактирование' : shownContext.reply!.sender.name}
            </strong>
            <p>
              {shownContext.edit
                ? shownContext.edit.message.body || shownContext.edit.message.file?.name
                : plainText(shownContext.reply!.body) ||
                  (shownContext.reply!.file && fileLabel(shownContext.reply!.file.name)) ||
                  'Сообщение'}
            </p>
          </div>
          <IconButton
            label={edit ? 'Отменить редактирование' : 'Отменить ответ'}
            disabled={savingCurrentEdit || sending}
            onClick={composer.cancelContext}
          >
            <X size={18} />
          </IconButton>
        </div>
      )}
      {composer.tiktokUrl && (
        <div className="tiktok-prompt" role="region" aria-label="Ссылка на TikTok">
          <span>Скачать видео из TikTok как видеофайл?</span>
          <div className="tiktok-prompt-actions">
            <button
              type="button"
              className="secondary"
              disabled={composer.downloadingTikTok}
              onClick={composer.dismissTikTok}
            >
              Не скачивать
            </button>
            <button
              type="button"
              className="primary"
              disabled={composer.downloadingTikTok}
              onClick={() => void composer.downloadTikTok()}
            >
              {composer.downloadingTikTok ? 'Скачивание…' : 'Скачать'}
            </button>
          </div>
        </div>
      )}
      {composer.linkPreview && !composer.tiktokUrl && (
        <div className="composer-link-preview">
          <div className="composer-link-preview-text">
            <strong>{composer.linkPreview.site}</strong>
            <span>{composer.linkPreview.title}</span>
          </div>
          <IconButton label="Убрать предпросмотр" onClick={composer.dismissPreview}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {attachment && !edit && (
        <AttachmentPreview
          file={attachment}
          transfer={transfer}
          original={attachmentSource && !transfer ? attachmentSource : undefined}
          onOriginal={() => {
            if (attachmentSource) void composer.attachFile(attachmentSource, true);
          }}
          onRetry={() => void composer.send()}
          onRemove={composer.removeAttachment}
        />
      )}
      <form className="composer" onSubmit={(e) => void composer.send(e)}>
        {mentionPanel.mounted && (
          <div
            ref={mentionList}
            className="mention-options"
            role="group"
            aria-label="Упомянуть участника"
            data-closing={mentionPanel.closing || undefined}
            inert={mentionPanel.closing}
          >
            {shownMentionOptions.map((member, index) => (
              <button
                key={member.id}
                type="button"
                className={index === mentionIndex % shownMentionOptions.length ? 'selected' : ''}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => composer.chooseMention(member)}
              >
                <Avatar person={member} size="small" />
                <span>
                  {member.name} <small>@{member.username}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void composer.attachFile(file);
            e.target.value = '';
          }}
        />
        <div className="composer-field">
          {sending || edit ? (
            <IconButton label="Прикрепить файл" disabled>
              <Paperclip size={21} />
            </IconButton>
          ) : (
            <details className="chat-actions attachment-menu">
              <summary
                className="icon-button"
                aria-label="Прикрепить файл"
                onClick={toggleMenu}
              >
                <Paperclip size={21} />
              </summary>
              <div className="chat-actions-menu">
                {(
                  [
                    [Images, 'Галерея', 'image/*,video/*'],
                    [FileText, 'Файл', ''],
                  ] as const
                ).map(([Icon, label, accept]) => (
                  <button
                    type="button"
                    key={label}
                    onClick={(event) => {
                      const input = fileInput.current;
                      if (!input) return;
                      closeMenu(event.currentTarget.closest('details')!);
                      input.accept = accept;
                      input.click();
                    }}
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={(event) => {
                    closeMenu(event.currentTarget.closest('details')!);
                    onOpenPoll();
                  }}
                >
                  <BarChart2 size={18} />
                  Опрос
                </button>
              </div>
            </details>
          )}
          <textarea
            ref={textarea}
            enterKeyHint="enter"
            aria-label="Сообщение"
            placeholder={edit ? 'Изменить сообщение' : 'Сообщение'}
            rows={1}
            value={composerValue}
            maxLength={8000}
            readOnly={sending || savingCurrentEdit}
            aria-busy={sending || savingCurrentEdit}
            onChange={(e) => {
              composer.changeDraft(e.target.value);
              setMentionCursor(e.target.selectionEnd);
              setMentionIndex(0);
            }}
            onSelect={(event) => setMentionCursor(event.currentTarget.selectionEnd)}
            onBlur={() => setMentionCursor(null)}
            onPaste={(e) => {
              const file = e.clipboardData.files[0];
              if (file && !edit) {
                e.preventDefault();
                void composer.attachFile(file);
              }
            }}
            onKeyDown={(e) => {
              if (
                selectedMention &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229
              ) {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex(
                    (index) =>
                      (index + mentionOptions.length + (e.key === 'ArrowDown' ? 1 : -1)) %
                      mentionOptions.length,
                  );
                  return;
                }
                if (
                  (e.key === 'Enter' || e.key === 'Tab') &&
                  !e.shiftKey &&
                  !e.ctrlKey &&
                  !e.metaKey
                ) {
                  e.preventDefault();
                  composer.chooseMention(selectedMention);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMentionCursor(null);
                  return;
                }
              }
              // Ctrl+B and Ctrl+I wrap the selection in bold or italic marks.
              const mark = e.code === 'KeyB' ? '**' : e.code === 'KeyI' ? '__' : '';
              const field = e.currentTarget;
              if (
                mark &&
                (e.ctrlKey || e.metaKey) &&
                !e.altKey &&
                !e.shiftKey &&
                field.selectionStart !== field.selectionEnd
              ) {
                e.preventDefault();
                const { selectionStart: from, selectionEnd: to } = field;
                const value =
                  composerValue.slice(0, from) +
                  mark +
                  composerValue.slice(from, to) +
                  mark +
                  composerValue.slice(to);
                if (value.length > 8000) return;
                composer.changeDraft(value);
                requestAnimationFrame(() =>
                  field.setSelectionRange(from + mark.length, to + mark.length),
                );
                return;
              }
              // As in Telegram Desktop: ↑ in an empty field edits your last message.
              if (e.key === 'ArrowUp' && !composerValue && !edit && !attachment) {
                const last = [...messages]
                  .reverse()
                  .find((message) => message.sender_id === meId && message.body);
                if (last) {
                  e.preventDefault();
                  composer.startEdit(last);
                  return;
                }
              }
              const enterSends = lookPrefs().enterSends;
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.nativeEvent.keyCode !== 229 &&
                window.matchMedia('(pointer:fine)').matches &&
                (enterSends || e.ctrlKey || e.metaKey)
              ) {
                e.preventDefault();
                void composer.send();
              }
            }}
          />
          {composer.scheduledCount > 0 && !edit && (
            <IconButton
              label={active.kind === 'saved' ? 'Напоминания' : 'Отложенные сообщения'}
              className="scheduled-badge-btn"
              onClick={onOpenScheduledList}
            >
              <CalendarClock size={20} />
            </IconButton>
          )}
          <div className="emoji-wrap">
            <EmojiPicker
              open={emojiOpen}
              mode="composer"
              onSelectEmoji={(emoji) => {
                composer.changeDraft(composerValue + emoji);
                setEmojiOpen(false);
                textarea.current?.focus();
              }}
              onSelectSticker={(token) => composer.sendSpecial(token)}
              onSelectGif={(token) => composer.sendSpecial(token)}
            />
            <IconButton
              label="Добавить эмодзи"
              disabled={sending || savingCurrentEdit}
              onClick={() => setEmojiOpen((v) => !v)}
            >
              <Smile size={21} />
            </IconButton>
          </div>
          {!edit && !draft.trim() && !attachment && (
            <VideoNoteRecorder
              key={active.id}
              disabled={sending}
              onActive={() => onTyping('video')}
              onRecorded={(file) => void composer.attachFile(file)}
              onError={onError}
            />
          )}
        </div>
        {!edit && !draft.trim() && !attachment ? (
          <VoiceRecorder
            key={active.id}
            disabled={sending}
            onActive={() => onTyping('voice')}
            onRecorded={(file) => void composer.attachFile(file)}
            onError={onError}
          />
        ) : (
          <>
            {sendOptions && !edit && (
              <div className="send-options chat-actions-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSendOptions(false);
                    void composer.send(undefined, true);
                  }}
                >
                  <BellOff size={17} />
                  Отправить без звука
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSendOptions(false);
                    onOpenSchedule();
                  }}
                >
                  <Clock3 size={17} />
                  {active.kind === 'saved' ? 'Напомнить позже' : 'Отправить позже'}
                </button>
              </div>
            )}
            <button
              className="send-button"
              onMouseDown={(e) => e.preventDefault()}
              // The click that ends a long press only opens the options.
              onClick={(e) => {
                if (sendOptions) e.preventDefault();
              }}
              // Right click or a long press offers sending without a notification.
              onContextMenu={(e) => {
                if (edit || e.currentTarget.disabled) return;
                e.preventDefault();
                setSendOptions(true);
              }}
              onPointerDown={(e) => {
                if (e.pointerType === 'mouse' || edit) return;
                const button = e.currentTarget;
                const timer = setTimeout(() => {
                  navigator.vibrate?.(8);
                  setSendOptions(true);
                }, 450);
                const stop = () => clearTimeout(timer);
                button.addEventListener('pointerup', stop, { once: true });
                button.addEventListener('pointercancel', stop, { once: true });
                button.addEventListener('pointerleave', stop, { once: true });
              }}
              aria-label={edit ? 'Сохранить изменения' : 'Отправить сообщение'}
              title={edit ? 'Сохранить изменения' : 'Отправить сообщение'}
              disabled={
                sending ||
                savingCurrentEdit ||
                (edit ? !edit.body.trim() && !edit.message.file : !draft.trim() && !attachment)
              }
            >
              {sending || savingCurrentEdit ? (
                <LoaderCircle size={20} className="spin" />
              ) : edit ? (
                <Check size={21} />
              ) : (
                <ArrowUp size={21} />
              )}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
