#!/bin/sh
# The image's stock default.conf would answer unknown host names with the nginx
# welcome page (and clashes with server_name localhost in the local test): remove it.
rm -f /etc/nginx/conf.d/default.conf
# Reload NGINX every 6 hours so renewed certificates are picked up (certbot renews
# in its own container and can't signal this one).
(while :; do sleep 21600; nginx -s reload; done) &
