-- Register /api/brain/* nginx proxy → OMAI :7060 (om-brain operator console)

INSERT INTO nginx_proxy_entries
  (name, location_path, location_modifier, description, backend_port, target_path, outer_mode,
   is_websocket, cookie_forwarding, cookie_domain_rewrite, intercept_errors_off,
   client_max_body, connect_timeout, send_timeout, read_timeout,
   inner_extra, outer_extra, scope, sort_order, is_catch_all, enabled)
VALUES
  ('Brain API', '/api/brain/', '^~', 'om-brain proxy via OMAI to om-dev :8390', 7060, NULL, 'via_inner',
   0, 1, 1, 1, '50M', '300s', '300s', '300s',
   NULL, NULL, 'both', 58, 0, 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  location_modifier = VALUES(location_modifier),
  description = VALUES(description),
  backend_port = VALUES(backend_port),
  target_path = VALUES(target_path),
  enabled = 1,
  updated_at = CURRENT_TIMESTAMP;
