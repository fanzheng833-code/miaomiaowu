// @ts-nocheck
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { toast } from 'sonner'
import { DataTable } from '@/components/data-table'
import type { DataTableColumn } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { profileQueryFn } from '@/lib/profile'
import { useAuthStore } from '@/stores/auth-store'
import { Pencil } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// @ts-ignore - retained simple route definition
export const Route = createFileRoute('/users')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: UsersPage,
})

type UserRow = {
  username: string
  email: string
  nickname: string
  role: string
  is_active: boolean
  remark: string
  custom_user_short_code?: string
  // 订阅获取开关:on / off;限时打开时 subscription_fetch_until 为到期时刻(unix 秒)
  subscription_fetch?: string
  subscription_fetch_until?: number
}

type AccountStatusFilter = 'all' | 'active' | 'disabled'

type SubscriptionFetchPayload = {
  username: string
  enabled: boolean
  duration_seconds?: number
}

type ResetState = {
  username: string
  password: string
}

type CreateState = {
  username: string
  email: string
  nickname: string
  password: string
  remark: string
  subscriptionIds: number[]
}

type SubscriptionManageState = {
  username: string
  selectedIds: number[] | null
}

type SubscribeFile = {
  id: number
  name: string
  description?: string
  type: string
  filename: string
  url: string
  created_at?: string
  updated_at?: string
}

// 限时打开可选时长,后端限制 60 秒 ~ 7 天
const SUBSCRIPTION_FETCH_DURATIONS = [
  { label: '10 分钟', seconds: 600 },
  { label: '1 小时', seconds: 3600 },
  { label: '1 天', seconds: 86400 },
  { label: '7 天', seconds: 7 * 86400 },
]

