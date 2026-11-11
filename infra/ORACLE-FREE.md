# Demo pública en Oracle Always Free

TSK-DEPLOY-001 · issue #159 · ADR-002 adenda 1. No cambia la arquitectura ni la lógica.
Esta guía contiene pasos de Linux **sólo para el VPS**; exportar configuración y generar
el entorno usa Node y funciona también desde macOS/Windows.

## 1. Cuentas y límite de gasto

1. Registrar una cuenta propia en https://signup.cloud.oracle.com/. Elegir región principal
   Santiago (`sa-santiago-1`) si se ofrece; la región principal no se cambia luego.
   Verificación de identidad/tarjeta y MFA los completa el titular en Oracle.
2. Mantener **Free Tier**, sin upgrade a pago por uso. El crédito de prueba no es el presupuesto.
   Comprobar en consola los límites y la etiqueta Always Free antes de confirmar cada recurso.
3. Registrar DuckDNS en https://www.duckdns.org/ con una cuenta propia y reservar
   `terreno-conectado-demo` o, si está ocupado, `terreno-conectado-daniel-demo`.
4. Registrar en ADR el nombre reservado, región, titular y límites confirmados.
   El PR lleva la aprobación del otro integrante antes de provisionar (Constitución VI).

Ejecución autorizada directamente por el titular el 2026-10-16: región principal
existente Valparaíso (`sa-valparaiso-1`), instancia `terreno-conectado-demo` y
`terreno-conectado-demo.duckdns.org`. La revisión cruzada del PR #160 queda pendiente.

Objetivo: una VM Ubuntu 24.04 ARM A1, 2 OCPU/12 GB, disco de arranque 50 GB y
volumen de datos 50 GB (100 GB combinados, por debajo de 200 GB gratuitos).
Bucket **privado Standard** para backups, sin versionado, replicación ni servicios pagados.
El límite de la herramienta es 10 GiB de backups cifrados, dentro de los 20 GB Always Free.
Verificar además IP pública y transferencia en el resumen de costos de la cuenta.
Si no hay capacidad A1 gratuita, esperar o informar el impedimento; no contratar alternativa.

La VM puede ser recuperada por inactividad. No hay SLA: esta instalación es una demo.
No generar carga artificial para evitar la política del proveedor.
Fuentes: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
y https://www.oracle.com/cloud/free/faq/ (revalidar antes de crear recursos).

## 2. Servidor y secretos

Crear llave SSH dedicada y VM con acceso por esa llave. Conservar la llave privada
en el equipo del titular. En OCI abrir 80/443. Para despliegues con runners hospedados
de GitHub, sus IP son dinámicas: el puerto 22 acepta conexiones de Internet, pero
únicamente autentica con la llave dedicada, sin contraseñas ni acceso root. Si se limita
22 a una IP administrativa, el deploy hospedado no funciona hasta permitir su origen.
No abrir 3000, 5173 ni 5432. Instalar con usuario `ubuntu`:

```bash
sudo bash infra/tools/bootstrap-ubuntu.sh ubuntu 0.0.0.0/0
```

El script requiere Ubuntu 24.04, instala Docker/Compose, Node 22, age y rclone,
habilita firewall y deshabilita contraseñas SSH. Reabrir una sesión por llave antes de
cerrar la anterior. El acceso al grupo Docker equivale a administración del host.

Montar el volumen de datos siguiendo **los comandos que entrega OCI para el dispositivo exacto**.
No formatear dispositivos por nombre supuesto. Montarlo por UUID, persistente en `/etc/fstab`.
En el servidor nuevo y antes de iniciar Docker con datos, configurar Docker `data-root`
en ese volumen (`/mnt/terreno/docker`) y rotación de logs: driver `json-file`, `max-size: 10m`,
`max-file: 3`. Copiar `docker-data.conf` a
`/etc/systemd/system/docker.service.d/terreno-data.conf` y ejecutar
`systemctl daemon-reload`: Docker debe depender del montaje para no abrir una base vacía
en el disco de arranque si el volumen falta. Reiniciar Docker y comprobar `docker info`
antes de crear contenedores.

