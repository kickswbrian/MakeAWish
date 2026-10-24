/**
 * Incremental scanner for a streamed JSON object (a tool call's input arriving in fragments).
 * Emits each top-level property the moment its value is complete, and each object element of a
 * top-level array the moment that element closes, so patches apply while the model still writes.
 */
export interface ScanHandlers {
  /** A top-level property finished: raw JSON text of its value. */
  onValue?: (key: string, raw: string) => void;
  /** An object/array element of a top-level array finished: raw JSON text of the element. */
  onItem?: (key: string, index: number, raw: string) => void;
}

export class JsonStreamScanner {
  private buf = "";
  private pos = 0;
  /** Open containers, counting the root object as 1. */
  private depth = 0;
  private inString = false;
  private escape = false;
  private key: string | null = null;
  private keyStart = -1;
  private expectingKey = true;
  private valueStart = -1;
  private valueIsArray = false;
  private itemStart = -1;
  private itemIndex = 0;

  constructor(private h: ScanHandlers) {}

  push(chunk: string) {
    this.buf += chunk;
    for (; this.pos < this.buf.length; this.pos++) this.step(this.buf[this.pos], this.pos);
  }

  /** End of stream: flush a trailing primitive value if the closing brace never came. */
  end() {
    if (this.depth === 1 && this.key !== null && this.valueStart >= 0 && !this.inString) {
      this.emit(this.buf.slice(this.valueStart).replace(/[\s}]+$/, ""));
    }
  }

  private emit(raw: string) {
    const v = raw.trim();
    if (this.key !== null && v) this.h.onValue?.(this.key, v);
    this.key = null;
    this.valueStart = -1;
    this.expectingKey = true;
  }

  private step(c: string, i: number) {
    if (this.inString) {
      if (this.escape) this.escape = false;
      else if (c === "\\") this.escape = true;
      else if (c === '"') {
        this.inString = false;
        if (this.depth === 1) {
          if (this.keyStart >= 0) {
            try {
              this.key = JSON.parse(this.buf.slice(this.keyStart, i + 1));
            } catch {
              this.key = null;
            }
            this.keyStart = -1;
          } else if (this.valueStart >= 0) this.emit(this.buf.slice(this.valueStart, i + 1));
        }
      }
      return;
    }
    if (c === " " || c === "\n" || c === "\r" || c === "\t") return;

    if (this.depth === 0) {
      if (c === "{") this.depth = 1;
      return;
    }

    if (this.depth === 1) {
      switch (c) {
        case '"':
          this.inString = true;
          if (this.expectingKey) this.keyStart = i;
          else this.valueStart = i;
          return;
        case ":":
          this.expectingKey = false;
          return;
        case ",":
          if (this.valueStart >= 0) this.emit(this.buf.slice(this.valueStart, i));
          this.expectingKey = true;
          return;
        case "}":
          if (this.valueStart >= 0) this.emit(this.buf.slice(this.valueStart, i));
          this.depth = 0;
          return;
        case "{":
        case "[":
          this.valueStart = i;
          this.valueIsArray = c === "[";
          this.itemStart = -1;
          this.itemIndex = 0;
          this.depth = 2;
          return;
        default:
          if (!this.expectingKey && this.valueStart < 0) this.valueStart = i;
          return;
      }
    }

    // depth >= 2: inside a top-level container value.
    if (c === '"') {
      this.inString = true;
      return;
    }
    if (c === "{" || c === "[") {
      if (this.depth === 2 && this.valueIsArray) this.itemStart = i;
      this.depth++;
      return;
    }
    if (c === "}" || c === "]") {
      this.depth--;
      if (this.depth === 2 && this.valueIsArray && this.itemStart >= 0) {
        this.h.onItem?.(this.key ?? "", this.itemIndex++, this.buf.slice(this.itemStart, i + 1));
        this.itemStart = -1;
      } else if (this.depth === 1) {
        this.emit(this.buf.slice(this.valueStart, i + 1));
      }
    }
  }
}
