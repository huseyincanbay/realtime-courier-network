# realtime-courier-network

> Event-driven courier dispatch platform — a focused showcase of
> distributed-systems patterns (outbox, DLQ + TTL retry, CQRS projection,
> saga compensation, distributed locks, circuit breaker, WS handshake auth).
> Fully local stack, no cloud dependencies.

**Status:** 🚧 work in progress — Phase 1 (foundation) complete.

## Stack

NestJS · TypeScript · PostgreSQL + PostGIS · Redis · RabbitMQ · gRPC ·
Socket.IO · Prometheus + Grafana · Docker Compose.

## Quickstart

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm start:infra      # Postgres, Redis, RabbitMQ, Prometheus, Grafana
```

| Service | URL |
|---|---|
| RabbitMQ Management | http://localhost:15672 (admin / admin123) |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3000 (admin / admin) |

## Structure

```
apps/         # 6 microservices (added phase by phase)
packages/
  types/      # event contracts, enums, RabbitMQ topology constants
  runtime/    # shared config, prod guards, pino logging
  events/     # RabbitMQ transport
infrastructure/
  docker/     # postgres init, rabbitmq topology (definitions.json)
  monitoring/ # prometheus + grafana provisioning
```

## License

MIT
