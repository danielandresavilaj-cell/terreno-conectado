# DATA MODEL — Modelo conceptual de datos

**Versión:** 1.0.0 · **Fecha:** 2026-09-14 · **Autor:** Daniel Ávila · **Relacionado:** spec maestro §5/§7, specs 001–006
**Evidencia APT:** "Modelo conceptual de datos preliminar" (informe §6).
**Reglas transversales:** toda tabla de dominio lleva `tenant_id UUID NOT NULL` + política RLS (Artículo IV); IDs `UUIDv7` generados en el cliente cuando el registro nace offline (FR-015); timestamps `created_at`, `updated_at` (servidor) y `captured_at` (cliente, autoridad para LWW — FR-023).

## 1. Diagrama ER conceptual

```mermaid
erDiagram
    TENANT ||--o{ USER : "tiene"
    TENANT ||--o{ SITE : "opera en"
    TENANT ||--o{ TEMPLATE : "define"
    TEMPLATE ||--|{ TEMPLATE_SECTION : "contiene"
    TEMPLATE_SECTION ||--|{ TEMPLATE_ITEM : "contiene"
    SITE ||--o{ INSPECTION : "recibe"
    USER ||--o{ INSPECTION : "ejecuta"
    TEMPLATE ||--o{ INSPECTION : "instancia"
    INSPECTION ||--o{ INSPECTION_RESPONSE : "registra"
    TEMPLATE_ITEM ||--o{ INSPECTION_RESPONSE : "responde"
    INSPECTION ||--o{ FINDING : "origina"
    FINDING ||--o{ ATTACHMENT : "evidencia"
    INSPECTION ||--o{ ATTACHMENT : "evidencia"
    SITE ||--o{ LOG_ENTRY : "recibe"
    USER ||--o{ LOG_ENTRY : "escribe"
    TENANT ||--o{ SYNC_LOG : "audita"
    SYNC_LOG ||--o{ CONFLICT_RECORD : "detecta"
    TENANT ||--o{ AUDIT_LOG : "registra"
```

## 2. Entidades por dominio

### 2.1 Tenancy y usuarios (spec 001)

**TENANT** — empresa cliente del SaaS.
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| id | UUID PK | |
| name | TEXT | "Minera El Cobre SpA" (demo) |
| slug | TEXT UNIQUE | URL/identificador legible |
| status | ENUM(active, suspended) | FR-050 |
| created_at | TIMESTAMPTZ | |

**USER** — cuenta de cualquier actor.
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| id | UUID PK | |
| tenant_id | UUID FK→TENANT | RLS; `platform_admin` tiene tenant NULL permitido (bypass auditado, §7 spec maestro) |
| email | CITEXT UNIQUE(tenant_id, email) | |
| password_hash | TEXT | argon2id (NFR-06) |
| role | ENUM(field_worker, supervisor, tenant_admin, platform_admin) | FR-003 |
| full_name | TEXT | |
| is_active | BOOLEAN | |

**SITE (Faena/Obra)**
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| id, tenant_id | UUID | |
| name | TEXT | |
| kind | ENUM(mining, construction) | |
| location | GEOGRAPHY(Point) NULL | georreferencia opcional (FR-034) |

### 2.2 Plantillas e inspecciones (spec 004)

**TEMPLATE (InspectionTemplate)** — `id, tenant_id, name, description, version INT, is_active`.
**TEMPLATE_SECTION** — `id, template_id, position, title`.
**TEMPLATE_ITEM** — `id, section_id, position, prompt TEXT, response_type ENUM(ok_nok_na, text, numeric, photo), require_finding_on_nok BOOLEAN, min/max NUMERIC NULL, help TEXT`.

**INSPECTION**
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| id | UUID PK (cliente, UUIDv7) | FR-015 |
| tenant_id, site_id, template_id | UUID FK | |
| template_version | INT | congela la plantilla usada |
| executed_by | UUID FK→USER | |
| status | ENUM(draft, in_progress, submitted, reviewed) | FR-031 |
| captured_at | TIMESTAMPTZ (cliente) | autoridad LWW |
| synced_at | TIMESTAMPTZ NULL (servidor) | métrica de latencia NFR-03/FR-024 |
| client_version | INT | contador de edición local para conflictos |
| geo | GEOGRAPHY NULL | |

