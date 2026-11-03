import Link from 'next/link'
import type { Cycle } from '@/lib/cycles'

export default function CyclePills({ basePath, cycles, active, extra }: { basePath: string; cycles: Cycle[]; active: string; extra?: string }) {
  return (
    <nav className="pills" aria-label="Ciclo de evaluación">
      {cycles.map((c) => (
        <Link key={c.value} href={`${basePath}?${extra ? extra + '&' : ''}c=${c.value}`} className="pill" aria-current={c.value === active ? 'true' : undefined}>
          {c.label}
        </Link>
      ))}
    </nav>
  )
}
