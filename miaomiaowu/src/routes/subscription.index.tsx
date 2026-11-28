import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  Copy,
  Download,
  Monitor,
  Network,
  QrCode,
  Search,
  Smartphone,
  X,
} from 'lucide-react'
import { QRCodeCanvas } from 'qrcode.react'
import { toast } from 'sonner'
// Import local icons
import clashIcon from '@/assets/icons/clash_color.png'
import egernIcon from '@/assets/icons/egern_color.png'
import loonIcon from '@/assets/icons/loon_color.png'
import meowxIcon from '@/assets/icons/meowx_color.png'
import quanxIcon from '@/assets/icons/quanx_color.png'
import shadowrocketIcon from '@/assets/icons/shadowrocket_color.png'
import singboxIcon from '@/assets/icons/sing-box_color.png'
import stashIcon from '@/assets/icons/stash_color.png'
import surfboardIcon from '@/assets/icons/surfboard_color.png'
import surgeIcon from '@/assets/icons/surge_color.png'
import surgeMacIcon from '@/assets/icons/surgeformac_icon_color.png'
import uriIcon from '@/assets/icons/uri-color.svg'
import v2rayIcon from '@/assets/icons/v2ray_color.png'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export const Route = createFileRoute('/subscription/')({
  beforeLoad: () => {
    const token = useAuthStore.getState().auth.accessToken
    if (!token) {
      throw redirect({ to: '/' })
    }
  },
  component: SubscriptionPage,
})

type SubscribeFile = {
  id: number
  name: string
  description: string
  type: string
  filename: string
  file_short_code?: string
  custom_short_code?: string
  raw_output?: boolean
  expire_at?: string | null
  created_at: string
  updated_at: string
  latest_version?: number
}

const ICON_MAP: Record<string, typeof Smartphone> = {
  clash: Smartphone,
  'openclash-redirhost': Network,
  'openclash-fakeip': Monitor,
}

// 「自动识别」的图标(lucide sparkles 轮廓)。清单里 icon 是给 <img src> 用的,放不了组件,用内联 data URI
const autoIcon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236366f1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'/%3E%3C/svg%3E"

// Client types configuration with icons and names
const CLIENT_TYPES = [
  // auto:后端按 User-Agent 判断客户端下发对应格式(internal/handler/client_ua.go),一条链接通吃,
  // 认不出时回落 Clash YAML
  { type: 'auto', name: 'Auto（自动识别）', icon: autoIcon },
  // 官方客户端 MeowX:格式与 Clash 相同(后端 client_ua.go 把 t=meowx 当 clash)
  { type: 'meowx', name: 'MeowX', icon: meowxIcon },
  { type: 'clash', name: 'Clash', icon: clashIcon },
  { type: 'stash', name: 'Stash', icon: stashIcon },
  {
    type: 'clash-to-shadowrocket',
    name: 'Shadowrocket',
    icon: shadowrocketIcon,
  },
  { type: 'surfboard', name: 'Surfboard', icon: surfboardIcon },
  { type: 'surge', name: 'Surge', icon: surgeIcon },
  { type: 'surgemac', name: 'Surge Mac', icon: surgeMacIcon },
  { type: 'clash-to-surge', name: 'Clash→Surge', icon: surgeIcon },
  { type: 'loon', name: 'Loon', icon: loonIcon },
  { type: 'clash-to-loon', name: 'Clash→Loon', icon: loonIcon },
  { type: 'clash-to-loon-kelee', name: 'Clash→Loon(kelee)', icon: loonIcon },
  { type: 'qx', name: 'QuantumultX', icon: quanxIcon },
  { type: 'egern', name: 'Egern', icon: egernIcon },
  { type: 'sing-box', name: 'sing-box', icon: singboxIcon },
  { type: 'v2ray', name: 'V2Ray', icon: v2rayIcon },
  { type: 'uri', name: 'URI', icon: uriIcon },
] as const

