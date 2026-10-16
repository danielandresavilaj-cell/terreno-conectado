# TSK-DEPLOY-001 — Demo Oracle Always Free

Issue #159 · NFR-01/04/05/06/08/09 · FR-006/007/009/044/052.
Plan aprobado por Daniel en este chat el 2026-10-16; ADR-002, adenda 1.

- [x] Imágenes ARM/amd64 por SHA real, validación previa y despliegue manual.
- [x] Export/import de configuración sin respuestas ni credenciales de origen.
- [x] Backup DB+archivos cifrado, offsite, retención limitada y restore a stack vacío.
- [x] Runbook de cuentas, infraestructura, DNS, TLS, operación y recuperación.
- [x] Validación local: lint, typecheck, build/PWA; 396 tests; imágenes ARM de tools/API/frontend.
- [x] Ensayo real aislado DB+archivos: cifrado age, transporte rclone, restore y rechazo de sobrescritura.
- [x] Registrar cuentas Oracle/DuckDNS; reservar capacidad gratuita y subdominio.
- [ ] Aprobar ADR actualizado en PR por el otro integrante, según CONTRIBUTING.
- [ ] Provisionar, importar configuración y verificar flujos HTTPS en dispositivos.
- [ ] Verificar restore, alertas y consumo en Oracle antes de entregar enlace.

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

Demo pública operativa: https://terreno-conectado-demo.duckdns.org/ . Logins de los
7 perfiles, cookies seguras/refresh API, aislamiento, descarga original con checksum y
alta/baja de asignación verificados. Base inicial sin inspecciones ni respuestas.
Backup OCI real restaurado en stack aislado: 2 empresas/7 usuarios/8 revisiones/
4 asignaciones/6 originales SHA256; rol tc_app sin BYPASSRLS. Stack de ensayo eliminado.
Reinicio completo del VPS conservó configuración y archivos; Docker depende del volumen.

En E2E se detectaron y corrigieron el reinicio involuntario del switch manual por
dependencias de efectos, su preferencia perdida al recargar, y el GET `/auth/me`
incorrecto (el contrato real es `/me`). Se evita rehidratar sesión en cada cambio de red.
Un error numérico visible también bloquea el envío aunque exista un valor válido anterior.
El manifiesto PWA se sirve como application/manifest+json. Falta registrar evidencia
final del último SHA, instalación física y el recorrido público de Excel/foto: el
navegador denegó la carga, que no se reintentó por otro mecanismo. No dar por aprobado
ese recorrido ni cerrar el issue. Auditoría externa requiere registrar workflow en main;
el PR #160 tiene revisión solicitada a ev6rlasting y exige su aprobación antes de merge.
