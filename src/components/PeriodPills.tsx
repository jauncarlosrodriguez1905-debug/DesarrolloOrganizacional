import Link from 'next/link'

export default function PeriodPills({
  basePath, periods, active, extra,
}: { basePath: string; periods: { id: string; name: string }[]; active: string; extra?: string }) {
  if (periods.length < 2) return null
  return (
    <nav className="pills" aria-label="Periodo">
      {periods.map((pe) => (
        <Link key={pe.id} href={`${basePath}?p=${pe.id}${extra ? '&' + extra : ''}`} className="pill"
          aria-current={pe.id === active ? 'true' : undefined}>
          {pe.name}
        </Link>
      ))}
    </nav>
  )
}
