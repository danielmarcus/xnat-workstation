// ESLint flat config — layering-boundary enforcement only.
//
// Implements the architecture-doc §2.3 import-boundary zones (the Phase-0
// "layering contract") with the built-in `no-restricted-imports` rule. ONLY the
// boundary rule is enabled — this is not a style/lint pass — so a run surfaces
// exactly the cross-layer import violations and nothing else.
//
// Dependencies point strictly downward (Components → Hooks → Services → Stores
// → Cornerstone). Legacy violations are quarantined per-line with a
// `// eslint-disable-next-line no-restricted-imports -- BOUNDARY-DEBT: <phase>`
// comment so the rule is ON from day one for new code while legacy debt stays
// visible + counted (architecture doc §2.3; Phase 6 asserts zero remain).
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

const REACT = ['react', 'react-dom', 'react/**', 'react-dom/**'];
const CORNERSTONE = ['@cornerstonejs/**'];
const libGlobs = (sub) => [`**/lib/${sub}/**`, `@renderer/lib/${sub}/**`, `@/renderer/lib/${sub}/**`];
const dirGlobs = (dir) => [`**/${dir}/**`, `@renderer/${dir}/**`, `@/renderer/${dir}/**`];

export default [
  { ignores: ['dist/**', 'release/**', 'node_modules/**', 'coverage/**', 'e2e/**', 'scripts/**'] },

  // Base: parse TS/TSX. No rules enabled here — zones below add the boundary
  // rule. react-hooks is registered (not enabled) only so pre-existing
  // `// eslint-disable react-hooks/*` directives in legacy code resolve.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    // We enforce only boundaries here, so don't flag legacy `eslint-disable`
    // directives for rules we haven't enabled (e.g. dormant react-hooks).
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {},
  },

  // Stores — pure reactive state: forbid services (lib/**), Cornerstone, React.
  {
    files: ['src/renderer/stores/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: [...dirGlobs('lib'), ...CORNERSTONE], message: 'BOUNDARY (§2): stores must not import services (lib/**) or Cornerstone — zustand + types + pure util only.' },
          { group: REACT, message: 'BOUNDARY (§2): stores must not import React.' },
        ],
      }],
    },
  },

  // Components — presentational: forbid services + Cornerstone (go through a hook).
  {
    files: ['src/renderer/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: [...libGlobs('cornerstone'), ...libGlobs('segmentation'), ...CORNERSTONE], message: 'BOUNDARY (§2): components are presentational — no services (lib/cornerstone, lib/segmentation) or Cornerstone; go through a hook.' },
        ],
      }],
    },
  },

  // Services (lib/**) — orchestration: forbid components, hooks, React.
  {
    files: ['src/renderer/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: [...dirGlobs('components'), ...dirGlobs('hooks')], message: 'BOUNDARY (§2): services must not import components or hooks.' },
          { group: REACT, message: 'BOUNDARY (§2): services must not import React.' },
        ],
      }],
    },
  },

  // Test/instrumentation code is not production layering — exempt from boundaries.
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**', 'src/renderer/test/**', 'src/test/**', 'src/renderer/lib/e2e/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
