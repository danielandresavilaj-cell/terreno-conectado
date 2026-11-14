import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pantallaCola = fileURLToPath(new URL('../src/screens/Cola.tsx', import.meta.url))

describe('accesibilidad táctil de Cola (TSK-OFF-014)', () => {
  it('mantiene los tres desplegables nativos con objetivo táctil de al menos 44 px', async () => {
    const fuente = await readFile(pantallaCola, 'utf8')
    const summaries = [...fuente.matchAll(/<summary className="([^"]+)"/g)].map((m) => m[1])

    expect(summaries).toHaveLength(3)
    for (const clases of summaries) {
      expect(clases).toContain('min-h-11')
      expect(clases).toContain('touch-manipulation')
    }
  })
})
