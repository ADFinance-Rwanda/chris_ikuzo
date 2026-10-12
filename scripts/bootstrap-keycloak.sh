#!/usr/bin/env bash
set -euo pipefail

KEYCLOAK_URL=${KEYCLOAK_URL:-http://localhost:8080}
KEYCLOAK_ADMIN=${KEYCLOAK_ADMIN:?Set KEYCLOAK_ADMIN}
KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD:?Set KEYCLOAK_ADMIN_PASSWORD}
REALM=${KEYCLOAK_REALM:-chris-ikuzo}
APP_CLIENT_ID=${KEYCLOAK_CLIENT_ID:-app-backend}
FRONTEND_CLIENT_ID=${KEYCLOAK_FRONTEND_CLIENT_ID:-frontend}
DEMO_USERNAME=${KEYCLOAK_DEMO_USERNAME:-demo-user}
DEMO_PASSWORD=${KEYCLOAK_DEMO_PASSWORD:?Set KEYCLOAK_DEMO_PASSWORD}
DEMO_ORGANIZATION_ID=00000000-0000-4000-8000-000000000001

if ! docker compose ps --status running --services | grep -qx 'keycloak'; then
  echo "Keycloak container is not running. Start the stack first: docker compose up -d postgres redis keycloak" >&2
  exit 1
fi

kcadm() {
  docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"
}

kcadm config credentials --server "$KEYCLOAK_URL" --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null

if ! kcadm get realms/${REALM} >/dev/null 2>&1; then
  echo "Creating realm ${REALM}..."
  kcadm create realms -s realm="$REALM" -s enabled=true >/dev/null
fi

app_client_id=$(kcadm get clients -r "$REALM" --fields id,clientId --format csv | awk -F',' -v target="$APP_CLIENT_ID" '$2 == "\"" target "\"" {gsub(/"/, "", $1); print $1; exit}')
if [[ -z "${app_client_id}" ]]; then
  echo "Creating client ${APP_CLIENT_ID}..."
  kcadm create clients -r "$REALM" \
    -s clientId="$APP_CLIENT_ID" \
    -s publicClient=false \
    -s serviceAccountsEnabled=true \
    -s standardFlowEnabled=true \
    -s 'redirectUris=["http://localhost/*","http://localhost:3000/*","http://localhost:5173/*"]' \
    -s 'webOrigins=["http://localhost","http://localhost:3000","http://localhost:5173"]' \
    >/dev/null
  app_client_id=$(kcadm get clients -r "$REALM" --fields id,clientId --format csv | awk -F',' -v target="$APP_CLIENT_ID" '$2 == "\"" target "\"" {gsub(/"/, "", $1); print $1; exit}')
fi

kcadm update "clients/${app_client_id}" -r "$REALM" -s 'publicClient=false' -s 'serviceAccountsEnabled=true' -s 'standardFlowEnabled=true' >/dev/null

has_audience_mapper=$(kcadm get "clients/${app_client_id}/protocol-mappers/models" -r "$REALM" --fields id,name --format json | grep -q 'app-backend-audience' && echo true || echo false)
if [[ "$has_audience_mapper" != "true" ]]; then
  echo "Adding audience mapper for ${APP_CLIENT_ID}..."
  kcadm create "clients/${app_client_id}/protocol-mappers/models" -r "$REALM" \
    -s "name=app-backend-audience" \
    -s "protocol=openid-connect" \
    -s "protocolMapper=oidc-audience-mapper" \
    -s "config.\"included.client.audience\"=${APP_CLIENT_ID}" \
    -s 'config."access.token.claim"=true' \
    -s 'config."id.token.claim"=false' \
    >/dev/null
fi

