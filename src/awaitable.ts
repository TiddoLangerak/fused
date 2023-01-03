export type Awaitable<T> = T | PromiseLike<T>;
export type AwaitableFunc<A extends any[], R> = ((...args: A) => Awaitable<R>);
