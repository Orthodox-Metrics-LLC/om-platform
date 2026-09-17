# /etc/nginx/sites-enabled/orthodoxmetrics.com
# .239 — serves the frontend directly and terminates TLS.
# Port 80 is now a 301 redirect; .221 edge is retired.

# ---- Maintenance bypass IPs (moved from .221 edge geo block) ----
# NOTE: LAN bypass (192.168.1.0/24) was removed on 2026-05-03 — it
# defeated the maintenance page for every operator running om-deploy
# from a LAN host, so the page was effectively invisible. Off-network
# verification still works via the admin's external bypass IP below.
geo $maintenance_bypass {
    default          0;
    73.160.15.116/32 1;  # admin bypass IP
}

# ---- Build type from user_role cookie (moved from .221 edge map) ----
map $cookie_user_role $om_build_type {
    default       stable;
    "super_admin" latest;
    "developer"   latest;
}

# ---- Port 80: redirect to HTTPS ----
server {
    listen 80;
    server_name orthodoxmetrics.com;
    return 301 https://orthodoxmetrics.com$request_uri;
}

# ---- Port 443: TLS-terminated direct-serve ----
server {
    listen 443 ssl;
    server_name orthodoxmetrics.com;

    ssl_certificate     /etc/ssl/certs/orthodoxmetrics-cert.pem;
    ssl_certificate_key /etc/ssl/private/orthodoxmetrics.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    include /etc/nginx/snippets/orthodoxmetrics-common.conf;
    include /etc/nginx/snippets/getbrain.conf;
}

# ---- api.orthodoxmetrics.com — same API stack as apex (no www) ----
server {
    listen 80;
    server_name api.orthodoxmetrics.com;
    return 301 https://api.orthodoxmetrics.com$request_uri;
}

server {
    listen 443 ssl;
    server_name api.orthodoxmetrics.com;

    ssl_certificate     /etc/ssl/certs/orthodoxmetrics-cert.pem;
    ssl_certificate_key /etc/ssl/private/orthodoxmetrics.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    include /etc/nginx/snippets/orthodoxmetrics-common.conf;
    include /etc/nginx/snippets/getbrain.conf;
}
