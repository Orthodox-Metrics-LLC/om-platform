# Additive public TLS vhost on om-prod01 for omstudio.orthodoxmetrics.com.
# Does not replace orthodoxmetrics.com / omdev / omworkshop.
# Proxies the dedicated OMStudio origin at 192.168.1.242:443
# (LAN host redirects :80 → HTTPS; HTTP origin would 301-loop on the WAN edge).

server {
    listen 80;
    server_name omstudio.orthodoxmetrics.com;

    access_log /var/log/nginx/omstudio.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/omstudio.orthodoxmetrics.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        return 301 https://omstudio.orthodoxmetrics.com$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name omstudio.orthodoxmetrics.com;

    ssl_certificate     /etc/nginx/ssl/omstudio.orthodoxmetrics.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/omstudio.orthodoxmetrics.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/omstudio.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/omstudio.orthodoxmetrics.error.log;

    client_max_body_size 100M;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        proxy_pass         https://192.168.1.242;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name     omstudio.orthodoxmetrics.com;
        proxy_set_header   Host omstudio.orthodoxmetrics.com;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   X-Forwarded-Host omstudio.orthodoxmetrics.com;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Cookie $http_cookie;
        proxy_read_timeout 120s;
        proxy_buffering    off;
    }
}
