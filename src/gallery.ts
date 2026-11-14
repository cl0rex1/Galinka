import { createContext } from 'react';
import type { Attachment, Person } from './types';

export type GalleryPhoto = {
  file: Attachment;
  sender: Pick<Person, 'id' | 'name' | 'color' | 'avatar' | 'username'>;
  at: string;
  caption?: string;
};

/** Photos of the open chat in order, so the viewer can step through them as in Telegram. */
export const GalleryContext = createContext<{
  photos: GalleryPhoto[];
  download: (file: Attachment) => void;
} | null>(null);
