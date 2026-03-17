/**
 * Typed IPC channel constants shared between main and preload processes.
 *
 * renderer → main (invoke/handle):
 *   XNAT_BROWSER_LOGIN, XNAT_LOGOUT, XNAT_VALIDATE, XNAT_GET_CONNECTION, XNAT_DICOMWEB_FETCH,
 *   XNAT_GET_PROJECT_SESSIONS,
 *   XNAT_UPLOAD_DICOM_SEG, XNAT_UPLOAD_DICOM_RTSTRUCT, XNAT_OVERWRITE_DICOM_SEG,
 *   XNAT_AUTOSAVE_TEMP, XNAT_LIST_TEMP_FILES, XNAT_DELETE_TEMP_FILE, XNAT_DOWNLOAD_TEMP_FILE
 *
 * main → renderer (send/on):
 *   XNAT_SESSION_EXPIRED
 */
export const IPC = {
  // Auth (renderer → main)
  XNAT_BROWSER_LOGIN: 'xnat:browser-login',
  XNAT_LOGOUT: 'xnat:logout',
  XNAT_VALIDATE: 'xnat:validate-session',
  XNAT_GET_CONNECTION: 'xnat:get-connection',

  // Proxied DICOMweb (renderer → main)
  XNAT_DICOMWEB_FETCH: 'xnat:dicomweb-fetch',

  // XNAT REST API browsing (renderer → main)
  XNAT_GET_PROJECTS: 'xnat:get-projects',
  XNAT_GET_SUBJECTS: 'xnat:get-subjects',
  XNAT_GET_SESSIONS: 'xnat:get-sessions',
  XNAT_GET_SCANS: 'xnat:get-scans',
  XNAT_GET_SCAN_FILES: 'xnat:get-scan-files',
  XNAT_GET_PROJECT_SESSIONS: 'xnat:get-project-sessions',

  // XNAT download (renderer → main)
  XNAT_DOWNLOAD_SCAN_FILE: 'xnat:download-scan-file',

  // XNAT upload (renderer → main)
  XNAT_UPLOAD_DICOM_SEG: 'xnat:upload-dicom-seg',
  XNAT_UPLOAD_DICOM_RTSTRUCT: 'xnat:upload-dicom-rtstruct',
  XNAT_OVERWRITE_DICOM_SEG: 'xnat:overwrite-dicom-seg',
  XNAT_OVERWRITE_DICOM_RTSTRUCT: 'xnat:overwrite-dicom-rtstruct',
  XNAT_PREPARE_DICOM_UPLOAD: 'xnat:prepare-dicom-upload',

  // XNAT temp resource (auto-save, renderer → main)
  XNAT_AUTOSAVE_TEMP: 'xnat:autosave-temp',
  XNAT_LIST_TEMP_FILES: 'xnat:list-temp-files',
  XNAT_DELETE_TEMP_FILE: 'xnat:delete-temp-file',
  XNAT_DOWNLOAD_TEMP_FILE: 'xnat:download-temp-file',

  // Session events (main → renderer)
  XNAT_SESSION_EXPIRED: 'xnat:session-expired',

  // Export (renderer → main)
  EXPORT_SAVE_SCREENSHOT: 'export:save-screenshot',
  EXPORT_COPY_CLIPBOARD: 'export:copy-clipboard',
  EXPORT_COPY_VIEWPORT_CAPTURE: 'export:copy-viewport-capture',
  EXPORT_SAVE_DICOM: 'export:save-dicom',
  EXPORT_SAVE_DICOM_SEG: 'export:save-dicom-seg',
  EXPORT_SAVE_ALL_SLICES: 'export:save-all-slices',
  EXPORT_SAVE_REPORT: 'export:save-report',
  EXPORT_SAVE_DICOM_RTSTRUCT: 'export:save-dicom-rtstruct',
  EXPORT_SAVE_VIEWPORT_CAPTURE: 'export:save-viewport-capture',

  // Shell (renderer → main)
  SHELL_OPEN_EXTERNAL: 'shell:open-external',

  // Local backup cache (renderer → main)
  BACKUP_WRITE_FILE: 'backup:write-file',
  BACKUP_READ_FILE: 'backup:read-file',
  BACKUP_DELETE_FILE: 'backup:delete-file',
  BACKUP_LIST_SESSION: 'backup:list-session',
  BACKUP_READ_MANIFEST: 'backup:read-manifest',
  BACKUP_WRITE_MANIFEST: 'backup:write-manifest',
  BACKUP_DELETE_SESSION: 'backup:delete-session',
  BACKUP_LIST_ALL_SESSIONS: 'backup:list-all-sessions',
  BACKUP_GET_CACHE_PATH: 'backup:get-cache-path',

  // Diagnostics (renderer → main)
  DIAGNOSTICS_GET_MAIN_SNAPSHOT: 'diagnostics:get-main-snapshot',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
