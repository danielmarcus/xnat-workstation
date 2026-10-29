/**
 * @nrgxnat/workstation-extension-api — the SDK an extension builds against
 * (docs/extension-framework.md, design point 6). Everything here is re-exported from the app's
 * own source, so the SDK can never drift from what the app implements.
 */
export { EXTENSION_API_VERSION, apiCompatible, validateExtensionManifest } from '../../../src/shared/extensions/manifest';
export type { ExtensionManifest } from '../../../src/shared/extensions/manifest';
export { EXTENSION_HOST_GLOBAL } from '../../../src/shared/extensions/api';
export type {
  AnnotationInfo,
  ExtensionAnnotations,
  ExtensionEventName,
  ExtensionEvents,
  ExtensionViewer,
  ExtensionXnat,
  MainChannel,
  OpenSession,
  RendererChannel,
  XnatRequestInit,
  XnatResourceFile,
  XnatResponse,
  XnatSessionRef,
  XnatUser,
  CommandSpec,
  Dispose,
  ExtensionCommands,
  ExtensionUi,
  KeyBinding,
  SettingsPageSpec,
  SidebarTabSpec,
  SlotComponent,
  ToolbarItemHandle,
  ToolbarItemSpec,
  ViewSpec,
  ExtensionContextBase,
  ExtensionPart,
  MainExtensionContext,
  MainPart,
  RendererExtensionContext,
  RendererPart,
} from '../../../src/shared/extensions/api';
