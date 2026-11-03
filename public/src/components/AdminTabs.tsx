import Link from 'next/link'

const tabs = [
  { href: '/admin/empleados', label: 'Empleados' },
  { href: '/admin/areas', label: 'Áreas' },
  { href: '/admin/periodos', label: 'Periodos' },
  { href: '/admin/configuracion', label: 'Configuración' },
]

export default function AdminTabs({ active }: { active: string }) {
  return (
    <nav className="tabs" aria-label="Administración">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="tab" aria-current={t.href === active ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
