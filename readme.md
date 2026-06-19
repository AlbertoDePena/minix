# minix

**A tiny reactive UI library that pairs with [htmx](https://htmx.org).** No build step, no dependencies, ~150 lines, ~2KB minified.

htmx gives you the network: it swaps server-rendered HTML into the page in response to user actions. minix gives you the other axis — the *local, client-side* reactivity htmx has no concept of: toggles, tabs, modals, live input, computed text. Together they let you build interactive UIs without an SPA framework, keeping the server as the source of truth.

```
hx-*   →  talks to the server   (requests, swaps)
mx-*   →  local browser state    (reactivity, toggles, bindings)
```

```html
<section mx-state="{ loading: false }"
         mx-on:htmx:before-request="loading = true"
         mx-on:htmx:after-request="loading = false">
  <button hx-get="/data" hx-target="#out"
          mx-bind:disabled="loading"
          mx-text="loading ? 'Loading…' : 'Load'"></button>
  <div id="out"></div>
</section>
```

You can read the axis straight off the prefix.

---

## Install

Drop in two script tags. Load htmx **first** so its events exist when minix wires up:

```html
<script src="https://unpkg.com/htmx.org@2"></script>
<script src="minix.js"></script>
```

minix works fine on its own too (without htmx) — it just initializes on `DOMContentLoaded`. It also exposes a CommonJS export (`require('./minix.js')`) for testing under Node.

---

## Quick start

```html
<!-- a counter -->
<div mx-state="{ count: 0 }">
  <button mx-on:click="count--">−</button>
  <span mx-text="count"></span>
  <button mx-on:click="count++">+</button>
</div>

<!-- a toggle -->
<div mx-state="{ open: false }">
  <button mx-on:click="open = !open" mx-bind:aria-expanded="open">Details</button>
  <div mx-show="open">Hidden until you click.</div>
</div>
```

`mx-state` declares a reactive scope on an element. Every descendant can read and write that state, and anything bound to it updates automatically when it changes. You never touch the DOM yourself.

---

## Directives

| Directive | Purpose | Example |
| --- | --- | --- |
| `mx-state` | Declare a reactive scope and its initial state | `mx-state="{ open: false, count: 0 }"` |
| `mx-text` | Set an element's text content from state | `mx-text="count"` |
| `mx-show` | Toggle visibility (`display`) from a boolean | `mx-show="open"` |
| `mx-bind:attr` | Bind any attribute to state | `mx-bind:disabled="busy"` |
| `mx-on:event` | Run code when a DOM (or htmx) event fires | `mx-on:click="count++"` |
| `mx-model` | Two-way bind a form input to state | `mx-model="name"` |

### `mx-state`

Declares a component boundary and seeds its reactive state from an object literal. The state is visible to that element and all of its descendants, down to the next nested `mx-state`.

```html
<div mx-state="{ tab: 'home', dark: false }"> … </div>
```

### `mx-text`

Replaces the element's text content with the value of an expression. Re-runs whenever any state it reads changes.

```html
<span mx-text="firstName + ' ' + lastName"></span>
```

### `mx-show`

Sets `display: none` when the expression is falsy, restores it when truthy. It only toggles visibility — the element stays in the DOM. (There is intentionally no `mx-if`; see [Design notes](#design-notes).)

```html
<div mx-show="cart.length > 0">You have items in your cart.</div>
```

### `mx-bind:attr`

Keeps an attribute in sync with state. Behavior depends on the value:

- **Boolean** → the attribute is added (when `true`) or removed (when `false`). Great for `disabled`, `hidden`, `required`.
- **`null` / `undefined`** → the attribute is removed.
- **`class` with an object** → each key is toggled by its truthiness, preserving any static classes.
- **Anything else** → set as the attribute's string value.

```html
<button mx-bind:disabled="!agreed">Continue</button>
<a mx-bind:href="profileUrl">Profile</a>
<li mx-bind:class="{ active: id === current, done: completed }">…</li>
```

### `mx-on:event`

Adds an event listener. The value is JavaScript run against the scope, and it can be a **single expression or multiple statements**:

```html
<button mx-on:click="open = !open">Toggle</button>
<button mx-on:click="$event.preventDefault(); open = false; count++">Save</button>
<input mx-on:keydown="if ($event.key === 'Escape') open = false">
```

The event name is everything after `mx-on:`, so htmx's namespaced events work too: `mx-on:htmx:after-request="…"`. Inside a handler you have two magics: `$event` (the DOM event) and `$el` (the element).

### `mx-model`

Two-way binding for form controls — shorthand for a `mx-bind:value` + `mx-on:input` pair. Supports text inputs/textareas and checkboxes.

```html
<input mx-model="query">
<p>Searching for: <span mx-text="query"></span></p>

<input type="checkbox" mx-model="subscribed">
<button mx-bind:disabled="!subscribed">Subscribe</button>
```

---

## The `data-` prefix

Every directive also works with a `data-` prefix, so your markup can validate against the HTML spec. The two forms are identical:

```html
<div data-mx-state="{ open: false }">
  <button data-mx-on:click="open = !open">Toggle</button>
  <div data-mx-show="open">…</div>
</div>
```

`data-mx-on:click` ≡ `mx-on:click`, `data-mx-state` ≡ `mx-state`, and so on.

---

## Working with htmx

This is the part minix is designed around. Two things make the pairing seamless:

**1. Swapped content is wired up automatically.** minix listens for htmx's `htmx:load` event (fired on initial load and after every swap), so any HTML htmx drops into the page gets its directives initialized with no manual step.

**2. State resolves from the nearest ancestor scope.** When htmx swaps content in, minix walks *up* from the new element to find the closest `mx-state`. This enables the key pattern:

> **Put your reactive state on a parent that htmx never replaces, and let htmx swap children underneath it.**

Because the state lives above the swap target, it survives the swap, and the freshly inserted children bind against it:

```html
<!-- mx-state is on the section; htmx only replaces #list -->
<section mx-state="{ filter: 'all' }">
  <button mx-on:click="filter = 'all'"    mx-bind:class="{ on: filter === 'all' }">All</button>
  <button mx-on:click="filter = 'active'" mx-bind:class="{ on: filter === 'active' }">Active</button>

  <div id="list"
       hx-get="/items"
       hx-trigger="click from:button"
       hx-include="[name=filter]">
    <!-- server returns rows; minix re-binds them against the section's state -->
  </div>
</section>
```

**Caveat:** if you put `mx-state` *inside* a region htmx replaces, that state is destroyed and re-initialized on every swap. Keep state above the swap boundary, or use htmx's [idiomorph](https://github.com/bigskysoftware/idiomorph) extension (`hx-swap="morph"`) to preserve the DOM (and thus the state) across swaps.

---

## JavaScript API

`MiniX` is available as a global (and as a CommonJS export).

```js
MiniX.start(root?)          // scan a subtree and wire up directives (root defaults to <body>)
MiniX.reactive(obj)         // wrap an object so reads track and writes notify
MiniX.effect(fn)            // run fn now, and re-run whenever its reactive reads change
MiniX.evaluate(expr, scope, magics?)  // evaluate an expression against a scope, return its value
MiniX.run(code, scope, magics?)       // run statements against a scope for their side effects
```

`start` is called for you on load and on `htmx:load`; call it manually only if you inject HTML through some channel htmx doesn't announce.

A shared store across components is free, since `reactive` is the same primitive scopes use:

```js
const store = MiniX.reactive({ user: null, theme: 'light' });
MiniX.effect(() => document.body.dataset.theme = store.theme);
```

---

## Configuration

The whole directive prefix derives from one constant at the top of `minix.js`. Change it once and every directive (and its `data-` form) follows:

```js
const P = 'mx-';   // → mx-state, mx-on:click, mx-bind:class, data-mx-* …
```

---

## Design notes

minix is deliberately small, which means some sharp edges. Worth knowing:

- **No `mx-for` / `mx-if`.** Generating and destroying DOM is the server's job in an htmx app — let it render lists and markup that htmx swaps in. Use `mx-show` for visibility (it toggles `display` rather than adding/removing nodes).
- **`mx-model` scope.** Text inputs, textareas, and checkboxes only. No radios, multi-selects, or `.number` / `.debounce` modifiers.
- **`mx-bind:class` and static classes.** The object form (`{ active: open }`) merges with static classes; the string form overwrites the whole `class` attribute. Prefer the object form when an element also has static classes.
- **Handlers and `this`.** Handler code runs against the scope, so it can read and write state directly, but `this` is **not** bound to the scope. Methods on your state object that rely on `this` won't work — use inline statements or a standalone function for heavier logic.
- **Effects don't clean up stale dependencies.** An expression that reads a property on only one branch keeps that subscription afterward. It stays correct (you never miss an update) but may re-run a bit more than strictly necessary.
- **Expressions use `new Function`.** Directive values are your own templates, not a place for untrusted input.

---

## How it works

A `Proxy` records which effects read which state keys; writing a key re-runs the effects that depend on it — that's the entire reactive engine. A walker scans the DOM, and for each directive it creates an effect (for value bindings) or an event listener (for `mx-on`). Directive expressions are compiled once with `new Function` + `with(scope)` and cached, so re-renders are just function calls.

---

## License

MIT.