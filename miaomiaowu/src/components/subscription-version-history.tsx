import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ClashConfigViewer } from '@/components/clash-config-viewer'
import { ConfirmDialog } from '@/components/confirm-dialog'

type SavedVersion = {
  Version: number
  Content: string
  CreatedAt: string
  CreatedBy: string
}

type SubscriptionVersionHistoryProps = {
  filename: string
  currentContent: string
  canLoad: boolean
  hasDraft: boolean
  onLoad: (content: string, version: number) => void
}

const versionDate = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function SubscriptionVersionHistory({
  filename,
  currentContent,
  canLoad,
  hasDraft,
  onLoad,
}: SubscriptionVersionHistoryProps) {
  const [selectedVersion, setSelectedVersion] = useState('')
  const [restoreTarget, setRestoreTarget] = useState<SavedVersion | null>(null)
  const historyQuery = useQuery({
    queryKey: ['subscribe-file-history', filename],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<{ history: SavedVersion[] | null }>(
        `/api/admin/rules/${encodeURIComponent(filename)}/history`,
        { signal }
      )
      return data.history ?? []
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    meta: { showErrorInPage: true },
  })

  if (historyQuery.isError) {
    return (
      <div className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-3'>
        <p role='alert' className='text-destructive text-sm'>
          读取历史版本失败。
        </p>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={historyQuery.isFetching}
          onClick={() => void historyQuery.refetch()}
        >
          {historyQuery.isFetching ? '正在重试…' : '重试加载版本'}
        </Button>
      </div>
    )
  }

  if (historyQuery.isPending) {
    return (
      <p role='status' className='text-muted-foreground text-sm'>
        正在加载历史版本…
      </p>
    )
  }

  const versions = historyQuery.data
  const version =
    versions.find(({ Version }) => String(Version) === selectedVersion) ??
    versions[0]
  if (!version) {
    return <p className='text-muted-foreground text-sm'>暂无历史版本</p>
  }

  const matchesCurrent = canLoad && currentContent === version.Content
  const downloadFilename = filename.replace(
    /(\.ya?ml)$/i,
    `-v${version.Version}$1`
  )

  return (
    <div className='min-w-0 space-y-3'>
      <div className='flex flex-wrap items-end gap-3'>
        <div className='w-full space-y-1.5 sm:max-w-xs'>
          <Label htmlFor='subscription-version'>选择历史版本</Label>
          <Select
            value={String(version.Version)}
            onValueChange={setSelectedVersion}
          >
            <SelectTrigger id='subscription-version' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((entry) => (
                <SelectItem key={entry.Version} value={String(entry.Version)}>
                  v{entry.Version} ·{' '}
                  {versionDate.format(new Date(entry.CreatedAt))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type='button'
          variant='outline'
          disabled={!canLoad || matchesCurrent}
          onClick={() => {
            if (hasDraft) setRestoreTarget(version)
            else onLoad(version.Content, version.Version)
          }}
        >
          {matchesCurrent ? '与编辑器内容一致' : '载入编辑器'}
        </Button>
      </div>
      {version.CreatedBy && (
        <p className='text-muted-foreground text-xs break-all'>
          保存者 {version.CreatedBy}
        </p>
      )}
      {!canLoad && (
        <p className='text-muted-foreground text-xs'>
          读取当前配置后可载入版本。
        </p>
      )}
      <ClashConfigViewer
        key={version.Version}
        value={version.Content}
        height={280}
        downloadFilename={downloadFilename}
      />
      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null)
        }}
        title='替换当前草稿'
        desc={`载入 v${restoreTarget?.Version ?? ''} 会替换编辑器中的未保存修改。`}
        cancelBtnText='取消'
        confirmText='载入版本'
        disabled={!canLoad}
        destructive
        handleConfirm={() => {
          if (!restoreTarget || !canLoad) return
          onLoad(restoreTarget.Content, restoreTarget.Version)
          setRestoreTarget(null)
        }}
      />
    </div>
  )
}
