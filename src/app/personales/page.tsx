import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/AppShell'
import { GOAL_STATUS, GOAL_LABEL, GOAL_BADGE, formatDate, type GoalStatus } from '@/lib/goals'

type Goal = {
  id: string
  title: string
  description: string | null
  target_date: string | null
  status: GoalStatus
  shared_with_manager: boolean
}

async function currentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, user }
}

const fail = (m: string): never => redirect('/personales?error=' + encodeURIComponent(m))

async function addGoal(formData: FormData) {
  'use server'
  const { supabase, user } = await currentUser()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) fail('Escribe el título del objetivo.')
  const { error } = await supabase.from('personal_goals').insert({
    owner_id: user.id,
    title,
    description: String(formData.get('description') ?? '').trim() || null,
    target_date: String(formData.get('target_date') ?? '') || null,
    shared_with_manager: formData.get('shared') === 'on',
  })
  if (error) fail(error.message)
  revalidatePath('/personales')
  redirect('/personales?ok=' + encodeURIComponent('Objetivo personal agregado.'))
}

async function setStatus(formData: FormData) {
  'use server'
  const { supabase } = await currentUser()
  const status = String(formData.get('status'))
  if (!GOAL_STATUS.some((s) => s.value === status)) fail('Estado no válido.')
  // RLS garantiza que solo puedas modificar los tuyos.
  const { error } = await supabase.from('personal_goals').update({ status }).eq('id', String(formData.get('id')))
  if (error) fail(error.message)
  revalidatePath('/personales')
}

async function toggleShare(formData: FormData) {
  'use server'
  const { supabase } = await currentUser()
  const { error } = await supabase
    .from('personal_goals')
    .update({ shared_with_manager: formData.get('shared') === 'true' })
    .eq('id', String(formData.get('id')))
  if (error) fail(error.message)
  revalidatePath('/personales')
}

async function deleteGoal(formData: FormData) {
  'use server'
  const { supabase } = await currentUser()
  const { error } = await supabase.from('personal_goals').delete().eq('id', String(formData.get('id')))
  if (error) fail(error.message)
  revalidatePath('/personales')
}

export default async function PersonalesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>
}) {
  const { error, ok } = await searchParams
  const { supabase, user } = await currentUser()

  const { data } = await supabase
    .from('personal_goals')
    .select('id, title, description, target_date, status, shared_with_manager')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
  const goals = (data ?? []) as Goal[]
  const today = new Date().toISOString().slice(0, 10)
  const done = goals.filter((g) => g.status === 'done').length

  return (
    <AppShell
      title="Objetivos personales"
      subtitle="Metas de desarrollo propias: un curso, una certificación, una habilidad. No pesan en tu calificación ni necesitan aprobación."
    >
      {error && <div className="alert" role="alert">{error}</div>}
      {ok && <div className="success" role="status">{ok}</div>}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Mis metas</h2>
              <p>
                {goals.length === 0
                  ? 'Aún no has registrado ninguna.'
                  : `${done} de ${goals.length} ${goals.length === 1 ? 'meta cumplida' : 'metas cumplidas'}.`}
              </p>
            </div>
          </div>

          {goals.length === 0 ? (
            <div className="empty">
              <h3>Empieza con una meta</h3>
              <p>Registra algo que quieras aprender o lograr este año. Solo tú la ves, salvo que decidas compartirla con tu jefe.</p>
            </div>
          ) : (
            goals.map((g) => {
              const overdue = g.target_date !== null && g.target_date < today && g.status !== 'done'
              return (
                <div className="goal" key={g.id}>
                  <div className="goal-main">
                    <div className="cell-title">{g.title}</div>
                    {g.description && <div className="cell-desc">{g.description}</div>}
                    <div className="goal-meta">
                      {g.target_date && (
                        <span className={overdue ? 'goal-due' : ''}>
                          Meta: {formatDate(g.target_date)}{overdue && ' · vencida'}
                        </span>
                      )}
                      <span className={`badge ${GOAL_BADGE[g.status]}`}>{GOAL_LABEL[g.status]}</span>
                      {g.shared_with_manager && <span className="tag">Compartida con tu jefe</span>}
                    </div>
                  </div>

                  <div className="goal-actions">
                    <form action={setStatus} className="toggle-group" aria-label="Estado de la meta">
                      <input type="hidden" name="id" value={g.id} />
                      {GOAL_STATUS.map((s) => (
                        <button key={s.value} type="submit" name="status" value={s.value} aria-pressed={g.status === s.value}>
                          {s.label}
                        </button>
                      ))}
                    </form>
                    <div className="row-actions">
                      <form action={toggleShare}>
                        <input type="hidden" name="id" value={g.id} />
                        <input type="hidden" name="shared" value={String(!g.shared_with_manager)} />
                        <button type="submit" className="link-btn">
                          {g.shared_with_manager ? 'Dejar de compartir' : 'Compartir con mi jefe'}
                        </button>
                      </form>
                      <form action={deleteGoal}>
                        <input type="hidden" name="id" value={g.id} />
                        <button type="submit" className="link-danger">Eliminar</button>
                      </form>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </section>

        <aside className="panel panel-form">
          <h2>Nueva meta</h2>
          <form action={addGoal}>
            <label className="field">
              <span>Título</span>
              <input name="title" placeholder="Ej. Certificación en Lean Six Sigma" required />
            </label>
            <label className="field">
              <span>Descripción</span>
              <textarea name="description" />
            </label>
            <label className="field">
              <span>Fecha meta</span>
              <input name="target_date" type="date" />
            </label>
            <label className="check">
              <input type="checkbox" name="shared" />
              <span>Compartir con mi jefe</span>
            </label>
            <button type="submit" className="btn">Guardar meta</button>
          </form>
        </aside>
      </div>
    </AppShell>
  )
}
