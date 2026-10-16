-- Add the canonical church roles (church_admin, deacon, editor) to users.role.
-- utils/roles.js defines super_admin > admin > church_admin > priest > deacon > editor > viewer > guest,
-- but the ENUM never carried the three church roles. Additive only: existing values,
-- nullability and default are preserved.
ALTER TABLE users
  MODIFY COLUMN role ENUM(
    'super_admin','admin','church_admin','manager','priest','deacon','editor',
    'moderator','user','viewer','guest','readonly_user','brain_ingest'
  ) NULL DEFAULT 'user';

-- user_friends_view: fall back to users.display_name / users.avatar_url when the
-- optional user_profiles row is missing (avatars are managed on users.avatar_url).
CREATE OR REPLACE VIEW user_friends_view AS
SELECT f.requester_id AS user_id, f.addressee_id AS friend_id,
       u.first_name, u.last_name,
       COALESCE(up.display_name, u.display_name) AS display_name,
       COALESCE(up.profile_image_url, u.avatar_url) AS profile_image_url,
       COALESCE(up.is_online, u.is_online) AS is_online,
       COALESCE(up.last_seen, u.last_seen) AS last_seen,
       f.requested_at AS friends_since
FROM friendships f
JOIN users u ON u.id = f.addressee_id
LEFT JOIN user_profiles up ON up.user_id = f.addressee_id
WHERE f.status = 'accepted'
UNION
SELECT f.addressee_id AS user_id, f.requester_id AS friend_id,
       u.first_name, u.last_name,
       COALESCE(up.display_name, u.display_name) AS display_name,
       COALESCE(up.profile_image_url, u.avatar_url) AS profile_image_url,
       COALESCE(up.is_online, u.is_online) AS is_online,
       COALESCE(up.last_seen, u.last_seen) AS last_seen,
       f.requested_at AS friends_since
FROM friendships f
JOIN users u ON u.id = f.requester_id
LEFT JOIN user_profiles up ON up.user_id = f.requester_id
WHERE f.status = 'accepted';
