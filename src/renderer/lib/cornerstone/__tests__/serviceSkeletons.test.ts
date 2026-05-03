/**
 * Skeleton tests for the new Phase 0 services.
 *
 * Phase 0 verifies that:
 *   - Each service exports the expected method shape.
 *   - Unimplemented methods throw a clear error mentioning the service name
 *     and method, so accidental consumption fails loudly rather than silently
 *     returning undefined.
 *
 * Behavioral tests land alongside the implementations in subsequent phases.
 */
import { describe, it, expect } from 'vitest';
import { containerService } from '../containerService';
import { undoService } from '../undoService';
import { viewportLayoutService } from '../viewportLayoutService';
import { transportContractService } from '../transportContractService';

describe('Phase 0 service skeletons', () => {
  describe('containerService', () => {
    it('exposes the expected method names', () => {
      const expected = [
        'createContainer',
        'deleteContainer',
        'renameContainer',
        'createMember',
        'deleteMember',
        'renameMember',
        'recolorMember',
        'setRoiType',
        'getActiveContainer',
        'getActiveMember',
        'setActiveMember',
        'approveContainer',
        'revokeApproval',
        'getApprovalHistory',
      ];
      for (const name of expected) {
        expect(typeof (containerService as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    // Behavioral tests for the implementation live in containerService.test.ts;
    // skeleton tests above only verify the export shape. As of Phase 3.1 the
    // read methods + metadata mutations (rename, approve, revoke) are
    // implemented; member CRUD + container creation still throw with phase
    // pointers and are covered by containerService.test.ts.
  });

  describe('undoService', () => {
    it('exposes the expected method names', () => {
      const expected = ['record', 'undo', 'redo', 'canUndo', 'canRedo', 'clear', 'getHistory'];
      for (const name of expected) {
        expect(typeof (undoService as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    // Behavioral tests for the implementation live in undoService.test.ts;
    // skeleton tests above only verify the export shape. As of Phase 2.7a
    // the service is no longer a stub.
  });

  describe('viewportLayoutService', () => {
    it('exposes the expected method names', () => {
      const expected = ['listPresets', 'getPreset', 'applyPreset', 'getCurrentPresetId'];
      for (const name of expected) {
        expect(typeof (viewportLayoutService as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    // Behavioral tests for the implementation live in viewportLayoutService.test.ts;
    // skeleton tests above only verify the export shape. As of Phase 1.5 the
    // service is no longer a stub.
  });

  describe('transportContractService', () => {
    it('exposes the expected method names', () => {
      const expected = [
        'setTransportAdapter',
        'notifyDirty',
        'cancelPendingSave',
        'saveNow',
        'saveAll',
        'notifyExternalChange',
        'resolveConflict',
        'ingestLoadedContainer',
        'ingestParseError',
      ];
      for (const name of expected) {
        expect(typeof (transportContractService as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    it('throws a clear error from unimplemented methods', () => {
      expect(() => transportContractService.notifyDirty('c-1')).toThrowError(/transportContractService.*not yet implemented/);
    });
  });
});