function SubscriptionPage() {
  const { auth } = useAuthStore()
  const searchInput = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState('')
  const [qrValue, setQrValue] = useState<string | null>(null)
  const [selectedFormats, setSelectedFormats] = useState<
    Record<number, string>
  >({})

  const {
    data: subscribeFilesData,
    isPending: subscriptionsPending,
    isError: subscriptionsError,
    isFetching: subscriptionsFetching,
    refetch: refetchSubscriptions,
  } = useQuery({
    queryKey: ['user-subscriptions'],
    queryFn: async ({ signal }) => {
      const response = await api.get<{
        subscriptions: SubscribeFile[]
        user_short_code: string
      }>('/api/subscriptions', { signal })
      return response.data
    },
    enabled: Boolean(auth.accessToken),
    staleTime: 60 * 1000,
    retry: false,
    meta: { showErrorInPage: true },
  })

  const subscribeFiles = subscribeFilesData?.subscriptions ?? []
  const userShortCode = subscribeFilesData?.user_short_code ?? ''
  const searchTerm = search.trim().toLowerCase()
  const matchingFiles = searchTerm
    ? subscribeFiles.filter((file) =>
        [file.name, file.filename, file.description].some((value) =>
          value?.toLowerCase().includes(searchTerm)
        )
      )
    : subscribeFiles

  const needsUserToken = subscribeFiles.some(
    (file) =>
      !userShortCode || !(file.custom_short_code || file.file_short_code)
  )
  const {
    data: tokenData,
    isError: tokenError,
    isFetching: tokenFetching,
    refetch: refetchToken,
  } = useQuery({
    queryKey: ['user-token'],
    queryFn: async ({ signal }) => {
      const response = await api.get<{ token: string }>('/api/user/token', {
        signal,
      })
      return response.data
    },
    enabled: Boolean(auth.accessToken) && needsUserToken,
    staleTime: 5 * 60 * 1000,
    retry: false,
    meta: { showErrorInPage: true },
  })

  const userToken = tokenData?.token ?? ''

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        hour12: false,
      }),
    []
  )

  const baseURL =
    api.defaults.baseURL ??
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}`
      : 'http://localhost:8080')

  const buildSubscriptionURL = (file: SubscribeFile, clientType?: string) => {
    const fileCode = file.custom_short_code || file.file_short_code
    const shortCode = fileCode && userShortCode ? fileCode + userShortCode : ''
    if (!shortCode && !userToken) return null

    const url = new URL(
      shortCode ? `/${shortCode}` : '/api/clash/subscribe',
      baseURL
    )
    if (!shortCode) url.searchParams.set('filename', file.filename)
    if (clientType) {
      url.searchParams.set('t', clientType)
    }
    if (!shortCode) url.searchParams.set('token', userToken)
    return url.toString()
  }

  const handleCopy = async (
    urlText: string,
    client?: (typeof CLIENT_TYPES)[number]
  ) => {
    if (!(await copyTextToClipboard(urlText))) {
      toast.error('复制失败，请手动复制链接')
      return
    }

    toast.success(client ? `${client.name} 订阅链接已复制` : '订阅链接已复制')
    if (client?.type === 'clash-to-shadowrocket') {
      toast.info(
        '请在 Shadowrocket 配置界面点击右上角 + 号，选择添加订阅链接',
        {
          duration: 5000,
        }
      )
    }
  }

  return (
    <div className='bg-background min-h-svh'>
      <main className='mx-auto w-full max-w-5xl px-4 py-8 pt-24 sm:px-6'>
        <section className='space-y-4 text-center sm:text-left'>
          <h1 className='text-3xl font-semibold tracking-tight'>订阅链接</h1>
          <p className='text-destructive mt-2 text-sm font-semibold'>
            转换客户端代理是从substore抄过来的, 没有完全测试，有BUG请联系开发者
          </p>
        </section>

        {subscribeFiles.length > 0 && (
          <div className='mt-6 flex flex-wrap items-center gap-x-3 gap-y-2'>
            <div className='relative w-full sm:w-80'>
              <Search
                className='text-muted-foreground inset-s-3 pointer-events-none absolute top-1/2 size-4 -translate-y-1/2'
                aria-hidden='true'
              />
              <Input
                ref={searchInput}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Escape' &&
                    !event.nativeEvent.isComposing
                  ) {
                    setSearch('')
                  }
                }}
                inputMode='search'
                aria-label='搜索订阅'
                placeholder='按名称、文件名或说明搜索'
                className='ps-9 pe-10'
              />
              {search && (
                <Button
                  type='button'
                  size='icon'
                  variant='ghost'
                  aria-label='清除搜索'
                  title='清除搜索'
                  className='inset-e-1 absolute top-1/2 size-8 -translate-y-1/2'
                  onClick={() => {
                    setSearch('')
                    searchInput.current?.focus()
                  }}
                >
                  <X aria-hidden='true' />
                </Button>
              )}
            </div>
            <span role='status' className='text-muted-foreground text-sm'>
              {searchTerm
                ? `匹配 ${matchingFiles.length} / ${subscribeFiles.length} 个订阅`
                : `共 ${subscribeFiles.length} 个订阅`}
            </span>
          </div>
        )}

        <section
          aria-busy={subscriptionsPending}
          className='mt-5 grid gap-6 md:grid-cols-2 lg:grid-cols-3'
        >
          {(subscriptionsPending ||
            subscriptionsError ||
            subscribeFiles.length === 0) && (
            <Card className='col-span-full w-full border-dashed shadow-none'>
              <CardHeader>
                {subscriptionsPending && (
                  <CardTitle role='status'>正在加载订阅</CardTitle>
                )}
                {subscriptionsError && (
                  <CardTitle role='alert'>
                    {subscribeFilesData
                      ? '订阅列表更新失败，当前显示上次加载的结果。'
                      : '订阅列表加载失败。'}
                  </CardTitle>
                )}
                {!subscriptionsPending && !subscriptionsError && (
                  <>
                    <CardTitle>暂无可用订阅</CardTitle>
                    <CardDescription>
                      管理员尚未为您分配订阅链接，请联系管理员进行分配。
                    </CardDescription>
                  </>
                )}
              </CardHeader>
              {subscriptionsError && (
                <CardFooter>
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    disabled={subscriptionsFetching}
                    onClick={() => void refetchSubscriptions()}
                  >
                    重新加载订阅
                  </Button>
                </CardFooter>
              )}
            </Card>
          )}

          {needsUserToken && tokenError && !userToken && (
            <Card className='col-span-full w-full border-dashed shadow-none'>
              <CardHeader>
                <CardTitle role='alert'>有订阅链接加载失败。</CardTitle>
              </CardHeader>
              <CardFooter>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={tokenFetching}
                  onClick={() => void refetchToken()}
                >
                  重试获取链接
                </Button>
              </CardFooter>
            </Card>
          )}

          {subscribeFiles.length > 0 && matchingFiles.length === 0 && (
            <Card className='col-span-full w-full border-dashed shadow-none'>
              <CardHeader>
                <CardTitle>没有匹配的订阅</CardTitle>
              </CardHeader>
            </Card>
          )}

          {matchingFiles.map((file) => {
            const Icon = ICON_MAP[file.name] ?? QrCode
            const selectedClient = file.raw_output
              ? undefined
              : CLIENT_TYPES.find(
                  (client) => client.type === selectedFormats[file.id]
                )
            const subscribeURL = buildSubscriptionURL(file)
            const displayURL = selectedClient
              ? buildSubscriptionURL(file, selectedClient.type)
              : subscribeURL
            const updatedLabel = file.updated_at
              ? dateFormatter.format(new Date(file.updated_at))
              : null
            const selectId = `subscription-format-${file.id}`

            return (
              <Card key={file.id} className='flex flex-col justify-between'>
                <CardHeader>
                  <div className='flex items-start gap-3 overflow-hidden'>
                    <div className='bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-xl'>
                      <Icon className='size-6' aria-hidden='true' />
                    </div>
                    <div className='min-w-0 flex-1 space-y-1 text-left'>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CardTitle className='truncate text-lg'>
                            {file.name}
                          </CardTitle>
                        </TooltipTrigger>
                        <TooltipContent>{file.name}</TooltipContent>
                      </Tooltip>
                      <CardDescription>
                        {file.description || '—'}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='flex flex-wrap items-center justify-end gap-2'>
                    {file.expire_at ? (
                      new Date(file.expire_at) < new Date() ? (
                        <Badge variant='destructive'>已过期</Badge>
                      ) : (
                        <Badge variant='outline'>
                          到期: {dateFormatter.format(new Date(file.expire_at))}
                        </Badge>
                      )
                    ) : (
                      <Badge
                        variant='outline'
                        className='text-muted-foreground'
                      >
                        永久有效
                      </Badge>
                    )}
                    {updatedLabel ? (
                      <p className='text-muted-foreground text-xs'>
                        {updatedLabel}
                      </p>
                    ) : null}
                    {file.latest_version ? (
                      <Badge variant='secondary' className='text-xs'>
                        v{file.latest_version}
                      </Badge>
                    ) : null}
                  </div>
                  {!file.raw_output ? (
                    <div className='space-y-2'>
                      <Label htmlFor={selectId}>客户端格式</Label>
                      <Select
                        value={selectedClient?.type ?? 'default'}
                        onValueChange={(format) =>
                          setSelectedFormats((prev) => ({
                            ...prev,
                            [file.id]: format,
                          }))
                        }
                      >
                        <SelectTrigger id={selectId}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='default'>默认链接</SelectItem>
                          {CLIENT_TYPES.map((client) => (
                            <SelectItem key={client.type} value={client.type}>
                              <img
                                src={client.icon}
                                alt=''
                                className='size-4 shrink-0'
                              />
                              {client.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <Input
                    aria-label={`${file.name} 的订阅链接`}
                    className='bg-muted/40 font-mono'
                    value={displayURL ?? ''}
                    placeholder={
                      tokenError ? '获取订阅链接失败' : '正在准备订阅链接'
                    }
                    onFocus={(event) => event.currentTarget.select()}
                    readOnly
                  />
                  <div className='grid grid-cols-2 gap-2'>
                    <Button
                      size='sm'
                      type='button'
                      disabled={!displayURL}
                      onClick={() =>
                        displayURL &&
                        void handleCopy(displayURL, selectedClient)
                      }
                    >
                      <Copy aria-hidden='true' />
                      复制链接
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      type='button'
                      disabled={!displayURL}
                      onClick={() => setQrValue(displayURL)}
                    >
                      <QrCode aria-hidden='true' />
                      二维码
                    </Button>
                    {!file.raw_output && subscribeURL ? (
                      <Button
                        size='sm'
                        variant='secondary'
                        className='col-span-2'
                        asChild
                      >
                        <a
                          href={`clash://install-config?url=${encodeURIComponent(subscribeURL)}`}
                        >
                          <Download aria-hidden='true' />
                          导入 Clash
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>
      </main>

      <Dialog
        open={Boolean(qrValue)}
        onOpenChange={(open) => {
          if (!open) {
            setQrValue(null)
          }
        }}
      >
        <DialogContent className='sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>订阅二维码</DialogTitle>
            <DialogDescription>
              使用手机扫描二维码快速导入订阅链接。
            </DialogDescription>
          </DialogHeader>
          {qrValue ? (
            <div className='flex flex-col items-center gap-4'>
              <div className='rounded-xl border bg-white p-4 shadow-inner'>
                <QRCodeCanvas
                  value={qrValue}
                  size={220}
                  level='M'
                  includeMargin
                />
              </div>
              <div className='text-muted-foreground text-center font-mono text-xs break-all'>
                {qrValue}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
