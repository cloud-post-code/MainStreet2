import { GetServerSideProps } from 'next'
import Link from 'next/link'
import AdminLayout from '../../../components/admin/AdminLayout'
import ProductForm from '../../../components/admin/ProductForm'
import { requireAdminSession } from '../../../lib/admin/auth'
import { getAdminClient } from '../../../lib/admin/supabase-admin'

interface Props {
  categories: { id: string; name: string }[]
  companies: { id: string; name: string }[]
  defaultCompanyId?: string
}

export default function NewProduct({ categories, companies, defaultCompanyId }: Props) {
  return (
    <AdminLayout title="Add Product">
      <div style={{ marginBottom: 20 }}>
        <Link href="/admin/products" style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>← Products</Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 24px' }}>Add Product</h1>
      <ProductForm
        categories={categories}
        companies={companies}
        initial={defaultCompanyId ? { business_id: defaultCompanyId } : undefined}
      />
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  const defaultCompanyId = (ctx.query.company as string) ?? undefined
  const db = getAdminClient()
  const [{ data: categories }, { data: companies }] = await Promise.all([
    db.from('categories').select('id, name').order('name'),
    db.from('businesses').select('id, name').eq('status', 'active').order('name'),
  ])
  return { props: { categories: categories ?? [], companies: companies ?? [], defaultCompanyId: defaultCompanyId ?? null } }
}
