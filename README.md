# mt-support-ops

A collapsible sidebar and an empty main workspace. Open `public/index.html` directly, or run `npm start` and visit <http://127.0.0.1:4318>.

## Collapse and expand motion

Use `var(--motion-collapse-expand)` as the timing for collapse and expand transitions, for example `transition: inline-size var(--motion-collapse-expand)`. The default in [style.css](public/style.css) is 240 ms with `cubic-bezier(0.4, 0, 0.2, 1)`. It becomes instant when the user prefers reduced motion. [View the recorded sidebar transition](docs/sidebar-motion.gif).
