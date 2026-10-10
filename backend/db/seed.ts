import { Pool } from 'pg'
import { hash } from '@node-rs/argon2'

/**
 * Datos semilla de la demo académica (data-model.md §5, FR-006).
 *
 * Crea dos tenants para probar el aislamiento multi-tenant:
 *  - Tenant A "Minera El Cobre SpA" (faena minera)
 *  - Tenant B "Constructora Andes SpA" (obra)
 *
 * El seed debe ejecutarse con la conexión **admin/owner** (bypassa RLS). El rol
 * de aplicación `tc_app` no puede sembrar datos cross-tenant por diseño.
 *
 * Contraseña demo (solo desarrollo académico, NFR-06): argon2id real vía
 * @node-rs/argon2. Se puede sobreescribir con `DEMO_PASSWORD` en el entorno.
 */

/** Contraseña de todas las cuentas demo (documentada en el README).
 *  Obligatoriamente desde variables de entorno; nunca hardcodeada en el fuente. */
const DEMO_PASSWORD_RAW = process.env.DEMO_PASSWORD
if (!DEMO_PASSWORD_RAW) {
  throw new Error('DEMO_PASSWORD requerido (ver .env.example)')
}
export const DEMO_PASSWORD = DEMO_PASSWORD_RAW

export const TENANT_A_ID = '01890000-0000-7000-8000-0000000000a1'
export const TENANT_B_ID = '01890000-0000-7000-8000-0000000000b1'
export const SITE_A_ID = '01890000-0000-7000-8000-0000000000a2'
export const SITE_B_ID = '01890000-0000-7000-8000-0000000000b2'
export const PLATFORM_ADMIN_ID = '01890000-0000-7000-8000-0000000000c1'

// Plantillas del módulo 007 (data-model §2.2): cabecera + una revisión
// publicada y un borrador por tenant (TSK-FORM-002, seed demo).
export const TEMPLATE_A_ID = '01890000-0000-7000-8000-0000000000a6'
export const TEMPLATE_B_ID = '01890000-0000-7000-8000-0000000000b6'
export const TEMPLATE_A_REVISION_DRAFT_ID = '01890000-0000-7000-8000-0000000000a7'
export const TEMPLATE_A_REVISION_PUBLISHED_ID = '01890000-0000-7000-8000-0000000000a8'
export const TEMPLATE_B_REVISION_DRAFT_ID = '01890000-0000-7000-8000-0000000000b7'
export const TEMPLATE_B_REVISION_PUBLISHED_ID = '01890000-0000-7000-8000-0000000000b8'

// Asignaciones faena+rol de la demo (TSK-FORM-008, FR-008/009): cada revisión
// publicada queda asignada a la faena del tenant para los dos roles operativos.
export const TEMPLATE_A_ASSIGNMENT_WORKER_ID = '01890000-0000-7000-8000-0000000000a9'
export const TEMPLATE_A_ASSIGNMENT_SUPERVISOR_ID = '01890000-0000-7000-8000-0000000000aa'
export const TEMPLATE_B_ASSIGNMENT_WORKER_ID = '01890000-0000-7000-8000-0000000000b9'
export const TEMPLATE_B_ASSIGNMENT_SUPERVISOR_ID = '01890000-0000-7000-8000-0000000000ba'

interface SeedQueryable {
  query: (text: string, values?: unknown[]) => Promise<unknown>
}

/* ── Fixture de definiciones (TSK-FORM-001, FR-036) ─────────────────────────
 * Las revisiones publicadas del seed cubren los 8 tipos de campo: es lo que
 * la captura dibuja al hacer data-driven render. UUIDs estables para que el
 * catálogo materializado y las respuestas de la demo referencien siempre los
 * mismos ítems.
 */

interface ItemFixture {
  id: string
  prompt: string
  response_type: string
  require_finding_on_nok?: boolean
  props?: Record<string, unknown>
  help?: string
}

interface SeccionFixture {
  id: string
  title: string
  position?: number
  items: ItemFixture[]
}

const u = (suf: string): string => `01890000-0000-7000-8000-00000000${suf}`

