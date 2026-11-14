"""Ediciones exactas para las fichas del plan 009.

Cada función falla con un mensaje claro si el texto ancla no aparece
exactamente una vez: así una ficha nunca escribe en el lugar equivocado.
Escribe siempre con fin de línea LF (AGENTS.md §6).

Uso desde una ficha:

    python3 - <<'PY'
    import sys; sys.path.insert(0, 'plans/009-plan-mejora-bloque-4/herramientas')
    from editar import reemplazar, reemplazar_bloque, insertar_antes, insertar_despues
    reemplazar('frontend/src/x.ts', 'viejo', 'nuevo')
    PY
"""
from pathlib import Path


def _leer(ruta: str) -> str:
    return Path(ruta).read_text(encoding='utf-8')


def _escribir(ruta: str, texto: str) -> None:
    Path(ruta).write_text(texto.replace('\r\n', '\n'), encoding='utf-8', newline='\n')


def _unico(texto: str, ancla: str, ruta: str) -> int:
    n = texto.count(ancla)
    if n != 1:
        primera = ancla.strip().splitlines()[0][:80] if ancla.strip() else repr(ancla)
        raise SystemExit(f'PARA: en {ruta} el ancla aparece {n} veces (se esperaba 1): {primera!r}')
    return texto.index(ancla)


def reemplazar(ruta: str, viejo: str, nuevo: str) -> None:
    """Reemplaza un texto que debe aparecer exactamente una vez."""
    t = _leer(ruta)
    _unico(t, viejo, ruta)
    _escribir(ruta, t.replace(viejo, nuevo, 1))
    print(f'ok  {ruta}')


def reemplazar_bloque(ruta: str, inicio: str, fin: str, nuevo: str) -> None:
    """Reemplaza desde `inicio` (incluido) hasta `fin` (incluido)."""
    t = _leer(ruta)
    i = _unico(t, inicio, ruta)
    j = t.find(fin, i)
    if j < 0:
        raise SystemExit(f'PARA: en {ruta} no aparece el fin del bloque después del inicio: {fin[:80]!r}')
    j += len(fin)
    _escribir(ruta, t[:i] + nuevo + t[j:])
    print(f'ok  {ruta} (bloque)')


def insertar_antes(ruta: str, ancla: str, nuevo: str) -> None:
    t = _leer(ruta)
    i = _unico(t, ancla, ruta)
    _escribir(ruta, t[:i] + nuevo + t[i:])
    print(f'ok  {ruta} (insertado antes)')


def insertar_despues(ruta: str, ancla: str, nuevo: str) -> None:
    t = _leer(ruta)
    i = _unico(t, ancla, ruta) + len(ancla)
    _escribir(ruta, t[:i] + nuevo + t[i:])
    print(f'ok  {ruta} (insertado después)')


# ── Ayudas para documentación ─────────────────────────────────────────────
import re as _re


def fijar_version(ruta: str, nueva: str) -> None:
    """Cambia la versión del encabezado (`**Versión:** x` o `| **Versión** | x |`)."""
    t = _leer(ruta)
    t2, n = _re.subn(r'(\*\*Versión:\*\* )[0-9][0-9.]*', r'\g<1>' + nueva, t, count=1)
    if n == 0:
        t2, n = _re.subn(r'(\| \*\*Versión\*\* \| )[0-9][0-9.]*', r'\g<1>' + nueva, t, count=1)
    if n == 0:
        raise SystemExit(f'PARA: {ruta} no tiene encabezado de versión')
    _escribir(ruta, t2)
    print(f'ok  {ruta} (versión {nueva})')


def agregar_cambio(ruta: str, fila: str) -> None:
    """Agrega `fila` como primera entrada de la tabla de '## Control de cambios'."""
    t = _leer(ruta)
    encontrados = list(_re.finditer(r'^## (?:\d+\. )?Control de cambios', t, _re.M))
    if not encontrados:
        raise SystemExit(f'PARA: {ruta} no tiene "## Control de cambios"')
    i = encontrados[-1].start()
    sep = t.find('| :--- |', i)
    if sep < 0:
        raise SystemExit(f'PARA: {ruta} no tiene la tabla de cambios')
    fin = t.index('\n', sep) + 1
    _escribir(ruta, t[:fin] + fila.rstrip('\n') + '\n' + t[fin:])
    print(f'ok  {ruta} (cambio agregado)')


def marcar_tarea(ruta: str, tarea: str, estado: str) -> None:
    """Cambia la última columna (estado) de la fila `| <tarea> |` en una tabla de tareas."""
    t = _leer(ruta)
    inicio = f'\n| {tarea} |'
    i = _unico(t, inicio, ruta) + 1
    j = t.index('\n', i)
    fila = t[i:j]
    partes = fila.rstrip().rstrip('|').rsplit('|', 1)
    _escribir(ruta, t[:i] + partes[0] + f'| {estado} |' + t[j:])
    print(f'ok  {ruta} ({tarea} → {estado})')


def agregar_evidencia(ruta: str, inicio_fila: str, texto: str) -> None:
    """Agrega `texto` al final de la 4.ª columna (evidencia) de la fila que empieza con `inicio_fila`."""
    t = _leer(ruta)
    i = _unico(t, '\n' + inicio_fila, ruta) + 1
    j = t.index('\n', i)
    partes = t[i:j].split(' | ')
    if len(partes) < 5:
        raise SystemExit(f'PARA: la fila {inicio_fila!r} no tiene 5 columnas')
    partes[3] = partes[3] + texto
    _escribir(ruta, t[:i] + ' | '.join(partes) + t[j:])
    print(f'ok  {ruta} (evidencia agregada)')
