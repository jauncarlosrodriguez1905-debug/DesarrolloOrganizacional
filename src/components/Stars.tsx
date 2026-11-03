import { Fragment } from 'react'
import { SCORE_LABEL } from '@/lib/scoring'

/** Selector de 1 a 5 estrellas (solo HTML y CSS; se envía con el formulario). */
export function StarInput({ name, defaultValue }: { name: string; defaultValue?: number | null }) {
  return (
    <div className="stars" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">
      {[5, 4, 3, 2, 1].map((n) => (
        <Fragment key={n}>
          <input type="radio" id={`${name}-${n}`} name={name} value={n} defaultChecked={defaultValue === n} />
          <label htmlFor={`${name}-${n}`} title={SCORE_LABEL[n]}>★</label>
        </Fragment>
      ))}
    </div>
  )
}

/** Estrellas de solo lectura. */
export function Stars({ value }: { value: number }) {
  return (
    <span className="stars-static" role="img" aria-label={SCORE_LABEL[value]} title={SCORE_LABEL[value]}>
      {'★'.repeat(value)}
      <span className="off">{'★'.repeat(5 - value)}</span>
    </span>
  )
}
