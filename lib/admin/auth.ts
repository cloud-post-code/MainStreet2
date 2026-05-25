import { GetServerSidePropsContext, GetServerSidePropsResult } from 'next'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../pages/api/auth/[...nextauth]'

export async function requireAdminSession(
  ctx: GetServerSidePropsContext
): Promise<{ session: Awaited<ReturnType<typeof getServerSession>> } | GetServerSidePropsResult<never>> {
  const session = await getServerSession(ctx.req, ctx.res, authOptions)
  if (!session) {
    return {
      redirect: { destination: '/admin/login', permanent: false },
    }
  }
  return { session }
}
