import type { ReactNode } from 'react';

import { useMemo, useState, useEffect, useContext, useCallback, createContext } from 'react';

import { AuthContext } from './auth-context';

// ----------------------------------------------------------------------

/**
 * Authentication against the real Orthodox Metrics backend.
 *
 * Requests go to relative `/api/...` paths, which Vite proxies to the OM backend
 * (see `vite.config.ts`). Because the browser sees a single origin, the
 * `orthodoxmetrics.sid` session cookie and the httpOnly `refresh_token` cookie
 * set by `POST /api/auth/login` are stored and replayed automatically — so
 * `credentials: 'include'` plus the Bearer token is all that is needed.
 *
 * `access_token` is held in memory and mirrored to sessionStorage so a page
 * reload does not drop the session. It is deliberately NOT in localStorage: that
 * would persist across browser sessions on a shared parish machine.
 */

const TOKEN_KEY = 'om_access_token';

export type OmUser = {
  id: number;
  email: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  role: string;
  church_id: number | null;
  church_name?: string | null;
  avatar_url?: string | null;
  profile_visibility?: 'public' | 'friends' | 'private';
  last_login?: string | null;
  must_change_password?: boolean;
  onboarding_request_id?: string | null;
};

export type OmImpersonation = {
  impersonating: boolean;
  originalAdmin: { email: string } | null;
};

type OmAuthState = {
  user: OmUser | null;
  loading: boolean;
  authenticated: boolean;
  impersonation: OmImpersonation;
  signIn: (email: string, password: string) => Promise<OmUser>;
  signOut: () => Promise<void>;
  checkSession: () => Promise<void>;
  /** super_admin only — swap the session to another account (server enforces the role). */
  switchToUser: (userId: number) => Promise<void>;
  /** Return from an impersonated session to the original admin account. */
  returnToSelf: () => Promise<void>;
};

export const OM_ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Administrator',
  church_admin: 'Church Admin',
  manager: 'Church Admin',
  priest: 'Priest',
  deacon: 'Deacon',
  editor: 'Editor',
  moderator: 'Editor',
  user: 'Member',
  viewer: 'Viewer',
  guest: 'Guest',
  readonly_user: 'Read-only',
};

export function omRoleLabel(role?: string | null) {
  return (role && OM_ROLE_LABELS[role]) || role || 'Member';
}

/** Platform roles oversee every tenant; everyone else belongs to one om_church_##. */
export const OM_PLATFORM_ROLES = ['super_admin', 'admin'] as const;
export function isPlatformRole(role?: string | null) {
  return !!role && (OM_PLATFORM_ROLES as readonly string[]).includes(role);
}
export function isChurchRole(role?: string | null) {
  return !!role && !isPlatformRole(role);
}

export function omDisplayName(user: Pick<OmUser, 'display_name' | 'first_name' | 'last_name' | 'username' | 'email'>) {
  return (
    (user.display_name ?? [user.first_name, user.last_name].filter(Boolean).join(' ')) ||
    user.username ||
    user.email
  );
}

const OmAuthContext = createContext<OmAuthState | undefined>(undefined);

export function useOmAuth() {
  const context = useContext(OmAuthContext);
  if (!context) throw new Error('useOmAuth must be used inside OmAuthProvider');
  return context;
}

// ----------------------------------------------------------------------

function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode) — the session cookie still carries us.
  }
}

