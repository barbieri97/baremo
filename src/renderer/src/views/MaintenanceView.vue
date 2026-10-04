<script setup lang="ts">
/**
 * Manutenção (spec §8.3, §14.3).
 *
 * "Backup sem restore não é backup" — daí a lista de backups com data e tamanho
 * e o botão de restaurar, e não apenas a rotina automática.
 */
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import BaseButton from '../components/BaseButton.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import PageHeader from '../components/PageHeader.vue'
import SectionHeader from '../components/SectionHeader.vue'
import BaseCard from '../components/BaseCard.vue'
import BaseAlert from '../components/BaseAlert.vue'
import BaseEmptyState from '../components/BaseEmptyState.vue'
import BaseTable, { type TableColumn } from '../components/BaseTable.vue'
import { AUDIT_ACTION_LABELS } from '@shared/labels'
import type { ChannelOutput } from '@shared/contracts'

const AUDIT_COLUMNS: TableColumn[] = [
  { key: 'when', label: 'Quando' },
  { key: 'action', label: 'Ação' },
  { key: 'entity', label: 'Entidade' },
  { key: 'summary', label: 'Resumo' }
]

const appStore = useAppStore()

const backups = ref<ChannelOutput<'maintenance:listBackups'>>([])
const scan = ref<ChannelOutput<'maintenance:scanFiles'> | null>(null)
const audit = ref<ChannelOutput<'maintenance:listAudit'>>([])
const integrity = ref<{ ok: boolean; detail: string } | null>(null)

const busy = ref(false)
const restoring = ref<string | null>(null)
const restoreOpen = ref(false)
const cleanupOpen = ref(false)

async function load(): Promise<void> {
  try {
    backups.value = await api('maintenance:listBackups')
    audit.value = await api('maintenance:listAudit', { limit: 100 })
  } catch (error) {
    appStore.notifyError(error)
  }
}

onMounted(load)

async function createBackup(): Promise<void> {
  busy.value = true
  try {
    await api('maintenance:createBackup')
    await load()
    appStore.notify('success', 'Backup criado.')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    busy.value = false
  }
}

async function confirmRestore(): Promise<void> {
  if (restoring.value === null) return
  try {
    // O processo principal reinicia o aplicativo logo após restaurar; se
    // chegarmos a ver uma resposta aqui, algo deu errado antes disso.
    await api('maintenance:restoreBackup', { fileName: restoring.value })
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    restoreOpen.value = false
    restoring.value = null
  }
}

async function checkIntegrity(): Promise<void> {
  busy.value = true
  try {
    integrity.value = await api('maintenance:integrityCheck')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    busy.value = false
  }
}

async function runScan(): Promise<void> {
  busy.value = true
  try {
    scan.value = await api('maintenance:scanFiles')
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    busy.value = false
  }
}

