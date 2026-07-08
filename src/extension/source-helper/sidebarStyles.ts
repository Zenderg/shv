export const SIDEBAR_WIDTH = 390;
export const SIDEBAR_COLLAPSED_WIDTH = 48;
export const HIGHLIGHT_PADDING = 8;

export function sidebarCss() {
  return `
    :host {
      all: initial;
      color: #17211d;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    .panel {
      background: #f8faf6;
      border-left: 1px solid rgba(23, 33, 29, 0.12);
      box-shadow: -14px 0 32px rgba(15, 23, 42, 0.18);
      display: grid;
      grid-template-rows: auto auto 1fr;
      height: 100vh;
      overflow: hidden;
      width: min(100vw, ${SIDEBAR_WIDTH}px);
    }

    .panel.collapsed {
      align-items: start;
      background: #ffffff;
      grid-template-rows: auto auto 1fr;
      justify-items: center;
      row-gap: 18px;
      width: ${SIDEBAR_COLLAPSED_WIDTH}px;
    }

    .rail-label {
      color: #64716b;
      font-size: 12px;
      font-weight: 800;
      line-height: 1;
      margin-top: 0;
      text-orientation: mixed;
      white-space: nowrap;
      writing-mode: vertical-rl;
    }

    header {
      align-items: start;
      background: #ffffff;
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 18px 16px 14px;
    }

    h1,
    p {
      margin: 0;
    }

    h1 {
      color: #17211d;
      font-size: 28px;
      letter-spacing: 0;
      line-height: 1;
    }

    header p,
    .job span,
    .source p,
    .empty p {
      color: #64716b;
    }

    .icon-button {
      align-items: center;
      background: #edf2ee;
      border: 0;
      border-radius: 999px;
      color: #17211d;
      cursor: pointer;
      display: inline-flex;
      font: 800 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      height: 30px;
      justify-content: center;
      width: 30px;
    }

    .icon-button svg,
    .collapse-button svg {
      display: block;
      height: 16px;
      width: 16px;
    }

    .header-actions {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .collapse-button {
      align-items: center;
      background: #21362e;
      border: 0;
      border-radius: 999px;
      color: #ffffff;
      cursor: pointer;
      display: inline-flex;
      font: 900 15px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      height: 30px;
      justify-content: center;
      width: 30px;
    }

    .rail-button {
      margin-top: 18px;
    }

    .job {
      background: #ffffff;
      border-top: 1px solid rgba(23, 33, 29, 0.08);
      display: grid;
      gap: 7px;
      padding: 12px 16px;
    }

    .job strong,
    .job span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .capture-button {
      background: #21362e;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 800 13px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      min-height: 34px;
    }

    .capture-button:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }

    .capture-button.capturing:disabled {
      cursor: progress;
    }

    .sources {
      display: grid;
      gap: 10px;
      overflow: auto;
      padding: 12px;
    }

    .source {
      background: #ffffff;
      border-radius: 8px;
      display: grid;
      gap: 8px;
      padding: 12px;
      transition: box-shadow 120ms ease, transform 120ms ease;
    }

    .source.is-highlighted {
      box-shadow: inset 0 0 0 2px #23d18b, 0 8px 22px rgba(30, 111, 85, 0.16);
      transform: translateX(-2px);
    }

    .source.is-selected {
      box-shadow: inset 0 0 0 2px #1e6f55;
    }

    .source-top {
      align-items: center;
      display: flex;
      justify-content: space-between;
    }

    .source-top strong {
      color: #17211d;
      font-size: 14px;
    }

    .source-top span {
      background: #e7f4de;
      border-radius: 999px;
      color: #24593f;
      font-size: 12px;
      font-weight: 800;
      padding: 5px 7px;
    }

    .source p {
      font-size: 12px;
    }

    .source code {
      color: #44524b;
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      max-height: 82px;
      overflow: auto;
      overflow-wrap: anywhere;
    }

    .source button {
      background: #1e6f55;
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      font: 800 14px/1 Inter, ui-sans-serif, system-ui, sans-serif;
      min-height: 40px;
    }

    .source button:disabled {
      cursor: not-allowed;
      opacity: 0.62;
    }

    .selection-error {
      background: #fee2e2;
      border-top: 1px solid rgba(127, 29, 29, 0.14);
      color: #7f1d1d;
      font-size: 13px;
      font-weight: 700;
      padding: 10px 16px;
    }

    .empty {
      background: #fff7ed;
      color: #7c2d12;
      display: grid;
      gap: 8px;
      padding: 14px;
    }

    .empty p {
      color: #8c4a24;
      font-size: 13px;
    }

    .diagnostics {
      background: #eef5ff;
      color: #19324d;
      display: grid;
      gap: 6px;
      padding: 12px;
    }

    .diagnostics strong {
      font-size: 13px;
    }

    .diagnostics p {
      align-items: start;
      display: grid;
      gap: 6px;
      grid-template-columns: 92px 1fr;
      margin: 0;
    }

    .diagnostics span {
      color: #4b6178;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }

    .diagnostics code {
      color: #19324d;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      overflow-wrap: anywhere;
    }

  `;
}