/** Adds the Bearer token when we have one; the session cookie covers the rest. */
function authHeaders(): HeadersInit {
  const token = readToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Authenticated fetch for OM backend calls made outside the auth context
 * itself (portal pages, dashboards, etc.). Attaches the Bearer token when one
 * exists; the session cookie covers the rest.
 */
export function omApiFetch(input: string, init: RequestInit = {}) {
  return fetch(input, {
    credentials: 'include',
    ...init,
    headers: { ...authHeaders(), ...init.headers },
  });
}

function isOmdevHost(): boolean {
  return window.location.hostname === 'omdev.orthodoxmetrics.com';
}

function userFromKeycloak(identity: {
  email?: string | null;
  name?: string | null;
  username?: string | null;
  roles?: string[] | null;
}): OmUser {
  const name = identity.name || '';
  const parts = name.split(' ').filter(Boolean);
  const roles = identity.roles || [];
  return {
    id: 0,
    email: identity.email || identity.username || '',
    username: identity.username || null,
    first_name: parts[0] || null,
    last_name: parts.slice(1).join(' ') || null,
    display_name: identity.name || identity.username || identity.email || null,
    role: roles[0] || 'user',
    church_id: null,
  };
}

const NO_IMPERSONATION: OmImpersonation = { impersonating: false, originalAdmin: null };

export function OmAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OmUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonation, setImpersonation] = useState<OmImpersonation>(NO_IMPERSONATION);

  const checkSession = useCallback(async () => {
    try {
      if (isOmdevHost()) {
        const oidc = await fetch('/api/auth/oidc/omdev/status', { credentials: 'include' });
        const oidcData = await oidc.json().catch(() => null);
        if (oidcData?.signed_in && oidcData.identity) {
          setUser(userFromKeycloak(oidcData.identity));
          return;
        }
      }
      const [res, imp] = await Promise.all([
        fetch('/api/auth/check', { credentials: 'include', headers: authHeaders() }),
        fetch('/api/om-admin/impersonate/status', { credentials: 'include' }),
      ]);
      const data = await res.json().catch(() => null);
      const impData = await imp.json().catch(() => null);
      setUser(data?.authenticated && data.user ? data.user : null);
      setImpersonation(
        impData?.impersonating
          ? { impersonating: true, originalAdmin: impData.originalAdmin ?? null }
          : NO_IMPERSONATION
      );
    } catch {
      setUser(null);
      setImpersonation(NO_IMPERSONATION);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Impersonation is session-based on the OM backend, but `/api/auth/check`
   * prefers the Bearer token (which still names the original admin). Dropping
   * the token makes every request fall through to the swapped session user.
   */
  const switchToUser = useCallback(
    async (userId: number) => {
      const res = await fetch('/api/om-admin/impersonate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || data?.message || `Switch failed (${res.status})`);
      }
      writeToken(null);
      await checkSession();
    },
    [checkSession]
  );

  const returnToSelf = useCallback(async () => {
    const res = await fetch('/api/om-admin/impersonate/return', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || data?.message || `Return failed (${res.status})`);
    }
    await checkSession();
  }, [checkSession]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      // Surface the backend's own wording — it distinguishes bad credentials,
      // locked accounts, and parish accounts that must use Keycloak instead.
      throw new Error(data?.message || `Sign in failed (${res.status})`);
    }

    if (data.access_token) writeToken(data.access_token);
    setUser(data.user);
    return data.user as OmUser;
  }, []);

  const signOut = useCallback(async () => {
    if (isOmdevHost()) {
      const back = `${window.location.origin}/`;
      window.location.assign(
        `/api/auth/oidc/omdev/logout?post_logout_redirect_uri=${encodeURIComponent(back)}`
      );
      return;
    }
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });
    } catch {
      // Clear locally regardless — a failed logout must not leave the UI signed in.
    }
    writeToken(null);
    setUser(null);
    setImpersonation(NO_IMPERSONATION);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      authenticated: !!user,
      impersonation,
      signIn,
      signOut,
      checkSession,
      switchToUser,
      returnToSelf,
    }),
    [user, loading, impersonation, signIn, signOut, checkSession, switchToUser, returnToSelf]
  );

  /**
   * The template's own `AuthContext` is fed from the same OM session.
   *
   * `AuthGuard`, `GuestGuard`, the account menu and the dashboard layout all read
   * `useAuthContext()`, not `useOmAuth()`. Without this they would consult the
   * template's demo JWT provider, which knows nothing about an OM login — so a real
   * superadmin session would be treated as unauthenticated and bounced straight back
   * out of /dashboard.
   *
   * Populating both means the template's components work unmodified against the real
   * backend, and the demo providers can be deleted rather than adapted.
   */
  const templateValue = useMemo(
    () => ({
      user: user
        ? {
            ...user,
            // The template's UI reads these names off the user object.
            displayName: omDisplayName(user),
            photoURL: user.avatar_url ?? null,
            role: user.role,
          }
        : null,
      loading,
      authenticated: !!user,
      unauthenticated: !loading && !user,
      checkUserSession: checkSession,
    }),
    [user, loading, checkSession]
  );

  return (
    <OmAuthContext.Provider value={value}>
      <AuthContext.Provider value={templateValue}>{children}</AuthContext.Provider>
    </OmAuthContext.Provider>
  );
}
