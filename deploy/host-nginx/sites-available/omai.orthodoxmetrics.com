# Additive public TLS vhost on om-prod01 for omai.orthodoxmetrics.com.
# Does not replace orthodoxmetrics.com / omdev / omworkshop.
# Proxies the existing production OMAI on 127.0.0.1:7060.

server {
    listen 80;
    server_name omai.orthodoxmetrics.com;

    access_log /var/log/nginx/omai.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/omai.orthodoxmetrics.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        return 301 https://omai.orthodoxmetrics.com$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name omai.orthodoxmetrics.com;

    ssl_certificate     /etc/nginx/ssl/omai.orthodoxmetrics.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/omai.orthodoxmetrics.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/omai.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/omai.orthodoxmetrics.error.log;

    client_max_body_size 50M;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location = / {
        return 302 /omai/;
    }

    location ^~ /omai/ {
        if (-f /var/www/omai/berry/.building) {
            return 503;
        }
        proxy_pass         http://127.0.0.1:7060/omai/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_buffering    off;
        proxy_read_timeout 120s;
        error_page 502 503 504 =503 @omai_updating;
    }

    location @omai_updating {
        root /var/www/html;
        rewrite ^(.*)$ /omai-updating.html break;
    }

    location /ws/omai-logger {
        proxy_pass         http://127.0.0.1:3001/ws/omai-logger;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
    }

    location /api/ {
        proxy_pass         http://127.0.0.1:7060/api/;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_set_header   Cookie $http_cookie;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection $connection_upgrade;
        proxy_buffering    off;
        proxy_cookie_path  / /;
        proxy_cookie_domain 127.0.0.1 omai.orthodoxmetrics.com;
        proxy_cookie_domain localhost omai.orthodoxmetrics.com;
        proxy_connect_timeout 300s;
        proxy_send_timeout    300s;
        proxy_read_timeout    300s;
    }
}
