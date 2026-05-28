import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)))
  const from = (page - 1) * limit
  const to = from + limit - 1

  const db = getAdminClient()
  const { data, error, count } = await db
    .from('users')
    .select('id, name, email, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ users: data ?? [], total: count ?? 0, page, limit })
}
