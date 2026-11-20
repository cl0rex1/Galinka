import { createContext } from 'react';
import type { Attachment, Person } from './types';

export type GalleryItem = {
  id: string;
  file: Attachment;
  sender: Pick<Person, 'name'> & Partial<Person>;
  at: string;
  caption?: string;
};

export type GallerySteps = { previous?: () => void; next?: () => void };

/** Gallery entries are messages: a forwarded photo can appear twice under the same file id. */
export const GalleryContext = createContext<{
  open: (id: string) => void;
  steps: (id: string) => GallerySteps;
} | null>(null);
