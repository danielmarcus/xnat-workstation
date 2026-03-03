# Cornerstone Test Harness

This harness provides deterministic mocks for renderer-side Cornerstone interface tests.

## Files

- `fakeEventTarget.ts`: event bus replacement with listener tracking and explicit `dispatch(type, detail?)`.
- `cornerstoneMocks.ts`: factories for mocked `@cornerstonejs/core`, `@cornerstonejs/tools`, and `@cornerstonejs/adapters` exports, plus mutable test state helpers.
- `resetCornerstoneMocks.ts`: one-call reset for all harness state between tests.
- `fixtures.ts`: canonical IDs and colors used in tests.
- `listenerAssertions.ts`: helper assertions for listener registration and leak checks.

## Typical Usage

```ts
const cs = createCornerstoneMockState();

vi.doMock('@cornerstonejs/core', () => createCoreModuleMock(cs));
vi.doMock('@cornerstonejs/tools', () => createToolsModuleMock(cs));
vi.doMock('@cornerstonejs/adapters', () => createAdaptersModuleMock(cs));

const { annotationService } = await import('../annotationService');
```

Then per test:

1. `resetCornerstoneMocks(cs)`
2. seed state (`cs.setAnnotations(...)`, `cs.setSegmentations(...)`, `cs.setViewportIdsForSegmentation(...)`)
3. call service API
4. assert store sync + mock API calls
5. dispose service and assert no leaked listeners

## Extending Mocks

When a service starts importing a new Cornerstone API:

1. Add the minimal runtime export to `createCoreModuleMock` / `createToolsModuleMock`.
2. Back it with stateful behavior in `createCornerstoneMockState`.
3. Add one focused test that proves our adapter/service calls the new API correctly.

Keep mocks minimal and explicit to avoid accidental coupling to real Cornerstone internals.
