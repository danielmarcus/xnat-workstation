import { expect } from 'vitest';
import { FakeEventTarget } from './fakeEventTarget';

export function expectListenersRegistered(
  target: FakeEventTarget,
  events: string[],
): void {
  for (const eventName of events) {
    expect(target.listenerCount(eventName)).toBeGreaterThan(0);
  }
}

export function expectNoListenersLeft(target: FakeEventTarget): void {
  expect(target.listenerCount()).toBe(0);
}
