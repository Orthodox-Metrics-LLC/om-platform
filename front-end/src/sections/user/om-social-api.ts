import { omApiFetch } from 'src/auth/context/om-auth';

// ----------------------------------------------------------------------

/**
 * Profile feed data layer — backed by OM's `/api/om/social` router
 * (prod: server/src/routes/om/social-profile.js).
 */

export type OmSocialUser = {
  id: number;
  name: string;
  role: string;
  avatar_url: string | null;
  church_id: number | null;
  church_name: string | null;
  location: string | null;
  job_title: string | null;
};

export type OmSocialProfile = OmSocialUser & {
  email: string;
  banner_url: string | null;
  bio: string | null;
  website: string | null;
  church_affiliation: string | null;
  profile_visibility: 'public' | 'friends' | 'private';
  followers_count: number;
  following_count: number;
  posts_count: number;
  member_since: string;
  is_self: boolean;
  is_following: boolean;
  is_friend: boolean;
  can_follow: boolean;
};

export type OmMedia = { url: string; kind: 'image' | 'video' };

export type OmPost = {
  id: number;
  author: { id: number; name: string; role: string; avatar_url: string | null };
  message: string;
  media: OmMedia[];
  shared_from: {
    id: number;
    author: OmPost['author'];
    message: string;
    media: OmMedia[];
    created_at: string;
  } | null;
  visibility: 'public' | 'friends_only' | 'private';
  church_id: number | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
};

export type OmComment = {
  id: number;
  message: string;
  created_at: string;
  author: { id: number; name: string; avatar_url: string | null };
};

export type OmFollowUser = OmSocialUser & { since: string; viewer_follows: boolean };
export type OmFriendUser = OmSocialUser & { since: string };
export type OmGalleryItem = { id: number; url: string; caption: string | null; created_at: string };
export type OmUploadedFile = { id: number; scope: string; url: string; kind: 'image' | 'video'; mime_type: string; size: number };

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await omApiFetch(input, init);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || json?.error || `Request failed (${res.status})`);
  }
  return json as T;
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const S = '/api/om/social';

export const omSocialApi = {
  me: () => call<{ profile: OmSocialProfile }>(`${S}/me`).then((r) => r.profile),
  profile: (id: number) => call<{ profile: OmSocialProfile }>(`${S}/users/${id}`).then((r) => r.profile),

  follow: (id: number) => call(`${S}/users/${id}/follow`, { method: 'POST' }),
  unfollow: (id: number) => call(`${S}/users/${id}/follow`, { method: 'DELETE' }),
  followers: (id: number) => call<{ followers: OmFollowUser[] }>(`${S}/users/${id}/followers`).then((r) => r.followers),
  following: (id: number) => call<{ following: OmFollowUser[] }>(`${S}/users/${id}/following`).then((r) => r.following),
  friends: (id: number) => call<{ friends: OmFriendUser[] }>(`${S}/users/${id}/friends`).then((r) => r.friends),

  posts: (id: number) => call<{ posts: OmPost[] }>(`${S}/users/${id}/posts`).then((r) => r.posts),
  createPost: (body: { message: string; media?: OmMedia[]; visibility?: OmPost['visibility']; shared_from?: number }) =>
    call<{ post: OmPost }>(`${S}/posts`, { method: 'POST', ...json(body) }).then((r) => r.post),
  deletePost: (id: number) => call(`${S}/posts/${id}`, { method: 'DELETE' }),
  toggleLike: (id: number) =>
    call<{ liked: boolean; like_count: number }>(`${S}/posts/${id}/like`, { method: 'POST' }),
  likes: (id: number) =>
    call<{ likes: { id: number; name: string; avatar_url: string | null }[] }>(`${S}/posts/${id}/likes`).then((r) => r.likes),
  comments: (id: number) => call<{ comments: OmComment[] }>(`${S}/posts/${id}/comments`).then((r) => r.comments),
  addComment: (id: number, message: string) =>
    call<{ comment: OmComment }>(`${S}/posts/${id}/comments`, { method: 'POST', ...json({ message }) }).then((r) => r.comment),

  gallery: (id: number) => call<{ gallery: OmGalleryItem[] }>(`${S}/users/${id}/gallery`).then((r) => r.gallery),
  deleteGalleryItem: (id: number) => call(`${S}/gallery/${id}`, { method: 'DELETE' }),

  upload: async (files: File[], usage: 'post' | 'gallery' | 'cover', caption?: string) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    if (caption) form.append('caption', caption);
    const r = await call<{ files: OmUploadedFile[] }>(`${S}/media?usage=${usage}`, { method: 'POST', body: form });
    return r.files;
  },
  setCover: (banner_url: string | null) => call(`${S}/me/cover`, { method: 'PUT', ...json({ banner_url }) }),
};
