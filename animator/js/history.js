// Отмена/повтор на снимках документа (ассеты не входят в снимок — они неизменяемы).
const replacer = (k, v) => (k === 'assets' || (k && k[0] === '_') ? undefined : v);

export function snapshot(doc) { return JSON.stringify(doc, replacer); }

export class History {
  constructor(limit = 200) { this.limit = limit; this.stack = []; this.i = -1; }
  reset(snap) { this.stack = [{ snap, label: '' }]; this.i = 0; }
  push(snap, label) {
    if (this.stack[this.i] && this.stack[this.i].snap === snap) return false;
    this.stack.length = this.i + 1;
    this.stack.push({ snap, label });
    if (this.stack.length > this.limit) this.stack.shift();
    this.i = this.stack.length - 1;
    return true;
  }
  get canUndo() { return this.i > 0; }
  get canRedo() { return this.i < this.stack.length - 1; }
  get undoLabel() { return this.canUndo ? this.stack[this.i].label : ''; }
  get redoLabel() { return this.canRedo ? this.stack[this.i + 1].label : ''; }
  undo() { if (!this.canUndo) return null; this.i--; return this.stack[this.i].snap; }
  redo() { if (!this.canRedo) return null; this.i++; return this.stack[this.i].snap; }
}
