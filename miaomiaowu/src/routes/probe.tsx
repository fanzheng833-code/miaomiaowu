import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { profileQueryFn } from '@/lib/profile'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ServerForm = {
  key: string
  isManual?: boolean
  server_id: string
  name: string
  traffic_method: string
  monthly_traffic_gb: number | string | null
}

type ProbeForm = {
  probeType: string
  address: string
  servers: ServerForm[]
}

type ProbeConfigResponse = {
  probe_type: string
  address: string
  servers: Array<{
    id: number
    server_id: string
    name: string
    traffic_method: string
    monthly_traffic_gb: number
    position: number
    monthly_traffic_bytes: number
  }>
  created_at?: string
  updated_at?: string
}

type SyncedServer = {
  server_id?: string
  name?: string
  traffic_method?: string
  monthly_traffic_gb?: number
}

const PROBE_TYPES = [
  { value: 'nezha', label: '哪吒面板' },
  { value: 'nezhav0', label: '哪吒 V0' },
  { value: 'dstatus', label: 'DStatus' },
  { value: 'komari', label: 'Komari' },
]

const TRAFFIC_METHODS = [
  { value: 'both', label: '上下行总和' },
  { value: 'up', label: '仅上行' },
  { value: 'down', label: '仅下行' },
]

const PROBE_CONFIG_KEY = ['probe-config'] as const
const EMPTY_PROBE_CONFIG: ProbeConfigResponse = {
  probe_type: 'nezha',
  address: '',
  servers: [],
}

export const Route = createFileRoute('/probe')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: ProbeManagePage,
})

