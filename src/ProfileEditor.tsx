import { useEffect, useState, type FormEvent } from 'react';
import { AtSign, Camera, Check, Copy, LoaderCircle } from 'lucide-react';
import { api, upload } from './api';
import { Avatar } from './Avatar';
import { PhotoPicker, photoForm } from './AvatarEditor';
import { profileLink } from './Share';
import { haptic } from './ui';
import type { Person } from './types';

export type ProfileDraft = { name: string; bio: string; username: string };
export const BIO_LIMIT = 140;
const LOGIN = /^[a-z0-9_]{3,24}$/;
export const draftOf = (me: Person): ProfileDraft => ({
  name: me.name,
  bio: me.bio || '',
  username: me.username,
});

type LoginState = 'same' | 'checking' | 'free' | 'taken' | 'invalid';

/**
 * Editing your profile, as a settings screen: the photo with a camera badge, the name, a line
 * about yourself with a counter, and the login with a live check whether it is free. The draft
 * lives in the settings screen, so leaving without saving keeps what was typed.
 */
export function ProfileEditor({
  me,
  draft,
  onDraft,
  onSaved,
  onMe,
}: {
  me: Person;
  draft: ProfileDraft;
  onDraft: (draft: ProfileDraft | null) => void;
  onSaved: () => void;
  onMe: (person: Person) => void;
}) {
  const [login, setLogin] = useState<LoginState>('same');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const set = (change: Partial<ProfileDraft>) => onDraft({ ...draft, ...change });
  const changed =
    draft.name.trim() !== me.name ||
    draft.bio.trim() !== (me.bio || '') ||
    draft.username !== me.username;

  // The login is checked as it is typed, a moment after the last key.
  useEffect(() => {
    const name = draft.username;
    if (name === me.username) return setLogin('same');
    if (!LOGIN.test(name)) return setLogin('invalid');
    setLogin('checking');
    let live = true;
    const timer = setTimeout(() => {
      api<{ available: boolean }>(`/usernames/${encodeURIComponent(name)}`)
        .then((answer) => live && setLogin(answer.available ? 'free' : 'taken'))
        .catch(() => live && setLogin('free'));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft.username, me.username]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!draft.name.trim()) return setError('Напишите имя: так вас увидят в чатах.');
    if (login === 'invalid' || login === 'taken') return;
    if (!changed) {
      onDraft(null);
      return onSaved();
    }
    setBusy(true);
    try {
      const person = await api<Person>('/me', 'PATCH', {
        ...(draft.name.trim() !== me.name && { name: draft.name.trim() }),
        ...(draft.bio.trim() !== (me.bio || '') && { bio: draft.bio.trim() }),
        ...(draft.username !== me.username && { username: draft.username }),
      });
      onMe(person);
      onDraft(null);
      haptic('press');
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const loginNote = {
    same: '',
    checking: 'Проверяем…',
    free: 'Логин свободен',
    taken: 'Этот логин уже занят',
    invalid: 'От 3 до 24 знаков: латинские буквы, цифры и _',
  }[login];

  return (
    <form className="profile-editor" onSubmit={save} noValidate>
      <div className="profile-editor-photo">
        <PhotoPicker
          hasPhoto={Boolean(me.avatar)}
          onUpload={async (blob) =>
            onMe(await upload<Person>('/me/avatar', photoForm(blob), () => {}))
          }
          onRemove={async () => onMe(await api<Person>('/me/avatar', 'DELETE'))}
          trigger={(choose) => (
            <>
              <button
                type="button"
                className="profile-editor-avatar"
                aria-label={me.avatar ? 'Изменить фото' : 'Добавить фото'}
                onClick={choose}
              >
                <Avatar person={me} size="large" showPresence={false} />
                <span className="profile-editor-camera" aria-hidden="true">
                  <Camera size={18} />
                </span>
              </button>
              <button type="button" className="text-button" onClick={choose}>
                {me.avatar ? 'Изменить фото' : 'Добавить фото'}
              </button>
            </>
          )}
        />
      </div>

      <section className="settings-section">
        <label>
          Имя
          <input
            value={draft.name}
            maxLength={40}
            autoComplete="name"
            onChange={(event) => set({ name: event.target.value })}
          />
        </label>
        <label>
          <span className="field-head">
            О себе
            <small className={draft.bio.length > BIO_LIMIT - 20 ? 'is-near' : undefined}>
              {BIO_LIMIT - draft.bio.length}
            </small>
          </span>
          <textarea
            value={draft.bio}
            rows={3}
            maxLength={BIO_LIMIT}
            placeholder="Например: люблю горы и плёночные фото"
            onChange={(event) => set({ bio: event.target.value.replace(/\n/g, ' ') })}
          />
          <small>Видно всем, кто откроет ваш профиль.</small>
        </label>
      </section>

      <section className="settings-section">
        <label>
          Логин
          <span className="login-field">
            <AtSign size={17} aria-hidden="true" />
            <input
              value={draft.username}
              maxLength={24}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={login === 'invalid' || login === 'taken'}
              aria-describedby="login-note"
              onChange={(event) =>
                set({ username: event.target.value.toLowerCase().replace(/^@/, '') })
              }
            />
            {login === 'checking' && <LoaderCircle size={16} className="spin" />}
            {login === 'free' && <Check size={17} className="login-ok" />}
          </span>
          <small
            id="login-note"
            role="status"
            className={login === 'free' ? 'is-ok' : login === 'invalid' || login === 'taken' ? 'is-error' : undefined}
          >
            {loginNote || 'По логину вас находят и упоминают в группах.'}
          </small>
        </label>
        <button
          type="button"
          className="profile-link"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(profileLink(me.username));
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              setError('Не удалось скопировать ссылку.');
            }
          }}
        >
          <span>
            <small>Ссылка на профиль</small>
            {profileLink(me.username).replace(/^https?:\/\//, '')}
          </span>
          {copied ? <Check size={18} /> : <Copy size={18} />}
          <span className="sr-only" role="status">
            {copied ? 'Ссылка скопирована' : ''}
          </span>
        </button>
      </section>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="profile-editor-save">
        <button className="primary wide" disabled={busy}>
          {busy && <LoaderCircle size={18} className="spin" />}
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </form>
  );
}
