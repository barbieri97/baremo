/**
 * Rotas do aplicativo.
 *
 * Histórico em memória, e não `createWebHistory`: em produção a interface é
 * servida por um esquema customizado (`app://`), e um histórico baseado em URL
 * levaria o Electron a tentar navegar de verdade — justamente o que o guarda de
 * `will-navigate` bloqueia (§13.1).
 */

import { createRouter, createMemoryHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/pacientes' },
  {
    path: '/pacientes',
    name: 'patients',
    component: () => import('../views/PatientsView.vue')
  },
  {
    path: '/pacientes/:id',
    name: 'patient',
    component: () => import('../views/PatientView.vue'),
    props: true
  },
  {
    path: '/avaliacoes/:id',
    name: 'assessment',
    component: () => import('../views/AssessmentView.vue'),
    props: true
  },
  {
    path: '/avaliacoes/:id/resultados',
    name: 'assessment-results',
    component: () => import('../views/ResultsView.vue'),
    props: true
  },
  {
    path: '/documentos/:id',
    name: 'document',
    component: () => import('../views/DocumentView.vue'),
    props: true
  },
  {
    path: '/pacientes/:patientId/assistente',
    name: 'assistant',
    component: () => import('../views/AssistantView.vue'),
    props: true
  },
  {
    path: '/funcoes',
    name: 'cognitive-functions',
    component: () => import('../views/CognitiveFunctionsView.vue')
  },
  {
    path: '/instrumentos',
    name: 'instruments',
    component: () => import('../views/InstrumentsView.vue')
  },
  {
    path: '/manutencao',
    name: 'maintenance',
    component: () => import('../views/MaintenanceView.vue')
  },
  {
    path: '/configuracoes',
    name: 'settings',
    component: () => import('../views/SettingsView.vue')
  }
]

export const router = createRouter({
  history: createMemoryHistory(),
  routes
})
