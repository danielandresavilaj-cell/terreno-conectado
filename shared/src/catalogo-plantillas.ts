/* Catálogo de plantillas de inicio — TSK-FORM-025 (FR-070, Enmienda 010).
 *
 * Formularios típicos de faena y obra listos para usar. Viven en el código
 * (versionados en el repo), no en la base de datos: no hay tabla ni RLS
 * nuevos. El administrador de una empresa elige uno en Plantillas → "Desde el
 * catálogo" y la app crea una copia propia de la empresa por el camino normal
 * (`POST /templates` + publicar), con ids nuevos (`duplicarDefinicion`). Desde
 * ahí la copia es de la empresa: la edita, la asigna o la archiva como
 * cualquier otra; cambiar el catálogo no toca las copias ya creadas.
 *
 * Cada definición cumple `templateDefinitionSchema` (lo prueba
 * `catalogo-plantillas.test.ts`). Los ids de aquí son deterministas sólo para
 * que el esquema los acepte; nunca llegan a una empresa.
 */
import type { FieldProps, ResponseType, TemplateDefinition, TemplateItem, TemplateSection } from './templates'

export interface PlantillaCatalogo {
  /** Clave estable dentro del catálogo (no es un id de base de datos). */
  clave: string
  nombre: string
  descripcion: string
  categoria: 'Seguridad' | 'Equipos' | 'Operación'
  definition: TemplateDefinition
}

/* ── Constructores compactos ────────────────────────────────────────────── */

let contador = 0
/** UUID v4 válido y determinista (orden de declaración). */
function idCatalogo(): string {
  contador += 1
  return `c47a1060-0000-4000-8000-${contador.toString(16).padStart(12, '0')}`
}

function item(
  prompt: string,
  response_type: ResponseType,
  extra: { props?: FieldProps; help?: string; hallazgo?: boolean } = {},
): TemplateItem {
  return {
    id: idCatalogo(),
    prompt,
    response_type,
    ...(extra.hallazgo ? { require_finding_on_nok: true } : {}),
    ...(extra.props ? { props: extra.props } : {}),
    ...(extra.help ? { help: extra.help } : {}),
  }
}

/** OK · NOK · N/A obligatorio; `hallazgo` exige registrar hallazgo si es NOK. */
const ok = (prompt: string, hallazgo = false, help?: string) =>
  item(prompt, 'ok_nok_na', { props: { required: true }, hallazgo, help })
const texto = (prompt: string, required = false, help?: string) =>
  item(prompt, 'text', { props: { required, max_length: 1000 }, help })
const numero = (prompt: string, min: number, max: number, help?: string) =>
  item(prompt, 'numeric', { props: { required: true, min, max }, help })
const una = (prompt: string, options: string[], required = true) =>
  item(prompt, 'select_single', { props: { required, options } })
const varias = (prompt: string, options: string[]) =>
  item(prompt, 'select_multiple', { props: { required: false, options } })
const foto = (prompt: string, required = false) => item(prompt, 'photo', { props: { required } })
const fecha = (prompt: string) => item(prompt, 'date', { props: { required: true } })
const hora = (prompt: string) => item(prompt, 'time', { props: { required: true } })

function seccion(title: string, items: TemplateItem[]): TemplateSection {
  return { id: idCatalogo(), title, items }
}

/* ── Catálogo ───────────────────────────────────────────────────────────── */

