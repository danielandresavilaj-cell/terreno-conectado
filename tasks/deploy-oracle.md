# TSK-DEPLOY-001 — Demo Oracle Always Free

Issue #159 · NFR-01/04/05/06/08/09 · FR-006/007/009/044/052.
Plan aprobado por Daniel en este chat el 2026-10-16; ADR-002, adenda 1.

- [x] Imágenes ARM/amd64 por SHA real, validación previa y despliegue manual.
- [x] Export/import de configuración sin respuestas ni credenciales de origen.
- [x] Backup DB+archivos cifrado, offsite, retención limitada y restore a stack vacío.
- [x] Runbook de cuentas, infraestructura, DNS, TLS, operación y recuperación.
- [x] Validación en CI del release: lint, typecheck, build/PWA y 401 pruebas (78 shared, 130 frontend, 190 backend y 3 infraestructura); imágenes ARM/amd64 publicadas por SHA.
- [x] Ensayo real aislado DB+archivos: cifrado age, transporte rclone, restore y rechazo de sobrescritura.
- [x] Registrar cuentas Oracle/DuckDNS; reservar capacidad gratuita y subdominio.
- [ ] Aprobar ADR actualizado en PR por el otro integrante, según CONTRIBUTING.
- [x] Provisionar, importar la configuración y verificar HTTPS, sesión, RLS, descargas y asignaciones en la demo pública.
- [x] Verificar restore, retención, consumo, actualización compatible y reinicio del VPS antes de entregar enlace.
- [ ] Registrar la aprobación humana del PR y activar la auditoría diaria de GitHub después de que el workflow exista en `main`.
- [ ] Completar el recorrido manual público de importación Excel, captura de foto sin señal/PWA instalada y renovación de sesión de larga duración.

Evidencia 2026-10-16: export local selectivo preparado (2 empresas, 7 usuarios, 2 faenas,
7 formularios, 8 revisiones, 4 asignaciones; 6 imports con originales). Paquete y secretos
ignorados por Git. Ensayo de restore en dos stacks desechables, con la imagen runtime de
producción y rol `tc_app` sin BYPASSRLS. Transporte local con rclone: acceso al bucket OCI,
TLS público y pruebas en dispositivo quedan pendientes del arranque. Workflow validado con
actionlint. Credenciales nuevas de demo y SSH configuradas en GitHub Secrets sin exponerlas.

Provisionamiento autorizado explícitamente por Daniel: Valparaíso (`sa-valparaiso-1`),
A1 2 OCPU/12 GB, arranque 50 GB y datos 50 GB montados por UUID. Solo 22/80/443;
SSH sin password/root y con host Ed25519 verificado contra consola OCI firmada.
Bucket Standard privado; instance principal limitado al bucket `terreno-backups`.
Rclone oficial v1.75.2 verificado por SHA256 (paquete Ubuntu no trae backend OCI).
Timer diario instalado. Clave age de recuperación copiada fuera de Oracle.
Clave API administrativa temporal eliminada en OCI (lista vacía verificada en consola);
clave privada y configuración temporales eliminadas localmente. SSH/age siguen privados.

Demo pública operativa: https://terreno-conectado-demo.duckdns.org/ . El release publicado es
`8185fd75c143a8d414c179a051e75d1e7b348e32`; el workflow de publicación completó sus tres
jobs correctamente (validación, imágenes y despliegue). Logins de los 7 perfiles, cookies
seguras/refresh API, aislamiento, descarga original con checksum y alta/baja de asignación
fueron verificados. La base inicial no recibió inspecciones ni respuestas históricas.
Backup OCI real restaurado en stack aislado: 2 empresas/7 usuarios/8 revisiones/4 asignaciones/
6 originales SHA256; después se verificó también la restauración de una inspección nueva con
19 respuestas y una foto, incluidos bytes y checksum. Se ensayó retorno entre versiones
compatibles. Los stacks de ensayo fueron eliminados. Un reinicio completo del VPS conservó
configuración y archivos; Docker depende del volumen de datos.

En E2E se detectaron y corrigieron el reinicio involuntario del switch manual por
dependencias de efectos, su preferencia perdida al recargar, y el GET `/auth/me`
incorrecto (el contrato real es `/me`). Se evita rehidratar sesión en cada cambio de red.
Un error numérico visible también bloquea el envío aunque exista un valor válido anterior.
El manifiesto PWA se sirve como application/manifest+json. Dos E2E dirigidos ya validaron
la detección física de red y que el modo manual sin señal persiste al navegar/recargar y
sincroniza una sola vez al reactivarse. Falta el recorrido público controlado de Excel/foto:
el navegador denegó la carga y no se reintentó por otro mecanismo. No dar por aprobado
ese recorrido ni cerrar el issue. Auditoría externa requiere registrar workflow en main;
el PR #160 tiene revisión solicitada a ev6rlasting y exige su aprobación antes de merge.
