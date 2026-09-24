# ADR-002 — Arquitectura de despliegue demo y ejercicio de diseño "producción real"

**Estado:** APROBADO COMO EJERCICIO DE DISEÑO POR RAÚL GONZÁLEZ (2026-09-24) — **pendiente firma de Daniel Ávila**; el provisionamiento real sigue pendiente del checklist en "Decisiones pendientes" (Artículo VI)
**Fecha:** 2026-09-14 · **Decisores:** Daniel Ávila, Raúl González

> **Regla de oro (Artículo VI):** antes de que cualquier IA o script cree el VPS, la base de datos o el dominio, el equipo debe poder explicar este documento sin notas. Este ADR existe para **entender el diseño primero**.

## Parte A — Lo que SÍ se provisiona (demo académica, ≤ US$7/mes)

### A.1 Topología elegida: 1 VPS + Docker Compose + Caddy

```
Internet
   │  HTTPS :443 (TLS automático Let's Encrypt vía Caddy)
   ▼
┌─────────────── VPS (Hetzner CAX11 ~€4.5/mes o Fly.io shared-cpu ~US$5/mes) ───────────────┐
│  Caddy (reverse proxy, renueva certificados solo)                                           │
│   ├── /            → frontend (nginx sirviendo build estático de la PWA)                   │
│   └── /api/*       → backend NestJS (contenedor, red interna Docker, NO expuesto)          │
│                          └── PostgreSQL 16 (contenedor, volumen pgdata, solo red interna)  │
│  Uptime Kuma (monitoreo, puerto interno + basic auth)                                       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Qué debe saber explicar cada integrante:**
- **VPS:** servidor Linux arrendado por mes; nosotros administramos OS, parches, firewall y Docker.
- **Red/DNS:** el dominio/apunte A registra la IP pública del VPS; tráfico entra solo por 443 (y 80→443 redirect); firewall (ufw/nftables) bloquea todo lo demás; SSH solo por llave, puerto no estándar opcional.
- **TLS:** Caddy obtiene y renueva certificados Let's Encrypt vía HTTP-01 challenge — por eso el dominio debe apuntar al VPS antes del primer arranque.
- **Contenedores:** compose levanta 4 servicios en una red interna Docker; Postgres y NestJS no tienen puerto publicado al exterior.
- **Presupuesto:** VPS ~US$5 + dominio (opcional, ver A.3) + monitoreo US$0 = **≤ US$7/mes** (NFR-08).

### A.2 CI/CD (GitHub Actions)

`push a main` → lint → tests (unit + integración con Testcontainers) → build imágenes → deploy por SSH (`docker compose pull && up -d` en el VPS). E2E Playwright corre en PR y nightly. Secrets del deploy vía GitHub Secrets (nunca en el repo, NFR-06).

### A.3 Dominio

- **V1 (decisión actual):** subdominio gratuito de la plataforma (`.fly.dev` / reverse-proxy) → US$0.
- **Opción documentada:** `.cl` en NIC.cl (~CLP 12.000–16.000/año ≈ US$15–20 **anual**): se compra solo si el docente lo pide para la demo. Configuración: registro A → IP del VPS, TTL bajo durante pruebas.

## Parte B — Ejercicio de diseño: qué sería "producción real" (NO se provisiona)

Comparación educativa para el informe final (muestra que entendemos la diferencia entre demo y producción):

| Concepto | Demo (pagamos) | Producción real (documentamos) | Costo producción estimado |
| :--- | :--- | :--- | :--- |
| Cómputo | 1 VPS único | 2+ instancias tras load balancer, o cluster de contenedores | US$80–300/mes |
| Base de datos | Postgres en el mismo VPS | DB gestionada (RDS/Cloud SQL) con réplica de lectura y backups automáticos PITR | US$50–150/mes |
| **VPC** | No aplica (1 red plana) | Red privada virtual: subredes públicas (LB) / privadas (app) / aisladas (DB), security groups, NAT gateway | NAT ~US$35/mes + datos |
| Fotos | Volumen Docker | Object storage S3-compatible con CDN | US$5–20/mes |
| DNS | Registro A simple | DNS gestionado + health checks + failover | US$0.5–2/mes |
| TLS | Caddy LE | Certificados gestionados + WAF | US$5–20/mes |
| Monitoreo | Uptime Kuma self-hosted | APM (Sentry/Grafana Cloud), alertas on-call | US$0–26/mes inicio |
| Backups | `pg_dump` nocturno a volumen externo | Snapshots + PITR + prueba de restore periódica | incl. DB gestionada |
| **Total** | **~US$5–7/mes** | **~US$200–600/mes** | |

**Lección del ejercicio:** la demo no es "producción chica": es otra arquitectura. Cada fila de la tabla es una decisión consciente de costo/riesgo, no un descuido.

## Decisiones pendientes antes de provisionar (checklist de aprobación)

- [ ] Proveedor del VPS elegido (Hetzner vs Fly.io) con cuenta a nombre de: ______
- [ ] Ambos integrantes explican la Parte A.1 sin notas
- [ ] Presupuesto mensual confirmado ≤ US$7 (Artículo VI)
- [ ] SSH por llave configurado, password auth deshabilitado
- [ ] Firewall: solo 22 (llave), 80, 443 abiertos
- [ ] `pg_dump` nocturno programado (cron) + copia fuera del VPS
- [ ] Secrets en GitHub Secrets; `.env.example` versionado sin valores reales

## Consecuencias

Positivas: costo mínimo, aprendizaje real de Linux/redes/Docker/CI-CD (objetivo declarado del equipo), despliegue reproducible con compose.
Negativas: punto único de fallo (aceptable para demo — se declara en el informe final); administración manual de parches (mitigado: ventana semanal de mantenimiento).
