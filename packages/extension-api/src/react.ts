/**
 * `react` for an extension's renderer bundle: the app's own React (design point 4). An
 * extension's bundler aliases `react` to this module, so its components render with the same
 * React as the app — one copy, shared hooks and context, the app's error boundaries.
 */
import type * as ReactTypes from 'react';
import { EXTENSION_HOST_GLOBAL } from '../../../src/shared/extensions/api';

const host = (globalThis as Record<string, unknown>)[EXTENSION_HOST_GLOBAL] as { React: typeof ReactTypes } | undefined;
if (!host) throw new Error('This extension runs only inside XNAT Workstation (its React was not found).');
const React = host.React;

export default React;
export const {
  Children, Component, Fragment, PureComponent, StrictMode, Suspense,
  createContext, createElement, forwardRef, isValidElement, lazy, memo, startTransition,
  use, useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId,
  useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef,
  useState, useSyncExternalStore, useTransition,
} = React;
