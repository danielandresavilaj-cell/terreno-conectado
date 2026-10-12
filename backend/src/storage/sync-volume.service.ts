import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * Volumen de adjuntos (`SYNC_VOLUME`) — data-model §2.2 V1.
 *
 * Lo escriben `SyncService` (fotos de ítem, hallazgo y bitácora) y
 * `TemplatesService` (documento original del import); lo leen el endpoint del
 * original (TSK-FORM-009) y la exportación del documento rellenado
 * (TSK-FORM-010). La comprobación de que una `file_key` resuelve DENTRO del
 * volumen vive acá y en un solo sitio: `file_key` es un valor que llega de la
 * base, y abrirlo sin comprobar sería un path traversal con lectura de disco.
 */
@Injectable()
export class SyncVolumeService {
  constructor(private readonly config: ConfigService) {}

  /** Raíz absoluta del volumen, igual que en la escritura. */
  raiz(): string {
    return resolve(this.config.get<string>('SYNC_VOLUME') ?? join(process.cwd(), '.vol'))
  }

  /**
   * Resuelve `fileKey` dentro del volumen y rechaza lo que se escape de él
   * (path traversal). La descarga es una lectura del disco por un valor de la
   * base, así que el límite del volumen se comprueba siempre antes de abrir.
   */
  rutaEn(fileKey: string): string {
    const raiz = this.raiz()
    const path = resolve(raiz, fileKey)
    if (path !== raiz && !path.startsWith(raiz + sep)) {
      throw new InternalServerErrorException('una clave de archivo quedó fuera del volumen de sync')
    }
    return path
  }

  /** Bytes de un archivo del volumen, con la MISMA comprobación que la escritura. */
  async leer(fileKey: string): Promise<Buffer> {
    return readFile(this.rutaEn(fileKey))
  }
}
