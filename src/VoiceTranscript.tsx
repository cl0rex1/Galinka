import { useEffect, useState } from 'react';
import { api } from './api';

type Result = { state: 'pending' } | { state: 'ready'; text: string };

export function VoiceTranscript({ fileId }: { fileId: string }) {
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load(method: 'POST' | 'GET') {
      try {
        const result = await api<Result>(
          `/files/${encodeURIComponent(fileId)}/transcription`,
          method,
          undefined,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (result.state === 'ready') setText(result.text);
        else timer = setTimeout(() => void load('GET'), 2500);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Не удалось получить расшифровку.');
      }
    }
    void load('POST');
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [fileId, attempt]);

  const pending = opened && text === null && !error;
  return (
    <div className="voice-transcript">
      <button
        type="button"
        disabled={pending}
        aria-expanded={opened}
        onClick={() => {
          if (text === null) {
            setError('');
            setAttempt((previous) => previous + 1);
            setOpened(true);
          } else setOpened(!opened);
        }}
      >
        {pending
          ? 'Расшифровываем…'
          : error
            ? 'Повторить расшифровку'
            : opened
              ? 'Скрыть текст'
              : text !== null
                ? 'Показать текст'
                : 'Расшифровать'}
      </button>
      <div role="status">
        {opened &&
          (error ? <p>{error}</p> : text !== null && <p>{text || 'Речь не распознана.'}</p>)}
      </div>
    </div>
  );
}
