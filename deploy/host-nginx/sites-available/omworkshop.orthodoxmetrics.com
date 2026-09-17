# Additive public TLS vhost on om-prod01 for omworkshop.orthodoxmetrics.com.
# Enable after Let's Encrypt issues the cert. Does not replace orthodoxmetrics.com
# or omdev.orthodoxmetrics.com. Proxies only MCP + preview to the product host.

server {
    listen 80;
    server_name omworkshop.orthodoxmetrics.com;

    access_log /var/log/nginx/omworkshop.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/omworkshop.orthodoxmetrics.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    location / {
        return 301 https://omworkshop.orthodoxmetrics.com$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name omworkshop.orthodoxmetrics.com;

    ssl_certificate     /etc/nginx/ssl/omworkshop.orthodoxmetrics.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/omworkshop.orthodoxmetrics.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/omworkshop.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/omworkshop.orthodoxmetrics.error.log;

    location = /__server/integrations/figma-dev/mcp {
        proxy_pass http://192.168.1.251;
        proxy_http_version 1.1;
        proxy_set_header Host omworkshop.orthodoxmetrics.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Accept $http_accept;
        proxy_set_header Content-Type $content_type;
        proxy_set_header Mcp-Session-Id $http_mcp_session_id;
        proxy_set_header MCP-Protocol-Version $http_mcp_protocol_version;
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        client_max_body_size 256k;
        add_header Cache-Control "no-store, private" always;
    }

    location ^~ /__preview/figma-dev/ {
        proxy_pass http://192.168.1.251;
        proxy_http_version 1.1;
        proxy_set_header Host omworkshop.orthodoxmetrics.com;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_hide_header Set-Cookie;
        add_header Cache-Control "no-store" always;
        add_header X-OM-Preview "figma-dev-untrusted" always;
    }

    location / {
        default_type text/plain;
        return 404 "omworkshop: MCP and preview locations only\n";
    }
}
