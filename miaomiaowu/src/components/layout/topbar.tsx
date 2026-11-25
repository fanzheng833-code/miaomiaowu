import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { Check, Menu } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import {
  adminNavLinks,
  applyNavMenuConfig,
  baseNavLinks,
  navMenuQueryFn,
} from '@/lib/nav-links'
import { profileQueryFn } from '@/lib/profile'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NavIcon } from '@/components/layout/nav-icon'
import { ThemeSwitch } from '@/components/theme-switch'
import { UserMenu } from './user-menu'

export function Topbar() {
  const { auth } = useAuthStore()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [compactMenuOpen, setCompactMenuOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const [iconOnlyCount, setIconOnlyCount] = useState(0)
  const [hideLogoText, setHideLogoText] = useState(false)

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: profileQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const isAdmin = Boolean(profile?.is_admin)

  // 管理员配的菜单顺序/隐藏。取不到就按默认顺序全显示 —— 导航不该因为一个
  // 附属请求失败而变空。
  const { data: navMenu } = useQuery({
    queryKey: ['nav-menu'],
    queryFn: navMenuQueryFn,
    enabled: Boolean(auth.accessToken),
    staleTime: 5 * 60 * 1000,
  })

  const allNavLinks = applyNavMenuConfig(
    isAdmin ? [...baseNavLinks, ...adminNavLinks] : baseNavLinks,
    navMenu
  )
  const currentPage = allNavLinks.find(
    ({ to }) => to === pathname || (to !== '/' && pathname.startsWith(`${to}/`))
  )
  const totalLinks = allNavLinks.length

  // 计算需要隐藏文字的按钮数量（从后往前）
  const calculateIconOnlyCount = useCallback(() => {
    if (!navRef.current) return

    // 直接获取窗口宽度
    const windowWidth = window.innerWidth
    // 预留空间：logo图片约60px，右侧按钮区约200px，左右padding约48px，间距约24px
    const logoTextWidth = 90 // "妙妙屋" 文字宽度
    const baseReservedSpace = 340 // 不含logo文字的预留空间

    // 每个带文字按钮约115px（4字+图标+padding），纯图标按钮约44px，gap约12px
    const fullButtonWidth = 115
    const iconButtonWidth = 44
    const gap = 12

    // 计算全部显示文字需要的宽度
    const fullWidth = totalLinks * (fullButtonWidth + gap) - gap
    const availableWithLogoText =
      windowWidth - baseReservedSpace - logoTextWidth

    if (fullWidth <= availableWithLogoText) {
      // 空间够，全部显示
      setIconOnlyCount(0)
      setHideLogoText(false)
      return
    }

    // 空间不够，先隐藏"妙妙屋"文字
    setHideLogoText(true)
    const availableWithoutLogoText = windowWidth - baseReservedSpace

    if (fullWidth <= availableWithoutLogoText) {
      // 隐藏logo文字后空间够了
      setIconOnlyCount(0)
      return
    }

    // 还不够，需要隐藏部分按钮文字
    const savedPerButton = fullButtonWidth - iconButtonWidth
    const overflowWidth = fullWidth - availableWithoutLogoText
    const needed = Math.ceil(overflowWidth / savedPerButton)
    setIconOnlyCount(Math.min(needed, totalLinks))
  }, [totalLinks])

  useEffect(() => {
    const header = navRef.current?.closest('header')
    const resizeObserver = new ResizeObserver(calculateIconOnlyCount)
    if (header) resizeObserver.observe(header)

    window.addEventListener('resize', calculateIconOnlyCount)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', calculateIconOnlyCount)
    }
  }, [calculateIconOnlyCount])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 64rem)')
    const closeCompactMenu = () => {
      if (desktop.matches) setCompactMenuOpen(false)
    }
    desktop.addEventListener('change', closeCompactMenu)
    return () => desktop.removeEventListener('change', closeCompactMenu)
  }, [])

  return (
    <header className='bg-background/80 supports-[backdrop-filter]:bg-background/60 fixed top-0 right-0 left-0 z-50 border-b border-[color:rgba(241,140,110,0.22)] backdrop-blur'>
      <div className='flex h-16 items-center justify-between gap-2 px-4 sm:px-6'>
        <div className='flex min-w-0 items-center gap-4 sm:gap-6'>
          <Link
            to='/'
            aria-label='妙妙屋首页'
            className='hover:text-primary focus-visible:outline-ring flex shrink-0 items-center gap-3 text-lg font-semibold tracking-tight transition focus-visible:outline-2 focus-visible:outline-offset-4'
          >
            <img
              src={`${import.meta.env.BASE_URL}images/logo.webp`}
              alt=''
              className='h-10 w-10 shrink-0 border-2 border-[color:rgba(241,140,110,0.4)] shadow-[4px_4px_0_rgba(0,0,0,0.2)]'
            />
            <span
              className={`pixel-text text-primary hidden text-base whitespace-nowrap min-[25rem]:inline ${hideLogoText ? 'lg:hidden' : ''}`}
            >
              妙妙屋
            </span>
          </Link>

          {/* Desktop Navigation - Base links + Admin links */}
          {/* data-glass-nav:液态玻璃「流动滑块」指示器的容器锚点(见 lib/glass-indicator.ts),
              滑块对第一层子项(data-nav-item)做布局动画,选中项由 TanStack Link 自动打的
              data-status="active" 标出。非 glass 主题下这些属性完全无副作用。 */}
          <nav
            ref={navRef}
            aria-label='主导航'
            data-glass-nav
            className='hidden items-center gap-3 lg:flex'
          >
            {allNavLinks.map(({ title, to, icon: Icon }, index) => {
              // 从后往前计算，index >= totalLinks - iconOnlyCount 的按钮只显示图标
              const showIconOnly = index >= totalLinks - iconOnlyCount

              return (
                <Link
                  key={to}
                  to={to}
                  data-nav-item
                  aria-label={title}
                  title={title}
                  activeOptions={{ exact: to === '/', includeSearch: false }}
                  className={`pixel-button bg-background/75 text-foreground hover:bg-accent/35 hover:text-accent-foreground focus-visible:outline-ring dark:bg-input/30 dark:hover:bg-accent/45 dark:hover:text-accent-foreground inline-flex h-9 items-center gap-2 border-[color:rgba(137,110,96,0.45)] py-2 text-sm font-semibold tracking-widest whitespace-nowrap uppercase transition-all focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-[color:rgba(255,255,255,0.18)] ${
                    showIconOnly
                      ? 'w-9 justify-center px-2'
                      : 'justify-start px-3'
                  }`}
                  activeProps={{
                    className:
                      'bg-primary/20 text-primary border-[color:rgba(217,119,87,0.55)] dark:bg-primary/20 dark:border-[color:rgba(217,119,87,0.55)]',
                  }}
                >
                  <NavIcon
                    icon={Icon}
                    to={to}
                    className='size-[18px] shrink-0'
                  />
                  {!showIconOnly && <span>{title}</span>}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className='flex min-w-0 items-center gap-2 sm:gap-3'>
          {totalLinks > 0 && (
            <DropdownMenu
              open={compactMenuOpen}
              onOpenChange={setCompactMenuOpen}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  variant='outline'
                  aria-label={
                    currentPage
                      ? `打开页面导航，当前页面：${currentPage.title}`
                      : '打开页面导航'
                  }
                  className='h-11 min-w-0 shrink px-2 has-[>svg]:px-2 lg:hidden'
                >
                  <Menu className='size-4 shrink-0' aria-hidden='true' />
                  <span className='truncate'>{currentPage?.title ?? '页面导航'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                collisionPadding={12}
                className='nav-overflow-menu pixel-border w-56'
              >
                <DropdownMenuLabel className='text-muted-foreground'>
                  页面导航
                </DropdownMenuLabel>
                {allNavLinks.map(({ title, to, icon: Icon }) => (
                  <DropdownMenuItem key={to} asChild>
                    <Link
                      to={to}
                      activeOptions={{ exact: to === '/', includeSearch: false }}
                      className='group hover:bg-accent/35 focus:bg-accent/35 flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2'
                      activeProps={{
                        className: 'bg-primary/15 text-primary font-semibold',
                      }}
                    >
                      <NavIcon
                        icon={Icon}
                        to={to}
                        className='size-[18px] shrink-0'
                      />
                      <span className='flex-1'>{title}</span>
                      <Check
                        className='text-primary hidden size-4 group-data-[status=active]:block'
                        aria-hidden='true'
                      />
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <ThemeSwitch />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
