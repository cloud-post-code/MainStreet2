import { GetServerSideProps } from 'next'
import Link from 'next/link'
import AdminLayout from '../../../../components/admin/AdminLayout'
import CompanyForm from '../../../../components/admin/CompanyForm'
import { requireAdminSession } from '../../../../lib/admin/auth'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

interface Props {
  company: Record<string, string>
  categories: { id: string; name: string }[]
}

export default function EditCompany({ company, categories }: Props) {
  return (
    <AdminLayout title={`Edit ${company.name}`}>
      <div style={{ marginBottom: 20 }}>
        <Link href={`/admin/companies/${company.id}`} style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>
          ← {company.name}
        </Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 24px' }}>Edit Company</h1>
      <CompanyForm initial={company as any} categories={categories} companyId={company.id} />
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  const { id } = ctx.params as { id: string }
  const db = getAdminClient()
  const [{ data: company, error }, { data: categories }] = await Promise.all([
    db.from('businesses').select('*').eq('id', id).single(),
    db.from('categories').select('id, name').order('name'),
  ])
  if (error || !company) return { notFound: true }
  return { props: { company, categories: categories ?? [] } }
}