const formatFetchUntil = (until: number) =>
  new Date(until * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// 订阅获取开关:关掉后该用户的所有订阅链接一律 403;限时打开到期自动回到关闭。
function SubscriptionFetchControl({
  user,
  pending,
  onChange,
}: {
  user: UserRow
  pending: boolean
  onChange: (payload: SubscriptionFetchPayload) => void
}) {
  const [open, setOpen] = useState(false)
  const enabled = user.subscription_fetch !== 'off'
  const until = user.subscription_fetch_until ?? 0
  return (
    <div className='flex items-center gap-2'>
      <Switch
        checked={enabled}
        disabled={pending}
        onCheckedChange={(checked) => onChange({ username: user.username, enabled: checked })}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant='ghost' size='sm' className='h-7 px-2 text-xs' disabled={pending}>
            {enabled && until > 0 ? (
              <span className='text-muted-foreground'>{formatFetchUntil(until)} 自动关</span>
            ) : (
              '限时打开'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-40 p-2' align='start'>
          <div className='space-y-1'>
            <Label className='text-xs'>限时打开，到期自动关闭</Label>
            {SUBSCRIPTION_FETCH_DURATIONS.map((item) => (
              <Button
                key={item.seconds}
                size='sm'
                variant='outline'
                className='h-7 w-full text-xs'
                disabled={pending}
                onClick={() => {
                  onChange({ username: user.username, enabled: true, duration_seconds: item.seconds })
                  setOpen(false)
                }}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const generatePassword = (length = 12) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

function UsersPage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>('all')
  const [resetState, setResetState] = useState<ResetState | null>(null)
  const [deleteUsername, setDeleteUsername] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createState, setCreateState] = useState<CreateState>({
    username: '',
    email: '',
    nickname: '',
    password: generatePassword(),
    remark: '',
    subscriptionIds: [],
  })
  const [subscriptionManageState, setSubscriptionManageState] = useState<SubscriptionManageState | null>(null)
  const [remarkEditState, setRemarkEditState] = useState<{ username: string; remark: string } | null>(null)
  const [customCodeEditUser, setCustomCodeEditUser] = useState<string | null>(null)
  const [customCodeInput, setCustomCodeInput] = useState('')

  const { data: profile, isLoading: profileLoading, isError: profileError } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const isAdmin = Boolean(profile?.is_admin)

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: async ({ signal }) => {
      const response = await api.get<{ users: UserRow[] }>('/api/admin/users', {
        signal,
      })
      return response.data
    },
    enabled: Boolean(isAdmin && auth.accessToken),
    staleTime: 30 * 1000,
    meta: { showErrorInPage: true },
  })

  const subscriptionsQuery = useQuery({
    queryKey: ['admin-all-subscriptions'],
    queryFn: async ({ signal }) => {
      const response = await api.get<{ subscriptions: SubscribeFile[] }>(
        '/api/subscriptions',
        { signal }
      )
      return response.data?.subscriptions ?? []
    },
    enabled: Boolean(isAdmin && auth.accessToken),
    staleTime: 60 * 1000,
    meta: { showErrorInPage: true },
  })

  const userSubscriptionsQuery = useQuery({
    queryKey: ['user-subscriptions', subscriptionManageState?.username],
    queryFn: async ({ signal }) => {
      if (!subscriptionManageState?.username) return { subscription_ids: [] }
      const response = await api.get<{ subscription_ids: number[] }>(
        `/api/admin/users/${subscriptionManageState.username}/subscriptions`,
        { signal }
      )
      return response.data
    },
    enabled: Boolean(subscriptionManageState?.username && isAdmin && auth.accessToken),
    staleTime: 30 * 1000,
    meta: { showErrorInPage: true },
  })

  const statusMutation = useMutation({
    mutationFn: async (payload: { username: string; is_active: boolean }) => {
      await api.post('/api/admin/users/status', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('用户状态已更新')
    },
    onError: handleServerError,
  })

  const resetMutation = useMutation({
    mutationFn: async (payload: ResetState) => {
      const response = await api.post('/api/admin/users/reset-password', {
        username: payload.username,
        new_password: payload.password,
      })
      return response.data as { username: string; password: string }
    },
    onSuccess: (data) => {
      toast.success('密码已重置')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setResetState(null)

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(data.password).catch(() => null)
      }
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (username: string) => {
      await api.post('/api/admin/users/delete', { username })
    },
    onSuccess: () => {
      toast.success('用户已删除')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setDeleteUsername(null)
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const createMutation = useMutation({
    mutationFn: async (payload: CreateState) => {
      // 创建用户
      const response = await api.post('/api/admin/users/create', {
        username: payload.username,
        email: payload.email,
        nickname: payload.nickname,
        password: payload.password,
        remark: payload.remark,
      })
      const userData = response.data as { username: string; email: string; nickname: string; role: string; password: string }

      // 如果选择了订阅，分配给用户
      if (payload.subscriptionIds.length > 0) {
        await api.put(`/api/admin/users/${userData.username}/subscriptions`, {
          subscription_ids: payload.subscriptionIds,
        })
      }

      return userData
    },
    onSuccess: (data) => {
      toast.success('用户已创建，初始密码已复制')
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setCreateOpen(false)
      setCreateState({ username: '', email: '', nickname: '', password: generatePassword(), remark: '', subscriptionIds: [] })

      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(data.password).catch(() => null)
      }
    },
    onError: (error) => {
      handleServerError(error)
    },
  })

  const updateSubscriptionsMutation = useMutation({
    mutationFn: async (payload: { username: string; subscription_ids: number[] }) => {
      await api.put(`/api/admin/users/${payload.username}/subscriptions`, {
        subscription_ids: payload.subscription_ids,
      })
    },
    onSuccess: (_, variables) => {
      toast.success('订阅已更新')
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions', variables.username] })
      setSubscriptionManageState(null)
    },
    onError: handleServerError,
  })

  const remarkMutation = useMutation({
    mutationFn: async (payload: { username: string; remark: string }) => {
      await api.post('/api/admin/users/remark', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('备注已更新')
      setRemarkEditState(null)
    },
    onError: handleServerError,
  })

  const customCodeMutation = useMutation({
    mutationFn: async (payload: { username: string; custom_short_code: string }) => {
      await api.post('/api/admin/users/custom-short-code', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      queryClient.invalidateQueries({ queryKey: ['user-subscriptions'] })
      toast.success('自定义连接已更新')
      setCustomCodeEditUser(null)
      setCustomCodeInput('')
    },
    onError: handleServerError,
  })

  const subscriptionFetchMutation = useMutation({
    mutationFn: async (payload: SubscriptionFetchPayload) => {
      await api.post('/api/admin/users/subscription-fetch', payload)
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success(payload.enabled ? '订阅获取已打开' : '订阅获取已关闭，该用户的订阅链接将被拒绝')
    },
    onError: handleServerError,
  })

  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data])
  const searchTerm = search.trim().toLowerCase()
  const hasFilter = Boolean(searchTerm) || statusFilter !== 'all'
  const visibleUsers = useMemo(
    () =>
      users.filter((user) => {
        if (statusFilter !== 'all' && user.is_active !== (statusFilter === 'active')) {
          return false
        }
        return (
          !searchTerm ||
          [user.username, user.nickname, user.email, user.remark].some((value) =>
            value?.toLowerCase().includes(searchTerm)
          )
        )
      }),
    [users, searchTerm, statusFilter]
  )
  const subscriptionEditorError =
    subscriptionsQuery.isError || userSubscriptionsQuery.isError
  const subscriptionEditorReady = Boolean(
    subscriptionManageState &&
      subscriptionsQuery.isSuccess &&
      userSubscriptionsQuery.isSuccess &&
      !userSubscriptionsQuery.isFetching
  )
  const savedSubscriptionIds = userSubscriptionsQuery.data?.subscription_ids ?? []
  const selectedSubscriptionIds =
    subscriptionManageState?.selectedIds ?? savedSubscriptionIds

  const toggleSubscriptionSelection = (id: number, nextState?: boolean) => {
    if (!subscriptionEditorReady) return
    setSubscriptionManageState((prev) => {
      if (!prev) return prev
      const previousIds = prev.selectedIds ?? savedSubscriptionIds
      const alreadySelected = previousIds.includes(id)
      const shouldSelect = nextState ?? !alreadySelected
      if (shouldSelect === alreadySelected) return prev
      const selectedIds = shouldSelect
        ? [...previousIds, id]
        : previousIds.filter((existingId) => existingId !== id)
      return { ...prev, selectedIds }
    })
  }

  if (profileLoading) {
    return (
      <div className='min-h-svh bg-background'>
        <main className='mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 pt-24'>
          <Card className='shadow-none border-dashed'>
            <CardHeader>
              <CardTitle>加载中…</CardTitle>
              <CardDescription>正在获取管理员信息，请稍候。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
                <div className='h-10 w-full rounded-md bg-muted animate-pulse' />
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  if (!isAdmin || profileError) {
    return (
      <div className='min-h-svh bg-background'>
        <main className='mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 py-20 text-center sm:px-6 pt-24'>
          <Card className='w-full shadow-none border-dashed'>
            <CardHeader>
              <CardTitle>权限不足</CardTitle>
              <CardDescription>只有管理员可以访问用户管理页面。</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className='min-h-svh bg-background'>
      <main className='mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 pt-24'>
        <section className='space-y-3'>
          <h1 className='text-3xl font-semibold tracking-tight'>用户管理</h1>
          <p className='text-muted-foreground'>查看系统用户，调整启用状态并重置密码。</p>
        </section>

        <Card className='mt-8'>
          <CardHeader>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <CardTitle>账号列表</CardTitle>
                <CardDescription>仅管理员可更改用户状态或重置密码。</CardDescription>
              </div>
              <Button
                size='sm'
                onClick={() => {
                  setCreateState({ username: '', email: '', nickname: '', password: generatePassword(), subscriptionIds: [] })
                  setCreateOpen(true)
                }}
              >
                新增用户
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {usersQuery.isError && (
              <div className='mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2'>
                <p role='alert' className='text-destructive text-sm'>
                  {usersQuery.data
                    ? '账号列表更新失败，当前显示上次加载的结果。'
                    : '加载账号列表失败。'}
                </p>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={usersQuery.isFetching}
                  onClick={() => void usersQuery.refetch()}
                >
                  {usersQuery.isFetching ? '正在重试…' : '重试'}
                </Button>
              </div>
            )}
            {usersQuery.isLoading && (
              <p role='status' className='text-muted-foreground py-8 text-center'>
                正在加载账号列表…
              </p>
            )}
            {users.length > 0 && (
              <div className='mb-4 space-y-2'>
                <div className='grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto]'>
                  <div className='min-w-0 space-y-1.5'>
                    <Label htmlFor='account-search'>搜索账号</Label>
                    <Input
                      id='account-search'
                      type='search'
                      placeholder='用户名、昵称、邮箱或备注'
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <div className='space-y-1.5'>
                    <Label htmlFor='account-status-filter'>账号状态</Label>
                    <Select
                      value={statusFilter}
                      onValueChange={(value) =>
                        setStatusFilter(value as AccountStatusFilter)
                      }
                    >
                      <SelectTrigger id='account-status-filter' className='w-full'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='all'>全部状态</SelectItem>
                        <SelectItem value='active'>已启用</SelectItem>
                        <SelectItem value='disabled'>已禁用</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    className='w-fit'
                    disabled={!search && statusFilter === 'all'}
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('all')
                    }}
                  >
                    重置筛选
                  </Button>
                </div>
                {hasFilter && (
                  <p role='status' className='text-muted-foreground text-sm'>
                    显示 {visibleUsers.length} 个，共 {users.length} 个账号
                  </p>
                )}
              </div>
            )}
            {usersQuery.data && <DataTable
              data={visibleUsers}
              getRowKey={(user) => user.username}
              emptyText={
                hasFilter && users.length > 0
                  ? '没有符合筛选条件的账号'
                  : '当前没有可显示的用户'
              }

              columns={[
                {
                  header: '用户名',
                  cell: (user) => user.username,
                  cellClassName: 'font-medium',
                  width: '160px'
                },
                {
                  header: '昵称',
                  cell: (user) => user.nickname || '—',
                  width: '160px'
                },
                {
                  header: '邮箱',
                  cell: (user) => user.email || '—',
                  cellClassName: 'text-muted-foreground',
                  width: '200px'
                },
                {
                  header: '备注',
                  cell: (user) => (
                    <div className='flex items-center gap-2'>
                      <span className='truncate max-w-[150px]' title={user.remark}>{user.remark || '—'}</span>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-6 w-6 shrink-0'
                        onClick={() => setRemarkEditState({ username: user.username, remark: user.remark || '' })}
                      >
                        <Pencil className='h-3 w-3' />
                      </Button>
                    </div>
                  ),
                  width: '200px'
                },
                {
                  header: '自定义连接',
                  cell: (user) => {
                    const code = user.custom_user_short_code || ''
                    return (
                      <Popover
                        open={customCodeEditUser === user.username}
                        onOpenChange={(open) => {
                          if (open) {
                            setCustomCodeEditUser(user.username)
                            setCustomCodeInput(code)
                          } else {
                            setCustomCodeEditUser(null)
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button variant='ghost' size='sm' className='h-7 px-2 font-mono text-xs'>
                            {code ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>{code.length > 6 ? code.slice(0, 6) + '…' : code}</span>
                                </TooltipTrigger>
                                {code.length > 6 && <TooltipContent>{code}</TooltipContent>}
                              </Tooltip>
                            ) : (
                              <span className='text-muted-foreground'>设置</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className='w-64 p-3' align='start'>
                          <div className='space-y-2'>
                            <Label className='text-xs'>自定义用户连接</Label>
                            <Input
                              value={customCodeInput}
                              onChange={(e) => setCustomCodeInput(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                              placeholder='仅字母数字，留空清除'
                              className='h-8 text-xs font-mono'
                            />
                            <div className='flex gap-2'>
                              <Button
                                size='sm'
                                className='h-7 flex-1 text-xs'
                                disabled={customCodeMutation.isPending}
                                onClick={() => customCodeMutation.mutate({ username: user.username, custom_short_code: customCodeInput })}
                              >
                                保存
                              </Button>
                              {code && (
                                <Button
                                  size='sm'
                                  variant='outline'
                                  className='h-7 text-xs'
                                  disabled={customCodeMutation.isPending}
                                  onClick={() => customCodeMutation.mutate({ username: user.username, custom_short_code: '' })}
                                >
                                  清除
                                </Button>
                              )}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )
                  },
                  width: '140px'
                },
                {
                  header: '角色',
                  cell: (user) => {
                    const isAdminRow = user.role === 'admin'
                    return <span className='text-sm font-medium'>{isAdminRow ? '管理员' : '普通用户'}</span>
                  },
                  headerClassName: 'text-center',
                  cellClassName: 'text-center',
                  width: '100px'
                },
                {
                  header: '状态',
                  cell: (user) => {
                    const isSelf = user.username === profile?.username
                    const isAdminRow = user.role === 'admin'
                    return (
                      <Switch
                        checked={user.is_active}
                        disabled={statusMutation.isPending || isSelf || isAdminRow}
                        onCheckedChange={(checked) =>
                          statusMutation.mutate({
                            username: user.username,
                            is_active: checked,
                          })
                        }
                      />
                    )
                  },
                  headerClassName: 'text-center',
                  cellClassName: 'text-center',
                  width: '100px'
                },
                {
                  header: '订阅获取',
                  cell: (user) => (
                    <SubscriptionFetchControl
                      user={user}
                      pending={subscriptionFetchMutation.isPending}
                      onChange={(payload) => subscriptionFetchMutation.mutate(payload)}
                    />
                  ),
                  width: '180px'
                },
                {
                  header: '操作',
                  cell: (user) => {
                    const isAdminRow = user.role === 'admin'
                    return isAdminRow ? (
                      <span className='text-sm text-muted-foreground'>—</span>
                    ) : (
                      <div className='flex items-center justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={resetMutation.isPending}
                          onClick={() =>
                            setResetState({
                              username: user.username,
                              password: generatePassword(),
                            })
                          }
                        >
                          重置密码
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            setSubscriptionManageState({
                              username: user.username,
                              selectedIds: null,
                            })
                          }
                        >
                          管理订阅
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          disabled={deleteMutation.isPending}
                          onClick={() => setDeleteUsername(user.username)}
                        >
                          删除
                        </Button>
                      </div>
                    )
                  },
                  headerClassName: 'text-right',
                  cellClassName: 'text-right',
                  width: '360px'
                }
              ] as DataTableColumn<UserRow>[]}

              mobileCard={{
                header: (user) => {
                  const isAdminRow = user.role === 'admin'
                  return (
                    <div>
                      <div className='flex items-center justify-between mb-1'>
                        <div className='font-medium text-sm'>{user.username}</div>
                        <Badge variant={isAdminRow ? 'default' : 'secondary'} className='text-xs'>
                          {isAdminRow ? '管理员' : '普通用户'}
                        </Badge>
                      </div>
                      {user.nickname && (
                        <div className='text-xs text-muted-foreground line-clamp-1'>{user.nickname}</div>
                      )}
                    </div>
                  )
                },
                fields: [
                  {
                    label: '邮箱',
                    value: (user) => <span className='break-all'>{user.email || '—'}</span>
                  },
                  {
                    label: '备注',
                    value: (user) => (
                      <div className='flex items-center gap-2'>
                        <span className='truncate'>{user.remark || '—'}</span>
                        <Button
                          variant='ghost'
                          size='icon'
                          className='h-6 w-6 shrink-0'
                          onClick={() => setRemarkEditState({ username: user.username, remark: user.remark || '' })}
                        >
                          <Pencil className='h-3 w-3' />
                        </Button>
                      </div>
                    )
                  },
                  {
                    label: '状态',
                    value: (user) => {
                      const isSelf = user.username === profile?.username
                      const isAdminRow = user.role === 'admin'
                      return (
                        <div className='flex items-center gap-2'>
                          <Switch
                            checked={user.is_active}
                            disabled={statusMutation.isPending || isSelf || isAdminRow}
                            onCheckedChange={(checked) =>
                              statusMutation.mutate({
                                username: user.username,
                                is_active: checked,
                              })
                            }
                          />
                          <span>{user.is_active ? '启用' : '禁用'}</span>
                        </div>
                      )
                    }
                  },
                  {
                    label: '订阅获取',
                    value: (user) => (
                      <SubscriptionFetchControl
                        user={user}
                        pending={subscriptionFetchMutation.isPending}
                        onChange={(payload) => subscriptionFetchMutation.mutate(payload)}
                      />
                    )
                  }
                ],
                actions: (user) => {
                  const isAdminRow = user.role === 'admin'
                  return isAdminRow ? null : (
                    <>
                      <Button
                        variant='outline'
                        size='sm'
                        className='flex-1'
                        disabled={resetMutation.isPending}
                        onClick={() =>
                          setResetState({
                            username: user.username,
                            password: generatePassword(),
                          })
                        }
                      >
                        重置密码
                      </Button>
                      <Button
                        variant='outline'
                        size='sm'
                        className='flex-1'
                        onClick={() =>
                          setSubscriptionManageState({
                            username: user.username,
                            selectedIds: null,
                          })
                        }
                      >
                        管理订阅
                      </Button>
                      <Button
                        variant='destructive'
                        size='sm'
                        className='flex-1'
                        disabled={deleteMutation.isPending}
                        onClick={() => setDeleteUsername(user.username)}
                      >
                        删除
                      </Button>
                    </>
                  )
                }
              }}
            />}
          </CardContent>
        </Card>
      </main>

      <Dialog open={createOpen} onOpenChange={(open) => setCreateOpen(open)}>
        <DialogContent className='sm:max-w-lg max-h-[90vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>新增用户</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='create-username'>用户名</Label>
              <Input
                id='create-username'
                value={createState.username}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => {
                    const value = event.target.value
                    const shouldSyncNickname = prev.nickname === '' || prev.nickname === prev.username
                    return {
                      ...prev,
                      username: value,
                      nickname: shouldSyncNickname ? value : prev.nickname,
                    }
                  })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-email'>邮箱</Label>
              <Input
                id='create-email'
                type='email'
                value={createState.email}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-nickname'>昵称</Label>
              <Input
                id='create-nickname'
                value={createState.nickname}
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, nickname: event.target.value }))
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-password'>初始密码</Label>
              <Input
                id='create-password'
                type='text'
                value={createState.password}
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, password: event.target.value }))
                }
              />
              <p className='text-xs text-muted-foreground'>默认生成随机密码，可在创建前自行调整。</p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='create-remark'>备注（可选）</Label>
              <Input
                id='create-remark'
                value={createState.remark}
                placeholder='输入备注信息'
                autoComplete='off'
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, remark: event.target.value }))
                }
              />
            </div>
            <div className='space-y-3'>
              <Label>分配订阅（可选）</Label>
              {subscriptionsQuery.isError ? (
                <div className='flex flex-wrap items-center gap-2'>
                  <p role='alert' className='text-destructive text-sm'>
                    加载可用订阅失败。
                  </p>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={subscriptionsQuery.isFetching}
                    onClick={() => void subscriptionsQuery.refetch()}
                  >
                    {subscriptionsQuery.isFetching ? '正在重试…' : '重试'}
                  </Button>
                </div>
              ) : subscriptionsQuery.isLoading ? (
                <div className='text-sm text-muted-foreground'>加载订阅列表...</div>
              ) : subscriptionsQuery.data && subscriptionsQuery.data.length > 0 ? (
                <div className='space-y-2 max-h-60 overflow-y-auto border rounded-md p-3'>
                  {subscriptionsQuery.data.map((sub) => (
                    <div key={sub.id} className='flex items-start space-x-3 py-2'>
                      <Checkbox
                        id={`create-sub-${sub.id}`}
                        checked={createState.subscriptionIds.includes(sub.id)}
                        onCheckedChange={(checked) => {
                          setCreateState((prev) => {
                            const newIds = checked
                              ? [...prev.subscriptionIds, sub.id]
                              : prev.subscriptionIds.filter((id) => id !== sub.id)
                            return { ...prev, subscriptionIds: newIds }
                          })
                        }}
                      />
                      <div className='grid gap-1.5 leading-none flex-1'>
                        <label
                          htmlFor={`create-sub-${sub.id}`}
                          className='text-sm font-medium leading-none cursor-pointer'
                        >
                          {sub.name}
                        </label>
                        {sub.description && (
                          <p className='text-sm text-muted-foreground'>{sub.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>暂无可用订阅</div>
              )}
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={createMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!createState.username || createMutation.isPending}
              onClick={() => createMutation.mutate(createState)}
            >
              {createMutation.isPending ? '创建中…' : '确认创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetState)} onOpenChange={(open) => (open ? null : setResetState(null))}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={resetState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='new-password'>新密码</Label>
              <Input
                id='new-password'
                type='text'
                value={resetState?.password ?? ''}
                onChange={(event) =>
                  setResetState((prev) =>
                    prev
                      ? {
                          ...prev,
                          password: event.target.value,
                        }
                      : prev
                  )
                }
              />
              <p className='text-xs text-muted-foreground'>默认生成随机密码，可自行修改后确认。</p>
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={resetMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!resetState?.password || resetMutation.isPending}
              onClick={() => resetState && resetMutation.mutate(resetState)}
            >
              {resetMutation.isPending ? '重置中…' : '确认重置'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(subscriptionManageState)}
        onOpenChange={(open) => !open && setSubscriptionManageState(null)}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>管理订阅</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={subscriptionManageState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-3'>
              <Label>可用订阅</Label>
              {subscriptionEditorError ? (
                <div className='flex flex-wrap items-center gap-2'>
                  <p role='alert' className='text-destructive text-sm'>
                    加载订阅或已有分配失败。
                  </p>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={subscriptionsQuery.isFetching || userSubscriptionsQuery.isFetching}
                    onClick={() => {
                      if (subscriptionsQuery.isError) void subscriptionsQuery.refetch()
                      if (userSubscriptionsQuery.isError) void userSubscriptionsQuery.refetch()
                    }}
                  >
                    重试
                  </Button>
                </div>
              ) : !subscriptionEditorReady ? (
                <p role='status' className='text-muted-foreground text-sm'>
                  正在加载订阅和已有分配…
                </p>
              ) : subscriptionsQuery.data && subscriptionsQuery.data.length > 0 ? (
                <div className='space-y-2 max-h-80 overflow-y-auto border rounded-md p-3'>
                  {subscriptionsQuery.data.map((sub) => {
                    const isChecked = selectedSubscriptionIds.includes(sub.id)
                    return (
                      <div
                        key={sub.id}
                        role='checkbox'
                        tabIndex={0}
                        aria-checked={isChecked}
                        aria-labelledby={`sub-${sub.id}-label`}
                        className='flex cursor-pointer items-start space-x-3 rounded-md px-3 py-2 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
                        onClick={() => toggleSubscriptionSelection(sub.id)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) {
                            return
                          }
                          if (event.key === ' ' || event.key === 'Enter') {
                            event.preventDefault()
                            toggleSubscriptionSelection(sub.id)
                          }
                        }}
                      >
                        <div onClick={(event) => event.stopPropagation()} className='pt-0.5'>
                          <Checkbox
                            id={`sub-${sub.id}`}
                            checked={isChecked}
                            onCheckedChange={(checked) => toggleSubscriptionSelection(sub.id, checked === true)}
                          />
                        </div>
                        <div className='grid gap-1.5 leading-none flex-1'>
                          <label
                            id={`sub-${sub.id}-label`}
                            className='text-sm font-medium leading-none cursor-pointer'
                          >
                            {sub.name}
                          </label>
                          {sub.description && (
                            <p className='text-sm text-muted-foreground'>{sub.description}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>暂无可用订阅</div>
              )}
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={updateSubscriptionsMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={!subscriptionEditorReady || updateSubscriptionsMutation.isPending}
              onClick={() => {
                if (subscriptionEditorReady && subscriptionManageState) {
                  updateSubscriptionsMutation.mutate({
                    username: subscriptionManageState.username,
                    subscription_ids: selectedSubscriptionIds,
                  })
                }
              }}
            >
              {updateSubscriptionsMutation.isPending ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteUsername)} onOpenChange={(open) => !open && setDeleteUsername(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>确认删除用户</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <p className='text-sm text-muted-foreground'>
              确定要删除用户 <strong>{deleteUsername}</strong> 吗？此操作将删除该用户的所有数据，包括：
            </p>
            <ul className='list-disc list-inside text-sm text-muted-foreground space-y-1'>
              <li>用户账号信息</li>
              <li>订阅绑定关系</li>
              <li>保存的节点</li>
              <li>外部订阅</li>
              <li>用户设置</li>
            </ul>
            <p className='text-sm text-destructive font-medium'>此操作不可撤销！</p>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={deleteMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              variant='destructive'
              disabled={deleteMutation.isPending}
              onClick={() => deleteUsername && deleteMutation.mutate(deleteUsername)}
            >
              {deleteMutation.isPending ? '删除中…' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(remarkEditState)} onOpenChange={(open) => !open && setRemarkEditState(null)}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>编辑备注</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>用户名</Label>
              <Input value={remarkEditState?.username ?? ''} readOnly disabled />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-remark'>备注</Label>
              <Input
                id='edit-remark'
                value={remarkEditState?.remark ?? ''}
                placeholder='输入备注信息'
                onChange={(event) =>
                  setRemarkEditState((prev) =>
                    prev ? { ...prev, remark: event.target.value } : prev
                  )
                }
              />
            </div>
          </div>
          <DialogFooter className='gap-2'>
            <DialogClose asChild>
              <Button type='button' variant='outline' disabled={remarkMutation.isPending}>
                取消
              </Button>
            </DialogClose>
            <Button
              type='button'
              disabled={remarkMutation.isPending}
              onClick={() => remarkEditState && remarkMutation.mutate(remarkEditState)}
            >
              {remarkMutation.isPending ? '保存中…' : '确认保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
