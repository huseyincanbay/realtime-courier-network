#!/usr/bin/env bash
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-rcn-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-rcn-redis}"
DB_NAME="${DB_NAME:-dispatch}"
DB_USER="${DB_USER:-postgres}"

COURIERS="${COURIERS:-5}"
PICKUP_LAT="${PICKUP_LAT:-41.0370}"
PICKUP_LNG="${PICKUP_LNG:-28.9850}"

pg() { docker exec "$PG_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -qtA "$@"; }
rc() { docker exec "$REDIS_CONTAINER" redis-cli "$@"; }

echo "Checking infrastructure..."
if ! docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}\$"; then
  echo "  x ${PG_CONTAINER} is not running — run: pnpm start:infra"
  exit 1
fi
if ! pg -c "SELECT 1 FROM locations.courier_locations LIMIT 1" >/dev/null 2>&1; then
  echo "  x locations.courier_locations missing — start the services once so tables are created: pnpm dev"
  exit 1
fi
echo "  ok Postgres + Redis reachable, schema present"

echo "Clearing previous seed..."
pg -c "DELETE FROM locations.courier_locations WHERE courier_id::text LIKE 'a0000000-%'" >/dev/null

echo "Seeding ${COURIERS} online couriers near (${PICKUP_LAT}, ${PICKUP_LNG})..."
for i in $(seq 1 "$COURIERS"); do
  id=$(printf 'a0000000-0000-4000-8000-0000000000%02d' "$i")
  lat=$(awk "BEGIN{srand($i);     print $PICKUP_LAT + (rand()-0.5)*0.02}")
  lng=$(awk "BEGIN{srand($i+100); print $PICKUP_LNG + (rand()-0.5)*0.02}")
  pg -c "INSERT INTO locations.courier_locations (courier_id, latitude, longitude, location)
         VALUES ('$id', $lat, $lng, ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography)" >/dev/null
  rc SET "courier:$id:status" available >/dev/null
  rc DEL "lock:courier:$id" >/dev/null
  echo "  ok ${id} @ ($lat, $lng)"
done

echo "Done — ${COURIERS} couriers online and locatable within ${PICKUP_LAT},${PICKUP_LNG}."