**INSPECTION_RESPONSE** — `id, inspection_id, template_item_id, tenant_id, value_ok ENUM(ok,nok,na) NULL, value_text NULL, value_number NULL, captured_at, client_version`.
**FINDING (Hallazgo)** — `id, inspection_id NULL, response_id NULL, tenant_id, severity ENUM(low, medium, high, critical), description TEXT, status ENUM(open, in_progress, resolved), captured_at, client_version`.
**LOG_ENTRY (Bitácora)** — `id, site_id, author_id, tenant_id, entry_text TEXT, tags TEXT[], shift_date DATE, captured_at, client_version`.
**ATTACHMENT (Foto)** — `id, tenant_id, owner_type ENUM(inspection, finding, log_entry), owner_id, file_key TEXT, mime, bytes INT, width/height INT, captured_at, client_version`. V1: `file_key` apunta a volumen Docker; evolución S3 documentada en research.md §6.

### 2.3 Sincronización y auditoría (spec 003 / 006)

**SYNC_LOG** — `id, tenant_id, user_id, device_id UUID, batch_id UUID, records_total INT, records_ok INT, records_failed INT, started_at, finished_at, status ENUM(ok, partial, failed)`. Satisface FR-024 y alimenta el dashboard (latencia media).

**CONFLICT_RECORD** — `id, tenant_id, entity_type, entity_id, winner_payload JSONB, loser_payload JSONB, resolution ENUM(lww), resolved_at, sync_log_id`. Ambas versiones conservadas (FR-023, Artículo III).

**AUDIT_LOG** (append-only, FR-051) — `id, tenant_id NULL, actor_id, action TEXT, entity_type, entity_id, payload JSONB, occurred_at`. Sin UPDATE/DELETE (permisos DB).

### 2.4 Cliente local (IndexedDB/Dexie — no es PostgreSQL)

| Store | Contenido |
| :--- | :--- |
| `outbox` | Cola de sync: `{batchable records por entidad, status: pending/syncing/synced/failed, retries, last_error}` (FR-013, FR-020/22) |
| `inspections / responses / findings / logEntries / attachments(blobs)` | Copia local de trabajo offline (FR-011, FR-014) |
| `templates_cache` | Plantillas del tenant descargadas para operar offline |
| `meta` | sesión, tenant_id, device_id (UUID persistente del dispositivo), cuotas (FR-017) |

## 3. Multi-tenancy — implementación RLS

```sql
-- Patrón por tabla de dominio (ejemplo inspection)
ALTER TABLE inspection ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inspection
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- La app fija por transacción: SET LOCAL app.tenant_id = '<uuid del JWT>';
-- platform_admin: rol DB separado con bypass explícito, solo endpoints admin, auditado.
```

Índices mínimos: `(tenant_id, captured_at DESC)` en tablas de dominio; `(tenant_id, status)` en outbox/inspection; GIN sobre `tags` en log_entry.

## 4. Reglas de integridad clave

1. **Idempotencia de ingesta:** `INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE excluded.client_version > inspection.client_version` (upsert por UUID cliente + versión → FR-021/023).
2. **Orden de dependencias del batch:** site → template refs → inspection → responses → findings → log_entries → attachments (FR-020); un lote se rechaza completo si cruza tenants (FR-025).
3. **Latencia medida:** `synced_at - captured_at` por registro; agregado diario por tenant para dashboard (FR-040).
4. **Retención demo:** sin borrado físico; `is_active`/status para baja lógica.

## 5. Datos semilla (demo académica)

- Tenant A "Minera El Cobre SpA": 1 faena, 2 plantillas (inspección de seguridad diaria / checklist de equipo), 4 usuarios (1 field_worker, 1 supervisor, 1 tenant_admin, 1 platform_admin global), ~30 inspecciones históricas simuladas (faker es-CL).
- Tenant B "Constructora Andes SpA": 1 obra, 1 plantilla (bitácora de obra), 2 usuarios — existe para probar aislamiento en vivo (spec maestro §7).
