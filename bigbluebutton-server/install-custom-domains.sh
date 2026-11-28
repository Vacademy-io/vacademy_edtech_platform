#!/bin/bash
# =============================================================
# Per-institute custom live-class domains (white-labelling)
# =============================================================
# Makes this BBB server answer for institute-owned hostnames such as
# meet.zoeedtech.com, in addition to its canonical pool domain.
#
# Usage:
#   bash install-custom-domains.sh <CANONICAL_DOMAIN> [comma,separated,aliases]
#
# Example:
#   bash install-custom-domains.sh meet.vacademy.io meet.zoeedtech.com,live.school.in
#
# Safe to run on every boot: every step is idempotent, and the script is
# written so the CANONICAL domain keeps working even if every alias step
# fails. An alias that cannot get a certificate degrades to a TLS warning on
# that one hostname; it never takes the pool server down.
#
# Ordering matters. This MUST run AFTER `bbb-conf --setip` and after the
# stale-IP sweep, because both rewrite /etc/nginx/sites-available/bigbluebutton
# and would drop the server_name list this script installs.
#
# Requires (for certificate expansion only):
#   /etc/letsencrypt/cloudflare.ini   Cloudflare API token, DNS:Edit on the zones
# =============================================================

set -uo pipefail

CANONICAL="${1:?Usage: bash install-custom-domains.sh <CANONICAL_DOMAIN> [aliases]}"
ALIAS_CSV="${2:-}"

SITE=/etc/nginx/sites-available/bigbluebutton
WEB=/usr/share/bigbluebutton/nginx/web
CF_INI=/etc/letsencrypt/cloudflare.ini
LOG_TAG="bbb-custom-domains"
STAMP=$(date +%Y%m%d-%H%M%S)

log() { echo "[$LOG_TAG] $*"; }

# ── Normalise the alias list ─────────────────────────────────
# Drop blanks, lowercase, strip scheme/path, reject anything that is not a
# plain hostname. The backend validates too, but this list is about to be
# interpolated into an nginx directive and a certbot command line, so it is
# re-checked here rather than trusted over the wire.
ALIASES=""
if [ -n "$ALIAS_CSV" ]; then
    for raw in ${ALIAS_CSV//,/ }; do
        h=$(echo "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's#^[a-z][a-z0-9+.-]*://##; s#/.*$##; s#^[^@]*@##')
        [ -z "$h" ] && continue
        case "$h" in *:*) log "  skip (port not allowed): $raw"; continue ;; esac
        if ! echo "$h" | grep -qE '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'; then
            log "  skip (not a hostname): $raw"
            continue
        fi
        [ "$h" = "$CANONICAL" ] && continue
        case " $ALIASES " in *" $h "*) continue ;; esac
        ALIASES="${ALIASES:+$ALIASES }$h"
    done
fi

if [ -n "$ALIASES" ]; then
    log "aliases: $ALIASES"
else
    log "no aliases configured — restoring canonical-only config"
fi

# ── 1. Location-level redirect rewrite ───────────────────────
# bbb-web builds its join redirect from bigbluebutton.web.serverURL, which is
# absolute, so an alias host would be bounced straight back to the canonical
# domain. Rewrite Location to whatever host the client actually asked for.
#
# This has to sit INSIDE each location block: the packaged config sets
# `proxy_redirect default;` per-location, which overrides anything inherited
# from the server level. The `default` line is kept and ours added after it,
# so upstream 127.0.0.1 rewrites still work.
#
# For the canonical host the rewrite is an identity transform, which is why it
# is safe to leave installed permanently.
REWRITE='proxy_redirect     ~^https://[^/]+/(.*)$ https://$host/$1;'
if [ -f "$WEB" ]; then
    if grep -qF 'proxy_redirect     ~^https://[^/]+/(.*)$' "$WEB"; then
        log "1/4 redirect rewrite already present"
    else
        cp -a "$WEB" "$WEB.bak-$STAMP"
        # The rule goes in through %ENV: spliced into the perl source, its $host,
        # $1 and "$ https" (perl allows a space after the sigil) were read as perl
        # variables and the line came out as "(.*):///" — nginx then refused the
        # whole config. Only a fresh package file reaches this branch (a BBB
        # upgrade), which is why snapshot restores never hit it.
        REWRITE="$REWRITE" perl -0pi -e 's{^(\s*)proxy_redirect(\s+)default;}{$1proxy_redirect$2default;\n$1$ENV{REWRITE}}gm' "$WEB"
        log "1/4 redirect rewrite added ($(grep -c 'proxy_redirect     ~\^https' "$WEB") locations)"
    fi
