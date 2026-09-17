# Additive vhost on om-prod01 for prod.orthodoxmetrics.com.
# Purpose: keep the legacy prod-current SPA reachable after orthodoxmetrics.com
# moves to om-platform. Does not replace the apex / www / api vhosts.
# SPA root: /var/www/orthodoxmetrics/prod/front-end/dist (NOT dist-platform, NOT om-platform).

server {
    listen 80;
    server_name prod.orthodoxmetrics.com;

    access_log /var/log/nginx/prod.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/prod.orthodoxmetrics.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        return 301 https://prod.orthodoxmetrics.com$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name prod.orthodoxmetrics.com;

    ssl_certificate     /etc/nginx/ssl/prod.orthodoxmetrics.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/prod.orthodoxmetrics.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    include /etc/nginx/snippets/orthodoxmetrics-legacy-common.conf;
    include /etc/nginx/snippets/getbrain.conf;
}
