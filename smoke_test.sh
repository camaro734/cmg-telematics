#!/bin/bash
# smoke_test.sh — Verifica que los endpoints críticos de CMG Telematics responden
# Uso: ./smoke_test.sh [BASE_URL] [TOKEN]
# Ejemplo: ./smoke_test.sh http://localhost:8000 eyJhbGci...

BASE_URL="${1:-http://localhost:8000}"
TOKEN="${2:-}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
    local name="$1"
    local url="$2"
    local expected="$3"
    local extra_headers="$4"

    if [ -n "$extra_headers" ]; then
        status=$(curl -s -o /dev/null -w "%{http_code}" -H "$extra_headers" "$url" 2>/dev/null)
    else
        status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
    fi

    if [ "$status" = "$expected" ]; then
        echo -e "${GREEN}✅ $name${NC} → HTTP $status"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}❌ $name${NC} → esperado $expected, recibido $status ($url)"
        FAIL=$((FAIL + 1))
    fi
}

echo ""
echo "🔍 CMG Telematics — Smoke Test"
echo "   Base URL: $BASE_URL"
echo "─────────────────────────────────────"

# Health check (sin auth)
check "Health check"              "$BASE_URL/health"                    "200"

# Auth (sin token → 401 o 403 según Caddy)
check "Auth sin token → protegido"  "$BASE_URL/api/v1/auth/me"            "403"

if [ -n "$TOKEN" ]; then
    AUTH="Authorization: Bearer $TOKEN"
    check "Vehículos (autenticado)"   "$BASE_URL/api/v1/vehicles"           "200" "$AUTH"
    check "Dispositivos (autenticado)" "$BASE_URL/api/v1/devices"           "200" "$AUTH"
    check "Alertas (autenticado)"     "$BASE_URL/api/v1/alerts"             "200" "$AUTH"
    check "Reglas (autenticado)"      "$BASE_URL/api/v1/rules"              "200" "$AUTH"
    check "Mantenimiento (autenticado)" "$BASE_URL/api/v1/maintenance"      "200" "$AUTH"
    check "Tenants (autenticado)"     "$BASE_URL/api/v1/tenants"            "200" "$AUTH"
    check "Tipos vehículo (autenticado)" "$BASE_URL/api/v1/vehicle-types"   "200" "$AUTH"
else
    echo -e "${YELLOW}⚠️  Sin token — saltando endpoints autenticados${NC}"
    echo "   Pasa un token como 2º argumento para test completo"
fi

echo "─────────────────────────────────────"
echo -e "Resultado: ${GREEN}$PASS ✅${NC}  ${RED}$FAIL ❌${NC}"
echo ""

if [ $FAIL -gt 0 ]; then
    exit 1
fi
exit 0
