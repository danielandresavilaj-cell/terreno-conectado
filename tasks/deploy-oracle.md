# TSK-DEPLOY-001 — Demo Oracle Always Free

Issue #159 · NFR-01/04/05/06/08/09 · FR-006/007/009/044/052.
Plan aprobado por Daniel en este chat el 2026-10-16; ADR-002, adenda 1.

- [x] Imágenes ARM/amd64 por SHA real, validación previa y despliegue manual.
- [x] Export/import de configuración sin respuestas ni credenciales de origen.
- [x] Backup DB+archivos cifrado, offsite, retención limitada y restore a stack vacío.
- [x] Runbook de cuentas, infraestructura, DNS, TLS, operación y recuperación.
- [x] Validación local: lint, typecheck, build/PWA; 396 tests; imágenes ARM de tools/API/frontend.
- [x] Ensayo real aislado DB+archivos: cifrado age, transporte rclone, restore y rechazo de sobrescritura.
- [ ] Registrar cuentas Oracle/DuckDNS; reservar capacidad gratuita y subdominio.
- [ ] Aprobar ADR actualizado en PR por el otro integrante, según CONTRIBUTING.
- [ ] Provisionar, importar configuración y verificar flujos HTTPS en dispositivos.
- [ ] Verificar restore, alertas y consumo en Oracle antes de entregar enlace.

Evidencia 2026-10-16: export local selectivo preparado (2 empresas, 7 usuarios, 2 faenas,
7 formularios, 8 revisiones, 4 asignaciones; 6 imports con originales). Paquete y secretos
ignorados por Git. Ensayo de restore en dos stacks desechables, con la imagen runtime de
producción y rol `tc_app` sin BYPASSRLS. Transporte local con rclone: acceso al bucket OCI,
TLS público y pruebas en dispositivo quedan pendientes de cuentas. Workflow validado con
actionlint. Credenciales nuevas de demo y SSH configuradas en GitHub Secrets sin exponerlas.
