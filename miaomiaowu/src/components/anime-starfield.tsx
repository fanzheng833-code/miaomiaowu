// 登录后可见的动态四角星背景，每颗星闪烁一次后移除。
import { useEffect, useState, useSyncExternalStore } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeToActivity(onChange: () => void) {
  const motionPreference = window.matchMedia(REDUCED_MOTION_QUERY)
  motionPreference.addEventListener('change', onChange)
  document.addEventListener('visibilitychange', onChange)
  return () => {
    motionPreference.removeEventListener('change', onChange)
    document.removeEventListener('visibilitychange', onChange)
  }
}

const canAnimate = () =>
  !document.hidden && !window.matchMedia(REDUCED_MOTION_QUERY).matches

// 刻晴配色:紫罗兰 / 薰衣草 / 靛蓝 / 金 / 品红粉 / 白
const COLORS = [
  '#a78bfa',
  '#8b5cf6',
  '#c4b5fd',
  '#6a5ae0',
  '#f0c674',
  '#ec6fb0',
  '#eede9f',
  '#efe6ff',
]

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]

type Star = {
  id: number
  top: string
  left: string
  size: number
  color: string
  dur: number
}

let gid = 0
function makeStar(): Star {
  return {
    id: ++gid,
    top: `${rand(2, 96).toFixed(2)}%`,
    left: `${rand(1, 98).toFixed(2)}%`,
    size: Math.round(rand(12, 26)),
    color: pick(COLORS),
    dur: Number(rand(1.4, 2.8).toFixed(2)),
  }
}

const SPAWN_MS = 70 // 生成间隔(越小越密)
const MAX = 160 // 并发上限(防 animationEnd 万一不触发导致堆积)

export function AnimeStarfield() {
  const active = useSyncExternalStore(subscribeToActivity, canAnimate, () => false)
  return active ? <AnimatedStars /> : null
}

function AnimatedStars() {
  const [stars, setStars] = useState<Star[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const star = makeStar()
      setStars((prev) => {
        const next =
          prev.length >= MAX ? prev.slice(prev.length - MAX + 1) : prev
        return [...next, star]
      })
    }, SPAWN_MS)
    return () => clearInterval(timer)
  }, [])

  const remove = (id: number) =>
    setStars((prev) => prev.filter((s) => s.id !== id))

  return (
    <div className='anime-starfield' aria-hidden='true'>
      {stars.map((s) => (
        <span
          key={s.id}
          className='anime-star'
          style={{
            top: s.top,
            left: s.left,
            width: s.size,
            height: s.size,
            color: s.color,
            animationDuration: `${s.dur}s`,
          }}
          onAnimationEnd={() => remove(s.id)}
        />
      ))}
    </div>
  )
}
