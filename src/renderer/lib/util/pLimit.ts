export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => { active--; next(); });
      });
      next();
    });
}