async function confirmCleanup(): Promise<void> {
  busy.value = true
  try {
    const outcome = await api('maintenance:cleanupFiles', {
      deleteOrphanBlobs: true,
      removeBrokenReferences: true
    })
    appStore.notify(
      'success',
      `${outcome.blobsDeleted} arquivo(s) órfão(s) removido(s) e ${outcome.referencesRemoved} referência(s) quebrada(s) limpa(s).`
    )
    await runScan()
    await load()
  } catch (error) {
    appStore.notifyError(error)
  } finally {
    busy.value = false
    cleanupOpen.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR')
}
</script>

<template>
  <div class="p-6">
    <PageHeader
      title="Manutenção"
      subtitle="Backups do banco, verificação de integridade, consistência do armazenamento de arquivos e registro de auditoria."
      class="mb-6"
    />

    <div class="grid grid-cols-2 gap-6">
      <BaseCard as="section" padding="lg">
        <SectionHeader title="Backups do banco de dados" size="sm" class="mb-3">
          <template #actions>
            <BaseButton size="sm" :loading="busy" @click="createBackup">Criar backup</BaseButton>
          </template>
        </SectionHeader>

        <p class="mb-3 text-xs text-fg-subtle">
          Um backup preventivo é criado automaticamente antes de cada atualização de estrutura. Os
          dez mais recentes são mantidos. O backup cobre o banco,
          <strong>não os arquivos anexados</strong> — para isso, use "Exportar prontuário" na ficha
          do paciente.
        </p>

        <BaseEmptyState v-if="backups.length === 0" message="Nenhum backup ainda." class="py-4" />

        <ul v-else class="max-h-64 divide-y divide-line overflow-y-auto">
          <li v-for="backup in backups" :key="backup.fileName" class="flex items-center gap-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="truncate font-mono text-xs text-fg-secondary">{{ backup.fileName }}</p>
              <p class="text-xs text-fg-subtle">
                {{ formatDateTime(backup.createdAt) }} · {{ formatSize(backup.sizeBytes) }} ·
                estrutura v{{ backup.schemaVersion }}
              </p>
            </div>
            <BaseButton
              size="sm"
              @click="
                () => {
                  restoring = backup.fileName
                  restoreOpen = true
                }
              "
            >
              Restaurar
            </BaseButton>
          </li>
        </ul>
      </BaseCard>

      <BaseCard as="section" padding="lg">
        <SectionHeader title="Integridade" size="sm" class="mb-3">
          <template #actions>
            <BaseButton size="sm" :loading="busy" @click="checkIntegrity">Verificar</BaseButton>
          </template>
        </SectionHeader>

        <p v-if="integrity === null" class="text-xs text-fg-subtle">
          A verificação também roda automaticamente a cada inicialização.
        </p>
        <p v-else-if="integrity.ok" class="text-sm text-ok">
          Banco íntegro. Nenhum problema encontrado.
        </p>
        <BaseAlert v-else tone="danger" title="Problemas encontrados">
          <pre class="whitespace-pre-wrap text-xs">{{ integrity.detail }}</pre>
          <p class="mt-2 text-xs">Restaure um backup recente.</p>
        </BaseAlert>

        <hr class="my-4 border-line" />

        <SectionHeader title="Armazenamento de arquivos" size="sm" class="mb-3">
          <template #actions>
            <BaseButton size="sm" :loading="busy" @click="runScan">Varrer</BaseButton>
          </template>
        </SectionHeader>

        <p v-if="scan === null" class="text-xs text-fg-subtle">
          Detecta arquivos no disco sem registro no banco (órfãos) e registros sem o arquivo
          correspondente (referências quebradas).
        </p>

        <div v-else class="space-y-2 text-sm">
          <p class="text-fg-secondary">
            <span class="tabular font-semibold">{{ scan.orphanBlobs.length }}</span>
            arquivo(s) órfão(s)
            <span v-if="scan.orphanBlobs.length > 0" class="text-fg-subtle">
              ({{ formatSize(scan.orphanBlobs.reduce((sum, blob) => sum + blob.sizeBytes, 0)) }})
            </span>
          </p>
          <p class="text-fg-secondary">
            <span class="tabular font-semibold">{{ scan.brokenReferences.length }}</span>
            referência(s) quebrada(s)
          </p>

          <BaseAlert
            v-if="scan.brokenReferences.length > 0"
            tone="warn"
            size="sm"
            class="max-h-32 overflow-y-auto"
          >
            <ul>
              <li v-for="reference in scan.brokenReferences" :key="reference.attachmentId">
                {{ reference.originalName }}
              </li>
            </ul>
          </BaseAlert>

          <BaseButton
            v-if="scan.orphanBlobs.length > 0 || scan.brokenReferences.length > 0"
            size="sm"
            variant="danger"
            @click="cleanupOpen = true"
          >
            Limpar
          </BaseButton>
          <p v-else class="text-xs text-ok">Banco e disco estão consistentes.</p>
        </div>
      </BaseCard>
    </div>

    <section class="mt-6">
      <SectionHeader
        title="Registro de auditoria"
        size="sm"
        description="Operações destrutivas e exportações. O histórico de conteúdo dos documentos fica no versionamento de cada documento, não aqui."
        class="mb-2"
      />

      <BaseCard class="max-h-96 overflow-y-auto">
        <BaseTable
          :columns="AUDIT_COLUMNS"
          density="comfortable"
          sticky
          :empty-text="audit.length === 0 ? 'Nenhum registro ainda.' : null"
        >
          <tr v-for="entry in audit" :key="entry.id">
            <td class="whitespace-nowrap tabular text-xs text-fg-subtle">
              {{ formatDateTime(entry.timestamp) }}
            </td>
            <td class="text-fg-secondary">{{ AUDIT_ACTION_LABELS[entry.action] }}</td>
            <td class="font-mono text-xs text-fg-subtle">{{ entry.entity }}</td>
            <td class="text-fg-muted">{{ entry.summary }}</td>
          </tr>
        </BaseTable>
      </BaseCard>
    </section>

    <ConfirmDialog
      v-model:open="restoreOpen"
      title="Restaurar backup"
      message="O banco de dados atual será substituído pelo backup selecionado e o aplicativo será reiniciado. Uma cópia do banco atual é guardada antes da substituição, caso a restauração seja um engano."
      confirm-label="Restaurar e reiniciar"
      @confirm="confirmRestore"
    />

    <ConfirmDialog
      v-model:open="cleanupOpen"
      title="Limpar armazenamento"
      message="Arquivos órfãos serão apagados do disco e registros sem arquivo correspondente serão removidos do banco. Esta ação é irreversível."
      confirm-label="Limpar"
      :busy="busy"
      @confirm="confirmCleanup"
    />
  </div>
</template>
