import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session || (session.user as { role?: string }).role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const rawPage = parseInt(String(req.query.page ?? '1'), 10)
  const rawLimit = parseInt(String(req.query.limit ?? '50'), 10)
  const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage)
  const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit))
  const from = (page - 1) * limit
  const to = from + limit - 1

  const db = getAdminClient()
  const [{ data, error }, { count }] = await Promise.all([
    db.from('users').select('id, name, email, created_at').order('created_at', { ascending: false }).range(from, to),
    db.from('users').select('*', { count: 'exact', head: true }),
  ])

  if (error) return res.status(500).json({ error: 'Failed to load users' })

  return res.status(200).json({ users: data ?? [], total: count ?? 0, page, limit })
}
