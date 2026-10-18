# Appearance

`ThemeProvider` owns `light`, `dark` and `system`. The preference is local to this browser (`oli.theme`), follows device changes in System mode, and syncs across tabs. It updates attributes without remounting the app. `public/theme.js` applies the same preference before styles load; keep its storage key and colors aligned with the provider.

Use semantic tokens from `styles/index.css` and `styles/theme.css`: `canvas`, `paper`, `bone`, `ink` and `ash`. The dark palette uses warm charcoal (#191715 canvas, #23201d surfaces) and ivory (#f1e9dd text). Keep the existing yellow accent.

- Solid yellow surfaces use `text-on-accent`, including nested captions and counts.
- Inverse `bg-ink` surfaces use `text-on-ink`.
- Use `bg-paper` for panels and inputs, `ring-field-border` for form boundaries.
- Physical document previews retain original colors with `document-original`. `brand-ink` and `night` are fixed colors for those exceptions and permanently dark sections.
- Canvas and loading indicators read the resolved theme through `useTheme()`; explicit appearance overrides are still supported.

The compact switch toggles light/dark. Settings exposes all three choices. Startup behavior is covered in `tests/theme/bootstrap.test.ts`.