else
    log "1/4 WARNING: $WEB not found — skipping redirect rewrite"
fi

# ── 1b. Rewrite the absolute URLs bbb-web advertises in its API index ──
# GET /bigbluebutton/api is the FIRST call the HTML5 client makes, and bbb-web
# answers with two absolute, canonical URLs derived from
# bigbluebutton.web.serverURL:
#
#   <graphqlApiUrl>https://<canonical>/api/rest</graphqlApiUrl>
#   <graphqlWebsocketUrl>wss://<canonical>/graphql</graphqlWebsocketUrl>
#
# The client uses both as bases for everything after. On an alias host that made
# every subsequent call cross-origin: CORS blocked the REST fetch (which is sent
# with credentials:"include"), and the websocket carried no cookie for that
# origin. The client showed only "Oops, something went wrong".
#
# There is no static value that is correct for two hostnames — a WebSocket URL
# needs a scheme, so it cannot simply be made relative. Rewriting per-request is
# the only thing that works for both. For the canonical host this is an identity
# transform, so existing traffic is untouched.
#
# An exact-match location wins over the packaged `location /bigbluebutton`
# prefix, so this overrides just this one endpoint and nothing else.
API_SNIP=/etc/bigbluebutton/nginx/01-vacademy-api-index.nginx
MSD_SNIP=/etc/bigbluebutton/nginx/02-vacademy-meeting-static-data.nginx
# Keep the previous good snippets: if the final nginx test fails they are put
# back. Deleting them instead (as this script used to) leaves every alias host
# broken until the next successful run.
SNIP_BAK=/var/backups/vacademy-custom-domains
mkdir -p "$SNIP_BAK"
rm -f "$SNIP_BAK"/*.nginx
for f in "$API_SNIP" "$MSD_SNIP"; do
    [ -f "$f" ] && cp -a "$f" "$SNIP_BAK/"
done
cat > "$API_SNIP" <<NGX
location = /bigbluebutton/api {
    proxy_http_version 1.1;
    proxy_pass         http://127.0.0.1:8090;
    proxy_redirect     default;
    proxy_redirect     ~^https://[^/]+/(.*)\$ https://\$host/\$1;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    add_header P3P 'CP="No P3P policy available"';

    # sub_filter cannot rewrite a compressed body.
    proxy_set_header   Accept-Encoding "";
    sub_filter_types   text/xml application/xml application/json;
    sub_filter_once    off;
    sub_filter "https://$CANONICAL" "https://\$host";
    sub_filter "wss://$CANONICAL"   "wss://\$host";
}
NGX
echo "1b/5 API-index URL rewrite installed ($CANONICAL -> \$host)"

# ── 1c. Rewrite the absolute URLs inside the meetingStaticData payload ──
# The client fetches this once at startup and takes its media endpoints from it:
#
#   clientSettings.public.kurento.wsUrl = wss://<canonical>/bbb-webrtc-sfu
#   clientSettings.public.pads.url      = https://<canonical>/pad
#   meeting.logoutUrl                   = https://<canonical>
#
# kurento.wsUrl is the one that matters: on an alias host the client opened the
# media websocket against the canonical origin, where it has no session cookie,
# so audio and video failed with WEBSOCKET_CONNECTION_FAILED (1002) while the
# rest of the UI worked perfectly.
#
# These come from /etc/bigbluebutton/bbb-html5.yml, which is per-SERVER config —
# there is no value that is simultaneously right for two hostnames, so again the
# rewrite has to happen per-request.
#
# The packaged block caches this response with key "$uri|$meeting_id". Since the
# body now differs per hostname, $host MUST be part of the key, otherwise one
# institute's cached payload gets served to another and both domains break in a
# way that looks intermittent and random.
cat > "$MSD_SNIP" <<NGX
location = /api/rest/meetingStaticData {
    auth_request /bigbluebutton/connection/checkGraphqlAuthorization;
    auth_request_set \$meeting_id \$sent_http_meeting_id;

    proxy_cache client_settings_cache;
    proxy_cache_key "\$uri|\$meeting_id|\$host";
    proxy_cache_use_stale updating;
    proxy_cache_valid 24h;
    proxy_cache_lock on;
    proxy_cache_lock_timeout 5s;
    proxy_cache_lock_age 10s;

    add_header X-Cached \$upstream_cache_status;

    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_connect_timeout 3s;
    proxy_send_timeout 15s;
    proxy_read_timeout 30s;
    proxy_set_header Host \$host;

    # sub_filter cannot rewrite a compressed body.
    proxy_set_header Accept-Encoding "";
    sub_filter_types application/json text/json text/plain;
    sub_filter_once off;
    sub_filter "https://$CANONICAL" "https://\$host";
    sub_filter "wss://$CANONICAL"   "wss://\$host";

    proxy_pass http://127.0.0.1:8185;
}
NGX
echo "1c/5 meetingStaticData URL rewrite installed (media + pads + logout)"

# ── 2. server_name + host-preserving HTTP redirect ───────────
cp -a "$SITE" "$SITE.bak-$STAMP"
ALL_NAMES="$CANONICAL${ALIASES:+ $ALIASES}"
sed -i -E "s/^([[:space:]]*)server_name[[:space:]]+.*;/\1server_name $ALL_NAMES;/" "$SITE"
# With more than one server_name, $server_name expands to the FIRST one, so an
# alias hitting :80 would be redirected to the canonical host. $host keeps the
# visitor on the hostname they typed.
sed -i 's|return 301 https://\$server_name\$request_uri;|return 301 https://$host$request_uri;|' "$SITE"
log "2/4 server_name -> $ALL_NAMES"

# ── 3. Certificate ───────────────────────────────────────────
# Expand the EXISTING lineage so haproxy's certbundle path never changes; its
# deploy hook rebuilds the bundle and reloads haproxy.
#
# DNS-01, not HTTP-01: this box gets a new public IP on every restore, so an
# HTTP-01 challenge fails for any hostname whose A record has not caught up
# yet. DNS-01 also lets a certificate be issued before the record exists.
if [ -z "$ALIASES" ]; then
    log "3/4 no aliases — leaving certificate untouched"
elif [ ! -f "$CF_INI" ]; then
    log "3/4 WARNING: $CF_INI missing — cannot expand certificate. Aliases will serve a TLS warning."
else
    LIVE=/etc/letsencrypt/live/$CANONICAL/cert.pem
    WANT=$(printf '%s\n' "$CANONICAL" $ALIASES | sort -u | tr '\n' ' ')
    HAVE=""
    [ -f "$LIVE" ] && HAVE=$(openssl x509 -in "$LIVE" -noout -ext subjectAltName 2>/dev/null \
        | tr ',' '\n' | sed -n 's/.*DNS://p' | tr -d ' ' | sort -u | tr '\n' ' ')

    if [ "$WANT" = "$HAVE" ]; then
        log "3/4 certificate already covers: $HAVE"
    else
        log "3/4 expanding certificate"
        log "     have: ${HAVE:-<none>}"
        log "     want: $WANT"
        if ! certbot plugins 2>/dev/null | grep -qi dns-cloudflare; then
            log "     installing python3-certbot-dns-cloudflare"
            DEBIAN_FRONTEND=noninteractive apt-get install -y -q python3-certbot-dns-cloudflare >/dev/null 2>&1
        fi
        D_ARGS=""
        for d in $WANT; do D_ARGS="$D_ARGS -d $d"; done
        # shellcheck disable=SC2086
        if certbot certonly --dns-cloudflare \
              --dns-cloudflare-credentials "$CF_INI" \
              --dns-cloudflare-propagation-seconds 30 \
              --cert-name "$CANONICAL" $D_ARGS \
              --non-interactive --agree-tos --expand 2>&1 | tail -5; then
            log "     certificate expanded"
        else
            # Non-fatal on purpose: the previous certificate is still in place and
            # still valid for the canonical domain, so classes keep working.
            log "     WARNING: certbot failed — keeping the existing certificate"
        fi
    fi
fi

# ── 4. Validate and reload ───────────────────────────────────
if nginx -t 2>&1 | tail -1; then
    systemctl reload nginx && log "4/4 nginx reloaded"
else
    log "4/4 ERROR: nginx config test failed — rolling back"
    cp -a "$SITE.bak-$STAMP" "$SITE"
    [ -f "$WEB.bak-$STAMP" ] && cp -a "$WEB.bak-$STAMP" "$WEB"
    for f in "$API_SNIP" "$MSD_SNIP"; do
        if [ -f "$SNIP_BAK/$(basename "$f")" ]; then cp -a "$SNIP_BAK/$(basename "$f")" "$f"; else rm -f "$f"; fi
    done
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
    log "4/4 rolled back to the previous config"
    exit 1
fi

# Keep the backup directory from growing without bound across daily restores.
find /etc/nginx/sites-available /usr/share/bigbluebutton/nginx \
     -maxdepth 1 -name '*.bak-*' -mtime +7 -delete 2>/dev/null || true

log "done: serving $ALL_NAMES"
