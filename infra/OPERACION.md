# Operación de la v1

Guía corta para operar Terreno Conectado en producción (VM de Oracle Always Free,
`/opt/terreno/infra`). Para provisionar la VM desde cero: [`ORACLE-FREE.md`](ORACLE-FREE.md).
Todas las órdenes se ejecutan **en la VM**, desde `/opt/terreno/infra`, salvo las de GitHub Actions.

> Producción no usa datos semilla ni cuentas compartidas (Enmienda 003). `backend/db/seed.ts`
> es sólo para desarrollo y pruebas: **nunca** ejecutarlo contra la VM.

## 1. Primer administrador de plataforma

Una sola vez, con la base recién creada:

```bash
node tools/ops.mjs bootstrap-admin
```

Pide correo, nombre y contraseña (mínimo 12 caracteres) en la terminal; la contraseña no se
muestra ni queda en el historial. Se niega a correr si ya existe un administrador de plataforma.

## 2. Alta de una empresa cliente

1. El administrador de plataforma entra a la app → **Empresas** → "Nueva empresa" (nombre y código;
   el código es el que usan los usuarios en el login si su correo existe en más de una empresa).
2. "Crear administrador": la app genera una **clave temporal** y la muestra una sola vez. Entrégala
   por un canal seguro.
3. El administrador de la empresa entra, crea su contraseña definitiva y, en **Equipo**, crea las
   faenas y las cuentas de trabajadores y supervisores (cada una con su clave temporal).
4. En **Plantillas** importa y publica sus formularios y los asigna a faenas y roles.

Si alguien olvida su contraseña, el administrador de su empresa la **restablece** desde Equipo
(nueva clave temporal). Desactivar una cuenta corta sus sesiones de inmediato.

## 3. Desplegar una versión

Desde GitHub → Actions → **Deploy** → elegir el commit de `main`. El workflow prueba, publica
imágenes por SHA y ejecuta en la VM `node tools/ops.mjs deploy <SHA>`: respaldo previo, migraciones,
arranque con verificación de salud y vuelta atrás automática si no cambió el esquema.

## 4. Respaldos

- Automáticos: `terreno-backup.timer` (systemd) cifra con `age` la base y las fotos y los sube al
  bucket privado de Object Storage; el workflow `demo-health.yml` audita que se estén generando.
- Manual: `node tools/ops.mjs backup`.

## 5. Restaurar

Sólo sobre un stack **vacío** (base nueva, API apagada):

```bash
node tools/ops.mjs restore /ruta/terreno-FECHA.tar.age --confirm-empty-target
```

Verificar luego usuarios, documentos y fotos antes de apuntar el DNS.

## 6. Paso de la demo a la v1 (una sola vez)

La VM venía de la demo con cuentas compartidas y datos ficticios. Corte, desde
`/opt/terreno/infra`, **después** de desplegar la v1 con el workflow Deploy:

```bash
node tools/ops.mjs reset-v1 --confirmo-borrar-datos-demo
node tools/ops.mjs bootstrap-admin
```

`reset-v1` saca primero un respaldo cifrado completo (base + fotos, subido fuera de la VM),
luego vacía la base y el volumen de fotos, aplica las migraciones v1 y levanta la API sin
cuentas. Se niega a correr sin la marca de confirmación o sin una versión desplegada. Después,
`bootstrap-admin` crea el primer administrador de plataforma y la prueba de humo es: empresa de
prueba → su administrador cambia la clave → crea faena y trabajador → el trabajador captura sin
señal y sincroniza.
