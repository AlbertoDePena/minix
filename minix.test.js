import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

let MiniX, dom, window, document;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  });
  window = dom.window;
  document = window.document;

  // Expose globals so the minix IIFE sees a browser-like environment.
  globalThis.window = window;
  globalThis.document = document;
  globalThis.Event = window.Event;

  // Re-run the IIFE against the fresh DOM by busting the require cache.
  delete require.cache[require.resolve('./minix.js')];
  MiniX = require('./minix.js');
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.Event;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a DOM tree from an HTML string inside a container, start it, return
 *  the first element child of body (the "root" component element). */
function mount(html) {
  // Wrap in a container so that `start` is called on the container, not on
  // body (which was already walked by the IIFE's auto-start).
  const container = document.createElement('div');
  container.innerHTML = html.trim();
  document.body.appendChild(container);
  // Walk the fresh container — it was not in the `seen` WeakSet.
  MiniX.start(container);
  return container.firstElementChild;
}

/** Dispatch a DOM event on an element. */
function fire(el, event, opts) {
  el.dispatchEvent(new window.Event(event, { bubbles: true, ...opts }));
}

// ---------------------------------------------------------------------------
// 1. Reactivity core
// ---------------------------------------------------------------------------

describe('reactive + effect', () => {
  it('effect runs immediately', () => {
    const state = MiniX.reactive({ count: 0 });
    let ran = 0;
    MiniX.effect(() => { void state.count; ran++; });
    expect(ran).toBe(1);
  });

  it('effect re-runs when a tracked key is written', () => {
    const state = MiniX.reactive({ count: 0 });
    let observed;
    MiniX.effect(() => { observed = state.count; });
    expect(observed).toBe(0);
    state.count = 5;
    expect(observed).toBe(5);
  });

  it('effect does not re-run for untracked keys', () => {
    const state = MiniX.reactive({ a: 1, b: 2 });
    let runs = 0;
    MiniX.effect(() => { void state.a; runs++; });
    expect(runs).toBe(1);
    state.b = 99;
    expect(runs).toBe(1);
  });

  it('multiple effects can track the same key', () => {
    const state = MiniX.reactive({ x: 0 });
    let a = 0, b = 0;
    MiniX.effect(() => { a = state.x; });
    MiniX.effect(() => { b = state.x * 10; });
    state.x = 3;
    expect(a).toBe(3);
    expect(b).toBe(30);
  });

  it('effect tracks multiple keys', () => {
    const state = MiniX.reactive({ first: 'A', last: 'B' });
    let full;
    MiniX.effect(() => { full = state.first + ' ' + state.last; });
    expect(full).toBe('A B');
    state.first = 'X';
    expect(full).toBe('X B');
    state.last = 'Y';
    expect(full).toBe('X Y');
  });
});

// ---------------------------------------------------------------------------
// 2. Expression evaluation
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  it('returns the value of an expression against a scope', () => {
    expect(MiniX.evaluate('a + b', { a: 2, b: 3 })).toBe(5);
  });

  it('returns undefined and warns on bad expressions', () => {
    const result = MiniX.evaluate('???', {});
    expect(result).toBeUndefined();
  });

  it('has access to magics', () => {
    const result = MiniX.evaluate('$val * 2', {}, { $val: 7 });
    expect(result).toBe(14);
  });
});

