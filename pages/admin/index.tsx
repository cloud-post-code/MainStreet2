import { GetServerSideProps } from 'next'
import { requireAdminSession } from '../../lib/admin/auth'

export default function AdminIndex() { return null }

export const getServerSideProps: GetServerSideProps = async ctx => {
  const authResult = await requireAdminSession(ctx)
  if ('redirect' in authResult) return authResult
  return { redirect: { destination: '/admin/companies', permanent: false } }
}
