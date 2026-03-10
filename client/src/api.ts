import axios from 'axios';
import type {
  AuthUser,
  MailboxInfo,
  Folder,
  MessagesPage,
  MessageFull,
  MessageSummary,
  Draft,
  Contact,
  EmailRule,
  AuditEntry,
  UserSettings,
  MailboxSignature,
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

  async getSettings(): Promise<UserSettings> {
    const res = await http.get('/auth/settings');
    return res.data;
  },

  async saveSettings(settings: Partial<UserSettings>) {
    await http.put('/auth/settings', settings);
  },

  async changePassword(current_password: string, new_password: string) {
    await http.put('/auth/password', { current_password, new_password });
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

  async createFolder(mailboxId: number, path: string) {
    await http.post(`/mailboxes/${mailboxId}/folders`, { path });
  },

  async deleteFolder(mailboxId: number, folder: string) {
    await http.delete(`/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}`);
  },

  async renameFolder(mailboxId: number, folder: string, newPath: string) {
    await http.patch(`/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}`, { new_path: newPath });
  },

  async emptyFolder(mailboxId: number, folder: string) {
    await http.post(`/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/empty`);
  },

  async markAllRead(mailboxId: number, folder: string) {
    await http.post(`/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/mark-all-read`);
  },

  async copyMessage(mailboxId: number, folder: string, uid: number, toFolder: string) {
    await http.post(
      `/mailboxes/${mailboxId}/folders/${encodeURIComponent(folder)}/messages/${uid}/copy`,
      { to_folder: toFolder }
    );
  },

  async search(
    mailboxId: number,
    query: string,
    folder?: string,
    page = 1,
    pageSize = 50,
    signal?: AbortSignal,
  ): Promise<{ total: number; messages: MessageSummary[] }> {
    const res = await http.get(`/mailboxes/${mailboxId}/search`, {
      params: { q: query, folder, page, pageSize },
      signal,
    });
    return res.data;
  },

  async getMailboxSignature(mailboxId: number): Promise<MailboxSignature> {
    const res = await http.get(`/mailboxes/${mailboxId}/signature`);
    return res.data;
  },

  async sendMail(mailboxId: number, data: FormData, onProgress?: (pct: number) => void) {
    await http.post(`/mailboxes/${mailboxId}/send`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (ev) => {
        if (onProgress && ev.total) onProgress(Math.round((ev.loaded / ev.total) * 100));
      },
    });
  },

  // Drafts
  async getDrafts(): Promise<Draft[]> {
    const res = await http.get('/drafts');
    return res.data;
  },

  async saveDraft(draft: {
    id?: number;
    mailbox_id?: number;
    to_addr?: string;
    cc?: string;
    bcc?: string;
    subject?: string;
    body?: string;
    in_reply_to?: string;
    references_header?: string;
  }): Promise<{ ok: boolean; id: number }> {
    const res = await http.post('/drafts', draft);
    return res.data;
  },

  async deleteDraft(id: number) {
    await http.delete(`/drafts/${id}`);
  },

  // Contacts
  async searchContacts(q?: string): Promise<Contact[]> {
    const res = await http.get('/contacts', { params: q ? { q } : {} });
    return res.data;
  },

  // Email Rules
  async getRules(mailboxId: number): Promise<EmailRule[]> {
    const res = await http.get('/rules', { params: { mailbox_id: mailboxId } });
    return res.data;
  },

  async createRule(rule: {
    mailbox_id: number;
    name: string;
    condition_field: string;
    condition_op: string;
    condition_value: string;
    action: string;
    action_param?: string;
    priority?: number;
  }): Promise<{ ok: boolean; id: number }> {
    const res = await http.post('/rules', rule);
    return res.data;
  },

  async toggleRule(id: number, active: boolean) {
    await http.patch(`/rules/${id}`, { active });
  },

  async deleteRule(id: number) {
    await http.delete(`/rules/${id}`);
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

  async updateUser(id: number, data: { password?: string; display_name?: string; is_admin?: boolean }) {
    await http.put(`/admin/users/${id}`, data);
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

  async getMailboxSignatureAdmin(id: number): Promise<MailboxSignature> {
    const res = await http.get(`/admin/mailboxes/${id}/signature`);
    return res.data;
  },

  async saveMailboxSignature(id: number, data: MailboxSignature) {
    await http.put(`/admin/mailboxes/${id}/signature`, data);
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

  async getAuditLog(params?: { limit?: number; offset?: number; action?: string }): Promise<{ total: number; entries: AuditEntry[] }> {
    const res = await http.get('/admin/audit-log', { params });
    return res.data;
  },
};
