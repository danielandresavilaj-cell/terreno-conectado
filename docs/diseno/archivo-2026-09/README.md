# Mockups de prueba — ARCHIVADO (2026-09)

> ⚠️ **CONGELADO. No usar como base de trabajo, no modificar, no reubicar.**
> Estas telas fueron superadas por la app real de [`frontend/`](../../../frontend/README.md). Se
> conservan únicamente para documentar la evolución del diseño y para permitir comparar por qué se
> eligió la dirección visual final. Cualquier trabajo nuevo empieza en `frontend/`, nunca aquí.

Estos archivos son prototipos desechables de interfaz. **No son parte de la entrega del ramo y de aquí no sale código de producción.**

## Qué son

Tres exploraciones visuales de la interfaz de Terreno Conectado, escritas en HTML y CSS planos para poder abrirlas en un navegador sin instalar nada. Sirven para discutir la dirección visual antes de que exista la aplicación.

## Qué no son

- No son la aplicación. No hay lógica de negocio, ni API, ni base de datos detrás de esto.
- No cumplen ningún requisito funcional. Son telas estáticas con datos de ejemplo.
- No están listos para publicarse. Faltan pruebas, faltan los estados vacíos reales, y ninguna cifra corresponde a una faena real.

## Los tres

| Archivo | Pantallas | Tema | Idea |
| --- | --- | --- | --- |
| `pizarra-claro.html` | 8 | claro | Base mineral fría y acentos con nombre, pensado para leerse al sol con guantes. |
| `nocturno-oscuro.html` | 10 | oscuro | Cromo pizarra con señal naranja, y papel blanco para todo lo que se lee al sol. |
| `borrador-inicial.html` | 8 | claro | Primera versión, ya superada. Se conserva para poder comparar la evolución. |

## Cómo verlos

Abrir el archivo en el navegador. También se pueden ver desde GitHub con el botón de vista previa que aparece arriba del archivo.

## Advertencias técnicas

- **Las tipografías se cargan desde el CDN de Google Fonts.** En la aplicación real eso no puede ser así: el producto es *offline-first* y NFR-07 exige Lighthouse ≥ 80 en móvil, así que las fuentes tienen que servirse desde el propio repositorio.
- **Todos los datos son inventados.** Nombres, cifras, coordenadas e identificadores son de ejemplo y no corresponden a personas ni a faenas reales.
- **La revisión fue estructural, no visual.** Se verificó balance de etiquetas, codificación UTF-8, sintaxis del JavaScript y contraste de color calculado. No se abrieron en un navegador para mirarlos.

### Sobre el contraste en la versión oscura

El naranja `#F97316` da 2,8:1 sobre blanco, así que en ese tema no se usa para escribir texto: queda para superficies, rieles y barras. El texto naranja va en `#C2410C`, que da 5,18:1. Los botones primarios usan tinta oscura sobre el naranja, que da 6,37:1.

## Qué sigue

Nada de esto está conectado con `frontend/`, que ya no está vacío: existe una aplicación React
funcional y animada ([`frontend/README.md`](../../../frontend/README.md)), escrita después que estos
HTML y que ya los supera en todo lo que estos pretendían mostrar. La dirección visual que terminó
en el producto sale de `nocturno-oscuro.html` — grafito, señal ámbar, cobre y tipografía Archivo +
IBM Plex Mono — pero los tres archivos de esta carpeta siguen siendo telas planas, sin componentes
ni estados.

Esta carpeta se archivó el 2026-10-05 con el nombre que le da el título: `archivo-2026-09`, la
fecha en que se escribieron los mockups. Sigue aquí para comparar la evolución y justificar
decisiones de diseño frente al spec.
