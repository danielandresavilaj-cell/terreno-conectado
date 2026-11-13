# Presentación final — Terreno Conectado

> SaaS offline-first para faenas mineras y obras. En producción desde la v1.

---

## 1. La promesa

**"Datos al día donde no hay señal"**

- Captura en terreno **sin red**.
- Sincronización automática al reconectar.
- Dashboard del supervisor actualizado en ≤ 60 s.

---

## 2. Problema

- Las faenas mineras y las obras no tienen conectividad estable.
- Los sistemas actuales necesitan la nube para capturar.
- Las pautas siguen en papel o en Excel sueltos, y consolidarlas toma días.

---

## 3. Solución

| Capa | Tecnología | Rol |
| :--- | :--- | :--- |
| Cliente | PWA React + Dexie | Captura sin señal, cola local |
| API | NestJS + PostgreSQL 16 + RLS | Ingesta idempotente, aislamiento por empresa |
| Shared | TypeScript + Zod | Un solo contrato para cliente y servidor |
| IA (opcional) | Claude Haiku, solo en el servidor | Convierte una foto o un PDF escaneado en un formulario |
| Despliegue | Oracle Always Free + Docker + Caddy | HTTPS, respaldos cifrados, **US$0/mes** |

---

## 4. Arquitectura clave

- **Offline-first:** IndexedDB es la fuente de verdad local.
- **Sincronización idempotente:** UUIDv7 de cliente + `client_version`.
- **LWW determinista:** `captured_at` → `client_version` → UUID.
- **Seguridad:** RLS de Postgres por `tenant_id`, no filtros en la app.
- **La IA propone, la persona decide:** nunca se publica sin revisión.

---

## 5. De la pauta en papel al dato consolidado

1. **Importar:** Excel, Word, PDF o **una foto de la pauta en papel**.
2. **Revisar:** la propuesta muestra secciones, preguntas, tipos y advertencias; se edita y se publica.
3. **Asignar** por faena y rol.
4. **Capturar** en terreno, con o sin señal, con fotos y hallazgos.
5. **Supervisar:** inspecciones, hallazgos, conflictos y estado de la sincronización.
6. **Exportar** el mes en **un solo Excel consolidado**, en PDF o en Word.

---

## 6. Demo en vivo (guion)

1. Fotografiar una pauta en papel y ver el formulario armado por la IA, revisarlo y publicarlo.
2. En el teléfono, en **modo avión**: iniciar la inspección, responder, adjuntar una foto y crear un hallazgo.
3. Reconectar: la sincronización es automática y el dashboard se actualiza en ≤ 60 s.
4. El supervisor revisa la inspección y mueve el hallazgo a "en curso".
5. Exportar el mes en Excel consolidado y mostrar la hoja por formulario y la de hallazgos.

---

## 7. Validación

- **528 pruebas automatizadas:** 253 de integración backend con Postgres real, 160 del frontend, 92 de shared y 23 E2E/caos.
- **Caos 1–7:** 0 pérdidas, 0 duplicados, 0 fugas entre empresas.
- **Matriz de requisitos:** **97,7% verde** en lo implementado (43/44).
- La IA se prueba en CI con un analizador simulado y se validó en producción con una foto real.

---

## 8. Lo que sumamos después de F2

| Enmienda | Mejora |
| :--- | :--- |
| 003 | Producto real: cuentas, empresas, equipos, despliegue y respaldos |
| 004 | Sin geolocalización, aviso de sesión reemplazada, supervisión de la sincronización |
| 005 | Importar Word y PDF; exportar Excel consolidado, PDF y Word |
| 006 | Importar con IA: fotos y PDF escaneados, con tope de gasto |
| 007 | Aprobada, por implementar: firma al cerrar, avisos por correo, inspecciones programadas y QR |

---

## 9. Decisiones de arquitectura

- Lectores y generadores pesados **solo en el servidor**: la PWA sigue liviana.
- **IA acotada:** modelo pequeño (menos de medio centavo por pauta), tope diario por empresa, límite de gasto y solo se envía la pauta en blanco.
- Delta de plantillas por `published_seq` global.
- Despliegue de costo cero con plan B manual por SSH.

---

## 10. Próximos pasos

1. Ratificar las enmiendas 003 a 006.
2. Implementar la Enmienda 007: firma con el dedo al cerrar, QR por vehículo o lugar, inspecciones programadas y avisos por correo.
3. Plan de acción para hallazgos: responsable y plazo.

---

## 11. Cierre

**Terreno Conectado: captura donde no hay señal y decide con datos al día.**

- Producción: `terrenoconectado.cl`
- Repo: `github.com/danielandresavilaj-cell/terreno-conectado`
- Equipo: Daniel Ávila · Raúl González
