# OMStudio product host (192.168.1.242).
# HTTP-01 for this name is issued on om-prod01 (.239); certs are copied here.
# Do not rewrite product locations — TLS wrapper only.

server {
    listen 80;
    server_name omstudio.orthodoxmetrics.com 192.168.1.242;

    access_log /var/log/nginx/omstudio.access.log;
    error_log  /var/log/nginx/omstudio.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        return 301 https://omstudio.orthodoxmetrics.com$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name omstudio.orthodoxmetrics.com 192.168.1.242;

    ssl_certificate     /etc/nginx/ssl/omstudio.orthodoxmetrics.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/omstudio.orthodoxmetrics.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    root /var/www/omstudio/apps/studio-shell/dist;
    index index.html;

    client_max_body_size 100M;

    access_log /var/log/nginx/omstudio.access.log;
    error_log  /var/log/nginx/omstudio.error.log;

    # Keycloak OIDC via OMAI on prod .239 (omstudio realm)
    location ^~ /api/auth/oidc/ {
        proxy_pass         http://192.168.1.239:7060/api/auth/oidc/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header Cookie $http_cookie;
        proxy_cookie_path / /;
    }

    location = /login {
        try_files /index.html =404;
    }

    # Fork A — Brain governance edge mapping (om-brain client contract)
    location /omstudio-embed/api/governance/brain/ {
        proxy_pass http://127.0.0.1:4070/api/governance/brain/;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_pass_request_headers on;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4070/api/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    location /health {
        proxy_pass http://127.0.0.1:4070/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
