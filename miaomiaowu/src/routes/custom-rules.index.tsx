import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'

import { DataTable } from '@/components/data-table'
import type { DataTableColumn } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { RULE_TEMPLATES, RULE_PROVIDER_RULES } from '../config/custom-rules-templates'
import { OVERRIDE_SCRIPT_TEMPLATES } from '@/config/override-script-templates'

export const Route = createFileRoute('/custom-rules/')({
  component: OverrideManagementPage,
})

interface CustomRule {
  id: number
  name: string
  type: 'dns' | 'rules' | 'rule-providers'
  mode: 'replace' | 'prepend' | 'append'
  content: string
  enabled: boolean
  created_at: string
  updated_at: string
}

interface OverrideScript {
  id: number
  name: string
  hook: 'post_fetch' | 'pre_save_nodes'
  content: string
  enabled: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

interface OverrideItem {
  id: number
  name: string
  kind: 'rule' | 'script'
  type: 'dns' | 'rules' | 'rule-providers' | 'script'
  mode?: string
  hook?: string
  content: string
  enabled: boolean
  sort_order?: number
  created_at: string
  updated_at: string
}

type OverrideType = 'dns' | 'rules' | 'rule-providers' | 'script'

interface FormData {
  name: string
  type: OverrideType
  mode: string
  hook: string
  content: string
  enabled: boolean
  sort_order: number
}

const HOOK_LABELS: Record<string, string> = {
  post_fetch: '转换为客户端配置前',
  pre_save_nodes: '保存外部订阅节点前',
}

function ruleToItem(rule: CustomRule): OverrideItem {
  return {
    id: rule.id,
    name: rule.name,
    kind: 'rule',
    type: rule.type,
    mode: rule.mode,
    content: rule.content,
    enabled: rule.enabled,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  }
}

function scriptToItem(script: OverrideScript): OverrideItem {
  return {
    id: script.id,
    name: script.name,
    kind: 'script',
    type: 'script',
    hook: script.hook,
    content: script.content,
    enabled: script.enabled,
    sort_order: script.sort_order,
    created_at: script.created_at,
    updated_at: script.updated_at,
  }
}

function OverrideManagementPage() {
  const queryClient = useQueryClient()
  const [filterType, setFilterType] = useState<string>('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<OverrideItem | null>(null)
  const [deletingItem, setDeletingItem] = useState<OverrideItem | null>(null)
  const [formData, setFormData] = useState<FormData>({
    name: '',
    type: 'dns',
    mode: 'replace',
    hook: 'post_fetch',
    content: '',
    enabled: true,
    sort_order: 0,
  })
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [isRuleProviderConfirmOpen, setIsRuleProviderConfirmOpen] = useState(false)
  const [providerCreated, setProviderCreated] = useState(false)
  const [savingProvider, setSavingProvider] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const rulesQuery = useQuery({
    queryKey: ['custom-rules'],
    queryFn: async ({ signal }) => {
      const response = await api.get<CustomRule[]>('/api/admin/custom-rules', { signal })
      return response.data
    },
    retry: false,
    meta: { showErrorInPage: true },
  })

  const scriptsQuery = useQuery({
    queryKey: ['override-scripts'],
    queryFn: async ({ signal }) => {
      const response = await api.get<OverrideScript[]>('/api/admin/override-scripts', { signal })
      return response.data
    },
    retry: false,
    meta: { showErrorInPage: true },
  })

  const rules = rulesQuery.data ?? []
  const scripts = scriptsQuery.data ?? []
  const listErrors = [
    { name: '覆写规则', query: rulesQuery },
    { name: '覆写脚本', query: scriptsQuery },
  ].filter(({ query }) => query.isError)
  const isLoading = rulesQuery.isLoading || scriptsQuery.isLoading

  const allItems: OverrideItem[] = [
    ...rules.map(ruleToItem),
    ...scripts.map(scriptToItem),
  ]

  const filteredItems = filterType
    ? allItems.filter((item) => item.type === filterType)
    : allItems

  // Rule mutations
  const createRuleMutation = useMutation({
    mutationFn: async (data: { name: string; type: string; mode: string; content: string; enabled: boolean }) => {
      if (data.enabled && data.mode === 'replace') {
        const conflicting = rules.filter(
          (r) => r.type === data.type && r.mode === 'replace' && r.enabled
        )
        for (const c of conflicting) {
          await api.put(`/api/admin/custom-rules/${c.id}`, { ...c, enabled: false })
        }
      }
      const response = await api.post('/api/admin/custom-rules', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
      toast.success('覆写规则已创建')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '创建规则时出错')
    },
  })

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name: string; type: string; mode: string; content: string; enabled: boolean }) => {
      if (data.enabled && data.mode === 'replace') {
        const conflicting = rules.filter(
          (r) => r.id !== id && r.type === data.type && r.mode === 'replace' && r.enabled
        )
        for (const c of conflicting) {
          await api.put(`/api/admin/custom-rules/${c.id}`, { ...c, enabled: false })
        }
      }
      const response = await api.put(`/api/admin/custom-rules/${id}`, data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
      toast.success('覆写规则已更新')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '更新规则时出错')
    },
  })

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/api/admin/custom-rules/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
      toast.success('覆写规则已删除')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '删除规则时出错')
    },
  })

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const rule = rules.find((r) => r.id === id)
      if (!rule) throw new Error('规则不存在')
      if (enabled && rule.mode === 'replace') {
        const conflicting = rules.filter(
          (r) => r.id !== id && r.type === rule.type && r.mode === 'replace' && r.enabled
        )
        for (const c of conflicting) {
          await api.put(`/api/admin/custom-rules/${c.id}`, { ...c, enabled: false })
        }
      }
      await api.put(`/api/admin/custom-rules/${id}`, { ...rule, enabled })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-rules'] })
      toast.success('状态已更新')
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || '更新状态时出错')
    },
  })

  // Script mutations
  const createScriptMutation = useMutation({
    mutationFn: async (data: { name: string; hook: string; content: string; enabled: boolean; sort_order: number }) => {
      return api.post('/api/admin/override-scripts', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
      toast.success('覆写脚本已创建')
    },
    onError: () => toast.error('创建脚本时出错'),
  })

  const updateScriptMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name: string; hook: string; content: string; enabled: boolean; sort_order: number }) => {
      return api.put(`/api/admin/override-scripts/${id}`, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
      toast.success('覆写脚本已更新')
    },
    onError: () => toast.error('更新脚本时出错'),
  })

  const deleteScriptMutation = useMutation({
    mutationFn: async (id: number) => {
      return api.delete(`/api/admin/override-scripts/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
      toast.success('覆写脚本已删除')
    },
    onError: () => toast.error('删除脚本时出错'),
  })

  const toggleScriptMutation = useMutation({
    mutationFn: async ({ id, script, enabled }: { id: number; script: OverrideScript; enabled: boolean }) => {
      return api.put(`/api/admin/override-scripts/${id}`, {
        name: script.name,
        hook: script.hook,
        content: script.content,
        enabled,
        sort_order: script.sort_order,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['override-scripts'] })
      toast.success('状态已更新')
    },
  })

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'dns',
      mode: 'replace',
      hook: 'post_fetch',
      content: '',
      enabled: true,
      sort_order: 0,
    })
    setEditingItem(null)
    setSelectedTemplate(null)
    setProviderCreated(false)
    setSaveFailed(false)
  }

  const closeEditor = () => {
    setIsDialogOpen(false)
    setIsRuleProviderConfirmOpen(false)
    resetForm()
  }

  const handleCreate = () => {
    resetForm()
    setIsDialogOpen(true)
  }

  const handleEdit = (item: OverrideItem) => {
    setSaveFailed(false)
    setEditingItem(item)
    setFormData({
      name: item.name,
      type: item.type,
      mode: item.mode || 'replace',
      hook: item.hook || 'post_fetch',
      content: item.content,
      enabled: item.enabled,
      sort_order: item.sort_order || 0,
    })
    setIsDialogOpen(true)
  }

  const handleDelete = (item: OverrideItem) => {
    setDeletingItem(item)
    setIsDeleteDialogOpen(true)
  }

  const handleDeleteConfirm = () => {
    if (!deletingItem) return
    if (deletingItem.kind === 'rule') {
      deleteRuleMutation.mutate(deletingItem.id)
    } else {
      deleteScriptMutation.mutate(deletingItem.id)
    }
    setIsDeleteDialogOpen(false)
    setDeletingItem(null)
  }

  const handleToggle = (item: OverrideItem, enabled: boolean) => {
    if (item.kind === 'rule') {
      toggleRuleMutation.mutate({ id: item.id, enabled })
    } else {
      const script = scripts.find((s) => s.id === item.id)
      if (script) {
        toggleScriptMutation.mutate({ id: item.id, script, enabled })
      }
    }
  }

  const handleSubmit = async () => {
    if (isSaving || needsRulesForSave) return
    setSaveFailed(false)
    if (!formData.name.trim()) {
      toast.error('请输入名称')
      return
    }
    if (!formData.content.trim()) {
      toast.error('请输入内容')
      return
    }

    // Rule: check rule-provider template confirmation
    if (!editingItem && formData.type === 'rule-providers' && selectedTemplate && selectedTemplate in RULE_PROVIDER_RULES) {
      setIsRuleProviderConfirmOpen(true)
      return
    }

    const { name, type, mode, hook, content, enabled, sort_order } = formData
    try {
      if (type === 'script') {
        const scriptData = { name, hook, content, enabled, sort_order }
        if (editingItem) {
          await updateScriptMutation.mutateAsync({ id: editingItem.id, ...scriptData })
        } else {
          await createScriptMutation.mutateAsync(scriptData)
        }
      } else {
        const ruleData = { name, type, mode, content, enabled }
        if (editingItem) {
          await updateRuleMutation.mutateAsync({ id: editingItem.id, ...ruleData })
        } else {
          await createRuleMutation.mutateAsync(ruleData)
        }
      }
      closeEditor()
    } catch {
      setSaveFailed(true)
    }
  }

  const handleRuleProviderConfirm = async (createRuleConfig: boolean) => {
    if (isSaving) return
    setSavingProvider(true)
    setSaveFailed(false)
    try {
      if (!providerCreated) {
        const { name, type, mode, content, enabled } = formData
        await createRuleMutation.mutateAsync({ name, type, mode, content, enabled })
        setProviderCreated(true)
      }

      if (createRuleConfig && selectedTemplate && selectedTemplate in RULE_PROVIDER_RULES) {
        const ruleContent = RULE_PROVIDER_RULES[selectedTemplate as keyof typeof RULE_PROVIDER_RULES]
        const { data: latestRules } = await api.get<CustomRule[]>('/api/admin/custom-rules')
        const existingRulesRules = latestRules.filter((r) => r.type === 'rules')
        let finalRuleContent = ruleContent

        if (existingRulesRules && existingRulesRules.length > 0) {
          const allExistingLines: string[] = []
          existingRulesRules.forEach((rule: CustomRule) => {
            const lines = rule.content.split('\n').map((l: string) => l.trim()).filter((l: string) => l)
            allExistingLines.push(...lines.slice(1))
          })
          const newLines = ruleContent.split('\n').map((l: string) => l.trim()).filter((l: string) => l)
          const existingLinesLower = allExistingLines.map((l: string) => l.toLowerCase())
          const filteredNewLines = newLines.filter((l: string) => !existingLinesLower.includes(l.toLowerCase()))
          if (filteredNewLines.length > 0) {
            finalRuleContent = filteredNewLines.join('\n')
          }
        }

        await createRuleMutation.mutateAsync({
          name: `路由规则 - ${formData.name}`,
          type: 'rules',
          mode: 'append',
          content: finalRuleContent,
          enabled: true,
        })
        toast.success('规则集和规则配置已创建')
      } else {
        toast.success('规则集已创建')
      }
      closeEditor()
    } catch {
      setSaveFailed(true)
    } finally {
      setSavingProvider(false)
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'dns': return 'DNS'
      case 'rules': return '规则'
      case 'rule-providers': return '规则集'
      case 'script': return '脚本'
      default: return type
    }
  }

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'dns':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:bg-blue-500/20 dark:text-blue-400 dark:border-blue-500/30'
      case 'rules':
        return 'bg-green-500/10 text-green-700 border-green-500/20 dark:bg-green-500/20 dark:text-green-400 dark:border-green-500/30'
      case 'rule-providers':
        return 'bg-purple-500/10 text-purple-700 border-purple-500/20 dark:bg-purple-500/20 dark:text-purple-400 dark:border-purple-500/30'
      case 'script':
        return 'bg-orange-500/10 text-orange-700 border-orange-500/20 dark:bg-orange-500/20 dark:text-orange-400 dark:border-orange-500/30'
      default:
        return ''
    }
  }

  const getModeOrHookLabel = (item: OverrideItem) => {
    if (item.kind === 'script') {
      return HOOK_LABELS[item.hook || ''] || item.hook || '-'
    }
    switch (item.mode) {
      case 'replace': return '替换'
      case 'prepend': return '添加至头部'
      case 'append': return '添加至尾部'
      default: return item.mode || '-'
    }
  }

  const isScript = formData.type === 'script'
  const needsRulesForSave =
    !isScript && formData.enabled && formData.mode === 'replace' && !rulesQuery.data

  const isSaving =
    savingProvider ||
    createRuleMutation.isPending ||
    updateRuleMutation.isPending ||
    createScriptMutation.isPending ||
    updateScriptMutation.isPending

  return (
    <main className='mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 pt-24'>
      <div className='space-y-6'>
        <div className='flex flex-wrap items-start justify-between gap-3 sm:items-center'>
          <div>
            <h1 className='text-3xl font-bold'>覆写管理</h1>
            <p className='text-muted-foreground mt-2'>
              管理 DNS、规则、规则集和覆写脚本的自定义配置
            </p>
          </div>
          <Button onClick={handleCreate}>
            <Plus className='mr-2 h-4 w-4' />
            添加覆写设置
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <CardTitle>覆写列表</CardTitle>
                <CardDescription>{filteredItems.length} 条覆写设置</CardDescription>
              </div>
              <Tabs value={filterType} onValueChange={setFilterType}>
                <TabsList>
                  <TabsTrigger value=''>全部</TabsTrigger>
                  <TabsTrigger value='dns'>DNS</TabsTrigger>
                  <TabsTrigger value='rules'>规则</TabsTrigger>
                  <TabsTrigger value='rule-providers'>规则集</TabsTrigger>
                  <TabsTrigger value='script'>脚本</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent>
            {listErrors.map(({ name, query }) => (
              <div key={name} className='mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2'>
                <p role='alert' className='text-destructive text-sm'>
                  {query.data ? `${name}更新失败，已保留上次加载的结果。` : `加载${name}失败。`}
                </p>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  disabled={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  {query.isFetching ? '正在重试…' : `重试加载${name}`}
                </Button>
              </div>
            ))}
            {isLoading ? (
              <div role='status' className='text-center py-8 text-muted-foreground'>正在加载覆写设置…</div>
            ) : filteredItems.length > 0 || listErrors.length === 0 ? (
              <DataTable
                data={filteredItems}
                getRowKey={(item) => `${item.kind}-${item.id}`}
                emptyText='暂无覆写设置'
                columns={[
                  {
                    header: '名称',
                    cell: (item) => item.name,
                    cellClassName: 'font-medium',
                  },
                  {
                    header: '类型',
                    cell: (item) => (
                      <Badge variant='outline' className={getTypeBadgeClass(item.type)}>
                        {getTypeLabel(item.type)}
                      </Badge>
                    ),
                  },
                  {
                    header: '模式/钩子',
                    cell: (item) => getModeOrHookLabel(item),
                  },
                  {
                    header: '状态',
                    cell: (item) => (
                      <div className='flex items-center gap-2'>
                        <Switch
                          checked={item.enabled}
                          onCheckedChange={(checked) => handleToggle(item, checked)}
                          disabled={toggleRuleMutation.isPending || toggleScriptMutation.isPending}
                        />
                        <span className='text-sm text-muted-foreground'>
                          {item.enabled ? '启用' : '禁用'}
                        </span>
                      </div>
                    ),
                  },
                  {
                    header: '创建时间',
                    cell: (item) => (
                      <span className='text-sm text-muted-foreground'>
                        {new Date(item.created_at).toLocaleString('zh-CN')}
                      </span>
                    ),
                  },
                  {
                    header: '操作',
                    cell: (item) => (
                      <div className='flex justify-end gap-2'>
                        <Button variant='ghost' size='icon' aria-label={`编辑 ${item.name}`} onClick={() => handleEdit(item)}>
                          <Pencil className='h-4 w-4' />
                        </Button>
                        <Button variant='ghost' size='icon' aria-label={`删除 ${item.name}`} onClick={() => handleDelete(item)}>
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      </div>
                    ),
                    headerClassName: 'text-right',
                    cellClassName: 'text-right',
                  },
                ] as DataTableColumn<OverrideItem>[]}
                mobileCard={{
                  header: (item) => (
                    <div className='space-y-1'>
                      <div className='flex items-start justify-between gap-2'>
                        <div className='flex items-center gap-2 flex-1 min-w-0'>
                          <Badge variant='outline' className={`${getTypeBadgeClass(item.type)} shrink-0`}>
                            {getTypeLabel(item.type)}
                          </Badge>
                          <div className='font-medium text-sm truncate flex-1 min-w-0'>{item.name}</div>
                        </div>
                        <Button
                          variant='outline'
                          size='icon'
                          className='size-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10'
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(item)
                          }}
                        >
                          <Trash2 className='size-4' />
                        </Button>
                      </div>
                      <div className='flex items-center justify-between gap-4 text-xs'>
                        <div className='flex items-center gap-2 min-w-0'>
                          <span className='text-muted-foreground shrink-0'>
                            {item.kind === 'script' ? '钩子:' : '模式:'}
                          </span>
                          <span className='truncate'>{getModeOrHookLabel(item)}</span>
                        </div>
                        <div className='flex items-center gap-2 shrink-0'>
                          <span className='text-muted-foreground shrink-0'>状态:</span>
                          <div className='flex items-center gap-2'>
                            <Switch
                              checked={item.enabled}
                              onCheckedChange={(checked) => handleToggle(item, checked)}
                              disabled={toggleRuleMutation.isPending || toggleScriptMutation.isPending}
                            />
                            <span>{item.enabled ? '启用' : '禁用'}</span>
                          </div>
                        </div>
                      </div>
                      <div className='flex items-center gap-2 text-xs'>
                        <span className='text-muted-foreground shrink-0'>创建时间:</span>
                        <span>{new Date(item.created_at).toLocaleString('zh-CN')}</span>
                      </div>
                    </div>
                  ),
                  fields: [],
                  actions: (item) => (
                    <Button variant='outline' size='sm' className='w-full' onClick={() => handleEdit(item)}>
                      <Pencil className='mr-1 h-4 w-4' />
                      编辑
                    </Button>
                  ),
                }}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isSaving && !isRuleProviderConfirmOpen) closeEditor()
        }}
      >
        <DialogContent
          className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'
          aria-busy={isSaving}
          showCloseButton={!isSaving}
        >
          <DialogHeader>
            <DialogTitle>
              {editingItem ? '编辑覆写设置' : '添加覆写设置'}
            </DialogTitle>
            <DialogDescription>
              {isScript
                ? '脚本需要定义 main 函数，接收配置对象并返回修改后的结果'
                : editingItem
                  ? '修改自定义规则配置'
                  : '创建新的自定义规则'}
            </DialogDescription>
          </DialogHeader>

          {saveFailed && !isRuleProviderConfirmOpen && (
            <p role='alert' className='text-destructive text-sm'>保存失败，输入已保留。请修改后重试或直接重新保存。</p>
          )}
          {needsRulesForSave && (
            <div className='flex flex-wrap items-center gap-2'>
              <p role={rulesQuery.isError ? 'alert' : 'status'} className='text-muted-foreground text-sm'>
                {rulesQuery.isError ? '请重新加载现有规则后再保存替换规则。' : '正在加载现有规则…'}
              </p>
              {rulesQuery.isError && (
                <Button type='button' size='sm' variant='outline' disabled={rulesQuery.isFetching} onClick={() => void rulesQuery.refetch()}>
                  重试加载覆写规则
                </Button>
              )}
            </div>
          )}
          {/* 顶部操作区 */}
          <div className='flex items-center justify-between border-b pb-4'>
            <div className='flex items-center space-x-2'>
              <Switch
                id='enabled'
                checked={formData.enabled}
                disabled={isSaving}
                onCheckedChange={(checked) => setFormData({ ...formData, enabled: checked })}
              />
              <Label htmlFor='enabled'>启用</Label>
            </div>
            <div className='flex items-center space-x-2'>
              <Button variant='outline' disabled={isSaving} onClick={closeEditor}>
                取消
              </Button>
              <Button onClick={() => void handleSubmit()} disabled={isSaving || needsRulesForSave}>
                {isSaving ? '保存中...' : '保存'}
              </Button>
            </div>
          </div>

          <div className='space-y-4 py-4'>
            <div className='space-y-2'>
              <Label htmlFor='name'>名称</Label>
              <Input
                id='name'
                value={formData.name}
                disabled={isSaving}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder='覆写设置名称'
              />
            </div>

            <div className={`grid grid-cols-2 gap-4 ${!editingItem && !isScript ? 'sm:grid-cols-4' : ''}`}>
              <div className='space-y-2'>
                <Label htmlFor='type'>类型</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: any) => {
                    const newFormData = { ...formData, type: value }
                    if (value === 'dns') newFormData.mode = 'replace'
                    if (value === 'script') newFormData.hook = formData.hook || 'post_fetch'
                    setFormData(newFormData)
                    setSelectedTemplate(null)
                  }}
                  disabled={!!editingItem || isSaving}
                >
                  <SelectTrigger id='type'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='dns'>DNS</SelectItem>
                    <SelectItem value='rules'>规则</SelectItem>
                    <SelectItem value='rule-providers'>规则集</SelectItem>
                    <SelectItem value='script'>脚本</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {isScript ? (
                <div className='space-y-2'>
                  <Label htmlFor='hook'>钩子</Label>
                  <Select
                    value={formData.hook}
                    disabled={isSaving}
                    onValueChange={(value) => setFormData({ ...formData, hook: value })}
                  >
                    <SelectTrigger id='hook'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='post_fetch'>转换为客户端配置前</SelectItem>
                      <SelectItem value='pre_save_nodes'>保存外部订阅节点前</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className='space-y-2'>
                  <Label htmlFor='mode'>模式</Label>
                  <Select
                    value={formData.mode}
                    onValueChange={(value: any) => setFormData({ ...formData, mode: value })}
                    disabled={formData.type === 'dns' || isSaving}
                  >
                    <SelectTrigger id='mode'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='replace'>替换</SelectItem>
                      <SelectItem value='prepend'>添加至头部</SelectItem>
                      <SelectItem value='append'>添加至尾部</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* 模板选择 - 仅在新建时显示 */}
              {!editingItem && !isScript && (
                <div className='space-y-2 col-span-2'>
                  <Label htmlFor='template'>模板（可选）</Label>
                  <Select
                    value={selectedTemplate || 'none'}
                    disabled={isSaving}
                    onValueChange={(value: string) => {
                      if (value === 'none') {
                        setSelectedTemplate(null)
                        return
                      }
                      const templates = RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES]
                      const template = templates[value as keyof typeof templates] as { name: string; content: string } | undefined
                      if (template) {
                        setSelectedTemplate(value)
                        const allTemplates = RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES]
                        const isTemplateName = Object.values(allTemplates).some((t: any) => t.name === formData.name)
                        setFormData({
                          ...formData,
                          name: formData.name === '' || isTemplateName ? template.name : formData.name,
                          content: template.content,
                        })
                      }
                    }}
                  >
                    <SelectTrigger id='template'>
                      <SelectValue placeholder='选择模板或手动输入' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='none'>不使用模板</SelectItem>
                      {Object.entries(RULE_TEMPLATES[formData.type as keyof typeof RULE_TEMPLATES] || {}).map(
                        ([key, template]) => (
                          <SelectItem key={key} value={key}>
                            {template.name}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* 脚本模板 */}
              {!editingItem && isScript && (
                <div className='space-y-2'>
                  <Label>模板（可选）</Label>
                  <Select
                    disabled={isSaving}
                    onValueChange={(templateName) => {
                      const hookTemplates = OVERRIDE_SCRIPT_TEMPLATES[formData.hook as keyof typeof OVERRIDE_SCRIPT_TEMPLATES] || []
                      const template = hookTemplates.find((t) => t.name === templateName)
                      if (template) {
                        setFormData((prev) => ({ ...prev, content: template.content }))
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder='选择模板填充内容' />
                    </SelectTrigger>
                    <SelectContent>
                      {(OVERRIDE_SCRIPT_TEMPLATES[formData.hook as keyof typeof OVERRIDE_SCRIPT_TEMPLATES] || []).map((t) => (
                        <SelectItem key={t.name} value={t.name}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className='space-y-2'>
              <Label htmlFor='content'>
                {isScript ? '脚本内容' : '规则内容（YAML 格式）'}
              </Label>
              <Textarea
                id='content'
                value={formData.content}
                disabled={isSaving}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder={
                  isScript
                    ? `function main(${formData.hook === 'post_fetch' ? 'config' : 'proxies'}) {\n  // ...\n  return ${formData.hook === 'post_fetch' ? 'config' : 'proxies'};\n}`
                    : '输入 YAML 格式的规则内容...'
                }
                className='font-mono text-sm min-h-[300px] whitespace-pre-wrap break-all [field-sizing:fixed]'
              />
              <p className='text-xs text-muted-foreground'>
                {isScript
                  ? '脚本需要定义 main 函数，接收配置对象并返回修改后的结果'
                  : '请确保内容符合 YAML 格式规范'}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              此操作无法撤销。确定要删除这条覆写设置吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleteRuleMutation.isPending || deleteScriptMutation.isPending}
            >
              {deleteRuleMutation.isPending || deleteScriptMutation.isPending ? '删除中...' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rule Provider Confirmation Dialog */}
      <AlertDialog
        open={isRuleProviderConfirmOpen}
        onOpenChange={(open) => {
          if (open || isSaving) return
          if (providerCreated) {
            closeEditor()
          } else {
            setIsRuleProviderConfirmOpen(false)
            setSaveFailed(false)
          }
        }}
      >
        <AlertDialogContent aria-busy={isSaving}>
          <AlertDialogHeader>
            <AlertDialogTitle>创建规则配置</AlertDialogTitle>
            <AlertDialogDescription>
              检测到您使用了规则集模板，是否同时创建对应的规则配置？
              <br /><br />
              规则配置将会追加到现有规则的末尾，系统会自动去除重复的规则（忽略大小写）。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {saveFailed && (
            <p role='alert' className='text-destructive text-sm'>
              {providerCreated ? '规则集已创建。规则配置保存失败，可以单独重试。' : '保存失败，输入已保留，可以重试。'}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>
              {providerCreated ? '完成' : '返回编辑'}
            </AlertDialogCancel>
            {!providerCreated && (
              <Button variant='outline' disabled={isSaving} onClick={() => void handleRuleProviderConfirm(false)}>
                仅创建规则集
              </Button>
            )}
            <Button disabled={isSaving} onClick={() => void handleRuleProviderConfirm(true)}>
              {isSaving ? '保存中...' : providerCreated ? '重试创建规则配置' : '创建规则集和规则配置'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
