import { useState, useEffect, useCallback } from 'react';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Notifications from OM's `/api/notifications` (prod: server/src/api/notifications.js),
 * shaped for the Minimal drawer. Polls while the app is open.
 */

export type OmNotificationRow = {
  id: number;
  type_name: string;
  category: string;
  title: string;
  message: string;
  data: Record<string, any> | null;
  is_read: 0 | 1 | boolean;
  action_url: string | null;
  sender_id: number | null;
  sender_name: string | null;
  sender_avatar_url: string | null;
  created_at: string;
};

export type OmNotification = {
  id: string;
  /** Minimal drawer archetypes: friend | project | file | chat | mail | payment | order | delivery */
  type: string;
  typeName: string;
  title: string; // HTML for readerContent
  category: string;
  isUnRead: boolean;
  avatarUrl: string | null;
  createdAt: string;
  actionUrl: string | null;
  data: Record<string, any>;
};

const TYPE_MAP: Record<string, string> = {
  friend_request: 'friend',
  friend_accepted: 'mail',
  friend_declined: 'mail',
  new_follower: 'mail',
  mention: 'project',
  post_comment: 'project',
  post_like: 'mail',
  post_share: 'mail',
  note_comment: 'project',
  file_added: 'file',
  file_shared: 'file',
  chat_message: 'chat',
  invoice_created: 'payment',
  invoice_overdue: 'payment',
  invoice_paid: 'order',
};

const CATEGORY_LABEL: Record<string, string> = {
  friend: 'Communication',
  chat: 'Communication',
  mail: 'Communication',
  project: 'Activity',
  file: 'File manager',
  payment: 'Billing',
  order: 'Billing',
  delivery: 'Billing',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toDrawerItem(row: OmNotificationRow): OmNotification {
  const type = TYPE_MAP[row.type_name] || 'mail';
  const data = (typeof row.data === 'string' ? safeJson(row.data) : row.data) || {};
  const sender = row.sender_name ? `<strong>${escapeHtml(row.sender_name)}</strong>` : '';
  const body = escapeHtml(row.message || row.title || '');
  // Prefer "<sender> did X" phrasing when the message already starts with the sender name.
  const html =
    row.sender_name && body.startsWith(escapeHtml(row.sender_name))
      ? `<p>${sender}${body.slice(escapeHtml(row.sender_name).length)}</p>`
      : `<p>${body}</p>`;
  return {
    id: String(row.id),
    type,
    typeName: row.type_name,
    title: html,
    category: CATEGORY_LABEL[type] || row.category || 'System',
    isUnRead: !row.is_read,
    avatarUrl: row.sender_avatar_url || null,
    createdAt: row.created_at,
    actionUrl: row.action_url,
    data,
  };
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(input, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}

export function useOmNotifications(enabled: boolean, pollMs = 20000) {
  const [items, setItems] = useState<OmNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const r = await call<{ notifications: OmNotificationRow[] }>('/api/notifications?limit=50');
      setItems((r.notifications ?? []).map(toDrawerItem));
    } catch {
      /* keep last good list */
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
    if (!enabled) return undefined;
    const t = setInterval(refresh, pollMs);
    return () => clearInterval(t);
  }, [refresh, enabled, pollMs]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isUnRead: false } : n)));
    await call(`/api/notifications/${id}/read`, { method: 'PUT' }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isUnRead: false })));
    await call('/api/notifications/read-all', { method: 'PUT' }).catch(() => {});
  }, []);

  const dismiss = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await call(`/api/notifications/${id}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  const respondFriendRequest = useCallback(
    async (requestId: number, action: 'accept' | 'decline') => {
      await call(`/api/social/friends/requests/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await refresh();
    },
    [refresh]
  );

  return { items, loading, refresh, markRead, markAllRead, dismiss, respondFriendRequest };
}
