# Terreno Conectado, Decisiones en Tiempo Real

Plataforma SaaS **offline-first** de captura de datos operacionales para faenas mineras y obras de construcción en Chile. Captura local sin conexión, sincronización automática al recuperar señal, multi-tenant con datos aislados por empresa cliente.

Proyecto Capstone (PTY4614) — Duoc UC, Ingeniería en Informática, Sede Alameda.
Integrantes: Daniel Ávila (datos / lógica de negocio) · Raúl González (infraestructura / validación).

## Metodología: Spec Driven Development (SDD)

Todo artefacto de código nace de un spec. Ninguna tarea se ejecuta sin requisito trazable.

```
terreno-conectado/
├── constitution.md       ← Principios innegociables (leer primero)
├── specs/
│   ├── 000-master/       ← SPEC MAESTRO: visión, módulos, FR/NFR, alcance (~70-80% del proyecto)
│   ├── 001-auth-tenancy/
│   ├── 002-captura-offline/
│   ├── 003-motor-sincronizacion/
│   ├── 004-dominio-inspecciones/
│   ├── 005-reportes-gerencia/
│   └── 006-admin-plataforma/
├── research.md           ← Stack evaluado y alternativas descartadas con criterios
├── data-model.md         ← Modelo conceptual de datos (evidencia APT Fase 2)
├── test-plan.md          ← Plan de pruebas de validación (evidencia APT Fase 2)
├── adr/                  ← Decisiones arquitectónicas (incl. ejercicio de despliegue/redes/costos)
├── plans/                ← plan.md por módulo (diseño técnico derivado del spec)
├── tasks/                ← tasks.md por iteración (cada tarea referencia FR/NFR del spec)
├── frontend/             ← PWA React + Vite + Dexie (IndexedDB)
├── backend/              ← NestJS + PostgreSQL 16 (Row-Level Security)
├── infra/                ← Docker Compose, Caddy, scripts de deploy
└── .github/workflows/    ← CI/CD (lint + test + build + deploy)
```

## Ciclo de trabajo por módulo

`spec → plan → tasks → código → tests → evidencia`

- Specs en **español**; código, tests, commits y CI en **inglés**.
- Spec congelado solo se modifica vía enmienda numerada (PR).
- Infra real solo después del ADR correspondiente entendido y firmado por el equipo.

## Documentos clave para empezar

1. [constitution.md](constitution.md)
2. [specs/000-master/spec.md](specs/000-master/spec.md)
3. [research.md](research.md) · [data-model.md](data-model.md) · [test-plan.md](test-plan.md)
