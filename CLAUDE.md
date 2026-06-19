# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

minix is a tiny (~150 lines, ~2KB minified) reactive UI library designed to pair with htmx. It handles local client-side reactivity (toggles, tabs, modals, live input, computed text) while htmx handles server communication. No build step, no dependencies.

## Repository layout

- `minix.js` — the entire library (single IIFE)
- `index.html` — demo page showcasing all directives
- `readme.md` — full documentation and API reference

## Development

There is no build step, package manager, test suite, or linter. To develop, open `index.html` in a browser (or use a local HTTP server) and edit `minix.js` directly.

## Architecture

The library is a single IIFE in `minix.js` with four layers:

1. **Reactivity core** (lines ~47–78) — `Proxy`-based dependency tracking. `reactive(obj)` returns a proxy that records which effects read which keys; writing a key re-runs dependent effects.

2. **Expression evaluation** (lines ~88–120) — Compiles directive strings into functions via `new Function` + `with(scope)`. Two modes: expression (returns a value, used by `mx-text`/`mx-show`/`mx-bind`/`mx-model`/`mx-state`) and statement (runs side effects, used by `mx-on` handlers). Functions are cached in `exprCache`/`stmtCache`.

3. **Directive walker** (lines ~123–201) — `walk(el, scope)` traverses the DOM. On each element, it checks for `mx-state` (creates a new reactive scope), then `bind()` processes all other directives (`mx-text`, `mx-show`, `mx-model`, `mx-on:*`, `mx-bind:*`). A `WeakSet` (`seen`) prevents double-initialization. Every directive also works with a `data-` prefix (e.g., `data-mx-on:click`).

4. **Public API + bootstrap** (lines ~204–223) — Exposes `MiniX.{start, reactive, effect, evaluate, run}` as a global and CommonJS export. Auto-starts on `DOMContentLoaded` and listens for `htmx:load` to wire up swapped content.

## Key design decisions

- The directive prefix is the constant `P` (default `'mx-'`) at the top of `minix.js`. Changing it renames all directives.
- No `mx-for` or `mx-if` by design — structural DOM generation is the server's job; use `mx-show` for visibility.
- Effects don't clean up stale dependencies (subscriptions only accumulate). Correct but may over-fire.
- `mx-model` supports text inputs, textareas, and checkboxes only.
