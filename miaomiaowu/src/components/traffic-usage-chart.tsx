import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export interface DailyUsage {
  date: string
  used_gb: number
}

const numberFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 2,
})

export default function TrafficUsageChart({ data }: { data: DailyUsage[] }) {
  return (
    <ResponsiveContainer width='100%' height='100%'>
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
      >
        <defs>
          <linearGradient id='daily-usage-fill' x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='var(--chart-1)' stopOpacity={0.34} />
            <stop offset='100%' stopColor='var(--chart-1)' stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke='var(--border)'
          strokeDasharray='4 4'
        />
        <XAxis
          dataKey='date'
          tickLine={false}
          axisLine={false}
          minTickGap={20}
          tickMargin={8}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          tickFormatter={(date: string) => date.slice(5).replace('-', '/')}
        />
        <YAxis
          width={44}
          tickCount={5}
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          tickFormatter={(value: number) => numberFormatter.format(value)}
        />
        <Tooltip
          formatter={(usage) =>
            typeof usage === 'number'
              ? `${numberFormatter.format(usage)} GB`
              : '—'
          }
          cursor={{ stroke: 'var(--chart-1)' }}
          contentStyle={{
            backgroundColor: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--popover-foreground)',
          }}
          itemStyle={{ color: 'var(--popover-foreground)' }}
        />
        <Area
          type='monotone'
          dataKey='used_gb'
          name='日消耗'
          stroke='var(--chart-1)'
          fill='url(#daily-usage-fill)'
          strokeWidth={2}
          dot={data.length === 1}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
