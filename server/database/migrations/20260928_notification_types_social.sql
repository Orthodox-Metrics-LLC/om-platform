-- Notification types for the om-platform social feed, chat and file manager (data only).
INSERT IGNORE INTO notification_types (name, description, category, default_enabled) VALUES
  ('post_comment','Someone commented on your post','user',1),
  ('post_like','Someone liked your post','user',1),
  ('post_share','Someone shared your post','user',1),
  ('new_follower','Someone started following you','user',1),
  ('file_added','A file was added to a shared folder','user',1),
  ('file_shared','A file or folder was shared with you','user',1);