frontend_client_id=$(kcadm get clients -r "$REALM" --fields id,clientId --format csv | awk -F',' -v target="$FRONTEND_CLIENT_ID" '$2 == "\"" target "\"" {gsub(/"/, "", $1); print $1; exit}')
if [[ -z "${frontend_client_id}" ]]; then
  echo "Creating frontend client ${FRONTEND_CLIENT_ID}..."
  kcadm create clients -r "$REALM" \
    -s clientId="$FRONTEND_CLIENT_ID" \
    -s publicClient=true \
    -s 'redirectUris=["http://localhost/*","http://localhost:3000/*","http://localhost:5173/*"]' \
    -s 'webOrigins=["http://localhost","http://localhost:3000","http://localhost:5173"]' \
    >/dev/null
  frontend_client_id=$(kcadm get clients -r "$REALM" --fields id,clientId --format csv | awk -F',' -v target="$FRONTEND_CLIENT_ID" '$2 == "\"" target "\"" {gsub(/"/, "", $1); print $1; exit}')
fi

kcadm update "clients/${frontend_client_id}" -r "$REALM" \
  -s 'publicClient=true' -s 'standardFlowEnabled=true' \
  -s 'directAccessGrantsEnabled=false' -s 'serviceAccountsEnabled=false' \
  -s 'redirectUris=["http://localhost/*","http://localhost:3000/*","http://localhost:5173/*"]' \
  -s 'webOrigins=["http://localhost","http://localhost:3000","http://localhost:5173"]' >/dev/null

frontend_mappers=$(kcadm get "clients/${frontend_client_id}/protocol-mappers/models" -r "$REALM" --format json)
if ! grep -q 'app-backend-audience' <<<"$frontend_mappers"; then
  kcadm create "clients/${frontend_client_id}/protocol-mappers/models" -r "$REALM" \
    -s 'name=app-backend-audience' -s 'protocol=openid-connect' \
    -s 'protocolMapper=oidc-audience-mapper' \
    -s "config.\"included.client.audience\"=${APP_CLIENT_ID}" \
    -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false' >/dev/null
fi
if ! grep -q 'organization-id-claim' <<<"$frontend_mappers"; then
  kcadm create "clients/${frontend_client_id}/protocol-mappers/models" -r "$REALM" \
    -s 'name=organization-id-claim' -s 'protocol=openid-connect' \
    -s 'protocolMapper=oidc-usermodel-attribute-mapper' \
    -s 'config."user.attribute"=org_id' -s 'config."claim.name"=org_id' \
    -s 'config."jsonType.label"=String' -s 'config."access.token.claim"=true' \
    -s 'config."id.token.claim"=false' >/dev/null
fi

for role in super_admin admin manager member; do
  if ! kcadm get roles -r "$REALM" --fields name --format csv | grep -q "\"${role}\""; then
    echo "Creating role ${role}..."
    kcadm create roles -r "$REALM" -s "name=${role}" >/dev/null
  fi
done

if ! kcadm get users -r "$REALM" --fields username --format csv | grep -q "\"${DEMO_USERNAME}\""; then
  echo "Creating user ${DEMO_USERNAME}..."
  kcadm create users -r "$REALM" \
    -s username="$DEMO_USERNAME" \
    -s enabled=true \
    -s firstName=Demo \
    -s lastName=User \
    >/dev/null
fi

user_id=$(kcadm get users -r "$REALM" --fields id,username --format csv | awk -F',' -v target="$DEMO_USERNAME" '$2 == "\"" target "\"" {gsub(/"/, "", $1); print $1; exit}')
if [[ -n "${user_id}" ]]; then
  kcadm set-password -r "$REALM" --username "$DEMO_USERNAME" --new-password "$DEMO_PASSWORD" >/dev/null
  kcadm update "users/${user_id}" -r "$REALM" \
    -s "attributes.org_id=[\"${DEMO_ORGANIZATION_ID}\"]" >/dev/null
  if ! kcadm get "users/${user_id}/role-mappings/realm" -r "$REALM" --format json | grep -q '"name" : "member"'; then
    kcadm add-roles -r "$REALM" --uusername "$DEMO_USERNAME" --rolename member >/dev/null
  fi
fi

echo "Keycloak bootstrap is ready for ${REALM}."
echo "Audience: ${APP_CLIENT_ID}"
echo "Frontend client: ${FRONTEND_CLIENT_ID}"
echo "Demo user: ${DEMO_USERNAME} (password configured from environment)"
