// UILayout.js — the game's UI layout: every HUD element, placed and styled in the editor (UI tab).
// The editor rewrites the whole file (POST /api/save-ui) — keep the format. Drawn by js/UI.js;
// game code takes an element by id: UI.get('score').setText('10') — and never positions HUD itself.
//   kind — 'text' | 'panel' | 'bar' | 'button'; anchor — one of 9 screen points ('top-left' …
//   'bottom-right'): x, y go from it to the same point of the element (inward from an edge,
//   signed from the center); w, h — px; numbers are px of a screen UI_REF_HEIGHT tall;
//   parent (optional) — id of the element this one sits in: anchor, x, y then count from the
//   parent's box, the parent clips it and hides it together with itself;
//   stretch (optional) — 'h' | 'v' | 'both': fills the container on that axis, x (y) — the inset
//   from both edges, w (h) is ignored;
//   colors — '#rrggbb', '' — none; visible: 0 — hidden until the game calls show().
//   Records go in drawing order: later — on top.
const UI_LAYOUT = [
    { id: 'brand', kind: 'text', anchor: 'top-left', x: 24, y: 18, text: "ASHFALL // ECHOES OF THE BEACON", fontSize: 12, color: '#d6e9e8', shadow: '#07131a', alpha: 0.85, visible: 1 },
    { id: 'chapter', kind: 'text', anchor: 'top-left', x: 24, y: 37, text: "ПРОЛОГ · ТИХАЯ ДОЛИНА", fontSize: 18, color: '#ffd8a1', shadow: '#07131a', alpha: 1, visible: 1 },
    { id: 'objectivePanel', kind: 'panel', anchor: 'top-left', x: 20, y: 66, w: 360, h: 57, fill: '#0a1a22', border: '#345662', radius: 8, alpha: 0.78, visible: 1 },
    { id: 'objectiveTag', kind: 'text', anchor: 'top-left', x: 35, y: 75, text: "ЗАДАЧА", fontSize: 10, color: '#8eb7bd', shadow: '', alpha: 1, visible: 1 },
    { id: 'objective', kind: 'text', anchor: 'top-left', x: 35, y: 91, text: "Подготовить приёмник", fontSize: 15, color: '#eef6ed', shadow: '#061016', alpha: 1, visible: 1 },
    { id: 'vitalsPanel', kind: 'panel', anchor: 'bottom-left', x: 22, y: 28, w: 274, h: 79, fill: '#07151b', border: '#31515a', radius: 10, alpha: 0.78, visible: 1 },
    { id: 'healthLabel', kind: 'text', anchor: 'bottom-left', x: 38, y: 88, text: "ЖИЗНЬ", fontSize: 10, color: '#d9e6e2', shadow: '', alpha: 0.9, visible: 1 },
    { id: 'health', kind: 'bar', anchor: 'bottom-left', x: 38, y: 72, w: 164, h: 8, value: 1, color: '#e05f67', fill: '#24343a', border: '', radius: 4, alpha: 1, visible: 1 },
    { id: 'staminaLabel', kind: 'text', anchor: 'bottom-left', x: 38, y: 58, text: "ВЫНОСЛИВОСТЬ", fontSize: 10, color: '#d9e6e2', shadow: '', alpha: 0.9, visible: 1 },
    { id: 'stamina', kind: 'bar', anchor: 'bottom-left', x: 38, y: 42, w: 164, h: 8, value: 1, color: '#efbd65', fill: '#24343a', border: '', radius: 4, alpha: 1, visible: 1 },
    { id: 'pulseLabel', kind: 'text', anchor: 'bottom-left', x: 216, y: 88, text: "ИМПУЛЬ", fontSize: 10, color: '#bdeff5', shadow: '', alpha: 0.9, visible: 1 },
    { id: 'pulse', kind: 'bar', anchor: 'bottom-left', x: 216, y: 72, w: 44, h: 8, value: 1, color: '#79e1ee', fill: '#24343a', border: '', radius: 4, alpha: 1, visible: 1 },
    { id: 'noiseLabel', kind: 'text', anchor: 'bottom-left', x: 216, y: 58, text: "ШУМ", fontSize: 10, color: '#d6c6e7', shadow: '', alpha: 0.9, visible: 1 },
    { id: 'noise', kind: 'bar', anchor: 'bottom-left', x: 216, y: 42, w: 44, h: 8, value: 0, color: '#b38de0', fill: '#24343a', border: '', radius: 4, alpha: 1, visible: 1 },
    { id: 'inventoryPanel', kind: 'panel', anchor: 'bottom-right', x: 22, y: 28, w: 200, h: 61, fill: '#07151b', border: '#31515a', radius: 10, alpha: 0.78, visible: 1 },
    { id: 'cells', kind: 'text', anchor: 'bottom-right', x: 38, y: 71, text: "ЯЧЕЙКИ  0 / 3", fontSize: 14, color: '#d7f7f7', shadow: '#061016', alpha: 1, visible: 1 },
    { id: 'lures', kind: 'text', anchor: 'bottom-right', x: 38, y: 47, text: "F  ПРИМАНКА  2", fontSize: 11, color: '#d8c3ea', shadow: '#061016', alpha: 1, visible: 1 },
    { id: 'reticle', kind: 'text', anchor: 'middle-center', x: 0, y: 0, text: "·", fontSize: 24, color: '#e6f7f2', shadow: '#07131a', alpha: 0.75, visible: 1 },
    { id: 'toast', kind: 'text', anchor: 'top-center', x: 0, y: 30, text: "", fontSize: 17, color: '#f7e5bd', shadow: '#07131a', alpha: 1, visible: 0 },
    { id: 'danger', kind: 'text', anchor: 'top-center', x: 0, y: 58, text: "", fontSize: 15, color: '#ff9296', shadow: '#23060c', alpha: 1, visible: 0 },
    { id: 'interactionPanel', kind: 'panel', anchor: 'bottom-center', x: 0, y: 26, w: 440, h: 38, fill: '#07151b', border: '#547783', radius: 19, alpha: 0.85, visible: 0 },
    { id: 'interaction', kind: 'text', anchor: 'bottom-center', x: 0, y: 37, text: "", fontSize: 14, color: '#f5f5e9', shadow: '#061016', alpha: 1, visible: 0 },
    { id: 'dialoguePanel', kind: 'panel', anchor: 'bottom-left', x: 308, y: 29, w: 618, h: 93, fill: '#07151b', border: '#557a80', radius: 10, alpha: 0.9, visible: 0 },
    { id: 'dialogueLine', kind: 'panel', anchor: 'bottom-left', parent: 'dialoguePanel', x: 0, y: 0, w: 6, h: 93, fill: '#eeb86a', border: '', radius: 0, alpha: 1, visible: 1 },
    { id: 'dialogueSpeaker', kind: 'text', anchor: 'top-left', parent: 'dialoguePanel', x: 20, y: 15, text: "НАДЯ // РАДИО", fontSize: 11, color: '#efc779', shadow: '#061016', alpha: 1, visible: 1 },
    { id: 'dialogueText', kind: 'text', anchor: 'top-left', parent: 'dialoguePanel', x: 20, y: 34, text: "", fontSize: 15, color: '#eff6ee', shadow: '#061016', alpha: 1, visible: 1 },
    { id: 'dialogueHint', kind: 'text', anchor: 'bottom-right', parent: 'dialoguePanel', x: 16, y: 11, text: "E  ПРОПУСТИТЬ", fontSize: 9, color: '#9bb5b7', shadow: '', alpha: 0.85, visible: 1 },
    { id: 'controlsPanel', kind: 'panel', anchor: 'top-right', x: 20, y: 20, w: 244, h: 101, fill: '#07151b', border: '#31515a', radius: 9, alpha: 0.68, visible: 1 },
    { id: 'controls', kind: 'text', anchor: 'top-right', x: 33, y: 30, text: "WASD  движение\nSHIFT  бег       C  тихий шаг\nE  взаимодействие\nQ  импуль        F  приманка", fontSize: 10, color: '#c7dadd', shadow: '#061016', alpha: 0.88, visible: 1 },
];
