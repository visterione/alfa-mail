import axios from 'axios';
import type {
  AuthUser,
  MailboxInfo,
  Folder,
  MessagesPage,
  MessageFull,
  MessageSummary,
} from './types';

const http = axios.create({ baseURL: '/api' });

// Attach JWT from localStorage
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401 clear token and reload
http.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export const api = {
  // Auth
  async login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const res = await http.post('/auth/login', { username, password });
    return res.data;
  },

  async me(): Promise<AuthUser> {
    const res = await http.get('/auth/me');
    return res.data;
  },

  async setup(username: string, password: string, display_name: string) {
    const res = await http.post('/auth/setup', { username, password, display_name });
    return res.data;
  },

  // Mailboxes
  async getMailboxes(): Promise<MailboxInfo[]> {
    const res = await http.get('/mailboxes');
    return res.data;
  },

  async getFolders(mailboxId: number): Promise<Folder[]> {
    const res = await http.get(`/mailboxes/${mailboxId}/folders`);
    return res.data;
  },

  async getMessages(mailboxId: number, folder: string, page = 1, pageSize = 50): Promise<MessagesPage> {
    const res = await http.get(
      `/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/messages`,
      { params: { page, pageSize } }
    );
    return res.data;
  },

  async getMessage(mailboxId: number, folder: string, uid: number): Promise<MessageFull> {
    const res = await http.get(
      `/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/messages/${uid}`
    );
    return res.data;
  },

  async syncFolder(mailboxId: number, folder: string) {
    await http.post(`/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/sync`);
  },

  async setFlags(mailboxId: number, folder: string, uid: number, flags: { seen?: boolean; flagged?: boolean }) {
    await http.patch(
      `/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/messages/${uid}`,
      flags
    );
  },

  async moveMessage(mailboxId: number, folder: string, uid: number, toFolder: string) {
    await http.post(
      `/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/messages/${uid}/move`,
      { to_folder: toFolder }
    );
  },

  async deleteMessage(mailboxId: number, folder: string, uid: number) {
    await http.delete(
      `/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/messages/${uid}`
    );
  },

  async search(mailboxId: number, query: string, folder?: string): Promise<MessageSummary[]> {
    const res = await http.get(`/mailboxes/${mailboxId}/search`, {
      params: { q: query, folder },
    });
    return res.data;
  },

  async sendMail(mailboxId: number, data: FormData) {
    await http.post(`/mailboxes/${mailboxId}/send`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // Admin
  async getUsers() {
    const res = await http.get('/admin/users');
    return res.data;
  },

  async createUser(data: { username: string; password: string; display_name: string; is_admin?: boolean }) {
    const res = await http.post('/admin/users', data);
    return res.data;
  },

  async deleteUser(id: number) {
    await http.delete(`/admin/users/${id}`);
  },

  async getAdminMailboxes() {
    const res = await http.get('/admin/mailboxes');
    return res.data;
  },

  async createMailbox(data: {
    email: string;
    display_name?: string;
    password: string;
    imap_host: string;
    imap_port?: number;
    imap_secure?: boolean;
    smtp_host: string;
    smtp_port?: number;
    smtp_secure?: boolean;
  }) {
    const res = await http.post('/admin/mailboxes', data);
    return res.data;
  },

  async deleteMailbox(id: number) {
    await http.delete(`/admin/mailboxes/${id}`);
  },

  async getUserMailboxes(userId: number) {
    const res = await http.get(`/admin/users/${userId}/mailboxes`);
    return res.data;
  },

  async assignMailbox(userId: number, mailboxId: number) {
    await http.post(`/admin/users/${userId}/mailboxes`, { mailbox_id: mailboxId });
  },

  async unassignMailbox(userId: number, mailboxId: number) {
    await http.delete(`/admin/users/${userId}/mailboxes/${mailboxId}`);
  },
};
