# Informe final de validación — Terreno Conectado

**Proyecto:** Terreno Conectado, SaaS offline-first para faenas mineras y obras.  
**Equipo:** Daniel Ávila · Raúl González.  
**Fase:** F3, producto v1.3 en producción.  
**Fecha:** 2026-11-11.  
**Repo:** `https://github.com/danielandresavilaj-cell/terreno-conectado`  
**Producción:** `https://terrenoconectado.cl` (Oracle Always Free, US$0/mes)

## 1. Resumen ejecutivo

Terreno Conectado está **en producción con cuentas reales**. Con el teléfono:

- se capturan inspecciones **sin señal**;
- quedan en una cola local (IndexedDB);
- se sincronizan con PostgreSQL en lotes idempotentes cuando vuelve la conexión.

El supervisor ve en el dashboard las inspecciones, los hallazgos y el estado de la sincronización. Puede revisar inspecciones, mover hallazgos y exportar lo filtrado en Excel, PDF o Word.

Después del cierre de F2, el producto dejó de ser una demo y sumó:

- formularios importados desde **Excel, Word, PDF y fotos de pautas en papel** (con IA opcional);
- una exportación consolidada.

De los requisitos implementados, la matriz está en **97,7% verde** (43/44), y hay **521 pruebas automatizadas** en CI. La Enmienda 007, aprobada el 2026-11-12, suma 3 filas de requisitos que todavía no se implementan.

## 2. Alcance entregado

| Módulo | Qué hace hoy |
| :--- | :--- |
| 001 Auth y tenancy | Login con correo y clave, JWT con tenant, refresh `httponly` con rotación y detección de reuso, bloqueo por intentos, RLS de Postgres, clave temporal en el primer ingreso, aviso si la sesión se abre en otro dispositivo |
| 002 Captura offline | PWA instalable (con botón "Instalar app" y ayuda por plataforma), borradores, cámara con compresión, cola local, cuota real del dispositivo con aviso al 80%, entrada sin señal con la identidad cacheada, captura operable con lector de pantalla y teclado |
| 003 Sincronización | Lotes idempotentes (UUIDv7 + `client_version`), orden de dependencias, LWW determinista, registro de conflictos visible para el supervisor |
| 004 Dominio | Plantillas versionadas, inspecciones con versión congelada, hallazgos, adjuntos, asociación a faena (sin geolocalización, Enmienda 004) |
| 005 Reportes | Dashboard con filtros, latencia (media y p95), "espera sin señal" medida aparte, supervisión de la sincronización por faena y equipo, exportación Excel consolidado / PDF / Word por filtro o selección |
| 006 Administración | Empresas, equipos, faenas y auditoría (`audit_log` append-only) |
| 007 Formularios dinámicos | Importar Excel, Word y PDF por reglas; con IA, también fotos y PDF escaneados; revisión humana obligatoria; asignación por faena y rol; delta por `published_seq`; exportación del original rellenado |

## 3. Mejoras posteriores a F2 (enmiendas al spec maestro)

| Enmienda | Cambio | Evidencia |
| :--- | :--- | :--- |
| 003 | Producto real: cuentas, alta de empresas y equipos, sin modo demo; despliegue en Oracle con respaldos cifrados | `supervision.spec.ts`, `auth.spec.ts`, `infra/OPERACION.md` |
| 004 | Se retira la geolocalización; aviso de sesión reemplazada; métricas de supervisión (TSK-REP-006) | PRs #170–#172 |
| 005 | Importar Word y PDF (TSK-FORM-020); exportar Excel consolidado, PDF y Word (TSK-REP-007) | PRs #173, #174 |
| 006 | Importar con IA, opcional, auditado y con tope diario (TSK-FORM-021, ADR-005) | PR #175 |
| 007 | **Aprobada, por implementar:** firma con el dedo al cerrar y cofirma opcional, avisos por correo, inspecciones programadas y QR por activo o lugar (FR-056…061, plan 008) | PR #187 |
| — | Validación en Windows/Mac/CI y E2E aislado (TSK-OPS-001, TSK-E2E-002); accesibilidad de la captura (TSK-OFF-003); instalación visible de la PWA (TSK-OFF-004); dominio propio `terrenoconectado.cl` (ADR-002 adenda 2) | PRs #178, #179, #182, #183, #185 |

Las enmiendas 003 a 006 quedan pendientes de ratificación por Raúl González.

## 4. Estado de la matriz de pruebas (§3 del test-plan)

- **47 filas · 🟢 43 · 🟡 3 · 🔴 0 · ⚪ 1.**
- De lo implementado: **43/44 en verde (97,7%)**.
- Las 3 🟡 son los requisitos de la Enmienda 007, aprobada y por implementar, que no se declaran cubiertos antes de tener sus pruebas.
- La única ⚪ es FR-034, por la geolocalización que la Enmienda 004 sacó de V1. Su parte vigente, la asociación a faena, está en 🟢.
- FR-040/043/NFR-03 (dashboard en ≤ 60 s) se verificaron en producción.

