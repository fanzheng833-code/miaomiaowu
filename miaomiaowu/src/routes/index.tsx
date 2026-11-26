import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CatchBoundary,
  createFileRoute,
  redirect,
} from '@tanstack/react-router'
import {
  Activity,
  AlertCircle,
  ChartNoAxesCombined,
  HardDrive,
  PieChart,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { DailyUsage } from '@/components/traffic-usage-chart'

interface TrafficSummary {
  metrics: {
    total_limit_gb: number
    total_used_gb: number
    total_remaining_gb: number
    usage_percentage: number
  }
  history: DailyUsage[] | null
}

const numberFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
})
const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const ranges = [7, 30] as const
const TrafficUsageChart = lazy(() => import('@/components/traffic-usage-chart'))

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    if (!useAuthStore.getState().auth.accessToken) {
      throw redirect({ to: '/login' })
    }
  },
  component: DashboardPage,
})

function DashboardPage() {
  const accessToken = useAuthStore((state) => state.auth.accessToken)
  const [range, setRange] = useState<(typeof ranges)[number]>(30)
  const { data, dataUpdatedAt, isError, isFetching, isLoading, refetch } =
    useQuery({
      queryKey: ['traffic-summary'],
      queryFn: async ({ signal }) => {
        const response = await api.get<TrafficSummary>('/api/traffic/summary', {
          signal,
        })
        return response.data
      },
      staleTime: 5 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      meta: { showErrorInPage: true },
      enabled: Boolean(accessToken),
    })

  const history = data?.history
  const today = new Date().toISOString().slice(0, 10)
  const chartData = useMemo(() => {
    if (!history?.length) return []

    // The API stores snapshots by UTC date.
    const cutoff = new Date(today)
    cutoff.setUTCDate(cutoff.getUTCDate() - range + 1)
    const oldest = cutoff.toISOString().slice(0, 10)
    return history.filter((entry) => entry.date >= oldest && entry.date <= today)
  }, [history, range, today])

  const metrics = data?.metrics
  const cards = [
    {
      label: '总流量配额',
      value: formatTraffic(metrics?.total_limit_gb),
      icon: TrendingUp,
    },
    {
      label: '已用流量',
      value: formatTraffic(metrics?.total_used_gb),
      icon: Activity,
    },
    {
      label: '剩余流量',
      value: formatTraffic(metrics?.total_remaining_gb),
      icon: HardDrive,
    },
    {
      label: '使用率',
      value:
        metrics && Number.isFinite(metrics.usage_percentage)
          ? `${numberFormatter.format(metrics.usage_percentage)}%`
          : '—',
      progress: metrics?.usage_percentage,
      icon: PieChart,
    },
  ]
  const chartLoading = (
    <Skeleton
      className='size-full'
      role='status'
      aria-label='正在加载流量趋势'
    />
  )

  return (
    <main
      aria-labelledby='traffic-heading'
      className='mx-auto w-full max-w-6xl space-y-5 px-4 pt-24 pb-10 sm:space-y-6 sm:px-6'
    >
      <header className='flex flex-wrap items-center justify-between gap-x-4 gap-y-3'>
        <h1
          id='traffic-heading'
          className='text-2xl font-semibold tracking-tight sm:text-3xl'
        >
          流量概览
        </h1>
        <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
          {dataUpdatedAt > 0 && (
            <p className='text-muted-foreground text-xs' aria-live='polite'>
              最近更新{' '}
              <time dateTime={new Date(dataUpdatedAt).toISOString()}>
                {timeFormatter.format(dataUpdatedAt)}
              </time>
            </p>
          )}
          <Button
            variant='outline'
            size='sm'
            type='button'
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              aria-hidden='true'
              className={isFetching ? 'motion-safe:animate-spin' : undefined}
            />
            {isFetching ? '刷新中' : '刷新'}
          </Button>
        </div>
      </header>

      {isError && !data ? (
        <Card>
          <CardContent className='flex flex-col items-center gap-3 py-12 text-center'>
            <AlertCircle
              className='text-destructive size-7'
              aria-hidden='true'
            />
            <p role='alert' className='font-medium'>
              流量数据加载失败
            </p>
            <Button
              type='button'
              size='sm'
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {isError && (
            <p
              role='status'
              className='border-border bg-card text-muted-foreground border px-3 py-2 text-sm'
            >
              更新失败，当前显示上次获取的数据。
            </p>
          )}

          <section
            aria-label='流量指标'
            aria-busy={isLoading}
            className='grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4'
          >
            {isLoading
              ? cards.map(({ label }) => (
                  <Card key={label} aria-hidden='true'>
                    <CardContent className='space-y-4 px-3.5 py-3 sm:px-5'>
                      <Skeleton className='h-5 w-3/4' />
                      <Skeleton className='h-7 w-2/3' />
                    </CardContent>
                  </Card>
                ))
              : cards.map(({ label, value, icon: Icon, progress }) => (
                  <Card key={label} className='min-w-0'>
                    <CardContent className='px-3.5 py-3 sm:px-5'>
                      <div className='mb-2.5 flex items-center justify-between gap-2'>
                        <h2 className='text-muted-foreground text-xs font-medium sm:text-sm'>
                          {label}
                        </h2>
                        <span className='bg-primary/10 text-primary grid size-8 shrink-0 place-items-center rounded-md'>
                          <Icon className='size-4' aria-hidden='true' />
                        </span>
                      </div>
                      <div className='text-xl font-semibold tracking-tight [overflow-wrap:anywhere] tabular-nums sm:text-2xl'>
                        {value}
                      </div>
                      {typeof progress === 'number' &&
                        Number.isFinite(progress) && (
                          <Progress
                            aria-label='流量使用率'
                            aria-valuetext={value}
                            className='mt-3 h-1.5'
                            value={progress}
                          />
                        )}
                    </CardContent>
                  </Card>
                ))}
          </section>

          <Card className='min-w-0'>
            <CardContent className='px-3 py-3 sm:px-6 sm:py-4'>
              <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                <div className='space-y-1'>
                  <h2 className='font-semibold'>每日流量消耗</h2>
                  <p className='text-muted-foreground text-xs'>单位 GB</p>
                </div>
                <div
                  role='group'
                  aria-label='趋势时间范围'
                  className='bg-muted/70 flex gap-1 rounded-lg p-1'
                >
                  {ranges.map((days) => (
                    <Button
                      key={days}
                      type='button'
                      variant={days === range ? 'outline' : 'ghost'}
                      size='sm'
                      className='h-8 rounded-md px-2.5 text-xs'
                      aria-pressed={days === range}
                      onClick={() => setRange(days)}
                    >
                      最近 {days} 天
                    </Button>
                  ))}
                </div>
              </div>
              <div className='h-60 min-w-0 sm:h-80'>
                {isLoading ? (
                  chartLoading
                ) : chartData.length === 0 ? (
                  <div className='text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center text-sm'>
                    <ChartNoAxesCombined
                      className='size-7'
                      aria-hidden='true'
                    />
                    暂无历史记录
                  </div>
                ) : (
                  <CatchBoundary
                    getResetKey={() => range}
                    errorComponent={TrafficChartError}
                  >
                    <Suspense fallback={chartLoading}>
                      <TrafficUsageChart data={chartData} />
                    </Suspense>
                  </CatchBoundary>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  )
}

function TrafficChartError() {
  return (
    <div className='text-muted-foreground flex h-full flex-col items-center justify-center gap-3 text-center text-sm'>
      <p role='alert'>流量趋势图加载失败</p>
      <Button
        variant='outline'
        size='sm'
        type='button'
        onClick={() => window.location.reload()}
      >
        重新加载页面
      </Button>
    </div>
  )
}

function formatTraffic(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1024) {
    return `${numberFormatter.format(value / 1024)} TB`
  }
  return `${numberFormatter.format(value)} GB`
}
