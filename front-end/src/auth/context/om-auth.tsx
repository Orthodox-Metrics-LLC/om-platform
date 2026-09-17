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
  last_login?: string | null;
  must_change_password?: boolean;
  onboarding_request_id?: string | null;
};

type OmAuthState = {
  user: OmUser | null;
  loading: boolean;
  authenticated: boolean;
  signIn: (email: string, password: string) => Promise<OmUser>;
  signOut: () => Promise<void>;
  checkSession: () => Promise<void>;
};

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

export function OmAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<OmUser | null>(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/check', {
        credentials: 'include',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => null);
      setUser(data?.authenticated && data.user ? data.user : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

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
  }, []);

  const value = useMemo(
    () => ({ user, loading, authenticated: !!user, signIn, signOut, checkSession }),
    [user, loading, signIn, signOut, checkSession]
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
            displayName:
              (user.display_name ?? [user.first_name, user.last_name].filter(Boolean).join(' ')) ||
              user.username ||
              user.email,
            photoURL: null,
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
