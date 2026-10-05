# Dónde vive cada evidencia — regla de repositorios

Este documento define una sola regla que evita trabajo duplicado entre este repositorio y el
repositorio [Capstone](https://github.com/danielandresavilaj-cell/Capstone). Existe porque la
constitución (Art. VIII) exige cero trabajo duplicado entre el SDD y el APT, y porque en la
organización anterior el informe de Fase 1 quedó copiado en los dos repos sin ningún mecanismo de
sincronía.

## La regla

> Todo documento formal de la asignatura vive **únicamente** en el repositorio `Capstone`.
> En `terreno-conectado` solo existe la **fuente en Markdown** (specs, planes, modelo de datos,
> plan de pruebas), nunca el entregable en pdf/docx ni una carpeta de staging.

Corolarios:

- Este repositorio **no** contiene carpetas tipo `docs-evidencia/`, `informes/` ni
  `Evidencias APT/`. Si alguna vez reaparece una, es un error a corregir.
- El `.docx` o `.pdf` que exige la asignatura **no** se versiona aquí. Se genera desde la fuente y
  se sube a `Capstone`.
- No hay excepciones. La copia canónica de cada entregable es la de `Capstone`.

## Por qué no se versiona el binario aquí

- Los dos repositorios se mueven a ritmos distintos: las evidencias se sellan al cerrar cada fase,
  el código cambia a diario.
- Un `.docx` en Git produce conflictos de merge binarios que solo se resuelven eligiendo un
  ganador, y no hay forma de revisar qué cambió.
- El `.docx` generado a partir del `.md` es **derivado**: si se versiona, la duda de qué versión
  manda es permanente.

## Flujo de cierre de fase

1. **Congelar la fuente.** El `.md` de origen queda aprobado por PR (constitución Art. II:
   `spec → plan → tasks → código → tests → evidencia`).
2. **Exportar.** Se genera el `.docx`/`.pdf` desde la fuente con la plantilla oficial de la
   asignatura. Se hace en un directorio **temporal del sistema** (ej. `~/Downloads`), nunca dentro
   del repositorio ni de su `.gitignore`.
3. **Subir a `Capstone`** en la carpeta de la fase correspondiente:

   | Fase | Destino en `Capstone` |
   | :--- | :--- |
   | Fase 1 | `Fase 1/Evidencias Grupales/` · `Fase 1/Evidencias Individuales/<Nombre>/` |
   | Fase 2 | `Fase 2/Evidencias Grupales/` · `Fase 2/Evidencias Individuales/<Nombre>/` |
   | Fase 3 | `Fase 3/Evidencias Grupales/` |

4. **Actualizar la tabla §12** de [`specs/000-master/spec.md`](../specs/000-master/spec.md) con la
   ruta del entregable recién subido, y cerrar el issue correspondiente en el tablero.
5. **Verificar.** Que el archivo exista en `Capstone` y que el enlace del README resuelva.

## Estado actual

| Evidencia | Fuente en este repo | Entregable formal | Dónde está |
| :--- | :--- | :--- | :--- |
| Informe de Definición APT (Fase 1) | Ya cerrado; en el log de git | `Informe_Definicion_Proyecto_APT_Fase1.docx` | `Capstone/Fase 1/Evidencias Grupales/` ✅ |
| Guía 1.5 (Fase 1) | — | `Guia_1.5_...` | `Capstone/Fase 1/Evidencias Individuales/` ✅ |
| Presentación Gantt (Fase 1) | — | Carta Gantt | `Capstone/Fase 1/Evidencias Grupales/` ✅ |
| Evidencias individuales (Fase 1) | — | 6 archivos, 3 por integrante | `Capstone/Fase 1/Evidencias Individuales/` ✅ |
| Modelo conceptual de datos | [`data-model.md`](data-model.md) | pendiente | `Capstone/Fase 2/` (aún en plantillas) |
| Plan de pruebas | [`test-plan.md`](test-plan.md) | pendiente | `Capstone/Fase 2/` (aún en plantillas) |
| Prototipo | [`frontend/`](../frontend/README.md) | pendiente | `Capstone/Fase 2/` (aún en plantillas) |
| Informe final | Consolida specs, `docs/test-plan.md` y ADRs | pendiente | `Capstone/Fase 3/` |

La copia del informe de Fase 1 que existía en este repositorio bajo `Fase 1/` fue eliminada al
adoptar esta regla; el archivo no se perdió, permanece en `Capstone` desde el commit `d3747c7`.