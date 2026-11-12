# PLAN — Operación certificada

**Versión:** 0.1.1 (aprobada 2026-11-12) · **Fecha:** 2026-11-12 · **Autor:** Raúl González (con IA)  
**Issue:** #186 · **Tarea raíz:** TSK-OPS-003 · **Requisitos:** FR-056…061  
**Depende de:** specs 001–004 y 007; motor de sync (003); RLS y auditoría (006).

> La Enmienda 007 del spec maestro quedó aprobada (propuesta por Raúl González, aprobada por Daniel Ávila el 2026-11-12), así que este plan puede pasar a implementación. Conserva el límite WIP: las tareas verticales se toman una por una, no se abre una rama de código para las cuatro a la vez.

## 1. Resultado operativo

El inspector puede cerrar una inspección desde el teléfono, dibujar su firma aun sin señal y conservar el registro hasta sincronizar. Si la pauta lo exige, una persona supervisora de la misma empresa cofirma después. Un administrador puede registrar un equipo, vehículo o lugar, imprimir/regenerar su QR y asociarle una pauta autorizada; al escanearlo se abre esa captura. También puede programar instancias y recibir avisos de correo confiables, sin que una caída del correo interfiera con la operación de terreno.

## 2. Decisiones de diseño

### 2.1 Firma y ciclo de vida

- La firma es un trazo vectorial, una declaración de cierre y una evidencia de identidad autenticada. No se afirma validez como firma electrónica avanzada ni se recopilan datos biométricos.
- Al cerrar, la PWA valida todos los obligatorios, calcula `content_hash` sobre la inspección congelada y exige una firma del inspector. Guarda `INSPECTION_SIGNATURE` con UUIDv7 y lo pone en la misma cola offline.
- La definición de una revisión incorpora `closing.require_supervisor_signature: boolean`, con valor por defecto `false`. Al publicar una nueva revisión, esa regla queda congelada para las inspecciones creadas con ella.
- La cofirma se realiza en una sesión posterior de `supervisor`/`tenant_admin`; no viaja por la identidad del inspector ni se puede crear desde un QR. `reviewed` sólo es posible cuando la regla congelada y sus firmas se cumplen.

### 2.2 Activos, QR y cámara

- Un activo puede ser `vehicle`, `equipment` o `location`, pertenece a una sola faena y tiene una plantilla estable. El QR lleva `tc1:<token aleatorio>`; se persiste sólo su hash.
- La resolución es siempre autenticada y con RLS. Un token erróneo, revocado o de otra empresa da una respuesta indistinguible de “no encontrado”. Después se vuelve a verificar la asignación de plantilla por faena y rol.
- En móvil, se intenta `getUserMedia` con cámara trasera y se decodifica localmente. Se mantiene un campo manual para cámaras sin permiso/no compatibles y para QR impresos dañados. El permiso se solicita sólo al pulsar “Escanear QR”.
- La elección de biblioteca QR se hace en la tarea correspondiente con evaluación de tamaño, licencia y soporte móvil; ninguna dependencia entra sin actualizar `research.md` (Artículo V).

### 2.3 Programación y avisos

- La recurrencia inicial deliberadamente es acotada: una vez, diaria, semanal o mensual. Se persiste una zona IANA; el worker calcula la próxima fecha con calendario local para no romper cambios de hora.
- El worker materializa `SCHEDULED_INSPECTION` con una restricción única por `(schedule_id, occurrence_at)`. Las instancias previamente entregadas al dispositivo pueden terminarse sin red; no se promete crear en el teléfono una instancia que aún no fue sincronizada desde servidor.
- Cada evento crea una fila durable de `NOTIFICATION_OUTBOX` en la transacción de negocio. La entrega de correo reintenta con backoff y usa una clave de idempotencia; jamás se reenvía una inspección ni se bloquea un cierre por un error SMTP/proveedor.
- El proveedor, remitente y política exacta de destinatarios no se presuponen. Se configurarán como secretos de despliegue, nunca en el bundle ni en Git.

## 3. Orden de entrega

```text
TSK-OPS-003-A  Enmienda + modelo + plan
       ├──► TSK-OPS-003-B  Firma offline y cofirma
       ├──► TSK-OPS-003-C  Activos y QR
       ├──► TSK-OPS-003-D  Programación
       └──► TSK-OPS-003-E  Outbox y correo (requiere proveedor/destinatarios)
```

La firma abre la primera rama de código porque es autónoma y responde al cierre de la inspección. QR/programación comparten el modelo de activo pero conservan PRs separados. Correo queda al final para no introducir infraestructura o secretos antes de que exista valor de producto verificable.

## 4. Seguridad, datos y pruebas

- Cada tabla nueva lleva `tenant_id`, RLS y pruebas de intrusión. Las firmas son inmutables; los QR son opacos/rotables; los correos usan snapshots mínimos y sólo el worker del servidor puede enviarlos.
- Hay una prueba de caos por reintento para firma, ocurrencia programada y notificación: reejecutar el mismo lote/worker deja exactamente una firma por rol, una ocurrencia y un correo lógico.
- E2E móvil: firma offline → recarga → sync; QR con cámara y entrada manual; QR revocado y tenant ajeno; ocurrencia recibida y completada offline.
- Las exportaciones PDF/Word/XLSX incorporan evidencia de firma (nombre, rol, fecha, hash y representación del trazo) con control de acceso. No se imprimen tokens QR ni direcciones de correo completas en logs.

## 5. Decisiones que requiere el equipo

1. Confirmar que “firma con el dedo” es evidencia operativa y no una firma electrónica con validez legal.
2. Definir proveedor/remitente de correo y destinatarios para cada evento antes de TSK-OPS-003-E.
3. Ratificar si la recurrencia inicial acotada (una vez/diaria/semanal/mensual) satisface la primera entrega.

