# Additive HTTP vhost for omworkshop.orthodoxmetrics.com on the product host.
# ACME + isolated Figma MCP (WAN edge on .239 still proxies these to :80).
# Other paths redirect to HTTPS.

server {
    listen 80;
    server_name omworkshop.orthodoxmetrics.com;

    access_log /var/log/nginx/omworkshop.orthodoxmetrics.access.log;
    error_log  /var/log/nginx/omworkshop.orthodoxmetrics.error.log;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type text/plain;
    }

    include /etc/nginx/snippets/omworkshop-figma-dev-connector-isolated-5279.conf;

    location / {
        return 301 https://omworkshop.orthodoxmetrics.com$request_uri;
    }
}
