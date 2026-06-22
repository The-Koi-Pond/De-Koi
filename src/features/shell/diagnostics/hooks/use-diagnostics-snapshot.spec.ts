import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRemoteRuntimeHealth } from '../../../../shared/api/remote-runtime';
import { localSidecarApi } from '../../../../shared/api/local-sidecar-api';
import { storageApi } from '../../../../shared/api/storage-api';
import { buildTroubleshootingPacket } from '../lib/diagnostics-model';
import { createDiagnosticsSnapshot } from './use-diagnostics-snapshot';

const remoteRuntimeMock = vi.hoisted(() => ({
  embedded: false,
  health: vi.fn(),
}));

vi.mock('../../../../shared/api/remote-runtime', () => ({
  hasEmbeddedTauriRuntime: () => remoteRuntimeMock.embedded,
  checkRemoteRuntimeHealth: remoteRuntimeMock.health,
}));

vi.mock('../../../../shared/api/local-sidecar-api', () => ({
  localSidecarApi: {
    status: vi.fn(),
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

describe('createDiagnosticsSnapshot', () => {
  beforeEach(() => {
    remoteRuntimeMock.embedded = false;
    remoteRuntimeMock.health.mockReset();
    vi.mocked(localSidecarApi.status).mockResolvedValue(readySidecarStatus());
    vi.mocked(storageApi.list).mockImplementation(async (entity) => {
      if (entity === 'connections') {
        return [
          { id: 'conn-1', name: 'Main Model', provider: 'openai', model: 'gpt-test' },
          { id: '', name: 'Broken Provider', provider: 'openai', model: 'gpt-test' },
        ];
      }
      return [];
    });
  });

  it('keeps unrelated sections when one section rejects', async () => {
    vi.mocked(checkRemoteRuntimeHealth).mockRejectedValue(new Error('runtime offline'));

    const snapshot = await createDiagnosticsSnapshot('http://runtime.test');
    const runtime = snapshot.sections.find((section) => section.id === 'runtime');
    const sidecar = snapshot.sections.find((section) => section.id === 'sidecar');
    const storage = snapshot.sections.find((section) => section.id === 'storage');

    expect(snapshot.overallStatus).toBe('error');
    expect(runtime?.status).toBe('error');
    expect(runtime?.items[0]?.summary).toBe('runtime offline');
    expect(sidecar?.status).toBe('ok');
    expect(storage?.items.some((item) => item.id === 'storage-chats')).toBe(true);
  });

  it('reports malformed provider rows instead of silently dropping them', async () => {
    vi.mocked(checkRemoteRuntimeHealth).mockResolvedValue({ status: 'ok', message: 'Runtime ready.', health: { ok: true } });

    const snapshot = await createDiagnosticsSnapshot('http://runtime.test');
    const providers = snapshot.sections.find((section) => section.id === 'providers');
    const packet = buildTroubleshootingPacket(snapshot);

    expect(providers?.items.map((item) => item.label)).toEqual(['Main Model', 'Broken Provider']);
    expect(providers?.items.find((item) => item.id === 'provider-invalid-1')?.status).toBe('error');
    expect(JSON.stringify(packet)).toContain('missing-id');
  });
});