describe('run', () => {
  it('executes statements that mutate scope', () => {
    const scope = MiniX.reactive({ x: 1 });
    MiniX.run('x = x + 10', scope);
    expect(scope.x).toBe(11);
  });

  it('supports multiple statements', () => {
    const scope = MiniX.reactive({ a: 0, b: 0 });
    MiniX.run('a = 1; b = 2', scope);
    expect(scope.a).toBe(1);
    expect(scope.b).toBe(2);
  });

  it('has access to magics', () => {
    const scope = MiniX.reactive({ val: 0 });
    MiniX.run('val = $input', scope, { $input: 42 });
    expect(scope.val).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 3. Directives
// ---------------------------------------------------------------------------

describe('mx-state', () => {
  it('creates a reactive scope on the element', () => {
    const root = mount('<div mx-state="{ count: 0 }"></div>');
    expect(root.__mx_scope).toBeDefined();
    expect(root.__mx_scope.count).toBe(0);
  });

  it('defaults to empty object for empty mx-state', () => {
    const root = mount('<div mx-state=""></div>');
    expect(root.__mx_scope).toBeDefined();
  });
});

describe('mx-text', () => {
  it('sets textContent from state', () => {
    const root = mount(`
      <div mx-state="{ msg: 'hello' }">
        <span mx-text="msg"></span>
      </div>
    `);
    expect(root.querySelector('span').textContent).toBe('hello');
  });

  it('updates when state changes', () => {
    const root = mount(`
      <div mx-state="{ n: 1 }">
        <span mx-text="n"></span>
      </div>
    `);
    const span = root.querySelector('span');
    expect(span.textContent).toBe('1');
    root.__mx_scope.n = 42;
    expect(span.textContent).toBe('42');
  });

  it('supports expressions', () => {
    const root = mount(`
      <div mx-state="{ a: 2, b: 3 }">
        <span mx-text="a + b"></span>
      </div>
    `);
    expect(root.querySelector('span').textContent).toBe('5');
  });
});

describe('mx-show', () => {
  it('shows element when expression is truthy', () => {
    const root = mount(`
      <div mx-state="{ visible: true }">
        <p mx-show="visible">hi</p>
      </div>
    `);
    expect(root.querySelector('p').style.display).toBe('');
  });

  it('hides element when expression is falsy', () => {
    const root = mount(`
      <div mx-state="{ visible: false }">
        <p mx-show="visible">hi</p>
      </div>
    `);
    expect(root.querySelector('p').style.display).toBe('none');
  });

  it('reacts to state changes', () => {
    const root = mount(`
      <div mx-state="{ on: false }">
        <p mx-show="on">content</p>
      </div>
    `);
    const p = root.querySelector('p');
    expect(p.style.display).toBe('none');
    root.__mx_scope.on = true;
    expect(p.style.display).toBe('');
  });
});

describe('mx-bind', () => {
  it('sets a string attribute', () => {
    const root = mount(`
      <div mx-state="{ url: '/page' }">
        <a mx-bind:href="url">link</a>
      </div>
    `);
    expect(root.querySelector('a').getAttribute('href')).toBe('/page');
  });

  it('adds boolean attribute when true', () => {
    const root = mount(`
      <div mx-state="{ off: true }">
        <button mx-bind:disabled="off">go</button>
      </div>
    `);
    expect(root.querySelector('button').hasAttribute('disabled')).toBe(true);
  });

  it('removes boolean attribute when false', () => {
    const root = mount(`
      <div mx-state="{ off: false }">
        <button mx-bind:disabled="off">go</button>
      </div>
    `);
    expect(root.querySelector('button').hasAttribute('disabled')).toBe(false);
  });

  it('removes attribute when null', () => {
    const root = mount(`
      <div mx-state="{ val: null }">
        <input mx-bind:placeholder="val">
      </div>
    `);
    expect(root.querySelector('input').hasAttribute('placeholder')).toBe(false);
  });

  it('toggles class keys with object form', () => {
    const root = mount(`
      <div mx-state="{ active: true, done: false }">
        <span class="base" mx-bind:class="{ active: active, done: done }">x</span>
      </div>
    `);
    const span = root.querySelector('span');
    expect(span.classList.contains('base')).toBe(true);
    expect(span.classList.contains('active')).toBe(true);
    expect(span.classList.contains('done')).toBe(false);
  });

  it('reacts to state changes', () => {
    const root = mount(`
      <div mx-state="{ ok: false }">
        <button mx-bind:disabled="!ok">go</button>
      </div>
    `);
    const btn = root.querySelector('button');
    expect(btn.hasAttribute('disabled')).toBe(true);
    root.__mx_scope.ok = true;
    expect(btn.hasAttribute('disabled')).toBe(false);
  });
});

describe('mx-on', () => {
  it('runs handler on click', () => {
    const root = mount(`
      <div mx-state="{ count: 0 }">
        <button mx-on:click="count++">inc</button>
        <span mx-text="count"></span>
      </div>
    `);
    const btn = root.querySelector('button');
    fire(btn, 'click');
    expect(root.__mx_scope.count).toBe(1);
    expect(root.querySelector('span').textContent).toBe('1');
  });

  it('provides $event and $el magics', () => {
    const root = mount(`
      <div mx-state="{ tag: '' }">
        <button mx-on:click="tag = $el.tagName">x</button>
      </div>
    `);
    fire(root.querySelector('button'), 'click');
    expect(root.__mx_scope.tag).toBe('BUTTON');
  });

  it('supports multiple statements in handler', () => {
    const root = mount(`
      <div mx-state="{ a: 0, b: 0 }">
        <button mx-on:click="a = 1; b = 2">go</button>
      </div>
    `);
    fire(root.querySelector('button'), 'click');
    expect(root.__mx_scope.a).toBe(1);
    expect(root.__mx_scope.b).toBe(2);
  });
});

describe('mx-model', () => {
  it('binds a text input to state (state → input)', () => {
    const root = mount(`
      <div mx-state="{ name: 'Ada' }">
        <input mx-model="name">
      </div>
    `);
    expect(root.querySelector('input').value).toBe('Ada');
  });

  it('binds a text input to state (input → state)', () => {
    const root = mount(`
      <div mx-state="{ name: '' }">
        <input mx-model="name">
      </div>
    `);
    const input = root.querySelector('input');
    input.value = 'Bob';
    fire(input, 'input');
    expect(root.__mx_scope.name).toBe('Bob');
  });

  it('binds a checkbox to state (state → checkbox)', () => {
    const root = mount(`
      <div mx-state="{ agreed: true }">
        <input type="checkbox" mx-model="agreed">
      </div>
    `);
    expect(root.querySelector('input').checked).toBe(true);
  });

  it('binds a checkbox to state (checkbox → state)', () => {
    const root = mount(`
      <div mx-state="{ agreed: false }">
        <input type="checkbox" mx-model="agreed">
      </div>
    `);
    const cb = root.querySelector('input');
    cb.checked = true;
    fire(cb, 'input');
    expect(root.__mx_scope.agreed).toBe(true);
  });

  it('updates the input when state changes programmatically', () => {
    const root = mount(`
      <div mx-state="{ val: 'a' }">
        <input mx-model="val">
      </div>
    `);
    root.__mx_scope.val = 'z';
    expect(root.querySelector('input').value).toBe('z');
  });
});

// ---------------------------------------------------------------------------
// 4. data- prefix
// ---------------------------------------------------------------------------

describe('data- prefix', () => {
  it('data-mx-state works like mx-state', () => {
    const root = mount('<div data-mx-state="{ x: 99 }"></div>');
    expect(root.__mx_scope).toBeDefined();
    expect(root.__mx_scope.x).toBe(99);
  });

  it('data-mx-text works like mx-text', () => {
    const root = mount(`
      <div data-mx-state="{ msg: 'hi' }">
        <span data-mx-text="msg"></span>
      </div>
    `);
    expect(root.querySelector('span').textContent).toBe('hi');
  });

  it('data-mx-show works like mx-show', () => {
    const root = mount(`
      <div data-mx-state="{ open: false }">
        <p data-mx-show="open">hidden</p>
      </div>
    `);
    expect(root.querySelector('p').style.display).toBe('none');
  });

  it('data-mx-on works like mx-on', () => {
    const root = mount(`
      <div data-mx-state="{ n: 0 }">
        <button data-mx-on:click="n++">go</button>
      </div>
    `);
    fire(root.querySelector('button'), 'click');
    expect(root.__mx_scope.n).toBe(1);
  });

  it('data-mx-bind works like mx-bind', () => {
    const root = mount(`
      <div data-mx-state="{ off: true }">
        <button data-mx-bind:disabled="off">go</button>
      </div>
    `);
    expect(root.querySelector('button').hasAttribute('disabled')).toBe(true);
  });

  it('data-mx-model works like mx-model', () => {
    const root = mount(`
      <div data-mx-state="{ q: 'hello' }">
        <input data-mx-model="q">
      </div>
    `);
    expect(root.querySelector('input').value).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// 5. Nested scopes and scope resolution
// ---------------------------------------------------------------------------

describe('nested scopes', () => {
  it('child scope does not inherit parent state', () => {
    const root = mount(`
      <div mx-state="{ outer: 1 }">
        <div mx-state="{ inner: 2 }">
          <span mx-text="inner"></span>
        </div>
      </div>
    `);
    expect(root.querySelector('span').textContent).toBe('2');
  });

  it('child scope creates its own reactive scope', () => {
    const root = mount(`
      <div mx-state="{ a: 1 }">
        <div mx-state="{ b: 2 }"></div>
      </div>
    `);
    const inner = root.querySelector('[mx-state="{ b: 2 }"]');
    expect(inner.__mx_scope.b).toBe(2);
    expect(inner.__mx_scope.a).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. start() on a subtree
// ---------------------------------------------------------------------------

describe('MiniX.start', () => {
  it('wires up a subtree injected after initial load', () => {
    mount('<div mx-state="{ x: 1 }"></div>');

    const extra = document.createElement('div');
    extra.setAttribute('mx-state', '{ y: 42 }');
    const span = document.createElement('span');
    span.setAttribute('mx-text', 'y');
    extra.appendChild(span);
    document.body.appendChild(extra);

    MiniX.start(extra);
    expect(span.textContent).toBe('42');
  });

  it('resolves scope from nearest ancestor when starting a subtree', () => {
    const root = mount(`
      <div mx-state="{ color: 'red' }">
        <div id="target"></div>
      </div>
    `);
    const target = root.querySelector('#target');
    const span = document.createElement('span');
    span.setAttribute('mx-text', 'color');
    target.appendChild(span);

    MiniX.start(span);
    expect(span.textContent).toBe('red');
  });
});
