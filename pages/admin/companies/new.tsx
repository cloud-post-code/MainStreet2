import { GetServerSideProps } from 'next'
import Link from 'next/link'
import AdminLayout from '../../../components/admin/AdminLayout'
import CompanyForm from '../../../components/admin/CompanyForm'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'

interface Props { categories: { id: string; name: string }[] }

export default function NewCompany({ categories }: Props) {
  return (
    <AdminLayout title="Add Company">
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/companies" style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>
          ← Companies
        </Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 24px' }}>Add Company</h1>
      <CompanyForm categories={categories} />
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  const db = getAdminClient()
  const { data: categories } = await db.from('categories').select('id, name').order('name')
  return { props: { categories: categories ?? [] } }
}
