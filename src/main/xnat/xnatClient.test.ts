import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  cookieSet: vi.fn(async () => undefined),
  cookieRemove: vi.fn(async () => undefined),
  readFile: vi.fn(() => ({ dict: {}, meta: {} })),
  naturalizeDataset: vi.fn(() => ({})),
  denaturalizeDataset: vi.fn(() => ({})),
}));

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      fetch: mocks.fetch,
      cookies: {
        set: mocks.cookieSet,
        remove: mocks.cookieRemove,
      },
    },
  },
}));

vi.mock('dcmjs', () => ({
  data: {
    DicomMessage: {
      readFile: mocks.readFile,
    },
    DicomMetaDictionary: {
      naturalizeDataset: mocks.naturalizeDataset,
      denaturalizeDataset: mocks.denaturalizeDataset,
    },
    DicomDict: vi.fn(function MockDicomDict(this: any) {
      this.dict = {};
      this.write = () => new ArrayBuffer(0);
    }),
  },
}));

import { XnatAuthError, XnatClient } from './xnatClient';

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('XnatClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets auth from browser login and builds combined cookie headers', async () => {
    const client = new XnatClient('https://xnat.example/');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [
        { name: 'AWSALB', value: 'alb-token', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
      ],
      csrfToken: 'csrf-123',
    });

    expect(client.serverUrl).toBe('https://xnat.example');
    expect(client.currentUsername).toBe('dan');
    expect(client.isAuthenticated).toBe(true);
    expect(mocks.cookieSet).toHaveBeenCalledTimes(2);
    expect(mocks.cookieSet).toHaveBeenNthCalledWith(1, {
      url: 'https://xnat.example',
      name: 'JSESSIONID',
      value: 'J1',
    });
    expect(client.buildAuthHeaders()).toEqual({
      Cookie: 'JSESSIONID=J1; AWSALB=alb-token',
    });
  });

  it('authenticatedFetch enforces auth/disconnect checks and maps HTTP errors', async () => {
    const client = new XnatClient('https://xnat.example');

    await expect(client.authenticatedFetch('/data/projects')).rejects.toBeInstanceOf(XnatAuthError);

    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });
    client.markDisconnected();
    await expect(client.authenticatedFetch('/data/projects')).rejects.toBeInstanceOf(XnatAuthError);

    const client2 = new XnatClient('https://xnat.example');
    await client2.setAuthFromBrowserLogin({
      jsessionId: 'J2',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });
    mocks.fetch.mockResolvedValueOnce(new Response('expired', { status: 401 }));
    await expect(client2.authenticatedFetch('/data/projects')).rejects.toThrow(XnatAuthError);

    mocks.fetch.mockResolvedValueOnce(new Response('server issue', { status: 500 }));
    await expect(client2.authenticatedFetch('/data/projects')).rejects.toThrow('XNAT API error: 500 server issue');
  });

  it('appends CSRF token for mutating requests and uses fallback user-agent when absent', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: 'csrf-token',
    });

    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await client.authenticatedFetch('/data/experiments/E1', { method: 'PUT' });
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://xnat.example/data/experiments/E1?XNAT_CSRF=csrf-token',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
      }),
    );

    const noCsrfClient = new XnatClient('https://xnat.example');
    await noCsrfClient.setAuthFromBrowserLogin({
      jsessionId: 'J2',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await noCsrfClient.authenticatedFetch('/data/experiments/E2', { method: 'POST', headers: { 'X-Test': '1' } });
    const fetchOptions = mocks.fetch.mock.calls[1][1] as RequestInit;
    const headers = new Headers(fetchOptions.headers as HeadersInit);
    expect(headers.get('X-Test')).toBe('1');
    expect(headers.get('User-Agent')).toBe('XNATDesktopClient');
  });

  it('filters DICOM resources in getScanFiles', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });

    mocks.fetch.mockResolvedValueOnce(
      makeJsonResponse({
        ResultSet: {
          Result: [
            { Name: 'image1.dcm', URI: '/a' },
            { Name: 'image2.jpg', URI: '/b' },
            { Name: 'image3', URI: '/c' },
            { Name: 'other.bin', URI: '/d', collection: 'DICOM' },
          ],
        },
      }),
    );
    const uris = await client.getScanFiles('XNAT_E001', '11');

    expect(uris).toEqual(['/a', '/c', '/d']);
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/data/experiments/XNAT_E001/scans/11/files?format=json'),
      expect.any(Object),
    );
  });

  it('resolves SOPClassUID when getScans includes SOP UID metadata probing', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });

    mocks.fetch
      .mockResolvedValueOnce(
        makeJsonResponse({
          ResultSet: {
            Result: [{ ID: '11', xsiType: 'xnat:ctScanData', type: 'AXIAL' }],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          ResultSet: {
            Result: [{ Name: 'image1.dcm', URI: '/data/uri/1' }],
          },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    mocks.naturalizeDataset.mockImplementationOnce(() => ({ SOPClassUID: '1.2.3.4' }));

    const scans = await client.getScans('XNAT_E001', { includeSopClassUID: true });
    expect(scans).toEqual([
      expect.objectContaining({
        id: '11',
        sopClassUID: '1.2.3.4',
      }),
    ]);
  });

  it('prepares DICOM uploads with routing lookup and derived scan-id selection', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });

    mocks.fetch
      .mockResolvedValueOnce(
        makeJsonResponse({
          items: [
            {
              data_fields: {
                ID: 'E1',
                project: 'P1',
                subject_ID: 'S1',
                label: 'Session 1',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          ResultSet: {
            Result: [{ ID: '3011' }],
          },
        }),
      );

    const prepared = await client.prepareDicomForUpload(
      'SEG',
      'P1',
      'S1',
      'E1',
      'Session 1',
      '11',
      Buffer.from([1, 2, 3]),
      undefined,
      'Series Label',
    );
    expect(prepared.scanId).toBe('3111');
    expect(Buffer.isBuffer(prepared.dicomBuffer)).toBe(true);

    await expect(
      client.prepareDicomForUpload(
        'SEG',
        'P1',
        'S1',
        'E1',
        'Session 1',
        '11',
        Buffer.from([1, 2, 3]),
        'bad-scan-id',
      ),
    ).rejects.toThrow('Cannot stamp SeriesNumber from non-numeric scan ID: bad-scan-id');
  });

  it('uploads and overwrites SEG/RTSTRUCT scans with deterministic error mapping', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });

    mocks.fetch
      .mockResolvedValueOnce(
        makeJsonResponse({
          items: [
            {
              data_fields: {
                ID: 'E1',
                project: 'P1',
                subject_ID: 'S1',
                label: 'Session 1',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeJsonResponse({ ResultSet: { Result: [] } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));

    const segUpload = await client.uploadDicomSegAsScan(
      'P1',
      'S1',
      'E1',
      'Session 1',
      '11',
      Buffer.from([1, 2, 3]),
      'My SEG',
    );
    expect(segUpload.scanId).toBe('3011');
    expect(segUpload.url).toContain('/data/experiments/E1/scans/3011');

    mocks.fetch
      .mockResolvedValueOnce(
        makeJsonResponse({
          items: [
            {
              data_fields: {
                ID: 'E1',
                project: 'P1',
                subject_ID: 'S1',
                label: 'Session 1',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(makeJsonResponse({ ResultSet: { Result: [] } }))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

    await expect(
      client.uploadDicomRtStructAsScan(
        'P1',
        'S1',
        'E1',
        'Session 1',
        '11',
        Buffer.from([1, 2, 3]),
        'My RT',
      ),
    ).rejects.toThrow('Permission denied: you do not have write access to this project');

    mocks.fetch
      .mockResolvedValueOnce(new Response('delete failed', { status: 500 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const segOverwrite = await client.overwriteDicomSegInScan('E1', '17', Buffer.from([1, 2, 3]), 'Seg Series');
    expect(segOverwrite.scanId).toBe('17');

    mocks.fetch
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('upload failed', { status: 500 }));
    await expect(
      client.overwriteDicomRtStructInScan('E1', '18', Buffer.from([1, 2, 3]), 'RT Series'),
    ).rejects.toThrow('Failed to overwrite RTSTRUCT in scan 18: 500 upload failed');
  });

  it('auto-saves temp DICOM data and maps permission errors', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });

    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 200 }));
    const saved = await client.autoSaveToTemp('XNAT_E001', '11', Buffer.from([1, 2]), 'autosave_seg_11.dcm');
    expect(saved.url).toContain('/resources/temp/files/autosave_seg_11.dcm');

    mocks.fetch.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    await expect(
      client.autoSaveToTemp('XNAT_E001', '11', Buffer.from([1, 2]), 'autosave_seg_11.dcm'),
    ).rejects.toThrow('Permission denied: you do not have write access to this session');
  });

  it('handles temp-resource list/delete/download behaviors', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });

    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(client.listTempFiles('XNAT_E001')).resolves.toEqual([]);

    mocks.fetch.mockResolvedValueOnce(
      makeJsonResponse({
        ResultSet: {
          Result: [{ Name: 'autosave_seg_11.dcm', URI: '/temp/1', Size: '42' }],
        },
      }),
    );
    await expect(client.listTempFiles('XNAT_E001')).resolves.toEqual([
      { name: 'autosave_seg_11.dcm', uri: '/temp/1', size: 42 },
    ]);

    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(client.deleteTempFile('XNAT_E001', 'missing.dcm')).resolves.toBeUndefined();

    mocks.fetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await expect(client.deleteTempFile('XNAT_E001', 'bad.dcm')).rejects.toThrow(
      'Failed to delete temp file bad.dcm: 500 boom',
    );

    const bytes = new Uint8Array([1, 2, 3, 4]);
    mocks.fetch.mockResolvedValueOnce(
      new Response(bytes, { status: 200, headers: { 'content-type': 'application/dicom' } }),
    );
    const buffer = await client.downloadTempFile('XNAT_E001', 'autosave_seg_11.dcm');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(Array.from(buffer.values())).toEqual([1, 2, 3, 4]);
  });

  it('clears cookies and local auth state deterministically', async () => {
    const client = new XnatClient('https://xnat.example');
    await client.setAuthFromBrowserLogin({
      jsessionId: 'J1',
      username: 'dan',
      serverCookies: [
        { name: 'AWSALB', value: 'alb' },
        { name: 'AWSALBCORS', value: 'cors' },
      ],
      csrfToken: 'csrf',
    });

    client.clearCookies();
    expect(mocks.cookieRemove).toHaveBeenCalledWith('https://xnat.example', 'AWSALB');
    expect(mocks.cookieRemove).toHaveBeenCalledWith('https://xnat.example', 'AWSALBCORS');
    expect(mocks.cookieRemove).toHaveBeenCalledWith('https://xnat.example', 'JSESSIONID');
    expect(client.isAuthenticated).toBe(false);
    expect(client.currentUsername).toBe('');
    expect(() => client.buildAuthHeaders()).toThrow(XnatAuthError);
  });
});