export const DEFINICION_MINERIA: { sections: SeccionFixture[] } = {
  sections: [
    {
      id: u('f1e1'),
      title: 'Barriers y señalética',
      position: 0,
      items: [
        {
          id: u('f101'),
          prompt: 'Barriers perimetrales del nivel de trabajo completos y estables',
          response_type: 'ok_nok_na',
          require_finding_on_nok: true,
          props: { required: true },
          help: 'Verificar anclajes, tensores y cintas reflectantes',
        },
        {
          id: u('f102'),
          prompt: 'Señalización de rutas de evacuación visible desde el punto de corte',
          response_type: 'ok_nok_na',
          require_finding_on_nok: true,
          props: {},
        },
      ],
    },
    {
      id: u('f1e2'),
      title: 'Condiciones de trabajo',
      position: 1,
      items: [
        {
          id: u('f103'),
          prompt: 'Temperatura en el punto de medida (°C)',
          response_type: 'numeric',
          props: { required: true, min: -10, max: 45 },
        },
        {
          id: u('f104'),
          prompt: 'Fecha del chequeo',
          response_type: 'date',
          props: { required: true, min: '2026-01-01', max: '2026-12-31' },
        },
        {
          id: u('f105'),
          prompt: 'Hora de inicio del turno',
          response_type: 'time',
          props: {},
        },
      ],
    },
    {
      id: u('f1e3'),
      title: 'EPP y protocolos',
      position: 2,
      items: [
        {
          id: u('f106'),
          prompt: 'Turno de trabajo',
          response_type: 'select_single',
          props: { required: true, options: ['Diurno', 'Nocturno'] },
        },
        {
          id: u('f107'),
          prompt: 'EPP en uso',
          response_type: 'select_multiple',
          props: { options: ['Casco', 'Arnés', 'Botas', 'Guantes', 'Gafas'] },
        },
        {
          id: u('f108'),
          prompt: 'Observaciones del supervisor',
          response_type: 'text',
          props: { max_length: 500 },
        },
      ],
    },
    {
      id: u('f1e4'),
      title: 'Evidencias',
      position: 3,
      items: [
        {
          id: u('f109'),
          prompt: 'Foto del área inspeccionada',
          response_type: 'photo',
          props: { photo_max_kb: 512 },
        },
      ],
    },
  ],
}

export const DEFINICION_OBRA: { sections: SeccionFixture[] } = {
  sections: [
    {
      id: u('f2e1'),
      title: 'Zanjas y excavaciones',
      position: 0,
      items: [
        {
          id: u('f201'),
          prompt: 'Zanja con taludes estables y sin material suelto sobre el borde',
          response_type: 'ok_nok_na',
          require_finding_on_nok: true,
          props: { required: true },
          help: 'Revisar también drenaje y acumulación de agua',
        },
        {
          id: u('f202'),
          prompt: 'Señalización y vallado perimetral de la excavación',
          response_type: 'ok_nok_na',
          require_finding_on_nok: true,
          props: {},
        },
      ],
    },
    {
      id: u('f2e2'),
      title: 'Condiciones del sitio',
      position: 1,
      items: [
        {
          id: u('f203'),
          prompt: 'Profundidad medida (m)',
          response_type: 'numeric',
          props: { required: true, min: 0, max: 20 },
        },
        {
          id: u('f204'),
          prompt: 'Fecha del replaneo',
          response_type: 'date',
          props: { required: true, min: '2026-01-01', max: '2026-12-31' },
        },
        {
          id: u('f205'),
          prompt: 'Hora de inicio de faena',
          response_type: 'time',
          props: {},
        },
      ],
    },
    {
      id: u('f2e3'),
      title: 'Equipamiento',
      position: 2,
      items: [
        {
          id: u('f206'),
          prompt: 'Turno',
          response_type: 'select_single',
          props: { required: true, options: ['Diurno', 'Nocturno'] },
        },
        {
          id: u('f207'),
          prompt: 'EPP en uso',
          response_type: 'select_multiple',
          props: { options: ['Casco', 'Arnés', 'Botas', 'Guantes', 'Eslinga'] },
        },
        {
          id: u('f208'),
          prompt: 'Observaciones del residente',
          response_type: 'text',
          props: { max_length: 500 },
        },
      ],
    },
    {
      id: u('f2e4'),
      title: 'Evidencias',
      position: 3,
      items: [
        {
          id: u('f209'),
          prompt: 'Foto del estado de la excavación',
          response_type: 'photo',
          props: { photo_max_kb: 512 },
        },
      ],
    },
  ],
}

