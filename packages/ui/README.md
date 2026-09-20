# @patina/ui

Reusable editor primitives. ESM source package, version 0.1.0.

## Public API

`icon`, `button`, `escapeHTML`, `$`, `toast`, `modal`, `CommandRegistry`, `installSplitter`; opt-in @patina/ui/styles.css.

## Host contract

DOM required. Styles set global editor defaults and are intentionally opt-in. Product layout and application-specific panels remain in app/.

No application-module dependency. See the root docs/ARCHITECTURE.md for data layout, lifetime and backend-selection contracts. These archives are local distribution packages, not a claim of npm publication.

## License

MIT. See LICENSE.
