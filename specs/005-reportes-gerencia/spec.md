# SPEC 005 — Reportes y gerencia

| | |
| :--- | :--- |
| **Estado** | ESQUELETO (detallar en ciclo del módulo, semanas 9–12) |
| **Autor** | Daniel Ávila |
| **Padre** | specs/000-master/spec.md |
| **Depende de** | 003 (datos sincronizados + SYNC_LOG), 004 (dominio) |
| **Bloquea a** | Demo final (el dashboard es la prueba de la promesa: datos al día en ≤ 60 s tras reconexión) |

## Alcance heredado del spec maestro

Requisitos que este spec detallará: **FR-040 → FR-043** y soporte a **NFR-03**.

- Dashboard por tenant: inspecciones del período por estado, hallazgos por severidad, pendientes de sync, **latencia media captura→disponibilidad** (la métrica que demuestra la propuesta de valor del informe APT).
- Filtros: faena, rango de fechas, severidad, autor (FR-041).
- Export CSV de vistas y listados (FR-042).
- Visibilidad ≤ 60 s tras sincronización (FR-043).

## Secciones a completar en el ciclo del módulo

- [ ] Wireframes de las 3 vistas: dashboard ejecutivo, listado de inspecciones, detalle con conflictos
- [ ] Queries de agregación (materializadas o directas — decidir con volumen demo)
- [ ] Visualización del registro de conflictos para el supervisor (FR-023 consume aquí)
- [ ] Definición exacta de la métrica de latencia (percentil 50/95) para el informe final
- [ ] Export CSV: formato, encoding, columnas
- [ ] Criterios de aceptación y pruebas (test-plan.md §3: FR-040/043)
- [ ] Plan técnico → `plans/005-reportes-gerencia/plan.md`

## Evolución futura (post-V1 — NO entra en el alcance actual)

Idea del equipo registrada como visión, sin comprometer el alcance V1 (spec maestro §10 excluye "Analítica con IA"):

- **Resumen ejecutivo generado por IA:** al consolidar los datos sincronizados (hallazgos, severidad, latencia), una IA podría redactar un resumen automático del estado de la faena para la gerencia (ej: "12 hallazgos esta semana, 2 críticos en Zona Norte").
- **Por qué no entra en V1:** costo de API de LLM (choca con NFR-08, ≤ US$7/mes), privacidad multi-tenant (datos de un cliente saliendo hacia un proveedor externo — a evaluar contra Artículo IV/NFR-06) y carga de trabajo del equipo (Artículo V).
- **Cuándo reabrirlo:** si el equipo lo decide, como enmienda al spec maestro (Artículo X) después de cerrar el walking skeleton, con costos y privacidad resueltos.

> Nota: la IA sí participa en V1 como **probador adversarial** (red-team cross-model, test-plan.md §5, Artículo VII).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 0.1.0 | 2026-09-14 | Esqueleto inicial desde spec maestro v1.0.0 | Daniel Ávila (con IA) |
| 0.1.1 | 2026-09-24 | Se documenta "resumen ejecutivo generado por IA" como evolución post-V1 (fuera de alcance, decisión del equipo) | Raúl González (con IA) |
