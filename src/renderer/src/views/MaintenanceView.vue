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
import { AUDIT_ACTION_LABELS } from '@shared/labels'
import type { ChannelOutput } from '@shared/contracts'

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
    <header class="mb-5">
      <h1 class="text-xl font-bold text-ink-800">Manutenção</h1>
      <p class="text-sm text-ink-500">
        Backups do banco, verificação de integridade, consistência do armazenamento de arquivos e
        registro de auditoria.
      </p>
    </header>

    <div class="grid grid-cols-2 gap-6">
      <section class="card p-5">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-800">Backups do banco de dados</h2>
          <BaseButton size="sm" :loading="busy" @click="createBackup">Criar backup</BaseButton>
        </div>

        <p class="mb-3 text-xs text-ink-500">
          Um backup preventivo é criado automaticamente antes de cada atualização de estrutura. Os
          dez mais recentes são mantidos. O backup cobre o banco, <strong>não os arquivos
          anexados</strong> — para isso, use "Exportar prontuário" na ficha do paciente.
        </p>

        <p v-if="backups.length === 0" class="py-4 text-center text-sm text-ink-400">
          Nenhum backup ainda.
        </p>

        <ul v-else class="max-h-64 divide-y divide-ink-200 overflow-y-auto">
          <li v-for="backup in backups" :key="backup.fileName" class="flex items-center gap-3 py-2">
            <div class="min-w-0 flex-1">
              <p class="truncate font-mono text-xs text-ink-700">{{ backup.fileName }}</p>
              <p class="text-xs text-ink-500">
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
      </section>

      <section class="card p-5">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-800">Integridade</h2>
          <BaseButton size="sm" :loading="busy" @click="checkIntegrity">Verificar</BaseButton>
        </div>

        <p v-if="integrity === null" class="text-xs text-ink-500">
          A verificação também roda automaticamente a cada inicialização.
        </p>
        <p v-else-if="integrity.ok" class="text-sm text-ok-500">
          Banco íntegro. Nenhum problema encontrado.
        </p>
        <div v-else class="rounded bg-danger-50 p-3">
          <p class="text-sm font-semibold text-danger-600">Problemas encontrados</p>
          <pre class="mt-1 whitespace-pre-wrap text-xs text-danger-600">{{ integrity.detail }}</pre>
          <p class="mt-2 text-xs text-danger-600">Restaure um backup recente.</p>
        </div>

        <hr class="my-4 border-ink-200" />

        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-ink-800">Armazenamento de arquivos</h2>
          <BaseButton size="sm" :loading="busy" @click="runScan">Varrer</BaseButton>
        </div>

        <p v-if="scan === null" class="text-xs text-ink-500">
          Detecta arquivos no disco sem registro no banco (órfãos) e registros sem o arquivo
          correspondente (referências quebradas).
        </p>

        <div v-else class="space-y-2 text-sm">
          <p class="text-ink-700">
            <span class="tabular font-semibold">{{ scan.orphanBlobs.length }}</span>
            arquivo(s) órfão(s)
            <span v-if="scan.orphanBlobs.length > 0" class="text-ink-500">
              ({{ formatSize(scan.orphanBlobs.reduce((sum, blob) => sum + blob.sizeBytes, 0)) }})
            </span>
          </p>
          <p class="text-ink-700">
            <span class="tabular font-semibold">{{ scan.brokenReferences.length }}</span>
            referência(s) quebrada(s)
          </p>

          <ul
            v-if="scan.brokenReferences.length > 0"
            class="max-h-32 overflow-y-auto rounded bg-warn-50 p-2 text-xs text-warn-700"
          >
            <li v-for="reference in scan.brokenReferences" :key="reference.attachmentId">
              {{ reference.originalName }}
            </li>
          </ul>

          <BaseButton
            v-if="scan.orphanBlobs.length > 0 || scan.brokenReferences.length > 0"
            size="sm"
            variant="danger"
            @click="cleanupOpen = true"
          >
            Limpar
          </BaseButton>
          <p v-else class="text-xs text-ok-500">Banco e disco estão consistentes.</p>
        </div>
      </section>
    </div>

    <section class="mt-6">
      <h2 class="mb-2 text-sm font-semibold text-ink-800">Registro de auditoria</h2>
      <p class="mb-2 text-xs text-ink-500">
        Operações destrutivas e exportações. O histórico de conteúdo dos documentos fica no
        versionamento de cada documento, não aqui.
      </p>

      <div class="card max-h-96 overflow-y-auto">
        <table class="w-full text-sm">
          <thead class="sticky top-0 bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th class="px-4 py-2 text-left font-semibold">Quando</th>
              <th class="px-4 py-2 text-left font-semibold">Ação</th>
              <th class="px-4 py-2 text-left font-semibold">Entidade</th>
              <th class="px-4 py-2 text-left font-semibold">Resumo</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="audit.length === 0">
              <td colspan="4" class="px-4 py-8 text-center text-ink-400">
                Nenhum registro ainda.
              </td>
            </tr>
            <tr v-for="entry in audit" :key="entry.id" class="border-t border-ink-200">
              <td class="whitespace-nowrap px-4 py-2 tabular text-xs text-ink-500">
                {{ formatDateTime(entry.timestamp) }}
              </td>
              <td class="px-4 py-2 text-ink-700">{{ AUDIT_ACTION_LABELS[entry.action] }}</td>
              <td class="px-4 py-2 font-mono text-xs text-ink-500">{{ entry.entity }}</td>
              <td class="px-4 py-2 text-ink-600">{{ entry.summary }}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
