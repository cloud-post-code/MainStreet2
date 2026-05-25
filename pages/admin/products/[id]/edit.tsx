import { GetServerSideProps } from 'next'
import Link from 'next/link'
import AdminLayout from '../../../../components/admin/AdminLayout'
import ProductForm from '../../../../components/admin/ProductForm'
import { requireAdminSession } from '../../../../lib/admin/auth'
import { getAdminClient } from '../../../../lib/admin/supabase-admin'

interface Props {
  product: Record<string, unknown>
  categories: { id: string; name: string }[]
  companies: { id: string; name: string }[]
  lockedFields: string[]
}

export default function EditProduct({ product, categories, companies, lockedFields }: Props) {
  return (
    <AdminLayout title={`Edit ${product.name}`}>
      <div style={{ marginBottom: 20 }}>
        <Link href={`/admin/products/${product.id}`} style={{ color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>
          ← {product.name as string}
        </Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: '0 0 24px' }}>Edit Product</h1>
      <ProductForm
        initial={{
          business_id: product.business_id as string,
          name: product.name as string,
          description: (product.description as string) ?? '',
          price: String(product.price),
          image_url: (product.image_url as string) ?? '',
          availability: (product.availability as string) ?? 'unknown',
          category_id: (product.category_id as string) ?? '',
          sku: (product.sku as string) ?? '',
          url: (product.url as string) ?? '',
        }}
        categories={categories}
        companies={companies}
        productId={product.id as string}
        lockedFields={lockedFields}
      />
    </AdminLayout>
  )
}

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  const { id } = ctx.params as { id: string }
  const db = getAdminClient()
  const [{ data: product, error }, { data: categories }, { data: companies }, { data: overrides }] = await Promise.all([
    db.from('products').select('*').eq('id', id).single(),
    db.from('categories').select('id, name').order('name'),
    db.from('businesses').select('id, name').eq('status', 'active').order('name'),
    db.from('product_field_overrides').select('field_name').eq('product_id', id),
  ])
  if (error || !product) return { notFound: true }
  return {
    props: {
      product,
      categories: categories ?? [],
      companies: companies ?? [],
      lockedFields: (overrides ?? []).map((o: { field_name: string }) => o.field_name),
    },
  }
}
