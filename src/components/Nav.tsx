'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Item = { href: string; label: string; ready: boolean }

export default function Nav({
  isHr = false,
  isManager = false,
  matrixUrl = null,
}: {
  isHr?: boolean
  isManager?: boolean
  matrixUrl?: string | null
}) {
  const pathname = usePathname()

  const items: Item[] = [
    { href: '/dashboard', label: 'Dashboard', ready: true },
    ...(isHr || isManager ? [{ href: '/seguimiento', label: 'Seguimiento', ready: true }] : []),
    { href: '/objetivos', label: 'Objetivos', ready: true },
    { href: '/personales', label: 'Objetivos personales', ready: true },
    ...(isManager ? [{ href: '/equipo', label: 'Mi equipo', ready: true }] : []),
    { href: '/autoevaluacion', label: 'Autoevaluación', ready: true },
    { href: '/reporte', label: 'Reporte', ready: true },
    ...(isHr ? [{ href: '/admin', label: 'Administración', ready: true }] : []),
  ]

  return (
    <nav className="nav" aria-label="Principal">
      {items.map((item) =>
        item.ready ? (
          <Link
            key={item.href}
            href={item.href}
            className="nav-item"
            aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ) : (
          <span key={item.href} className="nav-item nav-item--soon" aria-disabled="true">
            {item.label}
            <small>Pronto</small>
          </span>
        )
      )}
      {matrixUrl && (
        <a className="nav-item nav-item--external" href={matrixUrl} target="_blank" rel="noopener noreferrer">
          Matriz de objetivos
          <small aria-hidden="true">↗</small>
        </a>
      )}
    </nav>
  )
}
