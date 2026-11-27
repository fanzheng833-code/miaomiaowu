// @ts-nocheck
import {
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { Copy, RefreshCw, ShieldBan, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LogFilesPanel } from '@/components/log-files-panel'
import { api } from '@/lib/api'
import { copyTextToClipboard } from '@/lib/clipboard'
import { profileQueryFn } from '@/lib/profile'

export const Route = createFileRoute('/logs')({
  beforeLoad: async ({ context }) => {
    let profile
    try {
      profile = await context.queryClient.fetchQuery({ queryKey: ['profile'], queryFn: profileQueryFn })
    } catch {
      throw redirect({ to: '/login' })
    }
    if (!profile?.is_admin) throw redirect({ to: '/' })
  },
  component: LogsPage,
})

function LogsPage() {
  return (
    <div className='min-h-svh bg-background'>
      <main className='mx-auto max-w-6xl px-4 pb-10 pt-24'>
        <h1 className='text-3xl font-semibold'>日志管理</h1>
        <p className='mt-2 text-muted-foreground'>查看系统运行日志、安全事件、当前封禁和后台任务执行结果。</p>
        <Tabs defaultValue='system' className='mt-6'>
          <TabsList><TabsTrigger value='system'>系统日志</TabsTrigger><TabsTrigger value='security'>安全日志</TabsTrigger><TabsTrigger value='operations'>操作日志</TabsTrigger><TabsTrigger value='tasks'>任务日志</TabsTrigger></TabsList>
          <TabsContent value='system'><SystemLogPanel /></TabsContent>
          <TabsContent value='security'><SecurityPanel /></TabsContent>
          <TabsContent value='operations'><OperationPanel /></TabsContent>
          <TabsContent value='tasks'><TaskPanel /></TabsContent>
        </Tabs>
      </main>
    </div>
  )
}

type LogRow = { time: string; level: string; msg: string; fields?: string; raw?: string }
const LEVELS = ['', 'DEBUG', 'INFO', 'WARN', 'ERROR']
const SEARCH_DELAY_MS = 300

// 主控自身日志(data/logs/mmw.log)的查看:级别/关键字筛选 + 行数 + 自动刷新,下方附日志文件管理。
function SystemLogPanel() {
  const [level, setLevel] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [composing, setComposing] = useState(false)
  const [lines, setLines] = useState(100)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [isFollowing, setIsFollowing] = useState(true)
  const outputRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(true)
  const queryClient = useQueryClient()
  const queryKey = ['admin-logs-system', level, keyword, lines]
  const trimmedInput = searchInput.trim()
  const searchPending = composing || trimmedInput !== keyword
  const shouldPoll = autoRefresh && isFollowing && !searchPending
  const hasFilters = Boolean(level || keyword)

  const {
    data,
    isError,
    isFetching,
    isPending,
    isPlaceholderData,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ lines: String(lines) })
      if (level) params.set('level', level)
      if (keyword) params.set('q', keyword)
      const response = await api.get(`/api/admin/logs/system?${params.toString()}`, { signal })
      return response.data as {
        rows: LogRow[]
        log_path?: string
        note?: string
        error?: string
      }
    },
    placeholderData: keepPreviousData,
    retry: false,
    meta: { showErrorInPage: true },
    refetchInterval: shouldPoll ? 5000 : false,
    refetchIntervalInBackground: true,
    refetchOnReconnect: shouldPoll,
    refetchOnWindowFocus: shouldPoll,
  })
  const rows = data?.rows ?? []
  const applyingFilters = searchPending || isPlaceholderData

  useLayoutEffect(() => {
    const output = outputRef.current
    // 在滚动事件中记住跟随状态，避免新日志改变高度后误判。
    if (output && followingRef.current && !applyingFilters) {
      output.scrollTop = output.scrollHeight
    }
  }, [data, applyingFilters])

  const resumeFollowing = useCallback(() => {
    followingRef.current = true
    setIsFollowing(true)
  }, [])

  const applyKeyword = useCallback(
    (value: string) => {
      if (value === keyword) return
      resumeFollowing()
      setKeyword(value)
    },
    [keyword, resumeFollowing]
  )

  useEffect(() => {
    if (composing || trimmedInput === keyword) return
    const timer = window.setTimeout(
      () => applyKeyword(trimmedInput),
      SEARCH_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [applyKeyword, composing, keyword, trimmedInput])

  function clearSearch() {
    setSearchInput('')
    applyKeyword('')
  }

  function changeAutoRefresh(checked: boolean) {
    setAutoRefresh(checked)
    if (applyingFilters || !data) return
    if (!checked) {
      void queryClient.cancelQueries({ queryKey, exact: true })
    } else if (followingRef.current) {
      void refetch()
    }
  }

  function handleScroll({ currentTarget: output }: UIEvent<HTMLDivElement>) {
    const atBottom =
      output.scrollHeight - output.scrollTop - output.clientHeight <= 24
    if (followingRef.current === atBottom) return

    followingRef.current = atBottom
    setIsFollowing(atBottom)
    if (!atBottom && !applyingFilters) {
      // 滚出尾部时冻结当前日志，避免在途轮询覆盖正在阅读的记录。
      void queryClient.cancelQueries({ queryKey, exact: true })
    } else if (atBottom && autoRefresh && !applyingFilters) {
      void refetch()
    }
  }

  function jumpToLatest() {
    resumeFollowing()
    const output = outputRef.current
    if (output) output.scrollTop = output.scrollHeight
    void refetch()
  }

  async function copyRows() {
    if (applyingFilters || rows.length === 0) return
    const copied = await copyTextToClipboard(rows.map(logRowText).join('\n'))
    if (copied) {
      toast.success('已复制当前日志结果')
    } else {
      toast.error('复制失败，请手动选择日志文本')
    }
  }

  return (
    <div className='mt-4 space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Select
          value={level || 'all'}
          onValueChange={(value) => {
            resumeFollowing()
            if (!composing) applyKeyword(trimmedInput)
            setLevel(value === 'all' ? '' : value)
          }}
        >
          <SelectTrigger aria-label='日志级别' className='w-32'>
            <SelectValue placeholder='级别' />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((item) => (
              <SelectItem key={item || 'all'} value={item || 'all'}>
                {item || '全部级别'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className='flex w-full items-center gap-1 sm:w-64'>
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setSearchInput(event.currentTarget.value)
              setComposing(false)
            }}
            onKeyDown={(event) => {
              if (composing || event.nativeEvent.isComposing) return
              if (event.key === 'Enter') applyKeyword(trimmedInput)
              if (event.key === 'Escape') clearSearch()
            }}
            aria-label='日志关键字'
            placeholder='搜索关键字'
            className='min-w-0 flex-1'
          />
          {searchInput && (
            <Button
              type='button'
              size='icon'
              variant='ghost'
              aria-label='清除日志关键字'
              onClick={clearSearch}
            >
              <X aria-hidden='true' className='size-4' />
            </Button>
          )}
        </div>
        <Select
          value={String(lines)}
          onValueChange={(value) => {
            resumeFollowing()
            if (!composing) applyKeyword(trimmedInput)
            setLines(Number(value))
          }}
        >
          <SelectTrigger aria-label='日志行数' className='w-28'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[100, 200, 500, 1000, 2000].map((count) => (
              <SelectItem key={count} value={String(count)}>
                {count} 行
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type='button'
          variant='outline'
          size='sm'
          aria-label='刷新日志'
          onClick={() => void refetch()}
          disabled={isFetching || applyingFilters}
        >
          <RefreshCw
            aria-hidden='true'
            className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
          />
        </Button>
        <label className='ml-auto flex items-center gap-2 text-sm'>
          <Switch checked={autoRefresh} onCheckedChange={changeAutoRefresh} />
          自动刷新
        </label>
      </div>
      <div className='border bg-background/50'>
        <div className='flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2'>
          <span className='text-muted-foreground text-xs' role='status'>
            {isFollowing
              ? autoRefresh
                ? '实时跟随'
                : '仅手动刷新'
              : '已暂停跟随'}
          </span>
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => void copyRows()}
              disabled={applyingFilters || rows.length === 0}
            >
              <Copy aria-hidden='true' className='size-4' />
              复制结果
            </Button>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={jumpToLatest}
              disabled={isFollowing || applyingFilters}
            >
              跳到最新
            </Button>
          </div>
        </div>
        {applyingFilters ? (
          <p className='text-muted-foreground border-b px-3 py-2 text-xs' role='status'>
            {rows.length > 0 ? '正在应用筛选，暂时显示上次获取的日志。' : '正在应用筛选…'}
          </p>
        ) : hasFilters && data && !data.error && !data.note && (
          <p className='text-muted-foreground border-b px-3 py-2 text-xs' role='status'>
            当前筛选返回 {rows.length} 条日志
          </p>
        )}
        {isError && data && !applyingFilters && (
          <p className='text-destructive border-b px-3 py-2 text-sm' role='alert'>
            日志刷新失败，当前显示上次获取的结果。
          </p>
        )}
        <div
          ref={outputRef}
          role='region'
          aria-label='系统日志输出'
          tabIndex={0}
          onScroll={handleScroll}
          className='h-[60svh] overflow-y-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap'
        >
          {rows.length > 0 ? (
            rows.map((row, index) => <LogLine key={index} row={row} />)
          ) : (
            <span
              className='text-muted-foreground'
              role={isError && !data ? 'alert' : undefined}
            >
              {isPending
                ? '正在读取日志'
                : isError && !data
                  ? '日志加载失败，请刷新重试。'
                  : data?.error
                    ? `读取日志失败：${data.error}（${data.log_path}）`
                    : data?.note
                      ? `${data.note}（${data.log_path}）`
                      : hasFilters
                        ? '未找到匹配的日志'
                        : '暂无日志'}
            </span>
          )}
        </div>
      </div>
      <LogFilesPanel />
    </div>
  )
}

function logRowText(row: LogRow) {
  if (row.raw) return row.raw
  return [row.time, row.level, row.msg, row.fields].filter(Boolean).join(' ')
}

function LogLine({ row }: { row: LogRow }) {
  if (row.raw) return <div className='text-muted-foreground'>{row.raw}</div>
  const color = { ERROR: 'text-red-500', WARN: 'text-yellow-500', DEBUG: 'text-muted-foreground', INFO: 'text-foreground' }[row.level] ?? 'text-foreground'
  return <div>
    <span className='text-muted-foreground'>{row.time}</span>{' '}
    <span className={color}>{row.level.padEnd(5)}</span>{' '}
    <span>{row.msg}</span>
    {row.fields && <span className='text-muted-foreground'> {row.fields}</span>}
  </div>
}

function SecurityPanel() {
  const client = useQueryClient()
  const [ip, setIP] = useState('')
  const bans = useQuery({ queryKey: ['security-bans'], queryFn: async () => (await api.get('/api/admin/security/bans')).data.bans ?? [], refetchInterval: 15000 })
  const events = useQuery({ queryKey: ['security-events'], queryFn: async () => (await api.get('/api/admin/security/events?limit=200')).data.events ?? [], refetchInterval: 15000 })
  const refresh = () => client.invalidateQueries({ queryKey: ['security-bans'] }).then(() => client.invalidateQueries({ queryKey: ['security-events'] }))
  const ban = useMutation({ mutationFn: async (permanent: boolean) => api.post('/api/admin/security/bans', { ip, permanent }), onSuccess: () => { setIP(''); toast.success('IP 已封禁'); refresh() } })
  const unban = useMutation({ mutationFn: async (value: string) => api.delete(`/api/admin/security/bans/${encodeURIComponent(value)}`), onSuccess: () => { toast.success('IP 已解封'); refresh() } })
  return <div className='mt-4 space-y-4'>
    <Card><CardHeader><CardTitle className='text-base'>手动封禁</CardTitle></CardHeader><CardContent className='flex flex-wrap gap-2'><Input className='max-w-xs' value={ip} onChange={(e) => setIP(e.target.value)} placeholder='IPv4 或 IPv6' /><Button disabled={!ip || ban.isPending} onClick={() => ban.mutate(false)}><ShieldBan className='mr-2 h-4 w-4' />临时封禁</Button><Button variant='destructive' disabled={!ip || ban.isPending} onClick={() => ban.mutate(true)}>永久封禁</Button></CardContent></Card>
    <Card><CardHeader className='flex-row items-center justify-between'><CardTitle className='text-base'>当前封禁（{bans.data?.length ?? 0}）</CardTitle><Button size='icon' variant='ghost' onClick={refresh}><RefreshCw className='h-4 w-4' /></Button></CardHeader><CardContent><div className='overflow-x-auto'><table className='w-full text-sm'><thead><tr className='border-b text-left'><th className='py-2'>IP</th><th>原因</th><th>到期时间</th><th>操作者</th><th /></tr></thead><tbody>{bans.data?.map((b) => <tr key={b.ip} className='border-b'><td className='py-2 font-mono'>{b.ip}</td><td>{b.reason}</td><td>{b.permanent ? <Badge>永久</Badge> : formatTime(b.expires_at)}</td><td>{b.actor || '-'}</td><td className='text-right'><Button size='sm' variant='outline' onClick={() => unban.mutate(b.ip)}><ShieldCheck className='mr-1 h-4 w-4' />解封</Button></td></tr>)}</tbody></table>{!bans.data?.length && <p className='py-6 text-center text-muted-foreground'>暂无活动封禁</p>}</div></CardContent></Card>
    <Card><CardHeader><CardTitle className='text-base'>安全事件</CardTitle></CardHeader><CardContent><div className='max-h-[420px] overflow-auto'><table className='w-full text-sm'><thead><tr className='border-b text-left'><th className='py-2'>时间</th><th>类型</th><th>IP</th><th>路径/详情</th></tr></thead><tbody>{events.data?.map((e) => <tr key={e.id} className='border-b'><td className='whitespace-nowrap py-2'>{formatTime(e.at)}</td><td><Badge variant='outline'>{e.kind}</Badge></td><td className='font-mono'>{e.ip}</td><td>{e.path || e.detail || '-'}</td></tr>)}</tbody></table></div></CardContent></Card>
  </div>
}

function TaskPanel() {
  const runs = useQuery({ queryKey: ['task-runs'], queryFn: async () => (await api.get('/api/admin/tasks/runs?limit=200')).data.runs ?? [], refetchInterval: 15000 })
  return <Card className='mt-4'><CardHeader className='flex-row items-center justify-between'><CardTitle className='text-base'>任务执行记录</CardTitle><Button size='icon' variant='ghost' onClick={() => runs.refetch()}><RefreshCw className={`h-4 w-4 ${runs.isFetching ? 'animate-spin' : ''}`} /></Button></CardHeader><CardContent><div className='overflow-x-auto'><table className='w-full text-sm'><thead><tr className='border-b text-left'><th className='py-2'>开始时间</th><th>任务</th><th>状态</th><th>耗时</th><th>详情</th></tr></thead><tbody>{runs.data?.map((run) => <tr key={run.id} className='border-b'><td className='whitespace-nowrap py-2'>{formatTime(run.started_at)}</td><td>{run.task_name}</td><td><Badge variant={run.status === 'error' ? 'destructive' : 'outline'}>{run.status}</Badge></td><td>{run.duration_ms} ms</td><td>{run.detail || '-'}</td></tr>)}</tbody></table>{!runs.data?.length && <p className='py-6 text-center text-muted-foreground'>暂无任务记录</p>}</div></CardContent></Card>
}

function OperationPanel() {
  const logs = useQuery({ queryKey: ['operation-logs'], queryFn: async () => (await api.get('/api/admin/operations?limit=200')).data.logs ?? [], refetchInterval: 15000 })
  return <Card className='mt-4'><CardHeader className='flex-row items-center justify-between'><CardTitle className='text-base'>管理员操作记录</CardTitle><Button size='icon' variant='ghost' onClick={() => logs.refetch()}><RefreshCw className={`h-4 w-4 ${logs.isFetching ? 'animate-spin' : ''}`} /></Button></CardHeader><CardContent><div className='overflow-x-auto'><table className='w-full text-sm'><thead><tr className='border-b text-left'><th className='py-2'>时间</th><th>操作者</th><th>操作</th><th>路径</th><th>状态</th><th>来源 IP</th></tr></thead><tbody>{logs.data?.map((log) => <tr key={log.id} className='border-b'><td className='whitespace-nowrap py-2'>{formatTime(log.at)}</td><td>{log.actor || '-'}</td><td><Badge variant='outline'>{log.method}</Badge></td><td className='font-mono'>{log.path}</td><td>{log.status}</td><td className='font-mono'>{log.ip}</td></tr>)}</tbody></table>{!logs.data?.length && <p className='py-6 text-center text-muted-foreground'>暂无操作记录</p>}</div></CardContent></Card>
}

function formatTime(value?: string) { return value ? new Date(value).toLocaleString() : '-' }