export const CATALOGO_PLANTILLAS: readonly PlantillaCatalogo[] = [
  {
    clave: 'seguridad-diaria',
    nombre: 'Chequeo de seguridad diario',
    descripcion: 'Inicio de turno: condiciones del área, accesos, señalética y emergencias.',
    categoria: 'Seguridad',
    definition: {
      sections: [
        seccion('Área de trabajo', [
          una('Turno', ['Día', 'Noche']),
          ok('Accesos y vías de tránsito despejados', true),
          ok('Señalética y segregación del área en buen estado', true),
          ok('Iluminación suficiente para la tarea', true),
          ok('Sin derrames ni superficies resbaladizas', true),
        ]),
        seccion('Emergencias', [
          ok('Extintor visible, accesible y con carga vigente', true),
          ok('Vías de evacuación y punto de encuentro señalizados'),
          ok('Botiquín de primeros auxilios completo'),
          ok('Comunicación radial operativa con el supervisor', true),
        ]),
        seccion('Cierre', [
          numero('Personas en el frente de trabajo', 0, 200),
          foto('Foto general del área'),
          texto('Observaciones'),
        ]),
      ],
    },
  },
  {
    clave: 'andamios',
    nombre: 'Inspección de andamios',
    descripcion: 'Antes de subir: base, estructura, plataformas y protección contra caídas. Pide cofirma de supervisión.',
    categoria: 'Seguridad',
    definition: {
      closing: { require_supervisor_signature: true },
      sections: [
        seccion('Identificación', [
          texto('Ubicación o código del andamio', true),
          numero('Altura de la plataforma (m)', 0, 60),
          una('Tarjeta de estado', ['Verde (habilitado)', 'Roja (no usar)', 'Sin tarjeta']),
        ]),
        seccion('Base y estructura', [
          ok('Base sobre terreno firme, con placas y niveladas', true),
          ok('Pies derechos aplomados y sin deformaciones', true),
          ok('Arriostramientos y diagonales completos', true),
          ok('Anclajes a estructura fija cada 4 m de altura', true),
        ]),
        seccion('Plataforma y accesos', [
          ok('Plataforma completa, sin huecos y con tablones trabados', true),
          ok('Barandas a 1 m, intermedia y rodapié', true),
          ok('Escalera de acceso fija e interior al andamio', true),
          foto('Foto del andamio armado', true),
        ]),
      ],
    },
  },
  {
    clave: 'equipo-movil',
    nombre: 'Pre-uso de equipo móvil',
    descripcion: 'Camioneta, grúa horquilla o equipo de apoyo: chequeo antes de operar.',
    categoria: 'Equipos',
    definition: {
      sections: [
        seccion('Equipo', [
          una('Tipo de equipo', ['Camioneta', 'Grúa horquilla', 'Camión', 'Cargador frontal', 'Otro']),
          texto('Patente o código interno', true),
          numero('Horómetro o kilometraje', 0, 2_000_000),
        ]),
        seccion('Revisión exterior', [
          ok('Neumáticos sin cortes y con presión adecuada', true),
          ok('Sin fugas de aceite, combustible o refrigerante', true),
          ok('Luces, balizas y alarma de retroceso funcionando', true),
          ok('Espejos y parabrisas sin daños'),
        ]),
        seccion('Cabina y controles', [
          ok('Frenos de servicio y estacionamiento operativos', true),
          ok('Cinturón de seguridad en buen estado', true),
          ok('Extintor y cuñas a bordo', true),
          ok('Radio o medio de comunicación operativo'),
          varias('Documentos a bordo', ['Permiso de circulación', 'Revisión técnica', 'SOAP', 'Licencia interna']),
        ]),
        seccion('Cierre', [foto('Foto del equipo'), texto('Observaciones')]),
      ],
    },
  },
  {
    clave: 'extintores',
    nombre: 'Inspección de extintores',
    descripcion: 'Revisión mensual de cada extintor: ubicación, carga, sello y señalética.',
    categoria: 'Seguridad',
    definition: {
      sections: [
        seccion('Extintor', [
          texto('Código o ubicación del extintor', true),
          una('Tipo', ['PQS', 'CO2', 'Agua', 'Espuma', 'Clase K']),
          fecha('Fecha de vencimiento de la carga'),
        ]),
        seccion('Estado', [
          ok('Manómetro en zona verde', true),
          ok('Sello y pasador intactos', true),
          ok('Manguera y boquilla sin daños', true),
          ok('Cilindro sin abolladuras ni corrosión', true),
          ok('Señalética visible y altura de montaje correcta'),
          ok('Acceso libre de obstáculos', true),
          foto('Foto del extintor y su etiqueta'),
        ]),
      ],
    },
  },
  {
    clave: 'epp',
    nombre: 'Control de EPP',
    descripcion: 'Verificación del equipo de protección personal de una cuadrilla.',
    categoria: 'Seguridad',
    definition: {
      sections: [
        seccion('Cuadrilla', [
          texto('Cuadrilla o empresa contratista', true),
          numero('Personas revisadas', 1, 100),
        ]),
        seccion('Elementos', [
          ok('Casco con barbiquejo', true),
          ok('Lentes de seguridad', true),
          ok('Zapatos de seguridad', true),
          ok('Ropa de alta visibilidad', true),
          ok('Protección auditiva en zonas de ruido', true),
          ok('Guantes adecuados a la tarea'),
          ok('Respirador en zonas con polvo o gases', true),
        ]),
        seccion('Cierre', [
          varias('EPP faltante o en mal estado', ['Casco', 'Lentes', 'Zapatos', 'Ropa', 'Auditiva', 'Guantes', 'Respirador']),
          texto('Acciones tomadas'),
        ]),
      ],
    },
  },
  {
    clave: 'orden-aseo',
    nombre: 'Orden y aseo',
    descripcion: 'Recorrido rápido de orden, limpieza y manejo de residuos en el área.',
    categoria: 'Operación',
    definition: {
      sections: [
        seccion('Recorrido', [
          texto('Área o sector', true),
          ok('Materiales almacenados y apilados en forma segura', true),
          ok('Pasillos y escaleras despejados', true),
          ok('Residuos segregados en contenedores rotulados', true),
          ok('Herramientas guardadas después de usarlas'),
          ok('Sustancias peligrosas rotuladas y con hoja de seguridad', true),
        ]),
        seccion('Resultado', [
          una('Evaluación general', ['Bueno', 'Regular', 'Deficiente']),
          foto('Foto del área'),
          texto('Observaciones'),
        ]),
      ],
    },
  },
  {
    clave: 'trabajo-altura',
    nombre: 'Permiso de trabajo en altura',
    descripcion: 'Condiciones previas para trabajar sobre 1,8 m: arnés, anclajes, rescate. Pide cofirma de supervisión.',
    categoria: 'Seguridad',
    definition: {
      closing: { require_supervisor_signature: true },
      sections: [
        seccion('Trabajo', [
          texto('Descripción del trabajo', true),
          numero('Altura de trabajo (m)', 1.8, 150),
          hora('Hora de inicio'),
          numero('Trabajadores expuestos', 1, 30),
        ]),
        seccion('Protección contra caídas', [
          ok('Arnés de cuerpo completo inspeccionado', true),
          ok('Línea de vida o punto de anclaje certificado', true),
          ok('Cabo de vida con absorbedor de impacto', true),
          ok('Área inferior segregada', true),
          ok('Herramientas amarradas para evitar caída de objetos', true),
        ]),
        seccion('Condiciones', [
          ok('Personal con curso de trabajo en altura vigente', true),
          ok('Plan de rescate conocido por la cuadrilla', true),
          una('Viento', ['Calma', 'Moderado', 'Fuerte (suspender)']),
          foto('Foto del punto de anclaje', true),
        ]),
      ],
    },
  },
  {
    clave: 'relevo-turno',
    nombre: 'Relevo de turno',
    descripcion: 'Entrega de turno entre supervisores: estado de equipos, pendientes y riesgos.',
    categoria: 'Operación',
    definition: {
      sections: [
        seccion('Turno', [
          una('Turno que entrega', ['Día', 'Noche']),
          numero('Dotación presente', 0, 500),
          numero('Incidentes en el turno', 0, 50),
        ]),
        seccion('Estado', [
          ok('Equipos críticos operativos', true),
          ok('Permisos de trabajo abiertos cerrados o traspasados', true),
          ok('Bloqueos y tarjetas registrados'),
          texto('Equipos detenidos y motivo'),
        ]),
        seccion('Pendientes', [
          texto('Trabajos pendientes para el turno entrante', true),
          texto('Riesgos o condiciones a vigilar'),
        ]),
      ],
    },
  },
]

/** Plantilla del catálogo por su clave. */
export function plantillaDeCatalogo(clave: string): PlantillaCatalogo | undefined {
  return CATALOGO_PLANTILLAS.find((p) => p.clave === clave)
}

/** Número de preguntas de una definición. */
export function totalPreguntas(def: TemplateDefinition): number {
  return def.sections.reduce((n, s) => n + s.items.length, 0)
}