Copiar `infra/` a `/opt/terreno/infra` (sin `.env` local). Generar allí secretos nuevos:

```bash
node /opt/terreno/infra/tools/init-env.mjs SUBDOMINIO.duckdns.org SHA_COMPLETO /opt/terreno/infra/.env
```

El generador rechaza sobrescribir archivos. Configurar estos GitHub Actions secrets:
`VITE_DEMO_PASSWORD` (el nuevo `DEMO_PASSWORD`), `VPS_HOST`, `VPS_USER`,
`VPS_SSH_KEY`, `VPS_HOST_FINGERPRINT`. Para GHCR, Actions usa su token temporal
con `packages:write`; `GHCR_USERNAME`/`GHCR_READ_TOKEN` (read:packages) sólo son
opcionales para operación manual con token permanente. El token temporal expira:
las actualizaciones deben ejecutarse desde Actions para renovarlo automáticamente.
Verificar el fingerprint desde la consola OCI, no confiar sólo en `ssh-keyscan` por red.
No copiar passwords en issues, PRs ni logs. La contraseña demo sí será pública en el bundle;
no protege infraestructura ni debe reutilizarse fuera de esta demo.

## 3. Copia selectiva y primer arranque

En `backend/` del repo local, con Node 22+ y dependencias instaladas (ruta de salida nueva):

```bash
node --env-file=../.env ../infra/tools/config.mjs export ../infra/config-bundle
```

`SYNC_VOLUME` debe apuntar al volumen real del backend, relativo a `backend/` para ese comando.
Se copian empresas, usuarios sin hashes, faenas, plantillas, revisiones, catálogo,
asignaciones, imports y originales Excel. No hay sesiones, respuestas, hallazgos,
bitácoras, fotos operacionales, conflictos ni logs. La base fuente se lee en snapshot
sin modificaciones; no borrar IndexedDB ni colas locales. La nueva dirección web comienza
con almacenamiento del navegador independiente. No se transfieren pendientes locales.

Comprobar que la configuración sólo contiene datos ficticios antes de publicarla.
Copiar el paquete por SCP a `/opt/terreno/infra/config-bundle` y restringir sus permisos.
En GitHub Actions ejecutar Deploy, con el ref elegido y **publish_only=true**.
El workflow prueba el mismo commit y publica imágenes amd64/ARM etiquetadas por SHA real.
No usa `latest`. Ese SHA debe coincidir con las tres `IMAGE_*` del entorno.

En DuckDNS apuntar IPv4 a la IP de la VM; no dejar un AAAA que apunte a otro host.
Si cambia la IP, actualizarla con la API HTTPS de DuckDNS; su token nunca va al repo.
Ejecutar el workflow con **publish_only=false** después de copiar el paquete y el
entorno al servidor. El primer despliegue crea la base, migra, importa configuración
y ajusta permisos de archivos **antes de exponer la API**. La marca `.config-imported`
permite reintentar TLS sin repetir importación. No borrar esa marca en un stack con datos.
La importación exige destino vacío y genera hashes nuevos con `DEMO_PASSWORD`.
No ejecutar `seed`: agregaría formularios y asignaciones ajenos a la copia.
Los checksums de los originales se verifican antes de insertar datos.
Caddy emite TLS automáticamente. Para operación manual con sesión GHCR vigente,
el comando es `node tools/ops.mjs deploy SHA_COMPLETO`.
Revisar `https://SUBDOMINIO.duckdns.org/health`, cookies Secure/HttpOnly y service worker.
Primer arranque requiere red; luego la captura usa la caché y cola offline existentes.

## 4. Backups, alertas y actualizaciones

