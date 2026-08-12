import mermaid from 'mermaid';

export const ZENUML_PLUGIN_VERSION = '0.2.3';
export const ZENUML_CORE_VERSION = '3.50.1';

export type ZenUmlRuntimeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready' }
  | { error: string; status: 'load-failed' };

type ZenUmlPlugin = Awaited<ReturnType<ZenUmlPluginLoader>>;
type ZenUmlPluginLoader = () => Promise<{
  default: Parameters<typeof mermaid.registerExternalDiagrams>[0][number];
}>;
type ZenUmlRegistrar = (plugin: ZenUmlPlugin['default']) => Promise<void>;

export interface ZenUmlRuntime {
  ensureRegistered: () => Promise<void>;
  getSnapshot: () => ZenUmlRuntimeState;
  subscribe: (listener: () => void) => () => void;
}

export function getZenUmlRuntimePresentation(source: string, state: ZenUmlRuntimeState): { loading: boolean; modeLabel: string | null } {
  if (!isZenUmlSource(source)) return { loading: false, modeLabel: null };
  if (state.status === 'loading') return { loading: true, modeLabel: 'ZenUML · loading plugin' };
  if (state.status === 'load-failed') return { loading: false, modeLabel: 'ZenUML · plugin unavailable' };
  return { loading: false, modeLabel: null };
}

/**
 * A failed import is retained just like a successful registration. Repeated
 * renders must not create an import/retry storm or register the detector twice.
 */
export function createZenUmlRuntime(
  load: ZenUmlPluginLoader,
  register: ZenUmlRegistrar,
): ZenUmlRuntime {
  let state: ZenUmlRuntimeState = { status: 'idle' };
  let registration: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: ZenUmlRuntimeState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    ensureRegistered() {
      if (registration) return registration;
      publish({ status: 'loading' });
      registration = load()
        .then(({ default: plugin }) => register(plugin))
        .then(() => { publish({ status: 'ready' }); })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : 'The bundled ZenUML plugin could not be loaded.';
          publish({ error: detail, status: 'load-failed' });
          throw new Error(`ZenUML plugin unavailable: ${detail}`, { cause: error });
        });
      return registration;
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const runtime = createZenUmlRuntime(
  () => import('@mermaid-js/mermaid-zenuml'),
  async (plugin) => { await mermaid.registerExternalDiagrams([plugin]); },
);

export function isZenUmlSource(source: string): boolean {
  const withoutFrontmatter = source.replace(/^\s*---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/u, '');
  return /^\s*zenuml(?:\s|$)/iu.test(withoutFrontmatter);
}

/** Built-ins return synchronously without touching or awaiting the plugin. */
export function prepareMermaidRuntimeForSource(source: string): void | Promise<void> {
  if (isZenUmlSource(source)) return runtime.ensureRegistered();
}

export const getZenUmlRuntimeSnapshot = runtime.getSnapshot;
export const subscribeZenUmlRuntime = runtime.subscribe;