export async function seedDatabase(db: SeedQueryable): Promise<void> {
  const passwordHash = await hash(DEMO_PASSWORD)

  const tenants: Array<[string, string, string]> = [
    [TENANT_A_ID, 'Minera El Cobre SpA', 'minera-el-cobre'],
    [TENANT_B_ID, 'Constructora Andes SpA', 'constructora-andes'],
  ]
  for (const [id, name, slug] of tenants) {
    await db.query(
      `INSERT INTO tenant (id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [id, name, slug],
    )
  }

  const sites: Array<[string, string, string, string]> = [
    [SITE_A_ID, TENANT_A_ID, 'Faena El Roble', 'mining'],
    [SITE_B_ID, TENANT_B_ID, 'Obra Costanera', 'construction'],
  ]
  for (const [id, tenantId, name, kind] of sites) {
    await db.query(
      `INSERT INTO site (id, tenant_id, name, kind) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenantId, name, kind],
    )
  }

  const users: Array<[string, string | null, string, string, string]> = [
    [PLATFORM_ADMIN_ID, null, 'admin@terreno.local', 'platform_admin', 'Admin Plataforma'],
    ['01890000-0000-7000-8000-0000000000a3', TENANT_A_ID, 'trabajador@minera.cl', 'field_worker', 'Pedro Trabajador'],
    ['01890000-0000-7000-8000-0000000000a4', TENANT_A_ID, 'supervisor@minera.cl', 'supervisor', 'Sofía Supervisora'],
    ['01890000-0000-7000-8000-0000000000a5', TENANT_A_ID, 'admin@minera.cl', 'tenant_admin', 'Andrés Admin'],
    ['01890000-0000-7000-8000-0000000000b3', TENANT_B_ID, 'trabajador@andes.cl', 'field_worker', 'Bárbara Trabajadora'],
    ['01890000-0000-7000-8000-0000000000b4', TENANT_B_ID, 'supervisor@andes.cl', 'supervisor', 'Bruno Supervisor'],
  ]
  for (const [id, tenantId, email, role, fullName] of users) {
    await db.query(
      `INSERT INTO app_user (id, tenant_id, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             failed_login_count = 0,
             locked_until = NULL`,
      [id, tenantId, email, passwordHash, role, fullName],
    )
  }

  // Plantillas del módulo 007 (TSK-FORM-002). Las revisiones publicadas se
  // insertan directo en `published` (el seed corre como owner, bypassa RLS);
  // la app solo puede alcanzar ese estado vía draft → publish (FR-049).
  const templates: Array<[string, string, string, string | null]> = [
    [TEMPLATE_A_ID, TENANT_A_ID, 'Chequeo de seguridad minera', 'Lista de chequeo diario de seguridad (demo módulo 007)'],
    [TEMPLATE_B_ID, TENANT_B_ID, 'Inspección de obra', 'Checklist de obra en construcción (demo módulo 007)'],
  ]
  for (const [id, tenantId, name, description] of templates) {
    await db.query(
      `INSERT INTO template (id, tenant_id, name, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenantId, name, description],
    )
  }

  // `definition` = secciones + ítems (ADR-003). Las revisiones publicadas
  // llevan una definición REAL que cubre los 8 tipos de campo (FR-036): es el
  // material que el renderer data-driven dibuja en la captura (TSK-FORM-001).
  // Los borradores quedan vacíos y trazables al fixture (los edita el
  // tenant_admin con TSK-FORM-006).
  const revisions: Array<[string, string, string, number | null, string, unknown]> = [
    [TEMPLATE_A_REVISION_DRAFT_ID, TEMPLATE_A_ID, TENANT_A_ID, null, 'draft', { sections: [] }],
    [TEMPLATE_A_REVISION_PUBLISHED_ID, TEMPLATE_A_ID, TENANT_A_ID, 1, 'published', DEFINICION_MINERIA],
    [TEMPLATE_B_REVISION_DRAFT_ID, TEMPLATE_B_ID, TENANT_B_ID, null, 'draft', { sections: [] }],
    [TEMPLATE_B_REVISION_PUBLISHED_ID, TEMPLATE_B_ID, TENANT_B_ID, 1, 'published', DEFINICION_OBRA],
  ]
  for (const [id, templateId, tenantId, version, status, definition] of revisions) {
    // DO UPDATE sólo rellena fixtures vacíos: una definición ya cargada (o
    // editada en dev) no se pisa al re-sembrar.
    await db.query(
      `INSERT INTO template_revision (id, template_id, tenant_id, version, definition, status, published_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6,
               CASE WHEN $6 = 'published' THEN now() ELSE NULL END)
       ON CONFLICT (id) DO UPDATE
         SET definition = EXCLUDED.definition
       WHERE template_revision.definition = '{"sections":[]}'::jsonb`,
      [id, templateId, tenantId, version, JSON.stringify(definition), status],
    )
  }

  // El catálogo tipado de una revisión publicada se materializa al publicar
  // (FR-049); el seed lo hace directo como owner para que los fixtures también
  // sirvan a import/export/reportes que leen template_section/template_item.
  for (const [revisionId, tenantId, definition] of [
    [TEMPLATE_A_REVISION_PUBLISHED_ID, TENANT_A_ID, DEFINICION_MINERIA],
    [TEMPLATE_B_REVISION_PUBLISHED_ID, TENANT_B_ID, DEFINICION_OBRA],
  ] as const) {
    await materializarCatalogo(db, revisionId, tenantId, definition)
  }

  // Asignaciones faena+rol (TSK-FORM-008): la revisión publicada queda ligada a
  // la faena del tenant para `field_worker` y `supervisor`, de modo que la
  // captura la vea (FR-009). `assigned_by` es el admin del tenant.
  const assignments: Array<[string, string, string, string, string, string]> = [
    [TEMPLATE_A_ASSIGNMENT_WORKER_ID, TEMPLATE_A_REVISION_PUBLISHED_ID, TENANT_A_ID, SITE_A_ID, 'field_worker', '01890000-0000-7000-8000-0000000000a5'],
    [TEMPLATE_A_ASSIGNMENT_SUPERVISOR_ID, TEMPLATE_A_REVISION_PUBLISHED_ID, TENANT_A_ID, SITE_A_ID, 'supervisor', '01890000-0000-7000-8000-0000000000a5'],
    [TEMPLATE_B_ASSIGNMENT_WORKER_ID, TEMPLATE_B_REVISION_PUBLISHED_ID, TENANT_B_ID, SITE_B_ID, 'field_worker', '01890000-0000-7000-8000-0000000000b4'],
    [TEMPLATE_B_ASSIGNMENT_SUPERVISOR_ID, TEMPLATE_B_REVISION_PUBLISHED_ID, TENANT_B_ID, SITE_B_ID, 'supervisor', '01890000-0000-7000-8000-0000000000b4'],
  ]
  for (const [id, revisionId, tenantId, siteId, role, assignedBy] of assignments) {
    await db.query(
      `INSERT INTO template_assignment
         (id, tenant_id, template_revision_id, site_id, role, active, assigned_by)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenantId, revisionId, siteId, role, assignedBy],
    )
  }
}

