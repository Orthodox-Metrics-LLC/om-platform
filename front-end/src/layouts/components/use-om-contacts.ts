import { useState, useEffect, useCallback } from 'react';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Data layer for the header Contacts popover, backed by OM's social API
 * (prod: server/src/routes/social/friends.js):
 *   GET  /api/social/friends            accepted friends
 *   GET  /api/social/friends/requests   sent + received requests
 *   GET  /api/social/friends/discover   users with a public profile
 *   POST /api/social/friends/request/:id
 *   PUT  /api/social/friends/requests/:id  { action: accept|decline|cancel }
 *   DELETE /api/social/friends/:friendId
 */

export type OmFriend = {
  friend_id: number;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  profile_image_url: string | null;
  is_online: boolean | 0 | 1 | null;
  last_seen: string | null;
  friends_since: string;
};

export type OmFriendRequest = {
  id: number;
  status: 'pending' | 'accepted' | 'declined' | 'blocked';
  direction: 'sent' | 'received';
  requested_at: string;
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  profile_image_url: string | null;
  can_accept: boolean;
  can_decline: boolean;
  can_cancel: boolean;
};

export type OmPublicProfile = {
  id: number;
  display_name: string;
  role: string;
  avatar_url: string | null;
  location: string | null;
  job_title: string | null;
  church_name: string | null;
  is_online: boolean | 0 | 1 | null;
  last_seen: string | null;
  friendship_status: string | null;
  friendship_direction: 'sent' | 'received' | null;
  friendship_id: number | null;
  can_send_request: boolean;
  is_friend: boolean;
  has_pending_request: boolean;
};

export const contactName = (c: {
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) => c.display_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown';

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(input, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json as T;
}

export function useOmContacts(enabled: boolean) {
  const [friends, setFriends] = useState<OmFriend[]>([]);
  const [requests, setRequests] = useState<OmFriendRequest[]>([]);
  const [discover, setDiscover] = useState<OmPublicProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const [f, r, d] = await Promise.all([
        call<{ friends: OmFriend[] }>('/api/social/friends?limit=100'),
        call<{ requests: OmFriendRequest[] }>('/api/social/friends/requests?status=pending'),
        call<{ users: OmPublicProfile[] }>('/api/social/friends/discover?limit=100'),
      ]);
      setFriends(f.friends ?? []);
      setRequests(r.requests ?? []);
      setDiscover(d.users ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load contacts');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const sendRequest = useCallback(
    async (userId: number) => {
      await call(`/api/social/friends/request/${userId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      await refresh();
    },
    [refresh]
  );

  const respond = useCallback(
    async (requestId: number, action: 'accept' | 'decline' | 'cancel') => {
      await call(`/api/social/friends/requests/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await refresh();
    },
    [refresh]
  );

  const removeFriend = useCallback(
    async (friendId: number) => {
      await call(`/api/social/friends/${friendId}`, { method: 'DELETE' });
      await refresh();
    },
    [refresh]
  );

  return { friends, requests, discover, loading, error, refresh, sendRequest, respond, removeFriend };
}
