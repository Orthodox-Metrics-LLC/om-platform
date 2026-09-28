import type { SWRConfiguration } from 'swr';
import type { IChatMessage, IChatParticipant, IChatConversation } from 'src/types/chat';

import { useMemo } from 'react';
import { keyBy } from 'es-toolkit';
import useSWR, { mutate } from 'swr';

import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Chat data layer on OM's `/api/om/chat` (prod: server/src/routes/om/chat.js).
 * The server shapes conversations/participants/messages into the template's
 * IChat* types, so the Minimal chat UI runs unmodified. Reachability (who can
 * message whom) is enforced server-side by role and church.
 */

const CHAT = '/api/om/chat';
const CONTACTS_KEY = `${CHAT}/contacts`;
const CONVERSATIONS_KEY = `${CHAT}/conversations`;
const conversationKey = (id: string) => `${CHAT}/conversations/${id}`;

async function omFetcher<T = any>(url: string): Promise<T> {
  const res = await omApiFetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}

async function omSend<T = any>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await omApiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}

const swrOptions: SWRConfiguration = {
  revalidateIfStale: true,
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  refreshInterval: 8000,
};

// ----------------------------------------------------------------------

type ContactsData = { contacts: IChatParticipant[] };

export function useGetContacts() {
  const { data, isLoading, error, isValidating } = useSWR<ContactsData>(CONTACTS_KEY, omFetcher, {
    ...swrOptions,
    refreshInterval: 60000,
  });

  return useMemo(
    () => ({
      contacts: data?.contacts || [],
      contactsLoading: isLoading,
      contactsError: error,
      contactsValidating: isValidating,
      contactsEmpty: !isLoading && !isValidating && !data?.contacts.length,
    }),
    [data?.contacts, error, isLoading, isValidating]
  );
}

// ----------------------------------------------------------------------

type ConversationsData = { conversations: IChatConversation[] };

export function useGetConversations() {
  const { data, isLoading, error, isValidating } = useSWR<ConversationsData>(CONVERSATIONS_KEY, omFetcher, swrOptions);

  return useMemo(() => {
    const byId = data?.conversations.length ? keyBy(data.conversations, (option) => option.id) : {};
    const allIds = Object.keys(byId);

    return {
      conversations: { byId, allIds },
      conversationsLoading: isLoading,
      conversationsError: error,
      conversationsValidating: isValidating,
      conversationsEmpty: !isLoading && !isValidating && !allIds.length,
    };
  }, [data?.conversations, error, isLoading, isValidating]);
}

// ----------------------------------------------------------------------

type ConversationData = { conversation: IChatConversation };

export function useGetConversation(conversationId: string) {
  const { data, isLoading, error, isValidating } = useSWR<ConversationData>(
    conversationId ? conversationKey(conversationId) : null,
    omFetcher,
    { ...swrOptions, refreshInterval: 4000 }
  );

  return useMemo(
    () => ({
      conversation: data?.conversation,
      conversationLoading: isLoading,
      conversationError: error,
      conversationValidating: isValidating,
      conversationEmpty: !isLoading && !isValidating && !data?.conversation,
    }),
    [data?.conversation, error, isLoading, isValidating]
  );
}

// ----------------------------------------------------------------------

export async function sendMessage(conversationId: string, messageData: IChatMessage) {
  // Optimistic append so the UI feels instant; the server copy replaces it on revalidate.
  mutate(
    conversationKey(conversationId),
    (currentData: ConversationData | undefined) =>
      currentData
        ? { ...currentData, conversation: { ...currentData.conversation, messages: [...currentData.conversation.messages, messageData] } }
        : currentData,
    false
  );

  await omSend(`${conversationKey(conversationId)}/messages`, 'POST', {
    body: messageData.body,
    attachments: messageData.attachments,
  });

  await Promise.all([mutate(conversationKey(conversationId)), mutate(CONVERSATIONS_KEY)]);
}

// ----------------------------------------------------------------------

/**
 * `conversationData` comes from the template's `initialConversation()` helper:
 * participants include the current user; messages[0] is the first message.
 */
export async function createConversation(conversationData: IChatConversation) {
  const me = conversationData.messages[0]?.senderId;
  const participantIds = conversationData.participants
    .map((p) => Number(p.id))
    .filter((id) => Number.isInteger(id) && String(id) !== String(me));

  const first = conversationData.messages[0];
  const res = await omSend<ConversationData>(CONVERSATIONS_KEY, 'POST', {
    participant_ids: participantIds,
    message: first?.body ?? '',
    attachments: first?.attachments ?? [],
  });

  await mutate(CONVERSATIONS_KEY);
  await mutate(conversationKey(res.conversation.id), res, false);
  return res;
}

// ----------------------------------------------------------------------

export async function clickConversation(conversationId: string) {
  mutate(
    CONVERSATIONS_KEY,
    (currentData: ConversationsData | undefined) =>
      currentData
        ? {
            ...currentData,
            conversations: currentData.conversations.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
          }
        : currentData,
    false
  );
  await omSend(`${conversationKey(conversationId)}/read`, 'PUT').catch(() => {});
}

// ----------------------------------------------------------------------

/** Upload chat attachments through the tenant-aware media store. */
export async function uploadChatAttachments(files: File[]) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  const res = await omApiFetch('/api/om/social/media?usage=post', { method: 'POST', body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) throw new Error(json?.message || 'Upload failed');
  return (json.files as { url: string; kind: string; mime_type: string; size: number }[]).map((f, i) => ({
    name: files[i]?.name ?? 'file',
    size: f.size,
    type: f.mime_type,
    path: f.url,
    preview: f.url,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  }));
}
