#!/bin/sh
set -eu
# Named volume stores a private instance key; never print or commit its value.
umask 077
if [ ! -s /etc/searxng/instance-key ]; then
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > /etc/searxng/instance-key
fi
instance_key=$(cat /etc/searxng/instance-key)
sed "s/MILUJU_FILMY_GENERATED_SECRET/$instance_key/" /opt/milujufilmy/settings.yml > /etc/searxng/settings.yml
exec /usr/local/searxng/entrypoint.sh
