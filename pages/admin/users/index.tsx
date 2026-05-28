import { GetServerSideProps } from 'next'
import { useState } from 'react'
import AdminLayout from '../../../components/admin/AdminLayout'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'

interface AdminUser {
  id: string
  email: string
  name: string | null
  created_at: string
}

interface Props {
  users: AdminUser[]
  total: number
}

export default function UsersIndex({ users, total }: Props) {
  const [search, setSearch] = useState('')

  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return u.email.toLowerCase().includes(q) || (u.name ?? '').toLowerCase().includes(q)
  })

  return (
    <AdminLayout title="Users">
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={styles.h1}>Users</h1>
          <span style={styles.countBadge}>{total} total</span>
        </div>
      </div>

      <div style={styles.filters}>
        <input
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={styles.searchInput}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={styles.empty}>
          {users.length === 0
            ? 'No users have signed up yet.'
            : 'No users match your search.'}
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['Name', 'Email', 'Joined'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} style={styles.tr}>
                  <td style={styles.td}>{u.name ?? <span style={{ color: '#d1d5db' }}>—</span>}</td>
                  <td style={styles.td}>{u.email}</td>
                  <td style={styles.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult

  const db = getAdminClient()
  const { data, count } = await db
    .from('users')
    .select('id, name, email, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })

  return {
    props: {
      users: data ?? [],
      total: count ?? 0,
    },
  }
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  h1: { fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 },
  countBadge: { fontSize: 13, color: '#6b7280', fontWeight: 500 },
  filters: { display: 'flex', gap: 12, marginBottom: 20 },
  searchInput: {
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    fontSize: 14,
    flex: '1 1 200px',
    minWidth: 180,
  },
  tableWrap: { background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    fontSize: 12,
    fontWeight: 600,
    color: '#6b7280',
    background: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tr: { borderBottom: '1px solid #f3f4f6' },
  td: { padding: '13px 16px', fontSize: 14, color: '#374151', verticalAlign: 'middle' },
  empty: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e5e7eb',
    padding: '48px',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: 15,
  },
}
