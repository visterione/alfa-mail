import { create } from 'zustand';
import type { AuthUser, MailboxInfo } from './types';

interface AppState {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;

  activeMailbox: MailboxInfo | null;
  setActiveMailbox: (mb: MailboxInfo | null) => void;

  activeFolder: string;
  setActiveFolder: (folder: string) => void;

  activeUid: number | null;
  setActiveUid: (uid: number | null) => void;

  composeOpen: boolean;
  composeDefaults: Partial<{
    draftId: number;
    to: string;
    cc: string;
    subject: string;
    inReplyTo: string;
    references: string;
    body: string;
  }>;
  openCompose: (defaults?: AppState['composeDefaults']) => void;
  closeCompose: () => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  isSearching: boolean;
  setIsSearching: (v: boolean) => void;

  userSettingsOpen: boolean;
  setUserSettingsOpen: (v: boolean) => void;
}

export const useStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  activeMailbox: null,
  setActiveMailbox: (mb) => set({ activeMailbox: mb, activeFolder: 'INBOX', activeUid: null }),

  activeFolder: 'INBOX',
  setActiveFolder: (folder) => set({ activeFolder: folder, activeUid: null }),

  activeUid: null,
  setActiveUid: (uid) => set({ activeUid: uid }),

  composeOpen: false,
  composeDefaults: {},
  openCompose: (defaults = {}) => set({ composeOpen: true, composeDefaults: defaults }),
  closeCompose: () => set({ composeOpen: false, composeDefaults: {} }),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  isSearching: false,
  setIsSearching: (v) => set({ isSearching: v }),

  userSettingsOpen: false,
  setUserSettingsOpen: (v) => set({ userSettingsOpen: v }),
}));
