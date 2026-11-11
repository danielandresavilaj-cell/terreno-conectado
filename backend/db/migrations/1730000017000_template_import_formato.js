/**
 * TSK-FORM-020 (Enmienda 005): las plantillas también se importan desde Word y
 * PDF. `formato` dice de qué archivo viene cada import; los anteriores son
 * todos `.xlsx`. Sólo un import `xlsx` tiene un libro original que rellenar.
 */
exports.up = (pgm) => {
  pgm.addColumn('template_imports', {
    formato: { type: 'text', notNull: true, default: 'xlsx' },
  })
  pgm.addConstraint('template_imports', 'template_imports_formato_check', {
    check: "formato IN ('xlsx', 'docx', 'pdf')",
  })
}

exports.down = (pgm) => {
  pgm.dropConstraint('template_imports', 'template_imports_formato_check')
  pgm.dropColumn('template_imports', 'formato')
}
