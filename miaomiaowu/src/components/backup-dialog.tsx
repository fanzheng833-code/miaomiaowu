import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Download, Upload, HardDrive, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/confirm-dialog'

interface BackupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BackupDialog({ open, onOpenChange }: BackupDialogProps) {
  const fileInputId = useId()
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [restoreFailed, setRestoreFailed] = useState(false)

  // Download backup
  const handleDownload = async () => {
    if (isBusy) return
    setDownloadFailed(false)
    setIsDownloading(true)
    try {
      const response = await api.get('/api/admin/backup/download', {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .slice(0, 19)
      link.setAttribute('download', `miaomiaowu-backup-${timestamp}.zip`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      toast.success('备份下载成功')
    } catch {
      setDownloadFailed(true)
    } finally {
      setIsDownloading(false)
    }
  }

  // Restore backup
  const restoreMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('backup', file)
      return api.post('/api/admin/backup/restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      toast.success('备份已恢复，页面即将刷新')
      setBackupFile(null)
      setConfirmRestore(false)
      onOpenChange(false)
      // Reload page after a short delay
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    },
    onError: () => setRestoreFailed(true),
  })

  const isBusy =
    isDownloading || restoreMutation.isPending || restoreMutation.isSuccess

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (confirmRestore || restoreMutation.isPending) return
      setBackupFile(null)
      setDownloadFailed(false)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <HardDrive className='size-5' /> 数据备份
          </DialogTitle>
          <DialogDescription>
            备份包含数据库和订阅文件，恢复后页面会自动刷新
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6'>
          {/* Download backup */}
          <div className='space-y-2'>
            <Label>下载备份</Label>
            <Button
              onClick={handleDownload}
              disabled={isBusy}
              className='w-full'
            >
              <Download className='mr-2 size-4' />
              {isDownloading ? '正在生成备份…' : '下载当前数据备份'}
            </Button>
            {downloadFailed && (
              <p role='alert' className='text-destructive text-sm'>
                备份下载失败，可以重试。
              </p>
            )}
          </div>

          {/* Restore backup */}
          <div className='space-y-3'>
            <Label htmlFor={fileInputId}>选择备份文件</Label>
            <Input
              id={fileInputId}
              type='file'
              accept='.zip'
              onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
              disabled={isBusy}
              className='cursor-pointer'
            />
            <ConfirmDialog
              open={confirmRestore}
              onOpenChange={(nextOpen) => {
                if (restoreMutation.isPending) return
                setRestoreFailed(false)
                setConfirmRestore(nextOpen)
              }}
              trigger={
                <Button
                  disabled={!backupFile || isBusy}
                  variant='destructive'
                  className='w-full'
                >
                  <Upload className='mr-2 size-4' />
                  恢复备份
                </Button>
              }
              title='确认恢复备份'
              desc={
                <p>
                  将使用{' '}
                  <strong className='break-all'>{backupFile?.name}</strong>{' '}
                  覆盖当前数据，恢复后页面会自动刷新。
                </p>
              }
              cancelBtnText='取消'
              confirmText={
                restoreMutation.isPending
                  ? '恢复中…'
                  : restoreFailed
                    ? '重试恢复'
                    : '确认恢复'
              }
              destructive
              disabled={!backupFile || isBusy}
              isLoading={restoreMutation.isPending}
              handleConfirm={() => {
                if (!backupFile || isBusy) return
                setRestoreFailed(false)
                restoreMutation.mutate(backupFile)
              }}
            >
              {restoreFailed && (
                <p role='alert' className='text-destructive text-sm'>
                  恢复失败，已保留所选文件。可以重试，或取消后选择其他备份。
                </p>
              )}
            </ConfirmDialog>
            <div className='text-muted-foreground flex items-start gap-2 text-xs'>
              <AlertTriangle className='text-destructive size-4 shrink-0' />
              <span>恢复备份将覆盖当前所有数据，请谨慎操作</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
