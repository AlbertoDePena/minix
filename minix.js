/*!
 * minix.js — a tiny reactive UI library meant to pair with htmx.
 * ~150 lines, no build step, no dependencies, ~2KB minified.
 *
 * It covers the slice of behavior htmx does NOT do: local, client-side
 * reactive state (toggles, tabs, modals, live input, computed text). It
 * deliberately omits everything htmx already owns — network requests and
 * server-driven DOM swapping — and avoids structural DOM generation
 * (no mx-for / mx-if); use mx-show for visibility, and let the server render
 * lists/markup that htmx swaps in.
 *
 * Directives:
 *   mx-state="{ open: false, count: 0 }" declare a reactive scope + its state
 *   mx-text="count"                      set textContent
 *   mx-show="open"                       toggle display
 *   mx-model="name"                      two-way bind an input/checkbox
 *   mx-on:click="open = !open"           event listener; may hold multiple
 *                                        statements: "open = false; n++"
 *   mx-bind:class="{ active }"           bind an attribute (or class object)
 *
 * Every directive also works with a `data-` prefix for spec-valid HTML:
 * `data-mx-on:click` is identical to `mx-on:click`, `data-mx-state` to `mx-state`.
 *
 * htmx integration: listens for `htmx:load`, so content htmx swaps in is
 * wired up automatically. State is resolved from the nearest ancestor
 * mx-state, so you can keep state on a parent htmx never replaces.
 */
(function () {
  'use strict';

  /* ---- 0. Directive prefix ----------------------------------------------
   * Rename every directive by changing this one line. With 'mx-' you get
   * mx-state, mx-text, mx-show, mx-model, mx-on:, mx-bind: (and data-mx-* forms).
   */
  const P = 'mx-';
  const STATE = P + 'state';
  const TEXT  = P + 'text';
  const SHOW  = P + 'show';
  const MODEL = P + 'model';
  const ON    = P + 'on:';
  const BIND  = P + 'bind:';

  /* ---- 1. Reactivity core ------------------------------------------------
   * A Proxy records which effects read which keys; writing a key re-runs
   * the effects that depend on it. This is the whole reactive engine.
   */
  const stack = [];
  const activeEffect = () => stack[stack.length - 1] || null;

  function reactive(target) {
    const deps = new Map(); // key -> Set<effect>
    return new Proxy(target, {
      get(obj, key, recv) {
        const eff = activeEffect();
        if (eff) {
          let subs = deps.get(key);
          if (!subs) deps.set(key, (subs = new Set()));
          subs.add(eff);
        }
        return Reflect.get(obj, key, recv);
      },
      set(obj, key, value, recv) {
        const ok = Reflect.set(obj, key, value, recv);
        const subs = deps.get(key);
        if (subs) [...subs].forEach((fn) => fn()); // copy: effects may re-subscribe
        return ok;
      },
    });
  }

  function effect(fn) {
    const run = () => {
      stack.push(run);
      try { fn(); } finally { stack.pop(); }
    };
    run();
    return run;
  }

  /* ---- 2. Expression evaluation -----------------------------------------
   * `with` lets directive code reference scope properties (and "magics"
   * like $event) by name. Two compile modes, cached separately:
   *   - expression: wrapped in `return (...)`, used by directives that need
   *     a value (mx-text, mx-show, mx-bind, mx-model, mx-state).
   *   - statement: run as a function body, used by mx-on handlers so they can
   *     contain multiple statements, e.g. "$event.preventDefault(); open = false".
   */
  const exprCache = new Map();
  const stmtCache = new Map();

  function compile(code, asStatement) {
    const cache = asStatement ? stmtCache : exprCache;
    let fn = cache.get(code);
    if (!fn) {
      const body = asStatement
        ? `with($m){ with($data){ ${code} } }`
        : `with($m){ with($data){ return (${code}); } }`;
      fn = new Function('$data', '$m', body);
      cache.set(code, fn);
    }
    return fn;
  }

  // Evaluate an expression and return its value.
  function evaluate(expr, scope, magics) {
    try {
      return compile(expr, false)(scope || {}, magics || {});
    } catch (err) {
      console.warn(`[minix] error in "${expr}":`, err);
    }
  }

  // Run one or more statements for their side effects (event handlers).
  function run(code, scope, magics) {
    try {
      compile(code, true)(scope || {}, magics || {});
    } catch (err) {
      console.warn(`[minix] error in "${code}":`, err);
    }
  }

  /* ---- 3. Directive walking ---------------------------------------------- */
  const seen = new WeakSet();

  function findScope(el) {
    for (let p = el && el.parentElement; p; p = p.parentElement) {
      if (p.__mx_scope) return p.__mx_scope;
    }
    return null;
  }

  function walk(el, scope) {
    if (!el || el.nodeType !== 1 || seen.has(el)) return;

    const stateExpr = el.getAttribute(STATE) ?? el.getAttribute('data-' + STATE);
    if (stateExpr !== null) {
      scope = reactive(evaluate(stateExpr || '{}', {}) || {});
      el.__mx_scope = scope;
    }
    if (scope) bind(el, scope);
    seen.add(el);

    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      walk(c, scope);
    }
  }

  function bind(el, scope) {
    for (const attr of Array.from(el.attributes)) {
      // Treat `data-mx-foo` as `mx-foo` so both prefixes work identically.
      const name = attr.name.startsWith('data-' + P)
        ? attr.name.slice('data-'.length)
        : attr.name;
      const value = attr.value;
      if (name === STATE) continue;

      if (name === TEXT) {
        effect(() => { el.textContent = evaluate(value, scope) ?? ''; });

      } else if (name === SHOW) {
        effect(() => { el.style.display = evaluate(value, scope) ? '' : 'none'; });

      } else if (name === MODEL) {
        bindModel(el, value, scope);

      } else if (name.startsWith(ON)) {
        const event = name.slice(ON.length);
        el.addEventListener(event, (e) =>
          run(value, scope, { $event: e, $el: el }));

      } else if (name.startsWith(BIND)) {
        const attrName = name.slice(BIND.length);
        effect(() => applyAttr(el, attrName, evaluate(value, scope)));
      }
    }
  }

  function bindModel(el, prop, scope) {
    const checkbox = el.type === 'checkbox';
    effect(() => {
      const v = evaluate(prop, scope);
      if (checkbox) el.checked = !!v;
      else if (el.value !== v) el.value = v ?? '';
    });
    el.addEventListener('input', () => {
      evaluate(`${prop} = $value`, scope,
        { $value: checkbox ? el.checked : el.value });
    });
  }

  function applyAttr(el, attr, value) {
    if (attr === 'class' && value && typeof value === 'object') {
      for (const cls in value) el.classList.toggle(cls, !!value[cls]);
    } else if (typeof value === 'boolean') {
      value ? el.setAttribute(attr, '') : el.removeAttribute(attr);
    } else if (value == null) {
      el.removeAttribute(attr);
    } else {
      el.setAttribute(attr, value);
    }
  }

  /* ---- 4. Public API + bootstrapping ------------------------------------- */
  function start(root) {
    const el = root || (typeof document !== 'undefined' ? document.body : null);
    walk(el, findScope(el));
  }

  const MiniX = { start, reactive, effect, evaluate, run };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => start());
    } else {
      start();
    }
    // htmx:load fires on initial load and after every swap;
    // event.detail.elt is the freshly inserted element.
    document.addEventListener('htmx:load', (e) => start(e.detail && e.detail.elt));
  }

  if (typeof window !== 'undefined') window.MiniX = MiniX;
  if (typeof module !== 'undefined' && module.exports) module.exports = MiniX;
})();