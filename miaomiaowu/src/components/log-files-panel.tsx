import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HardDrive, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'

type LogFile = {
  name: string
  size: number
  modified: string
  // 正在被写入的文件。删除它只会截断(不能 unlink,进程还持着 fd),UI 上要说清楚。
  active: boolean
}

type FilesResp = {
  files?: LogFile[]
  total_size?: number
  dir?: string
}

type PurgeTarget = { all: true } | { name: string }

function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/**
 * LogFilesPanel 日志文件占用与清理(data/logs)。
 *
 * 后端对"当前正在写入的文件"执行截断而非删除 —— 那个文件被进程持有 fd,
 * unlink 后日志会继续写进已删除的 inode(空间不释放、页面也看不到新行)。
 * 所以这里对 active 文件把按钮文案写成"清空",避免用户以为删除失败。
 */
export function LogFilesPanel() {
  const queryClient = useQueryClient()
  const queryKey = ['admin-log-files']
  const [confirm, setConfirm] = useState<PurgeTarget | null>(null)

  const filesQuery = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (await api.get<FilesResp>('/api/admin/logs/files', { signal })).data,
    retry: false,
    meta: { showErrorInPage: true },
  })

  const purgeMutation = useMutation({
    networkMode: 'always',
    mutationFn: async (target: PurgeTarget) => {
      await api.delete('/api/admin/logs/files', {
        params: 'all' in target ? { all: '1' } : { name: target.name },
      })
    },
    onSuccess: async () => {
      setConfirm(null)
      toast.success('已清理')
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey })
    },
  })

  const data = filesQuery.data
  const files = data?.files ?? []
  const canPurge = filesQuery.isSuccess && !filesQuery.isFetching
  const confirmAll = confirm !== null && 'all' in confirm
  const confirmName = confirm && 'name' in confirm ? confirm.name : undefined
  const confirmFile = files.find((file) => file.name === confirmName)
  const canConfirm = canPurge && (confirmAll ? files.length > 0 : !!confirmFile)

  return (
    <div className='border'>
      <div className='flex flex-wrap items-center gap-2 border-b px-3 py-2'>
        <HardDrive className='text-muted-foreground h-4 w-4' />
        <span className='text-sm font-medium'>日志文件</span>
        {data && (
          <span className='text-muted-foreground text-xs'>
            共 {files.length} 个 · {formatBytes(data.total_size ?? 0)}
          </span>
        )}
        {data?.dir && (
          <span className='text-muted-foreground hidden text-xs sm:inline'>
            · {data.dir}
          </span>
        )}
        <div className='ml-auto flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            aria-label='刷新日志文件'
            title='刷新日志文件'
            onClick={() => void filesQuery.refetch()}
            disabled={filesQuery.isFetching || purgeMutation.isPending}
          >
            <RefreshCw
              className={`h-4 w-4 ${filesQuery.isFetching ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button
            variant='destructive'
            size='sm'
            onClick={() => setConfirm({ all: true })}
            disabled={
              !canPurge || files.length === 0 || purgeMutation.isPending
            }
          >
            清空全部
          </Button>
        </div>
      </div>

      {filesQuery.isError && (
        <div className='flex flex-wrap items-center justify-between gap-2 px-3 py-2'>
          <p role='alert' className='text-destructive text-sm'>
            {data
              ? '日志文件刷新失败，当前显示上次加载的结果。'
              : '加载日志文件失败。'}
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void filesQuery.refetch()}
            disabled={filesQuery.isFetching || purgeMutation.isPending}
          >
            {filesQuery.isFetching ? '正在重试…' : '重试加载日志文件'}
          </Button>
        </div>
      )}
      {filesQuery.isLoading && (
        <p role='status' className='text-muted-foreground p-3 text-sm'>
          正在加载日志文件…
        </p>
      )}
      {filesQuery.isSuccess && files.length === 0 && (
        <div className='text-muted-foreground p-3 text-sm'>暂无日志文件</div>
      )}
      {files.length > 0 && (
        <ul className='divide-y'>
          {files.map((f) => (
            <li
              key={f.name}
              className='flex flex-wrap items-center gap-2 px-3 py-2 text-sm'
            >
              <span className='min-w-0 font-mono text-xs break-all'>
                {f.name}
              </span>
              {f.active && (
                <Badge variant='secondary' className='text-[10px]'>
                  写入中
                </Badge>
              )}
              <span className='text-muted-foreground text-xs'>
                {formatBytes(f.size)}
              </span>
              <span className='text-muted-foreground hidden text-xs sm:inline'>
                {f.modified}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='text-muted-foreground hover:text-destructive ml-auto'
                onClick={() => setConfirm({ name: f.name })}
                disabled={!canPurge || purgeMutation.isPending}
                aria-label={`${f.active ? '清空' : '删除'} ${f.name}`}
                title={
                  f.active ? '清空该文件内容(文件本身会保留)' : '删除该文件'
                }
              >
                <Trash2 className='h-4 w-4' />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !purgeMutation.isPending) {
            purgeMutation.reset()
            setConfirm(null)
          }
        }}
        title={confirmAll ? '清空全部日志文件？' : '清理日志文件？'}
        desc={
          confirmAll
            ? '历史日志文件将被删除，当前正在写入的文件会被清空并保留。此操作不可撤销。'
            : confirmFile?.active
              ? `「${confirmName}」正在写入，将清空其内容并保留文件。此操作不可撤销。`
              : `将删除「${confirmName ?? ''}」。此操作不可撤销。`
        }
        confirmText={
          purgeMutation.isPending
            ? '清理中…'
            : purgeMutation.isError
              ? '重试清理'
              : '确定'
        }
        cancelBtnText='取消'
        destructive
        disabled={!canConfirm}
        isLoading={purgeMutation.isPending}
        handleConfirm={() => {
          if (confirm && canConfirm && !purgeMutation.isPending) {
            purgeMutation.mutate(confirm)
          }
        }}
      >
        {purgeMutation.isError && (
          <p role='alert' className='text-destructive text-sm'>
            清理失败，请检查文件列表后重试。
          </p>
        )}
        {filesQuery.isError ? (
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <p role='alert' className='text-destructive text-sm'>
              无法确认当前日志文件列表。
            </p>
            <Button
              variant='outline'
              size='sm'
              onClick={() => void filesQuery.refetch()}
              disabled={filesQuery.isFetching}
            >
              重试加载日志文件
            </Button>
          </div>
        ) : (
          canPurge &&
          !canConfirm && (
            <p role='status' className='text-muted-foreground text-sm'>
              当前没有对应的日志文件可清理。
            </p>
          )
        )}
      </ConfirmDialog>
    </div>
  )
}
