import type { Metadata } from 'next'
import { Hanken_Grotesk, Newsreader } from 'next/font/google'
import './globals.css'

const ui = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-ui' })
const display = Newsreader({ subsets: ['latin'], variable: '--font-display' })

export const metadata: Metadata = {
  title: 'Gestión del desempeño',
  description: 'Objetivos, autoevaluación y evaluación del jefe.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${ui.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  )
}