/** Inserta secciones/ítems de un fixture publicado (idempotente, como owner). */
async function materializarCatalogo(
  db: SeedQueryable,
  revisionId: string,
  tenantId: string,
  definition: { sections: Array<SeccionFixture> },
): Promise<void> {
  for (const [si, s] of definition.sections.entries()) {
    const sectionId = s.id as string
    await db.query(
      `INSERT INTO template_section (id, revision_id, tenant_id, position, title)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [sectionId, revisionId, tenantId, s.position ?? si, s.title],
    )
    for (const [ii, item] of s.items.entries()) {
      await db.query(
        `INSERT INTO template_item
           (id, section_id, tenant_id, position, prompt, response_type,
            require_finding_on_nok, props, help)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          item.id,
          sectionId,
          tenantId,
          ii,
          item.prompt,
          item.response_type,
          item.require_finding_on_nok ?? false,
          item.props !== undefined ? JSON.stringify(item.props) : null,
          item.help ?? null,
        ],
      )
    }
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('Falta DATABASE_URL (conexión admin). Ver .env.example')
  }
  const pool = new Pool({ connectionString })
  try {
    await seedDatabase(pool)
    console.log('Seed OK: tenants A/B, faenas y usuarios demo.')
  } finally {
    await pool.end()
  }
}

if (require.main === module) {
  void main()
}
