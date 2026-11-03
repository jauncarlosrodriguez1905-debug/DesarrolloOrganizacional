'use client'

/** Abre el diálogo de impresión con el nombre de archivo sugerido; elegir "Guardar como PDF". */
export default function PrintButton({ filename }: { filename: string }) {
  return (
    <button
      type="button"
      className="btn btn--inline"
      onClick={() => {
        const previous = document.title
        document.title = filename
        window.print()
        setTimeout(() => { document.title = previous }, 1000)
      }}
    >
      Descargar PDF
    </button>
  )
}
