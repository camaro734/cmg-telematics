#!/bin/bash
# CMG Track — Onboarding de nuevo cliente
# Uso: ./add_client.sh "Empresa S.L." admin@empresa.com Password123!
set -e

EMPRESA="$1"
EMAIL="$2"
PASSWORD="$3"

if [ -z "$EMPRESA" ] || [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Uso: $0 'Nombre Empresa' email@cliente.com Contraseña"
  exit 1
fi

echo "→ Creando cliente: $EMPRESA ($EMAIL)"

# Hash de la contraseña
HASH=$(docker exec cmg-telematic1_core-api_1 python3 -c "
import bcrypt; print(bcrypt.hashpw('$PASSWORD'.encode(), bcrypt.gensalt()).decode())
")

# Insertar tenant y usuario admin en la BD
docker exec cmg-telematic1_postgres_1 psql -U cmg -d cmg_telematics << SQL
DO \$\$
DECLARE
  t_id UUID := gen_random_uuid();
  u_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO tenant (id, name, tier, created_at)
  VALUES (t_id, '$EMPRESA', 'client', NOW())
  ON CONFLICT DO NOTHING;

  INSERT INTO "user" (id, tenant_id, email, hashed_password, role, is_active, created_at)
  VALUES (u_id, t_id, '$EMAIL', '$HASH', 'admin', true, NOW())
  ON CONFLICT (email) DO NOTHING;

  RAISE NOTICE 'Tenant ID: %', t_id;
  RAISE NOTICE 'User ID: %', u_id;
END \$\$;
SQL

echo "✅ Cliente '$EMPRESA' creado. Login: $EMAIL / $PASSWORD"
echo "   El cliente puede añadir sus propios vehículos desde el panel."
