/**
 * TSK-FORM-021 (Enmienda 006): importar con IA. Una plantilla también puede
 * venir de una FOTO de una pauta en papel (`jpg`/`png`), y `motor` dice quién
 * armó la propuesta: las reglas de siempre o Claude. Los imports anteriores
 * son todos `reglas`.
 */
exports.up = (pgm) => {
  pgm.dropConstraint('template_imports', 'template_imports_formato_check')
  pgm.addConstraint('template_imports', 'template_imports_formato_check', {
    check: "formato IN ('xlsx', 'docx', 'pdf', 'jpg', 'png')",
  })
  pgm.addColumn('template_imports', {
    motor: { type: 'text', notNull: true, default: 'reglas' },
  })
  pgm.addConstraint('template_imports', 'template_imports_motor_check', {
    check: "motor IN ('reglas', 'ia')",
  })
}

exports.down = (pgm) => {
  pgm.dropConstraint('template_imports', 'template_imports_motor_check')
  pgm.dropColumn('template_imports', 'motor')
  pgm.sql("DELETE FROM template_imports WHERE formato IN ('jpg', 'png')")
  pgm.dropConstraint('template_imports', 'template_imports_formato_check')
  pgm.addConstraint('template_imports', 'template_imports_formato_check', {
    check: "formato IN ('xlsx', 'docx', 'pdf')",
  })
}
