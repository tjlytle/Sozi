# CSS (standard 3)

Stylelint (`config/stylelintrc.json`) enforces 3.1 and 3.2; one ESLint rule enforces 3.3.

### 3.1 One file per component, classes in block-element-modifier form, `sozi-` prefix

- One file styles one component: `presenter/panels/Notes.css` styles the notes panel
  and nothing else.
- Class names are `sozi-block`, `sozi-block__element`, `sozi-block__element--modifier`
  (`selector-class-pattern`).
- No ids for styling (`selector-max-id: 0`); ids remain for scripting hooks.
- Specificity at most three classes deep; no `!important`; no hand-written vendor
  prefixes.

### 3.2 Theme through custom properties (design tokens), dark by default, `rem` units

- `presenter/theme.css` declares every colour, spacing step and font size as a custom
  property (`--sozi-bg`, `--sozi-accent`, `--sozi-space-2`). Components use only those
  (`declaration-strict-value`).
- The presenter is dark by default.
- Sizes are `rem`; `px` only on `border*`, `outline*`, `box-shadow`, `text-shadow` and
  `stroke-width` (`unit-disallowed-list`).
- A docking library's variables are mapped from ours in one place.

### 3.3 Layout with flex and grid; inline styles only for computed geometry

- Flex for one direction (a toolbar row, a panel column); grid for rows and columns
  (the workspace). No absolute positioning for panel internals.
- JavaScript sets an inline style only for a value it computed: width, height, min and
  max sizes, top/left/right/bottom/inset, transform, translate, scale, rotate. Any
  other `style.*` assignment is a lint error.
- Showing and hiding is a class toggle, never `style.display`.
