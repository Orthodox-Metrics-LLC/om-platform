/**
 * session_reauth — concrete, always-available human-auth challenge.
 *
 * The approver must re-supply their super_admin credentials (email + password)
 * at approval time. We re-verify the password with bcrypt against the live
 * users table and confirm the account is an active super_admin. This proves a
 * fresh human decision independent of any long-lived session or service token.
 */

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

module.exports = {
  method: 'session_reauth',
  label: 'Super-admin credential re-authentication (email + password)',

  available() {
    return true;
  },

  async issue({ actor }) {
    return {
      prompt:
        'Re-authenticate as a super_admin to approve this global setting change. '
        + 'Provide { email, password } for the approving super_admin. '
        + 'A plaintext confirmation is NOT accepted.',
      expires_in_seconds: DEFAULT_TTL_SECONDS,
      nonce: null,
      hint_actor: actor || null,
    };
  },

  /**
   * @param {object} response  { email, password }
   * @param {object} deps      { pool, bcrypt }
   */
  async verify({ response, deps }) {
    const email = response && (response.email || response.username);
    const password = response && response.password;

    if (!email || !password) {
      return { ok: false, reason: 'email and password are required (plaintext confirmation is not accepted)' };
    }
    if (typeof password !== 'string' || password.length < 1) {
      return { ok: false, reason: 'password is required' };
    }

    const pool = deps.pool;
    const bcrypt = deps.bcrypt;

    const [rows] = await pool.query(
      'SELECT id, email, role, is_active, password_hash FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = rows && rows[0];
    if (!user) {
      return { ok: false, reason: 'invalid credentials' };
    }
    if (!user.is_active) {
      return { ok: false, reason: 'account is not active' };
    }
    if (user.role !== 'super_admin') {
      return { ok: false, reason: 'approver must be a super_admin' };
    }
    if (!user.password_hash) {
      return { ok: false, reason: 'account has no local password (cannot re-authenticate)' };
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return { ok: false, reason: 'invalid credentials' };
    }

    return { ok: true, verified_identity: user.email };
  },
};
