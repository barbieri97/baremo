/**
 * Contexto que `BaseField` oferece aos controles dentro dele.
 *
 * É o que liga rótulo, mensagem de erro e controle sem que cada tela precise
 * repassar `id`, `aria-describedby` e o estado inválido à mão — e esquecer um
 * deles quebra o `getByLabel` dos testes e o leitor de tela ao mesmo tempo.
 */
import { inject, type ComputedRef, type InjectionKey } from 'vue'

export interface FieldContext {
  id: ComputedRef<string>
  describedBy: ComputedRef<string | undefined>
  invalid: ComputedRef<boolean>
}

export const FIELD_CONTEXT: InjectionKey<FieldContext> = Symbol('field-context')

export function useFieldContext(): FieldContext | null {
  return inject(FIELD_CONTEXT, null)
}

export type ControlSize = 'xs' | 'sm' | 'md'

/** Aparência comum de input, select e textarea. */
export function controlClasses(size: ControlSize, invalid: boolean): string[] {
  const sizes: Record<ControlSize, string> = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-2.5 py-1',
    md: 'px-2.5 py-2'
  }

  return [
    'w-full rounded-control border text-fg disabled:cursor-not-allowed disabled:opacity-60',
    sizes[size],
    invalid ? 'border-danger bg-danger-soft' : 'border-line-strong bg-surface'
  ]
}
