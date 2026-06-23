import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectionCommandApi } from '../../../../shared/api/connection-command-api';
import { localSidecarApi } from '../../../../shared/api/local-sidecar-api';
import { storageApi } from '../../../../shared/api/storage-api';
import { HealthDiagnosticsSettings } from './HealthDiagnosticsSettings';

vi.mock('../../../../shared/api/remote-runtime', async () => {
  const actual = await vi.importActual<typeof import('../../../../shared/api/remote-runtime')>(
    '../../../../shared/api/remote-runtime',
  );
  return {
    ...actual,
    hasEmbeddedTauriRuntime: () => true,
  };
});

vi.mock('../../../../shared/api/local-sidecar-api', () => ({
  localSidecarApi: {
    status: vi.fn(),
  },
}));

vi.mock('../../../../shared/api/connection-command-api', () => ({
  connectionCommandApi: {
    test: vi.fn(),
  },
}));

vi.mock('../../../../shared/api/storage-api', () => ({
  storageApi: {
    list: vi.fn(),
  },
}));

vi.mock('../../../../shared/lib/client-diagnostics', () => ({
  getRecentClientDiagnostics: vi.fn(() => []),
  recordClientDiagnostic: vi.fn(),
}));

function readySidecarStatus() {
  return {
    id: 'sidecar:local',
    status: 'ready',
    configured: true,
    enabled: true,
    config: { enabled: true, executablePath: null },
    ready: true,
    baseUrl: 'http://127.0.0.1:3333',
    logPath: null,
    startupError: null,
    modelDownloaded: true,
    modelDisplayName: 'Local Model',
    modelSize: 1,
    runtime: { installed: true },
    platform: 'windows',
    arch: 'x64',
    curatedModels: [],
    download: null,
  } as unknown as Awaited<ReturnType<typeof localSidecarApi.status>>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('HealthDiagnosticsSettings provider probes', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.mocked(localSidecarApi.status).mockResolvedValue(readySidecarStatus());
    vi.mocked(storageApi.list).mockImplementation(async (entity) => {
      if (entity === 'connections') {
        return [
          { id: 'conn-1', name: 'Main Model', provider: 'openai', model: 'gpt-test' },
          { id: 'conn-2', name: 'Backup Model', provider: 'openai', model: 'gpt-test' },
        ];
      }
      return [];
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.clearAllMocks();
  });

  it('only disables the provider row currently being probed', async () => {
    const firstProbe = deferred<{ success: boolean; latencyMs: number }>();
    vi.mocked(connectionCommandApi.test).mockImplementation(async (connectionId) => {
      if (connectionId === 'conn-1') return firstProbe.promise;
      return { success: true, latencyMs: 5 };
    });

    await act(async () => {
      root = createRoot(container!);
      root.render(<HealthDiagnosticsSettings />);
    });
    await flushAsyncWork();

    const probes = Array.from(container!.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Probe'),
    ) as HTMLButtonElement[];
    expect(probes).toHaveLength(2);

    await act(async () => {
      probes[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsyncWork();

    expect(probes[0].disabled).toBe(true);
    expect(probes[1].disabled).toBe(false);

    await act(async () => {
      probes[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(connectionCommandApi.test).toHaveBeenCalledWith('conn-2');

    await act(async () => {
      firstProbe.resolve({ success: true, latencyMs: 30 });
      await firstProbe.promise;
    });
  });
});