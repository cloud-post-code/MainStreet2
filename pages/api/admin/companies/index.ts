import { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../auth/[...nextauth]'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions)
  if (!session) return res.status(401).json({ error: 'Unauthorized' })

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    name, url, town, category_id, verification_status,
    contact_name, contact_email, contact_phone,
    address_street, address_city, address_state, address_zip,
  } = req.body

  if (!name || !url || !town || !category_id) {
    return res.status(400).json({ error: 'name, url, town, and category_id are required' })
  }

  const db = getAdminClient()
  const { data, error } = await db
    .from('businesses')
    .insert({
      name: stripHtml(name),
      url,
      town: stripHtml(town),
      category_id,
      verification_status: verification_status ?? 'pending_review',
      contact_name: contact_name ? stripHtml(contact_name) : null,
      contact_email: contact_email || null,
      contact_phone: contact_phone || null,
      address_street: address_street ? stripHtml(address_street) : null,
      address_city: address_city ? stripHtml(address_city) : null,
      address_state: address_state || null,
      address_zip: address_zip || null,
      selectors: {},
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json(data)
}