Se cumple con holgura el criterio de salida de F2 (**≥ 90% verde**); incluso contando la enmienda nueva, la matriz completa está en 91,5%.

## 5. Resultados de pruebas

| Capa | Cantidad | Estado |
| :--- | :--- | :--- |
| Integración backend (Vitest + Testcontainers, Postgres real) | 253 | Verde en el CI de `main` (`a13c50c`) |
| Unidad frontend (Vitest) | 153 | Verde |
| Unidad shared (Vitest) | 92 | Verde |
| E2E + caos (Playwright, perfil móvil) | 23 | Verde en la última corrida |
| **Total** | **521** | |

Invariantes de los escenarios de caos 1–7: **0 pérdidas, 0 duplicados, 0 fugas entre empresas**.

La IA de importación se prueba con un analizador simulado, así que la CI no llama a la API ni gasta crédito. También se validó en producción con una foto real de una pauta en papel.

## 6. Decisiones de arquitectura relevantes

- **Aislamiento por RLS de Postgres** (Art. IV), no por filtros de la aplicación.
- **Offline-first** (Art. I): la nube consolida, pero nunca es requisito para trabajar. La IA es un extra que necesita internet y no toca la captura.
- **Idempotencia** por UUIDv7 de cliente + `client_version` (FR-021/023).
- **Un solo contrato** Zod en `shared/` para frontend y backend (ADR-001/003).
- **Lectores pesados solo en el servidor** (pdf.js, pdfkit, docx, SDK de IA), para que la PWA siga liviana (ADR-003 Enmienda 4).
- **IA acotada** (ADR-005):
  - modelo pequeño: menos de USD 0,005 por pauta;
  - tope de 20 análisis por empresa al día;
  - límite de gasto de la cuenta;
  - solo se envía la pauta en blanco;
  - la persona siempre confirma.
- **Despliegue de costo cero:** Oracle Always Free + Docker Compose + Caddy; imágenes por SHA en GHCR; respaldos cifrados con `age` fuera de la VM (ADR-002).

## 7. Huecos y deuda técnica

- **Catálogo de plantillas de plataforma** (TSK-FORM-012): queda para V2.
- **Avisos de GitHub Actions:** algunas acciones apuntan a Node 20, que está obsoleto. Funcionan, pero hay que subirlas de versión.
- **Dependencias:** quedan 2 vulnerabilidades moderadas (`uuid` → `exceljs`), aceptadas en ADR-004.
- **IA:** depende del crédito de la cuenta. Si se agota, la app sigue con las reglas y lo avisa.

## 8. Lecciones aprendidas

- Marcar un requisito como "hecho" sin una prueba real deja huecos (FR-034, FR-041). La matriz se actualiza en el mismo PR que el código (Art. II/VIII).
- Postgres real (Testcontainers) encuentra errores de esquema y de RLS que las pruebas en memoria no ven.
- **PRs apilados:** hay que cambiar la base a `main` antes de mergear. Uno se mergeó en la rama padre y hubo que recuperarlo.
- Las caídas de GitHub Actions se resolvieron con un despliegue manual por SSH documentado. Conviene tener siempre un plan B de despliegue.
- La IA rinde más cuando **propone** y una persona decide. Así entra al producto sin arriesgar la calidad de los datos.

## 9. Enlaces a artefactos

- `specs/000-master/spec.md`: visión, FR/NFR y enmiendas 001–006.
- `test-plan.md`: matriz §3, caos §4 y defectos §5.
- `data-model.md`: modelo de datos y RLS.
- `adr/001…005`: stack, despliegue, formularios dinámicos, dependencias e IA.
- `infra/OPERACION.md`: desplegar, respaldar, restaurar y activar la IA.
- `tasks/`: tareas por módulo.

## 10. Próximos pasos

1. Que Raúl González ratifique las enmiendas 003 a 006.
2. Demo final en vivo:
   - captura en modo avión y sincronización al reconectar;
   - dashboard en ≤ 60 s;
   - importar una pauta desde una foto;
   - exportar el mes en Excel consolidado.
3. Implementar la Enmienda 007 por tareas: firma offline y cofirma (TSK-OPS-003-B), activos y QR (-C), inspecciones programadas (-D) y avisos por correo (-E, que necesita definir proveedor y destinatarios).
4. Mejora candidata: plan de acción para hallazgos (responsable y plazo).

## Control de cambios

| Versión | Fecha | Cambio | Autor |
| :--- | :--- | :--- | :--- |
| 2.2.0 | 2026-11-12 | Enmienda 007 aprobada (por implementar): matriz 47 filas, 97,7% de lo implementado | Daniel Ávila (con IA) |
| 2.1.0 | 2026-11-12 | Mejoras de validación, E2E, accesibilidad e instalación PWA; dominio `terrenoconectado.cl`; 521 pruebas | Daniel Ávila (con IA) |
| 2.0.0 | 2026-11-11 | Estado v1.3 en producción: enmiendas 003–006, matriz 43/44 y 517 pruebas reales del CI de `main` | Daniel Ávila (con IA) |
| 1.0.0 | 2026-10-14 | Borrador del informe final de F2 | Daniel Ávila |
