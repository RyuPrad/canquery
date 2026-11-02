import { createElement, lazy, useState } from 'react';

// A route page loaded on demand, like React.lazy, that can also be preloaded.
// React.lazy suspends on its first render even when its module has already
// arrived, and React then keeps the fallback up for at least 300 ms, so a
// direct visit would flash the skeleton over a page whose code and data are
// both ready. Once preload() has resolved, the page renders the module
// directly. The choice is made once per mount, so a mounted page never
// switches between the two (which would remount it and lose its state).

/**
 * @template {Record<string, any>} P
 * @param {() => Promise<{ default: import('react').ComponentType<P> }>} factory
 */
export function lazyPage(factory) {
  /** @type {{ default: import('react').ComponentType<P> } | null} */
  let loaded = null;
  /** @type {Promise<{ default: import('react').ComponentType<P> }> | null} */
  let loading = null;
  const load = () => {
    if (!loading) {
      loading = factory().then((module) => {
        loaded = module;
        return module;
      });
      loading.catch(() => {
        loading = null;
      });
    }
    return loading;
  };
  const Lazy = lazy(load);
  /** @param {P} props */
  function Page(props) {
    const [Component] = useState(() => (loaded ? loaded.default : Lazy));
    return createElement(/** @type {import('react').ComponentType<P>} */ (Component), props);
  }
  Page.preload = load;
  return Page;
}