Configurar `rclone config --config /opt/terreno/secrets/rclone.conf` con backend
`oracleobjectstorage` (rclone ≥ 1.60), nombre `oci`, región y namespace de la cuenta,
proveedor `instance_principal_auth`, con un dynamic group que incluya únicamente esta
instancia y política limitada al bucket privado. No dejar claves de administrador en
la máquina. El ejemplo `user_principal_auth` es una alternativa de recuperación con
usuario dedicado y permisos mínimos. Guía oficial: https://rclone.org/oracleobjectstorage/.
No usar una URL pública/PAR. Crear el prefijo remoto `oci:terreno-backups/demo`.
Generar identidad age con `age-keygen -o /opt/terreno/secrets/backup.key`;
guardar **copia fuera de Oracle**, junto con `.env` y las credenciales de recuperación.
Copiar `backup/backup.conf.example` a `backup/backup.conf` y completar sus rutas,
destinatario público age y `ALERT_WEBHOOK` HTTPS privado si se desean avisos externos.
Sin webhook, los fallos quedan en stderr, código de salida y unidad systemd fallida.
El workflow `Demo health and backup audit` verifica HTTPS, timer, resultado del servicio,
antigüedad del último backup (26 h) y retención. Falla visiblemente en Actions; activar
las notificaciones de workflows del titular en GitHub. GitHub debe registrar este
workflow nuevo en `main` antes de permitir su disparo manual o su programación diaria
(03:30 UTC). Mientras el PR siga abierto, ejecutar la misma auditoría por SSH:
`node /opt/terreno/infra/tools/check-backup.mjs` y verificar `/health` por HTTPS.

```bash
node /opt/terreno/infra/tools/ops.mjs backup
sudo cp /opt/terreno/infra/backup/terreno-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now terreno-backup.timer
sudo systemctl start terreno-backup.service
sudo journalctl -u terreno-backup.service
```

El backup detiene la API brevemente (los dispositivos conservan su cola), captura DB
y archivos, reinicia la API aun si falla la copia, cifra con age y sube fuera del host.
Conserva hasta siete conjuntos bajo 10 GiB sin borrar el último remoto para hacer espacio.
Si no cabe un conjunto nuevo, falla y alerta; no amplía cuotas ni contrata capacidad.
No ejecutar escrituras manuales en la DB durante esta ventana.

Para actualizaciones posteriores ejecutar Deploy con **publish_only=false**. Un bloqueo
impide mezclar backups/despliegues/restores; las migraciones corren con la API detenida.
Se respalda antes, se fijan imágenes por SHA y se comprueba API y borde HTTPS.
Si falla y no cambió el esquema, vuelve a imágenes anteriores. Si cambió, deja la API
detenida y exige restauración verificada: no corre migraciones `down` automáticamente.
Guardar las imágenes de las versiones referenciadas por los siete backups y la anterior;
no purgarlas en GHCR. Monitorizar `/health` desde un servicio gratuito externo.

## 5. Recuperación y aceptación

Descargar un backup cifrado y preparar otro stack **vacío**, con otro nombre Compose
(`COMPOSE_PROJECT_NAME=terreno-restore`), archivos `.env` y volúmenes independientes.
Usar el mismo `APP_DB_PASSWORD` del destino en la provisión de `tc_app`; credenciales
owner/rol vienen del entorno y no del dump. Mantener JWT/config de demo coherentes.
No publicar Caddy en el stack de ensayo para no competir por 80/443.

```bash
node tools/ops.mjs restore /ruta/terreno-FECHA.tar.age --confirm-empty-target
```

Para un directorio alternativo usar `COMPOSE_DIR` y `COMPOSE_FILE` en el entorno.
Restore rechaza una base o volumen con contenido y una API ya encendida. Recupera DB,
archivos y versiones registradas; verificar lectura de originales/fotos, conteos, login
y RLS antes de cambiar DNS. No elimina automáticamente el stack averiado ni sus datos.
Una operación interrumpida puede requerir limpiar **sólo el stack de ensayo identificado**
y repetir en un destino vacío. Verificar que no haya proceso antes de retirar un lock huérfano.

Aceptación en HTTPS: todos los roles; importación/publicación; asignar/desasignar;
captura con foto offline y reinicio del navegador; reconexión sin duplicados; revisión
por trabajador y export Excel; aislamiento entre empresas; PWA instalada; refresh;
actualización con pendientes; reinicio del servidor y restauración completa.
Tras esa prueba inicial, repetir restore periódicamente y antes de una evaluación importante.
Registrar evidencia real en la tarea #159; publicar código no equivale a publicar la app.