function ProbeManagePage() {
  const { auth } = useAuthStore()
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState<ProbeForm | null>(null)
  const [syncLoading, setSyncLoading] = useState(false)

  const generateKey = () =>
    typeof crypto !== 'undefined' && crypto?.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10)

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
    meta: { showErrorInPage: true },
  })

  const isAdmin = Boolean(profileQuery.data?.is_admin)

  const configQuery = useQuery({
    queryKey: PROBE_CONFIG_KEY,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ config: ProbeConfigResponse }>(
        '/api/admin/probe-config',
        { signal }
      )
      if (!data?.config) throw new Error('探针配置为空')
      return data
    },
    enabled: Boolean(auth.accessToken && isAdmin),
    staleTime: 5 * 60 * 1000,
    retry: false,
    meta: { showErrorInPage: true },
  })

  const config = configQuery.data?.config ?? EMPTY_PROBE_CONFIG
  const savedForm = useMemo<ProbeForm>(() => {
    const normalizedType = (config.probe_type ?? '').toLowerCase().trim()
    const matchedType = PROBE_TYPES.some(
      (item) => item.value === normalizedType
    )
      ? normalizedType
      : EMPTY_PROBE_CONFIG.probe_type

    return {
      probeType: matchedType,
      address: config.address?.trim() ?? '',
      servers: (config.servers ?? []).map((server) => ({
        key: `${server.id ?? server.server_id}-${server.position}`,
        server_id: server.server_id,
        name: server.name,
        traffic_method: server.traffic_method,
        monthly_traffic_gb: Number.isFinite(server.monthly_traffic_gb)
          ? Number(server.monthly_traffic_gb)
          : 0,
      })),
    }
  }, [config])
  const formState = draft ?? savedForm
  const setFormState = (update: (current: ProbeForm) => ProbeForm) =>
    setDraft((current) => update(current ?? savedForm))

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: false,
      }),
    []
  )

  const lastUpdated = useMemo(() => {
    const updatedAt = config.updated_at
    if (!updatedAt || updatedAt === '' || updatedAt.startsWith('0001-01-01')) {
      return null
    }
    const date = new Date(updatedAt)
    if (isNaN(date.getTime())) {
      return null
    }
    return dateFormatter.format(date)
  }, [config.updated_at, dateFormatter])

  const applySavedConfig = async (
    config: ProbeConfigResponse,
    token?: string
  ) => {
    if (useAuthStore.getState().auth.accessToken !== token) return false
    await queryClient.cancelQueries({ queryKey: PROBE_CONFIG_KEY, exact: true })
    if (useAuthStore.getState().auth.accessToken !== token) return false
    queryClient.setQueryData(PROBE_CONFIG_KEY, { config })
    setDraft(null)
    return true
  }

  const mutation = useMutation({
    mutationFn: async (form: ProbeForm) => {
      const payload = {
        probe_type: form.probeType,
        address: form.address.trim(),
        servers: form.servers.map((server) => ({
          server_id: server.server_id.trim(),
          name: server.name.trim(),
          traffic_method: server.traffic_method,
          monthly_traffic_gb: Number(server.monthly_traffic_gb),
        })),
      }

      const response = await api.put('/api/admin/probe-config', payload)
      return response.data as { config: ProbeConfigResponse }
    },
    onMutate: () => auth.accessToken,
    onSuccess: async (data, _form, token) => {
      if (!(await applySavedConfig(data.config, token))) return
      toast.success('探针配置已保存')
      // 使流量汇总数据缓存失效，以便重新获取最新数据
      queryClient.invalidateQueries({ queryKey: ['traffic-summary'] })
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await api.delete('/api/admin/probe-config')
      return response.data
    },
    onMutate: () => auth.accessToken,
    onSuccess: async (_data, _params, token) => {
      if (!(await applySavedConfig(EMPTY_PROBE_CONFIG, token))) return
      toast.success('探针配置已删除')
      queryClient.invalidateQueries({ queryKey: PROBE_CONFIG_KEY })
      queryClient.invalidateQueries({ queryKey: ['traffic-summary'] })
      queryClient.invalidateQueries({ queryKey: ['nodes'] })
    },
    onError: handleServerError,
  })

  const isBusy = syncLoading || mutation.isPending || deleteMutation.isPending

  const handleServerChange = (
    index: number,
    field: 'server_id' | 'name' | 'traffic_method' | 'monthly_traffic_gb',
    value: string
  ) => {
    setFormState((prev) => {
      const servers = [...prev.servers]
      servers[index] = { ...servers[index], [field]: value }
      return { ...prev, servers }
    })
  }

  const handleAddServer = () => {
    const key = generateKey()
    setFormState((prev) => ({
      ...prev,
      servers: [
        ...prev.servers,
        {
          key,
          isManual: true,
          server_id: '',
          name: '',
          traffic_method: 'both',
          monthly_traffic_gb: null,
        },
      ],
    }))
  }

  const handleRemoveServer = (index: number) => {
    setFormState((prev) => {
      const servers = [...prev.servers]
      servers.splice(index, 1)
      return { ...prev, servers }
    })
  }

  const handleSyncServers = async () => {
    if (isBusy) return
    const { address, probeType } = formState
    if (!address.trim()) {
      toast.error('请先填写探针面板地址')
      return
    }

    setSyncLoading(true)
    const token = auth.accessToken
    try {
      const { data } = await api.post<{ servers: SyncedServer[] }>(
        '/api/admin/probe-sync',
        {
          probe_type: probeType,
          address: address.trim().replace(/\/$/, ''),
        }
      )
      if (useAuthStore.getState().auth.accessToken !== token) return
      if (!data?.servers?.length) {
        toast.error('未从面板获取到服务器列表')
        return
      }

      const servers = data.servers.map((server, index) => ({
        key: generateKey(),
        server_id: server.server_id ?? '',
        name: server.name ?? `服务器 ${index + 1}`,
        traffic_method: server.traffic_method ?? 'both',
        monthly_traffic_gb:
          probeType === 'nezhav0'
            ? 0
            : (server.monthly_traffic_gb ??
              (probeType === 'dstatus' ? 0 : null)),
      }))
      setFormState((prev) => ({
        ...prev,
        servers,
      }))
      toast.success('已从面板同步服务器列表')
    } catch (error) {
      if (useAuthStore.getState().auth.accessToken === token) {
        toast.error(
          error instanceof Error
            ? error.message
            : '同步服务器失败，请检查面板地址或网络'
        )
      }
    } finally {
      setSyncLoading(false)
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy) return

    if (!formState.address.trim()) {
      toast.error('请输入探针地址')
      return
    }

    if (!formState.probeType) {
      toast.error('请选择探针类型')
      return
    }

    if (formState.servers.length === 0) {
      toast.error('请至少添加一个服务器节点')
      return
    }

    for (const server of formState.servers) {
      if (!server.server_id.trim()) {
        toast.error('服务器 ID 不能为空')
        return
      }
      if (!server.name.trim()) {
        toast.error('服务器名称不能为空')
        return
      }
      if (!server.traffic_method) {
        toast.error('请选择流量计算方式')
        return
      }
      const monthlyValue = Number(server.monthly_traffic_gb)
      if (!Number.isFinite(monthlyValue) || monthlyValue <= 0) {
        toast.error('请填写服务器月流量（GB）')
        return
      }
    }

    mutation.mutate(formState)
  }

  if (profileQuery.isPending || (isAdmin && configQuery.isPending)) {
    return (
      <div className='bg-background min-h-svh'>
        <main className='mx-auto w-full max-w-5xl px-4 py-8 pt-24 sm:px-6'>
          <Card className='border-dashed shadow-none'>
            <CardHeader>
              <CardTitle>加载中…</CardTitle>
              <CardDescription>正在读取探针配置，请稍候。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                <div className='bg-muted h-10 w-full animate-pulse rounded-md' />
                <div className='bg-muted h-10 w-full animate-pulse rounded-md' />
                <div className='bg-muted h-10 w-full animate-pulse rounded-md' />
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  const profileLoadFailed = profileQuery.isError && !profileQuery.data
  const configLoadFailed = isAdmin && configQuery.isError && !configQuery.data
  if (profileLoadFailed || configLoadFailed) {
    const failedQuery = profileLoadFailed ? profileQuery : configQuery
    return (
      <main className='mx-auto w-full max-w-5xl px-4 py-8 pt-24 sm:px-6'>
        <Card>
          <CardHeader>
            <CardTitle>探针数据源</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-wrap items-center gap-3'>
            <p role='alert' className='text-destructive text-sm'>
              {profileLoadFailed ? '加载账号信息失败。' : '加载探针配置失败。'}
            </p>
            <Button
              type='button'
              variant='outline'
              disabled={failedQuery.isFetching}
              onClick={() => void failedQuery.refetch()}
            >
              {failedQuery.isFetching ? '正在重试…' : '重试'}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!isAdmin) {
    return (
      <div className='bg-background min-h-svh'>
        <main className='mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 py-20 pt-24 text-center sm:px-6'>
          <Card className='w-full border-dashed shadow-none'>
            <CardHeader>
              <CardTitle>权限不足</CardTitle>
              <CardDescription>仅管理员可管理探针数据源配置。</CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className='bg-background min-h-svh'>
      <main className='mx-auto w-full max-w-5xl px-4 py-8 pt-24 sm:px-6'>
        <form className='space-y-8' onSubmit={handleSubmit} noValidate>
          <section className='space-y-2'>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <h1 className='text-3xl font-semibold tracking-tight'>
                  探针数据源
                </h1>
                <p className='text-muted-foreground'>
                  配置 traffic
                  接口所使用的探针类型、面板地址以及参与汇总的服务器列表。
                </p>
              </div>
              <div className='flex gap-2'>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type='button'
                      variant='destructive'
                      disabled={isBusy || !config.address}
                    >
                      {deleteMutation.isPending ? '删除中…' : '删除配置'}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确认删除探针配置</AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作将删除探针配置、所有服务器数据，并解除所有节点与探针的绑定关系。此操作不可撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          if (!isBusy) deleteMutation.mutate()
                        }}
                        disabled={isBusy}
                        className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      >
                        确认删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button type='submit' disabled={isBusy}>
                  {mutation.isPending ? '保存中…' : '保存配置'}
                </Button>
              </div>
            </div>
            {lastUpdated ? (
              <p className='text-muted-foreground text-sm'>
                最近保存：{lastUpdated}
              </p>
            ) : null}
            {mutation.isError && (
              <p role='alert' className='text-destructive text-sm'>
                保存失败，输入已保留，可以重试。
              </p>
            )}
            {configQuery.isError && (
              <div className='flex flex-wrap items-center gap-3'>
                <p role='alert' className='text-destructive text-sm'>
                  刷新探针配置失败，当前输入已保留。
                </p>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={isBusy || configQuery.isFetching}
                  onClick={() => void configQuery.refetch()}
                >
                  {configQuery.isFetching ? '正在重试…' : '重试刷新'}
                </Button>
              </div>
            )}
          </section>

          <Card>
            <CardHeader>
              <CardTitle>探针信息</CardTitle>
              <CardDescription>
                支持哪吒、DStatus、Komari 三种探针类型。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-6'>
              <div className='grid gap-6 sm:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='probe-type'>探针类型</Label>
                  <Select
                    value={formState.probeType}
                    disabled={isBusy}
                    onValueChange={(value) =>
                      setFormState((prev) => ({ ...prev, probeType: value }))
                    }
                  >
                    <SelectTrigger id='probe-type'>
                      <SelectValue placeholder='选择探针类型' />
                    </SelectTrigger>
                    <SelectContent>
                      {PROBE_TYPES.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className='space-y-2'>
                  <Label htmlFor='probe-address'>面板地址</Label>
                  <Input
                    id='probe-address'
                    value={formState.address}
                    disabled={isBusy}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        address: event.target.value,
                      }))
                    }
                    placeholder='例如：https://panel.example.com'
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <CardTitle>服务器列表</CardTitle>
                <CardDescription>
                  根据探针类型填写对应的服务器 ID、名称和流量统计方式。
                </CardDescription>
                <p className='text-destructive mt-2 text-sm font-semibold'>
                  请为每个服务器填写月流量（GB），该字段为必填项。
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                {['dstatus', 'nezha', 'nezhav0', 'komari'].includes(
                  formState.probeType
                ) ? (
                  <Button
                    type='button'
                    variant='secondary'
                    size='sm'
                    onClick={handleSyncServers}
                    disabled={isBusy}
                  >
                    {syncLoading ? '同步中…' : '从面板同步'}
                  </Button>
                ) : null}
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={handleAddServer}
                  disabled={isBusy}
                >
                  <Plus className='mr-2 size-4' />
                  新增服务器
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* 移动端卡片视图 */}
              <div className='space-y-3 md:hidden'>
                {formState.servers.length === 0 ? (
                  <Card>
                    <CardContent className='text-muted-foreground py-8 text-center'>
                      尚未配置服务器，请点击右上角按钮添加。
                    </CardContent>
                  </Card>
                ) : (
                  formState.servers.map((server, index) => {
                    const numericMonthly = Number(server.monthly_traffic_gb)
                    const monthlyInvalid =
                      !Number.isFinite(numericMonthly) || numericMonthly <= 0

                    return (
                      <Card key={server.key} className='overflow-hidden'>
                        <CardContent className='space-y-2 p-3'>
                          {/* 头部：显示名称和删除按钮 */}
                          <div className='flex items-center justify-between'>
                            <div className='mr-2 flex-1 truncate font-medium'>
                              {server.name || '未命名服务器'}
                            </div>
                            <Button
                              type='button'
                              variant='outline'
                              size='icon'
                              className='text-destructive hover:text-destructive hover:bg-destructive/10 size-8 shrink-0'
                              aria-label='删除服务器'
                              onClick={() => handleRemoveServer(index)}
                              disabled={isBusy}
                            >
                              <Trash2 className='size-4' />
                            </Button>
                          </div>

                          {server.isManual ? (
                            <div className='grid grid-cols-2 gap-2'>
                              <div className='min-w-0 space-y-1.5'>
                                <Label
                                  className='text-xs'
                                  htmlFor={`manual-id-${server.key}`}
                                >
                                  服务器 ID
                                </Label>
                                <Input
                                  id={`manual-id-${server.key}`}
                                  aria-label={`服务器 ID ${index + 1}`}
                                  value={server.server_id}
                                  disabled={isBusy}
                                  onChange={(event) =>
                                    handleServerChange(
                                      index,
                                      'server_id',
                                      event.target.value
                                    )
                                  }
                                />
                              </div>
                              <div className='min-w-0 space-y-1.5'>
                                <Label
                                  className='text-xs'
                                  htmlFor={`manual-name-${server.key}`}
                                >
                                  显示名称
                                </Label>
                                <Input
                                  id={`manual-name-${server.key}`}
                                  aria-label={`显示名称 ${index + 1}`}
                                  value={server.name}
                                  disabled={isBusy}
                                  onChange={(event) =>
                                    handleServerChange(
                                      index,
                                      'name',
                                      event.target.value
                                    )
                                  }
                                />
                              </div>
                            </div>
                          ) : (
                            <div className='flex items-start gap-2 text-xs'>
                              <span className='text-muted-foreground min-w-[60px] shrink-0'>
                                服务器 ID
                              </span>
                              <span className='min-w-0 flex-1 font-mono break-all'>
                                {server.server_id}
                              </span>
                            </div>
                          )}

                          {/* 可编辑字段 - 流量统计和月流量在同一行 */}
                          <div className='grid grid-cols-2 gap-2 pt-1'>
                            <div className='space-y-1.5'>
                              <Label className='text-muted-foreground text-xs'>
                                流量统计
                              </Label>
                              <Select
                                value={server.traffic_method}
                                disabled={isBusy}
                                onValueChange={(value) =>
                                  handleServerChange(
                                    index,
                                    'traffic_method',
                                    value
                                  )
                                }
                              >
                                <SelectTrigger className='h-9'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TRAFFIC_METHODS.map((item) => (
                                    <SelectItem
                                      key={item.value}
                                      value={item.value}
                                    >
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className='space-y-1.5'>
                              <Label className='text-muted-foreground text-xs'>
                                月流量 (GB){' '}
                                <span className='text-destructive'>*</span>
                              </Label>
                              <Input
                                type='number'
                                inputMode='decimal'
                                min={0}
                                step='0.01'
                                aria-label={`月流量 ${index + 1}`}
                                value={server.monthly_traffic_gb ?? ''}
                                disabled={isBusy}
                                onChange={(event) =>
                                  handleServerChange(
                                    index,
                                    'monthly_traffic_gb',
                                    event.target.value
                                  )
                                }
                                className={
                                  monthlyInvalid
                                    ? 'border-destructive focus-visible:ring-destructive/80 h-9 focus-visible:ring-2'
                                    : 'h-9'
                                }
                                aria-invalid={monthlyInvalid}
                                placeholder='必填'
                                required
                                title='请填写服务器的月流量（GB）'
                              />
                            </div>
                          </div>
                          {monthlyInvalid && (
                            <p className='text-destructive text-xs font-semibold'>
                              请输入该服务器的月流量（GB）
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    )
                  })
                )}
              </div>

              {/* 桌面端表格视图 */}
              <div className='hidden max-h-[600px] overflow-x-auto overflow-y-auto md:block'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='min-w-[120px]'>服务器 ID</TableHead>
                      <TableHead className='min-w-[120px]'>显示名称</TableHead>
                      <TableHead className='w-[120px] min-w-[100px]'>
                        流量统计
                      </TableHead>
                      <TableHead className='w-[150px] min-w-[120px]'>
                        <span className='flex items-center gap-1'>
                          月流量 (GB)
                          <span className='text-destructive'>*</span>
                        </span>
                      </TableHead>
                      <TableHead className='w-[60px]' />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {formState.servers.map((server, index) => {
                      const numericMonthly = Number(server.monthly_traffic_gb)
                      const monthlyInvalid =
                        !Number.isFinite(numericMonthly) || numericMonthly <= 0

                      return (
                        <TableRow key={server.key}>
                          <TableCell>
                            <Input
                              aria-label={`服务器 ID ${index + 1}`}
                              value={server.server_id}
                              disabled={isBusy || !server.isManual}
                              onChange={(event) =>
                                handleServerChange(
                                  index,
                                  'server_id',
                                  event.target.value
                                )
                              }
                              placeholder='服务器唯一 ID'
                              className={
                                server.isManual
                                  ? undefined
                                  : 'bg-muted/60 text-muted-foreground'
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              aria-label={`显示名称 ${index + 1}`}
                              value={server.name}
                              disabled={isBusy || !server.isManual}
                              onChange={(event) =>
                                handleServerChange(
                                  index,
                                  'name',
                                  event.target.value
                                )
                              }
                              placeholder='用于展示的名称'
                              className={
                                server.isManual
                                  ? undefined
                                  : 'bg-muted/60 text-muted-foreground'
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={server.traffic_method}
                              disabled={isBusy}
                              onValueChange={(value) =>
                                handleServerChange(
                                  index,
                                  'traffic_method',
                                  value
                                )
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TRAFFIC_METHODS.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Input
                              type='number'
                              inputMode='decimal'
                              min={0}
                              step='0.01'
                              aria-label={`月流量 ${index + 1}`}
                              value={server.monthly_traffic_gb ?? ''}
                              disabled={isBusy}
                              onChange={(event) =>
                                handleServerChange(
                                  index,
                                  'monthly_traffic_gb',
                                  event.target.value
                                )
                              }
                              className={
                                monthlyInvalid
                                  ? 'border-destructive focus-visible:ring-destructive/80 focus-visible:ring-2'
                                  : undefined
                              }
                              aria-invalid={monthlyInvalid}
                              placeholder='必填'
                              required
                              title='请填写服务器的月流量（GB）'
                            />
                            {monthlyInvalid && (
                              <p className='text-destructive mt-1 text-xs font-semibold'>
                                请输入月流量
                              </p>
                            )}
                          </TableCell>
                          <TableCell className='text-right'>
                            <Button
                              type='button'
                              variant='outline'
                              size='icon'
                              className='text-destructive hover:text-destructive hover:bg-destructive/10'
                              aria-label='删除服务器'
                              onClick={() => handleRemoveServer(index)}
                              disabled={isBusy}
                            >
                              <Trash2 className='size-4' />
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    {formState.servers.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className='text-muted-foreground py-10 text-center'
                        >
                          尚未配置服务器，请点击右上角按钮添加。
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </form>
      </main>
    </div>
  )
}
