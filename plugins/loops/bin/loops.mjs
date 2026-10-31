#!/usr/bin/env node
import { createRequire as __loops_createRequire } from 'node:module';
const require = __loops_createRequire(import.meta.url);

// src/lib/loops-cli.ts
import { readFileSync as readFileSync5 } from "node:fs";

// src/lib/env-check.ts
import { readFileSync as readFileSync3, existsSync as existsSync3 } from "node:fs";
import { homedir } from "node:os";
import { join as join4, resolve as resolve2 } from "node:path";

// src/lib/env-config.ts
import { isAbsolute, normalize } from "node:path";

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r?\n/);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r?\n/);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class _TomlError extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
  /** @internal */
  static x(message, ctx, ptr) {
    throw new _TomlError(message, { toml: ctx.s, ptr: ptr ?? ctx.p });
  }
};

// node_modules/smol-toml/dist/primitive.js
function parseString(ctx) {
  let startPtr = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      TomlError.x("control characters are not allowed in strings", ctx);
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state) {
        let s = ctx.s.slice(sliceStart, ctx.p);
        parsed = parsed ? parsed + s : s;
      }
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let errPtr = ctx.p++ - 1;
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            TomlError.x("invalid non-hex character in unicode escape", ctx);
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          TomlError.x("invalid unicode escape", ctx, errPtr);
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p--;
        state = 0;
      } else if (isMultiline && (c === 32 || c === 9)) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          TomlError.x("unrecognised escape sequence", ctx);
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2)
        TomlError.x("invalid escape: only line-ending whitespace may be escaped", ctx, sliceStart);
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  TomlError.x("unfinished string", ctx, startPtr);
}

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[Tt ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date, fasttype, unsafeDelim) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    let c;
    if (typeof date === "string") {
      if (fasttype)
        prep: {
          if (fasttype < 3) {
            if (+date.slice(11, 13) > 23) {
              date = "";
              break prep;
            }
            if (fasttype === 2) {
              offset = null;
              date += "Z";
            } else if ((c = date.charCodeAt(date.length - 1)) !== 90 && c !== 122) {
              offset = date.slice(date.length - 6);
            }
            if (unsafeDelim)
              date = date.slice(0, 10) + "T" + date.slice(11);
          } else if (fasttype === 4) {
            date = +date.slice(0, 2) > 23 ? "" : `0000-01-01T${date}Z`;
          }
          hasDate = fasttype !== 4;
          hasTime = fasttype !== 3;
        }
      else {
        let match = date.match(DATE_TIME_RE);
        if (match) {
          if (!match[1]) {
            hasDate = false;
            date = `0000-01-01T${date}`;
          }
          hasTime = !!match[2];
          hasTime && date[10] === " " && (date = date.replace(" ", "T"));
          if (match[2] && +match[2] > 23) {
            date = "";
          } else {
            offset = match[3] || null;
            if (!offset && hasTime)
              date += "Z";
          }
        } else {
          date = "";
        }
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z" || this.#offset === "z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// node_modules/smol-toml/dist/extract.js
function isDigit(char, base = 10) {
  return base === 16 ? char > 47 && char < 58 || char > 64 && char < 71 || char > 96 && char < 103 : char > 47 && char < 48 + base;
}
function isEndOfValue(char, delim) {
  return char === 32 || char === 9 || char === 10 || char === 13 || // Structure end or next value delimiter
  delim && (char === delim || char === 44) || // Comment
  char === 35;
}
function extractValue(ctx, end) {
  let errPtr = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p);
  if (c === 91 || c === 123) {
    ctx.d-- || TomlError.x("document contains excessively nested structures. aborting.", ctx);
    let value = c === 91 ? parseArray(ctx) : parseInlineTable(ctx);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      TomlError.x("invalid value", ctx, errPtr);
    return ctx.p++, true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      TomlError.x("invalid value", ctx, errPtr);
    return ctx.p++, false;
  }
  if (c === 43 || c === 45) {
    return parseNumber(ctx, ctx.p, ctx.s.charCodeAt(++ctx.p), 44 - c, end);
  }
  if (ctx.s.charCodeAt(ctx.p + 4) === 45 && ctx.s.charCodeAt(ctx.p + 7) === 45) {
    return parseDate(ctx, c, end);
  }
  if (ctx.s.charCodeAt(ctx.p + 2) === 58) {
    return parseTime(ctx, c, end);
  }
  return parseNumber(ctx, ctx.p, c, 0, end);
}
function parseNumber(ctx, startPtr, startChr, sign, endChr) {
  let c = startChr;
  let state = 0;
  let hasUnderscores = false;
  if (c === 105) {
    if (ctx.s.charCodeAt(++ctx.p) !== 110 || ctx.s.charCodeAt(++ctx.p) !== 102)
      TomlError.x("invalid value", ctx, startPtr);
    return ctx.p++, (sign || 1) / 0;
  }
  if (c === 110) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 110)
      TomlError.x("invalid value", ctx, startPtr);
    return ctx.p++, NaN;
  }
  if (c === 48) {
    if (++ctx.p >= ctx.s.length || isEndOfValue(c = ctx.s.charCodeAt(ctx.p), endChr))
      return ctx.bi === true ? 0n : 0;
    if (!sign) {
      if (c === 120)
        return parseIntegerBaseN(ctx, startPtr, 16, endChr);
      else if (c === 98)
        return parseIntegerBaseN(ctx, startPtr, 2, endChr);
      else if (c === 111)
        return parseIntegerBaseN(ctx, startPtr, 8, endChr);
    }
    if (c === 46)
      state = 2;
    else if (c === 101 || c === 69)
      state = 4;
    else
      TomlError.x("illegal leading zero", ctx, startPtr);
  } else if (!isDigit(c))
    TomlError.x("invalid value", ctx, startPtr);
  while (++ctx.p < ctx.s.length && (c = ctx.s.charCodeAt(ctx.p), !isEndOfValue(c, endChr))) {
    if (!state)
      state = 1;
    if (c === 95) {
      if (!(state & 1))
        TomlError.x("illegal underscore", ctx);
      state += 11;
      hasUnderscores = true;
    } else if (state === 1 && c === 46)
      state = 2;
    else if ((state === 1 || state === 3) && (c === 101 || c === 69))
      state = 4;
    else if (state === 4 && (c === 43 || c === 45)) {
      state = 6;
    } else if (!isDigit(c))
      TomlError.x(`illegal character in numeric literal`, ctx);
    else if (state > 9)
      state -= 11;
    else if (!(state & 1))
      state++;
  }
  if (!state) {
    let val = (startChr - 48) * (sign || 1);
    return ctx.bi === true ? BigInt(val) : val;
  }
  if (!(state & 1))
    TomlError.x("unfinished numeric value", ctx, startPtr);
  let str = ctx.s.slice(startPtr, ctx.p);
  if (hasUnderscores)
    str = str.replaceAll("_", "");
  return state > 1 ? parseFloat(str) : parseInteger(ctx, str, 10, startPtr);
}
function parseIntegerBaseN(ctx, startPtr, base, endChr) {
  let c, underscore = 1;
  while (++ctx.p < ctx.s.length && (c = ctx.s.charCodeAt(ctx.p), !isEndOfValue(c, endChr))) {
    if (c === 95) {
      if (underscore & 1)
        TomlError.x("illegal underscore", ctx);
      underscore = 3;
    } else if (!isDigit(c, base))
      TomlError.x(`illegal character in numeric literal`, ctx);
    else if (underscore & 1)
      underscore--;
  }
  if (underscore & 1)
    TomlError.x("unfinished numeric value", ctx);
  let str = ctx.s.slice(startPtr + 2, ctx.p);
  if (underscore)
    str = str.replaceAll("_", "");
  return parseInteger(ctx, str, base, startPtr);
}
function parseInteger(ctx, str, base, startPtr) {
  if (ctx.bi !== true)
    int: {
      let val = parseInt(str, base);
      if (!Number.isSafeInteger(val)) {
        if (ctx.bi)
          break int;
        TomlError.x("integer value cannot be represented losslessly", ctx, startPtr);
      }
      return val;
    }
  return base === 10 ? BigInt(str) : BigInt((base === 2 ? "0b" : base === 8 ? "0o" : "0x") + str);
}
function parseDate(ctx, c, endChr) {
  let startPtr = ctx.p++, unsafeSeparator;
  if (!isDigit(c) || !isDigit(ctx.s.charCodeAt(ctx.p++)) || !isDigit(ctx.s.charCodeAt(ctx.p++)) || !isDigit(ctx.s.charCodeAt(ctx.p++))) {
    return parseNumber(ctx, ctx.p = startPtr, c, 0, endChr);
  }
  ctx.p += 5;
  if (!isDigit(ctx.s.charCodeAt(ctx.p++)))
    TomlError.x("invalid date-time: date part is malformed", ctx, startPtr);
  if (ctx.p >= ctx.s.length || ((c = ctx.s.charCodeAt(ctx.p)) !== 32 || (unsafeSeparator = true, !isDigit(ctx.s.charCodeAt(ctx.p + 1)))) && c !== 84 && c !== 116) {
    let t2 = ctx.s.slice(startPtr, ctx.p);
    return readDate(ctx, t2, 3, false, startPtr);
  }
  if (ctx.s.charCodeAt(ctx.p += 3) !== 58)
    TomlError.x("invalid date-time: time part is malformed", ctx, startPtr);
  if (ctx.s.charCodeAt(ctx.p += 3) === 58)
    ctx.p += 3;
  if (ctx.s.charCodeAt(ctx.p) === 46)
    while (isDigit(ctx.s.charCodeAt(++ctx.p)))
      ;
  if (c = ctx.s.charCodeAt(ctx.p)) {
    if (c === 90 || c === 122) {
      let t2 = ctx.s.slice(startPtr, ++ctx.p);
      return readDate(ctx, t2, 1, unsafeSeparator, startPtr, "[+00:00]");
    }
    if (c === 43 || c === 45) {
      let t2 = ctx.s.slice(startPtr, ctx.p += 6);
      return readDate(ctx, t2, 1, unsafeSeparator, startPtr, !ctx.ld && "[" + ctx.s.slice(ctx.p - 6, ctx.p) + "]");
    }
  }
  let t = ctx.s.slice(startPtr, ctx.p);
  return readDate(ctx, t, 2, unsafeSeparator, startPtr);
}
function parseTime(ctx, c, endChr) {
  let start = ctx.p;
  if (!isDigit(c) || !isDigit(ctx.s.charCodeAt(++ctx.p))) {
    return parseNumber(ctx, --ctx.p, c, 0, endChr);
  }
  if (ctx.s.charCodeAt(ctx.p += 4) === 58)
    ctx.p += 3;
  if (ctx.s.charCodeAt(ctx.p) === 46)
    while (isDigit(ctx.s.charCodeAt(++ctx.p)))
      ;
  let t = ctx.s.slice(start, ctx.p);
  return readDate(ctx, t, 4, false, start);
}
function readDate(ctx, str, type, unsafeDelim, errPtr, temporalSuffix) {
  if (ctx.ld) {
    let date = new TomlDate(str, type, unsafeDelim);
    if (!date.isValid())
      TomlError.x("invalid date", ctx, errPtr);
    return date;
  }
  try {
    if (temporalSuffix)
      str += temporalSuffix;
    switch (type) {
      case 1:
        return Temporal.ZonedDateTime.from(str);
      case 2:
        return Temporal.PlainDateTime.from(str);
      case 3:
        return Temporal.PlainDate.from(str);
      case 4:
        return Temporal.PlainTime.from(str);
    }
  } catch (e) {
    TomlError.x(e instanceof Error ? e.message : "" + e, ctx, errPtr);
  }
}

// node_modules/smol-toml/dist/util.js
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      TomlError.x("control characters are not allowed in comments", ctx);
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (ctx.p < ctx.s.length) {
    while (ctx.p < ctx.s.length && ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}

// node_modules/smol-toml/dist/struct.js
function parseKey(ctx, end = 61) {
  let startPtr;
  let state = 0;
  let parsed = [];
  let sliceStart;
  let c = ctx.s.charCodeAt(startPtr = ctx.p);
  do {
    if (c === end) {
      if (!state)
        TomlError.x("unexpected end of key", ctx);
      if (state === 1)
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
      return ctx.p++, parsed;
    } else if (c === 46) {
      if (!state)
        TomlError.x("illegal empty bare key", ctx);
      if (state === 1)
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
      state = 0;
    } else if (!state && (c === 34 || c === 39)) {
      if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2))
        TomlError.x("illegal quoted key: multiline strings are not allowed", ctx);
      parsed.push(parseString(ctx));
      state = 2;
      ctx.p--;
    } else if (c === 32 || c === 9) {
      if (state === 1) {
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
        state = 2;
      }
    } else if (state === 2 || c < 48 && c !== 45 || c > 57 && c < 65 || c > 90 && c < 97 && c !== 95 || c > 122) {
      TomlError.x("illegal character in key", ctx);
    } else if (!state) {
      state = 1;
      sliceStart = ctx.p;
    }
  } while (c = ctx.s.charCodeAt(++ctx.p));
  TomlError.x("incomplete key-value: cannot find end of key", ctx, startPtr);
}
function parseInlineTable(ctx) {
  let startPtr = ctx.p++;
  let res2 = /* @__PURE__ */ Object.create(null);
  let seen = /* @__PURE__ */ new Set();
  let c;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res2;
    }
    let k;
    let t = res2;
    let hasOwn = false;
    let errPtr = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        TomlError.x("trying to redefine an already defined value", ctx, errPtr);
      }
      let unsafe = k === "__proto__";
      if (ctx.uk && (unsafe || k === "constructor")) {
        t = ctx.uk !== 1 && TomlError.x("document contains an unsafe property", ctx, errPtr);
        break;
      }
      if (!hasOwn && unsafe) {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      TomlError.x("trying to redefine an already defined value", ctx, errPtr);
    }
    skipVoid(ctx, true, true);
    let value = extractValue(
      ctx,
      125
      /* } */
    );
    if (t && typeof (t[k] = value) === "object")
      seen.add(value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res2;
    }
    if (c !== 44)
      TomlError.x("expected comma or end of structure", ctx, ctx.p - 1);
  }
  TomlError.x("unfinished table", ctx, startPtr);
}
function parseArray(ctx) {
  let startPtr = ctx.p++;
  let res2 = [];
  let c;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res2;
    }
    res2.push(extractValue(
      ctx,
      93
      /* ] */
    ));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res2;
    }
    if (c !== 44)
      TomlError.x("expected comma or end of structure", ctx, ctx.p - 1);
  }
  TomlError.x("unfinished array", ctx, startPtr);
}

// node_modules/smol-toml/dist/parse.js
function peekTable(ctx, key, table2, meta, type) {
  let t = table2;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      let unsafe = k === "__proto__";
      if (ctx.uk && (unsafe || k === "constructor"))
        return false;
      if (unsafe) {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: /* @__PURE__ */ Object.create(null)
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = /* @__PURE__ */ Object.create(null));
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: /* @__PURE__ */ Object.create(null) };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function validateTablePeek(ctx, peek, ptr) {
  if (peek === null || ctx.uk === 2)
    TomlError.x(peek === null ? "trying to redefine an already defined table or value" : "document contains an unsafe property", ctx, ptr);
}
function parse(toml, options = {}) {
  let ctx = {
    s: toml,
    p: 0,
    d: options.maxDepth ?? 1e3,
    bi: options.integersAsBigInt ?? false,
    ld: options.useLegacyDate ?? true,
    uk: options.unsafeKeyBehaviour === "throw" ? 2 : options.unsafeKeyBehaviour === "drop" ? 1 : 0
  };
  let res2 = /* @__PURE__ */ Object.create(null);
  let meta = /* @__PURE__ */ Object.create(null);
  let tmp;
  let skipping = false;
  let tbl = res2;
  let m = meta;
  if (toml.charCodeAt(0) === 65279)
    ctx.p++;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      skipping = false;
      let k = parseKey(
        ctx,
        93
        /* ] */
      );
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p) !== 93) {
          TomlError.x("expected end of table array declaration", ctx);
        }
        ctx.p++;
      }
      let p = peekTable(
        ctx,
        k,
        res2,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        validateTablePeek(ctx, p, tmp);
        skipping = true;
      } else {
        m = p[2];
        tbl = p[1];
      }
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        ctx,
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p && !skipping)
        validateTablePeek(ctx, p, tmp);
      skipVoid(ctx, true, true);
      let v = extractValue(ctx, void 0);
      if (p && !skipping)
        p[1][p[0]] = v;
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && (tmp !== 13 || toml.charCodeAt(ctx.p + 1) !== 10)) {
      TomlError.x("each key-value declaration must be followed by an end-of-line", ctx);
    }
    skipVoid(ctx);
  }
  return res2;
}

// node_modules/smol-toml/dist/stringify.js
var HAS_WELLFORMED = !!"".isWellFormed;

// src/lib/proc.ts
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
var UsageError = class extends Error {
};
var run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const timedOut = r.error?.code === "ETIMEDOUT";
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut };
};
function git(r, cwd, args) {
  const res2 = r("git", args, { cwd });
  return res2.code === 0 ? res2.stdout : null;
}
function repoRoot(r, cwd) {
  return git(r, cwd, ["rev-parse", "--show-toplevel"])?.trim() || null;
}
function isExecutable(file) {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function which(name, pathVar) {
  for (const dir of (pathVar ?? "").split(delimiter)) {
    if (dir && isExecutable(join(dir, name))) return join(dir, name);
  }
  return null;
}
function parseFlags(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const m = /^--?([A-Za-z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`unexpected argument ${arg}`);
    const [, name = "", inline] = m;
    if (spec.bool?.includes(name) && inline === void 0) out[name] = true;
    else if (spec.value?.includes(name)) {
      const v = inline ?? argv[++i];
      if (v === void 0) throw new UsageError(`--${name} needs a value`);
      out[name] = v;
    } else if (spec.list?.includes(name) && inline === void 0) {
      const items = [];
      while (i + 1 < argv.length) {
        const next = argv[i + 1];
        if (next === "--") {
          items.push(...argv.slice(i + 2));
          i = argv.length;
        } else if (next.startsWith("-") && next !== "-") break;
        else {
          items.push(next);
          i++;
        }
      }
      out[name] = items;
    } else throw new UsageError(`unknown flag ${arg}`);
  }
  return out;
}

// src/lib/pins.ts
import { existsSync, readFileSync } from "node:fs";
import { basename, join as join2 } from "node:path";

// src/lib/glob.ts
function splitTop(s) {
  const parts2 = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts2.push(cur);
      cur = "";
    } else cur += ch;
  }
  return [...parts2, cur];
}
function expandBraces(g) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "{") {
      if (depth++ === 0) start = i;
    } else if (c === "}") {
      if (depth === 0) throw new UsageError(`unbalanced "}" in ${g}`);
      if (--depth === 0) {
        const parts2 = splitTop(g.slice(start + 1, i));
        if (parts2.length < 2) throw new UsageError(`brace group without a comma in ${g} ({a..b} is not supported)`);
        return parts2.flatMap((p) => expandBraces(g.slice(0, start) + p + g.slice(i + 1)));
      }
    }
  }
  if (depth !== 0) throw new UsageError(`unbalanced "{" in ${g}`);
  return [g];
}
function globToRegExp(g) {
  if (/[[!]/.test(g) || g.startsWith("/")) {
    throw new UsageError(`unsupported glob ${g} ("[", "!" and a leading "/" are not allowed)`);
  }
  let r = "";
  for (let i = 0; i < g.length; ) {
    if (g.startsWith("**/", i)) {
      r += "(?:.*/)?";
      i += 3;
    } else if (g.startsWith("**", i)) {
      r += ".*";
      i += 2;
    } else if (g[i] === "*") {
      r += "[^/]*";
      i++;
    } else if (g[i] === "?") {
      r += "[^/]";
      i++;
    } else {
      r += g[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${r}$`, "s");
}
function compileGlob(token) {
  return expandBraces(token).map(globToRegExp);
}
var isGlob = (s) => /[*?{]/.test(s);

// src/lib/pins.ts
var PinError = class extends Error {
};
var ver = (s) => /(\d+(?:\.\d+){0,2})/.exec(s)?.[1] ?? null;
var hit = (s, floor = false) => {
  const v = s ? ver(s) : null;
  return v ? [{ v, floor }] : [];
};
var ALIAS = { node: ["node", "nodejs"] };
var IMAGE = { go: "golang" };
var toolVersions = (text, tool) => {
  for (const line of text.split("\n")) {
    const m = /^\s*(\S+)\s+(\S+)/.exec(line);
    if (m && (Object.hasOwn(ALIAS, tool) ? ALIAS[tool] : [tool]).includes(m[1])) return hit(m[2]);
  }
  return [];
};
var plain = (text) => {
  const v = ver(text.trim().replace(/^v/, ""));
  if (!v) throw new PinError(`no version in "${text.trim().slice(0, 30)}"`);
  return [{ v }];
};
var goMod = (text, tool) => tool !== "go" ? [] : hit(/^toolchain\s+go(\S+)/m.exec(text)?.[1] ?? /^go\s+(\S+)/m.exec(text)?.[1]);
var pkg = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new PinError("not valid JSON");
  }
};
var fcmp = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
};
var above = (v) => {
  const p = v.split(".").map(Number);
  p[p.length - 1]++;
  while (p.length < 3) p.push(0);
  return p.join(".");
};
function lowerBound(expr, tool) {
  const lows = expr.split("||").map((alt) => {
    const bounds = [];
    for (const m of alt.replace(/\s-\s+v?[\d.xX*]+/g, "").matchAll(/(<=?|>=?|\^|~>?|=)?\s*v?(\d+(?:\.(?:\d+|[xX*]))*)([-+][\w.-]+)?/g)) {
      const v = m[1]?.startsWith("<") ? null : ver(m[2]);
      if (v) bounds.push(m[1] === ">" && !m[3]?.startsWith("-") ? above(v) : v);
    }
    if (!bounds.length) throw new PinError(`engines.${tool} "${expr}" has no lower bound`);
    return bounds.sort(fcmp).at(-1);
  });
  return lows.sort(fcmp)[0];
}
var engines = (text, tool) => {
  const e = pkg(text).engines?.[tool];
  return typeof e === "string" ? [{ v: lowerBound(e, tool), floor: true }] : [];
};
var pkgVersion = (text, tool, root) => {
  const volta = pkg(text).volta?.[tool];
  const out = typeof volta === "string" ? hit(volta) : engines(text, tool, root);
  if (!out.length) throw new PinError(`no volta.${tool} or engines.${tool}`);
  return out;
};
var dockerfile = (text, tool) => {
  const out = [];
  for (const m of text.matchAll(/^FROM\s+(?:--\S+\s+)?(\S+)/gim)) {
    const [name = "", tag = ""] = m[1].split("@")[0].split("/").pop().split(":");
    if (name === (IMAGE[tool] ?? tool)) out.push(...hit(tag));
  }
  const arg = new RegExp(`^ARG\\s+${tool.toUpperCase().replace(/\W/g, "_")}_VERSION=(\\S+)`, "gim");
  for (const m of text.matchAll(arg)) out.push(...hit(m[1]));
  return out;
};
function byName(file) {
  const b = basename(file);
  return b === "go.mod" ? goMod : b === ".tool-versions" ? toolVersions : b === "package.json" ? pkgVersion : plain;
}
var ACTIONS = {
  "setup-go": ["actions/setup-go", "go", "go-version"],
  "setup-node": ["actions/setup-node", "node", "node-version"],
  "setup-python": ["actions/setup-python", "python", "python-version"],
  "golangci-action": ["golangci/golangci-lint-action", "golangci-lint", "version"],
  "goreleaser-action": ["goreleaser/goreleaser-action", "goreleaser", "version"]
};
function setup(kind) {
  const [action, forTool, key] = ACTIONS[kind];
  return (text, tool, root) => {
    if (tool !== forTool) return [];
    const lines = text.split(/\r?\n/);
    const out = [];
    const indentOf = (l) => l.length - l.trimStart().length;
    lines.forEach((line, i) => {
      const bare = /^(\s*)-\s*(#.*)?$/.exec(line);
      const d = bare ?? /^(\s*)-\s+/.exec(line);
      if (!d) return;
      const dash = d[1].length;
      let keyIndent = d[0].length;
      const body = bare ? [] : [{ indent: keyIndent, text: line.slice(keyIndent).trimEnd() }];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim() || l.trimStart().startsWith("#")) continue;
        if (indentOf(l) <= dash) break;
        if (bare && !body.length) keyIndent = indentOf(l);
        body.push({ indent: indentOf(l), text: l.trim() });
      }
      if (!body.some((e) => e.indent === keyIndent && new RegExp(`^uses:\\s*${action}@`).test(e.text))) return;
      const w = body.findIndex((e) => e.indent === keyIndent && /^with:\s*(#.*)?$/.test(e.text));
      if (w < 0) return;
      const mapIndent = body[w + 1]?.indent ?? 0;
      for (const e of body.slice(w + 1)) {
        if (e.indent <= keyIndent) break;
        const kv = e.indent === mapIndent ? new RegExp(`^(${key}(-file)?):\\s*(.+?)\\s*(?:#.*)?$`).exec(e.text) : null;
        if (!kv || /\$\{\{|\[/.test(kv[3])) continue;
        const val = kv[3].replace(/^["']|["']$/g, "");
        if (!kv[2]) out.push(...hit(val));
        else if (existsSync(join2(root, val))) out.push(...byName(val)(readFileSync(join2(root, val), "utf8"), tool, root));
        else throw new PinError(`${key}-file ${val} not found`);
      }
    });
    return out;
  };
}
var KINDS = {
  "tool-versions": { file: ".tool-versions", parse: toolVersions },
  nvmrc: { file: ".nvmrc", parse: plain },
  "node-version": { file: ".node-version", parse: plain },
  "python-version": { file: ".python-version", parse: plain },
  "go-mod": { file: "go.mod", parse: goMod },
  engines: { file: "package.json", parse: engines },
  dockerfile: { file: "Dockerfile", parse: dockerfile },
  "setup-go": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-go") },
  "setup-node": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-node") },
  "setup-python": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-python") },
  "golangci-action": { file: ".github/workflows/*.{yml,yaml}", parse: setup("golangci-action") },
  "goreleaser-action": { file: ".github/workflows/*.{yml,yaml}", parse: setup("goreleaser-action") }
};
var splitSource = (spec) => {
  const i = spec.indexOf(":");
  return i < 0 ? [spec, void 0] : [spec.slice(0, i), spec.slice(i + 1)];
};
var isSourceKind = (spec) => Object.hasOwn(KINDS, splitSource(spec)[0]);
function readSource(root, tracked, tool, spec) {
  const [kind, path] = splitSource(spec);
  const k = KINDS[kind];
  const target = path ?? k.file;
  const files = isGlob(target) ? tracked.filter((f) => compileGlob(target).some((re) => re.test(f))) : [target];
  if (!files.length) throw new PinError(`${spec}: no file matches ${target}`);
  const out = [];
  for (const f of files) {
    if (!existsSync(join2(root, f))) throw new PinError(`${spec}: ${f} not found`);
    try {
      for (const x of k.parse(readFileSync(join2(root, f), "utf8"), tool, root)) out.push({ src: `${kind}:${f}`, v: x.v, floor: x.floor ?? false });
    } catch (e) {
      throw new PinError(`${spec}: ${f}: ${e.message}`);
    }
  }
  if (!out.length) throw new PinError(`${spec}: no ${tool} version found in ${files.length === 1 ? files[0] : `${files.length} files`}`);
  return out;
}
var DEPTH = { exact: 3, minor: 2, major: 1, floor: 3 };
function cmp(a, b, depth = 3) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.min(depth, x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
var maxFloor = (vals) => vals.filter((x) => x.floor).map((x) => x.v).sort((a, b) => fcmp(b, a))[0] ?? null;
var parts = (v) => v.split(".").length;
var pinOf = (vals, mode) => mode === "floor" ? maxFloor(vals) ?? vals[0].v : pinned(vals).reduce((a, b) => parts(b.v) > parts(a.v) ? b : a).v;
var pinned = (vals) => vals.some((x) => !x.floor) ? vals.filter((x) => !x.floor) : vals;
function disagreement(vals, mode) {
  if (mode === "floor") {
    const fl = maxFloor(vals);
    if (fl === null) return "compare = floor needs a floor source (engines)";
    const bad2 = vals.filter((x) => !x.floor && cmp(x.v, fl) < 0);
    return bad2.length ? bad2.map((x) => `${x.src}=${x.v}`).join(", ") + ` below the floor ${fl}` : null;
  }
  const bad = vals.some((x, i) => vals.slice(i + 1).some((y) => cmp(x.v, y.v, DEPTH[mode]) !== 0));
  return bad ? vals.map((x) => `${x.src}=${x.v}`).join(", ") + ` disagree (${mode})` : null;
}
var belowFloor = (local, vals) => {
  const fl = maxFloor(vals);
  return fl !== null && fcmp(local, fl) < 0 ? fl : null;
};
var localOk = (local, pin, mode) => mode === "floor" ? cmp(local, pin) >= 0 : cmp(local, pin, DEPTH[mode]) === 0;

// src/lib/version.ts
var VERSION = "0.4.0";

// src/lib/env-config.ts
function table(v, where, allowed) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new UsageError(`${where} must be a table`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new UsageError(`${where}: unknown key "${k}"`);
  return v;
}
function pick(t, k, where, ok, what, def) {
  const v = t[k];
  if (v === void 0) {
    if (def === void 0) throw new UsageError(`${where}: missing ${k}`);
    return def;
  }
  if (!ok(v)) throw new UsageError(`${where}: ${k} must be ${what}`);
  return v;
}
var isStr = (v) => typeof v === "string" && v !== "";
var isBool = (v) => typeof v === "boolean";
var isStrs = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");
var oneOf = (...opts) => (v) => typeof v === "string" && opts.includes(v);
var list = (v, where) => {
  if (!Array.isArray(v)) throw new UsageError(`${where} must be an array of tables`);
  return v;
};
function checkEngine(range) {
  const m = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) throw new UsageError(`engine must look like ">=0.4.0", found "${range}"`);
  const want = m.slice(1).map(Number);
  const have = VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) {
      if (have[i] < want[i]) throw new UsageError(`config needs loops ${range}, this is ${VERSION}; update agentic-tools`);
      return;
    }
  }
}
function parseConfig(text, file) {
  let raw;
  try {
    raw = parse(text);
  } catch (e) {
    throw new UsageError(`${file}: ${e.message.split("\n")[0]}`);
  }
  const top = table(raw, file, ["schema_version", "engine", "shared_checkout", "pins", "harness", "compose", "local"]);
  if (top.schema_version !== 1) {
    const what = top.schema_version === void 0 ? "is missing" : `${String(top.schema_version)} is unsupported by loops ${VERSION}`;
    throw new UsageError(`${file}: schema_version ${what} (want 1)`);
  }
  if (top.engine !== void 0) checkEngine(pick(top, "engine", "engine", isStr, "a string"));
  const shared = top.shared_checkout === void 0 ? null : table(top.shared_checkout, "[shared_checkout]", ["hint"]);
  const sharedHint = shared && pick(shared, "hint", "[shared_checkout]", isStr, "a string", "use a git worktree");
  const pins = list(top.pins ?? [], "[[pins]]").map((p, i) => {
    const where = `[[pins]] #${i + 1}`;
    const t = table(p, where, ["tool", "sources", "compare", "local"]);
    const sources = pick(t, "sources", where, isStrs, "a list of strings");
    for (const s of sources) if (!isSourceKind(s)) throw new UsageError(`${where}: unknown source kind in "${s}"`);
    if (!sources.length) throw new UsageError(`${where}: sources is empty`);
    return {
      tool: pick(t, "tool", where, isStr, "a string"),
      sources,
      compare: pick(t, "compare", where, oneOf("exact", "minor", "major", "floor"), "exact|minor|major|floor", "exact"),
      local: pick(t, "local", where, oneOf("fail", "warn", "off"), "fail|warn|off", "warn")
    };
  });
  const h = table(top.harness ?? {}, "[harness]", ["tools", "files", "entrypoints", "tracked", "sparse"]);
  const isEntry = (v) => v === "auto" || isStrs(v);
  const harness = {
    tools: pick(h, "tools", "[harness]", isStrs, "a list of strings", []),
    files: pick(h, "files", "[harness]", isStrs, "a list of strings", []),
    entrypoints: pick(h, "entrypoints", "[harness]", isEntry, '"auto" or a list of paths', []),
    tracked: pick(h, "tracked", "[harness]", isBool, "a boolean", false),
    sparse: pick(h, "sparse", "[harness]", oneOf("warn", "off"), "warn|off", "off") === "warn"
  };
  const c = table(top.compose ?? {}, "[compose]", ["mode", "files", "inputs", "containers", "derive", "allow_container_name"]);
  const compose = top.compose === void 0 ? null : {
    mode: pick(c, "mode", "[compose]", oneOf("none", "test"), "none|test", "none"),
    files: pick(c, "files", "[compose]", isStrs, "a list of strings", []),
    inputs: pick(c, "inputs", "[compose]", isStrs, "a list of globs", []),
    containers: pick(c, "containers", "[compose]", oneOf("fail", "warn"), "fail|warn", "fail"),
    derive: pick(c, "derive", "[compose]", oneOf("slug-hash", "dirname"), "slug-hash|dirname", "dirname"),
    allowContainerName: pick(c, "allow_container_name", "[compose]", isStrs, "a list of strings", [])
  };
  if (compose?.mode === "test" && !compose.files.length) throw new UsageError("[compose]: mode test needs files");
  const seen = /* @__PURE__ */ new Set();
  const locals = list(top.local ?? [], "[[local]]").map((l, i) => {
    const where = `[[local]] #${i + 1}`;
    const t = table(l, where, ["id", "run", "static", "timeout_s"]);
    const id = pick(t, "id", where, isStr, "a string");
    if (!/^[a-ex]\.[\w.-]+$/.test(id)) throw new UsageError(`${where}: id "${id}" must look like <a-e or x>.<name>`);
    if (seen.has(id)) throw new UsageError(`${where}: duplicate id ${id}`);
    seen.add(id);
    const timeoutS = pick(t, "timeout_s", where, (v) => typeof v === "number" && v >= 1e-3 && Number.isSafeInteger(Math.round(v * 1e3)), "a positive number of seconds (at least 0.001)", 15);
    const timeoutMs = Math.round(timeoutS * 1e3);
    const run2 = pick(t, "run", where, isStr, "a path");
    if (isAbsolute(run2) || /^\.\.(\/|$)/.test(normalize(run2))) throw new UsageError(`${where}: run "${run2}" must be a repo-relative path`);
    return { id, run: run2, static: pick(t, "static", where, isBool, "a boolean", false), timeoutS, timeoutMs };
  });
  return { sharedHint, pins, harness, compose, locals };
}

// src/lib/env-checks.ts
import { createHash } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync2, realpathSync, statSync as statSync2 } from "node:fs";
import { basename as basename2, join as join3, resolve } from "node:path";
var res = (level, id, message, fix) => ({ level, id, message, fix, source: "builtin" });
var CFG = ".loops/env-check.toml";
var rp = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
var short = (xs, n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ` (+${xs.length - n} more)` : "");
var VERSION_CMD = { go: ["go", ["version"]], node: ["node", ["--version"]], python: ["python3", ["--version"]] };
function pinChecks(c) {
  const out = [];
  for (const pin of c.cfg.pins) {
    const id = `a.pins.${pin.tool}`;
    let vals;
    try {
      vals = pin.sources.flatMap((s) => readSource(c.root, c.tracked, pin.tool, s));
    } catch (e) {
      if (!(e instanceof PinError)) throw e;
      out.push(res("FAIL", id, e.message, `fix the source file or the sources in ${CFG}`));
      continue;
    }
    const bad = disagreement(vals, pin.compare);
    if (bad) {
      out.push(res("FAIL", id, bad, `align the pinned versions, or loosen compare in ${CFG}`));
      continue;
    }
    const want = pinOf(vals, pin.compare);
    out.push(res("PASS", id, `${pin.tool} ${want} (${[...new Set(vals.map((v) => v.src))].join(", ")})`));
    if (c.static || pin.local === "off") continue;
    const [bin, args] = Object.hasOwn(VERSION_CMD, pin.tool) ? VERSION_CMD[pin.tool] : [pin.tool, ["--version"]];
    const r = c.run(bin, args, { cwd: c.root, env: { ...c.env, GOTOOLCHAIN: "local", GOPROXY: "off" } });
    const have = r.code === 0 ? ver(r.stdout + r.stderr) : null;
    const lid = `a.local.${pin.tool}`;
    const level = pin.local === "fail" ? "FAIL" : "WARN";
    const fix = `install ${pin.tool} ${want} (asdf install, mise install, or your package manager)`;
    if (have === null) out.push(res(level, lid, `${bin} not found or gave no version`, fix));
    else if (!localOk(have, want, pin.compare)) out.push(res(level, lid, `local ${pin.tool} ${have} does not match pin ${want}`, fix));
    else if (belowFloor(have, vals)) out.push(res(level, lid, `local ${pin.tool} ${have} is below the floor ${belowFloor(have, vals)}`, fix));
    else out.push(res("PASS", lid, `local ${pin.tool} ${have} matches pin ${want}`));
  }
  return out;
}
function sharedCheck(c) {
  if (c.cfg.sharedHint === null) return [];
  if (c.static) return [res("SKIP", "c.shared", "not checked in --static mode")];
  if (c.isWorktree) return [res("PASS", "c.shared", "in a linked worktree")];
  if (c.env.ENV_CHECK_ALLOW_MAIN === "1") return [res("INFO", "c.shared", "shared checkout allowed by ENV_CHECK_ALLOW_MAIN")];
  return [res("FAIL", "c.shared", "this is the shared checkout; agents and branches belong in a worktree", c.cfg.sharedHint)];
}
function autoEntrypoints(c) {
  const re = compileGlob(".github/workflows/*.{yml,yaml}");
  const found = /* @__PURE__ */ new Set();
  for (const f of c.tracked.filter((t) => re.some((r) => r.test(t)) && existsSync2(join3(c.root, t)))) {
    for (const m of readFileSync2(join3(c.root, f), "utf8").matchAll(/^\s*(?:-\s+)?(?:run:\s+(?:[|>][+-]?\s*)?)?\.\/([\w./-]+)/gm)) found.add(m[1]);
  }
  return [...found].sort();
}
function harnessChecks(c) {
  const h = c.cfg.harness;
  const out = [];
  if (h.tools.length && !c.static) {
    const missing = h.tools.filter((t) => !which(t, c.env.PATH));
    out.push(missing.length ? res("FAIL", "d.tools", `missing on PATH: ${missing.join(", ")}`, "install the missing tools") : res("PASS", "d.tools", `present: ${h.tools.join(", ")}`));
  }
  if (h.files.length) {
    const bad = h.files.filter((f) => !existsSync2(join3(c.root, f)) || statSync2(join3(c.root, f)).size === 0);
    out.push(bad.length ? res("FAIL", "d.files", `missing or empty: ${bad.join(", ")}`, "restore the files (git checkout) or fix [harness] files") : res("PASS", "d.files", `present: ${h.files.join(", ")}`));
  }
  const entries = h.entrypoints === "auto" ? autoEntrypoints(c) : h.entrypoints;
  if (entries.length) {
    const bad = entries.filter((e) => !isExecutable(join3(c.root, e)));
    out.push(bad.length ? res("FAIL", "d.entrypoints", `missing or not executable: ${short(bad)}`, `chmod +x ${bad.slice(0, 3).join(" ")}`) : res("PASS", "d.entrypoints", `${entries.length} executable`));
  }
  const [deletedZ, stagedZ] = h.tracked ? ["-d", "-s"].map((f) => git(c.run, c.root, ["ls-files", f, "-z"])) : [];
  if (h.tracked && (deletedZ == null || stagedZ == null)) out.push(res("FAIL", "d.tracked", "git ls-files failed", "run git status to see what is wrong with the index"));
  else if (h.tracked) {
    const deleted = deletedZ.split("\0").filter(Boolean);
    const lost = stagedZ.split("\0").flatMap((l) => l.startsWith("100755 ") ? [l.split("	")[1] ?? ""] : []).filter((p) => p && existsSync2(join3(c.root, p)) && !isExecutable(join3(c.root, p)));
    const parts2 = [deleted.length ? `deleted: ${short(deleted)}` : "", lost.length ? `exec bit lost: ${short(lost)}` : ""].filter(Boolean);
    out.push(parts2.length ? res("FAIL", "d.tracked", parts2.join("; "), "git checkout -- <path> to restore, chmod +x for exec bits") : res("PASS", "d.tracked", "no tracked file deleted, exec bits intact"));
  }
  if (h.sparse && !c.static && git(c.run, c.root, ["config", "--get", "core.sparseCheckout"])?.trim() === "true") {
    out.push(res("WARN", "d.sparse", "sparse checkout is enabled; tools may not see every file", "git sparse-checkout disable"));
  }
  return out;
}
var norm = (s) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
var COMPOSE_FILE = /(^|\/)(docker-)?compose(\.[\w.-]+)?\.ya?ml$/;
function derive(c, root) {
  if (c.cfg.compose?.derive === "dirname") return norm(basename2(root));
  const main2 = c.worktrees[0] ?? c.root;
  const hash = createHash("sha1").update(rp(root)).digest("hex").slice(0, 6);
  return `${norm(basename2(main2))}-${norm(basename2(root)).slice(0, 24)}-${hash}`;
}
function parseDotEnv(file) {
  let text;
  try {
    text = readFileSync2(file, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const v = m[2];
    out[m[1]] = /^(["'])(.*?)\1/.exec(v)?.[2] ?? v.replace(/(^|\s)#.*$/, "").trim();
  }
  return out;
}
function interpolate(raw, env) {
  let bad = false;
  const out = raw.replace(/\$(?:\$|\{(\w+)(?:(:?[-?])([^}]*))?\}|(\w+))/g, (m, braced, op, arg = "", bare) => {
    if (m === "$$") return "$";
    const v = env[braced ?? bare];
    const set = op?.startsWith(":") ? !!v : v !== void 0;
    if (op?.endsWith("?") ? !set : !op && v === void 0) bad = true;
    return set ? v : op?.endsWith("-") ? arg : "";
  });
  return bad || out.includes("$") ? null : out;
}
var normProject = (s) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[_-]+/, "");
var scalar = (s) => /^(["'])(.*?)\1/.exec(s.trim())?.[2] ?? s.replace(/(^|\s)#.*$/, "").trim();
function declaredName(c, dir) {
  const env = { ...parseDotEnv(join3(dir, ".env")), ...c.env };
  let last;
  for (const f of c.cfg.compose.files) {
    if (!existsSync2(join3(dir, f))) continue;
    const lines = readFileSync2(join3(dir, f), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = /^name:[ \t]*(.*)$/.exec(line);
      if (!m) return;
      let raw = scalar(m[1]);
      if (!raw) {
        const next = lines.slice(i + 1).find((l) => l.trim() && !/^\s*#/.test(l));
        if (next && /^[ \t]+\S/.test(next) && !/:(\s|$)/.test(scalar(next))) raw = scalar(next);
      }
      if (!raw) return;
      const v = interpolate(raw, env);
      if (v === null) last = { bad: raw };
      else if (v !== "") last = normProject(v) || { bad: raw };
    });
  }
  return last;
}
function composeProject(c) {
  const id = "e.project";
  const { files, derive: how } = c.cfg.compose;
  const present = files.filter((f) => existsSync2(join3(c.root, f)));
  if (!present.length) return { name: null, result: res("FAIL", id, `no compose file found (${files.join(", ")})`, `fix [compose] files in ${CFG}`) };
  const missing = files.filter((f) => !present.includes(f));
  if (missing.length) return { name: null, result: res("FAIL", id, `compose file missing: ${missing.join(", ")}`, `restore ${missing[0]} or fix [compose] files in ${CFG}`) };
  const mine = declaredName(c, c.root);
  const declared = typeof mine === "string" ? mine : null;
  if (c.static) return { name: null, result: res("PASS", id, `compose files present${declared ? `, name: ${declared}` : ""} (project name not resolved in --static)`) };
  const unresolved = (d, whose = "") => ({ name: null, result: res("FAIL", id, `${whose}compose name: ${d.bad} cannot be resolved`, "set the variable it uses, or declare a literal name: in the compose file") });
  const envName = c.env.COMPOSE_PROJECT_NAME || parseDotEnv(join3(c.root, ".env")).COMPOSE_PROJECT_NAME || null;
  if (typeof mine === "object" && !c.isWorktree && !envName) return unresolved(mine);
  const main2 = c.worktrees[0] ?? c.root;
  const theirs = c.isWorktree ? declaredName(c, main2) : mine;
  const mainEnvName = normProject(parseDotEnv(join3(main2, ".env")).COMPOSE_PROJECT_NAME ?? "");
  if (c.isWorktree && typeof theirs === "object" && !mainEnvName) return unresolved(theirs, "the main checkout's ");
  const prod = mainEnvName || ((c.isWorktree ? (typeof theirs === "string" ? theirs : void 0) ?? declared : declared) ?? derive(c, main2));
  const name = envName ?? (c.isWorktree ? derive(c, c.root) : declared ?? derive(c, c.root));
  const source = envName ? "COMPOSE_PROJECT_NAME" : c.isWorktree || !declared ? `derived: ${how}` : "name: in compose file";
  const clash = c.worktrees.filter((w) => rp(w) !== rp(c.root) && derive(c, w) === name);
  if (c.isWorktree && normProject(name) === prod) {
    return { name, result: res("FAIL", id, `worktree would use the main checkout's project name ${name}`, 'set COMPOSE_PROJECT_NAME, or use derive = "slug-hash"') };
  }
  if (clash.length) return { name, result: res("FAIL", id, `project name ${name} also derives for worktree ${clash[0]}`, 'rename a worktree, or use derive = "slug-hash"') };
  return { name, result: res("PASS", id, `${name} (${source})`) };
}
var DOCKER_TIMEOUT_MS = 1e4;
function containersCheck(c, project) {
  const cfg = c.cfg.compose;
  const id = "b.containers";
  if (!cfg.inputs.length || !project) return [];
  const ids = c.run("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`], { cwd: c.root, timeoutMs: DOCKER_TIMEOUT_MS });
  if (ids.code !== 0) return [res("SKIP", id, "docker is not available (not installed, the daemon is down, or it did not answer in 10s)")];
  const running = ids.stdout.split("\n").filter(Boolean);
  if (!running.length) return [res("SKIP", id, `stack down (no running container for project ${project})`)];
  const matchers = cfg.inputs.flatMap((g) => compileGlob(g));
  const files = c.tracked.filter((f) => matchers.some((re) => re.test(f)));
  const ct = files.length ? Number(git(c.run, c.root, ["log", "-1", "--format=%ct", "--", ...files])?.trim()) : NaN;
  if (!ct) return [res("SKIP", id, "no commit touches the [compose] inputs")];
  const info = c.run("docker", ["inspect", "--format", "{{.Name}} {{.Created}}", ...running], { cwd: c.root, timeoutMs: DOCKER_TIMEOUT_MS });
  if (info.code !== 0) return [res("SKIP", id, "docker inspect failed")];
  const stale = info.stdout.split("\n").map((l) => l.trim().split(" ")).filter(([name, created]) => name && Date.parse(created ?? "") < ct * 1e3).map(([name]) => name.replace(/^\//, ""));
  const fix = `docker compose -p ${project} up -d --build`;
  const level = cfg.containers === "fail" ? "FAIL" : "WARN";
  return [stale.length ? res(level, id, `${short(stale)} created before the newest change to the compose inputs`, fix) : res("PASS", id, `${running.length} running container(s) are newer than the compose inputs`)];
}
function composeChecks(c) {
  if (!c.cfg.compose) return [];
  const { mode, files, allowContainerName } = c.cfg.compose;
  if (mode === "none") {
    const tracked = c.tracked.filter((f) => COMPOSE_FILE.test(f));
    return [tracked.length ? res("FAIL", "e.none", `config says compose mode none but ${short(tracked)} is tracked`, `set [compose] mode = "test" and list the files in ${CFG}`) : res("PASS", "e.none", "no compose file tracked")];
  }
  const names = files.filter((f) => existsSync2(join3(c.root, f))).flatMap((f) => [...readFileSync2(join3(c.root, f), "utf8").matchAll(/^\s*container_name:\s*["']?([^\s"'#]+)/gm)].map((m) => m[1])).filter((n) => !allowContainerName.includes(n));
  const project = composeProject(c);
  return [
    project.result,
    ...c.static ? [] : containersCheck(c, project.name),
    names.length ? res("WARN", "e.container_name", `fixed container_name ${short([...new Set(names)])} collides across worktrees`, `drop container_name, or list it in allow_container_name in ${CFG}`) : res("PASS", "e.container_name", "no fixed container_name")
  ];
}
var LINE = /^(PASS|WARN|FAIL|SKIP|INFO) (\S+) (.+?)(?: (?:—|--) fix: (.*))?$/;
function runLocal(c, l, project) {
  if (c.static && !l.static) return [{ ...res("SKIP", l.id, "not run in --static mode"), source: "local" }];
  const env = {
    ...c.env,
    ENV_CHECK_ROOT: c.root,
    ENV_CHECK_MODE: c.static ? "static" : "full",
    ENV_CHECK_WORKTREE: c.isWorktree ? "1" : "0",
    ENV_CHECK_PROJECT: project ?? "",
    ENV_CHECK_ID: l.id,
    GOPROXY: "off",
    GOTOOLCHAIN: "local",
    NO_COLOR: "1"
  };
  const r = c.run(resolve(c.root, l.run), [], { cwd: c.root, env, timeoutMs: l.timeoutMs });
  const mk = (level, id, message, fix) => ({ level, id, message, fix, source: "local" });
  const out = [];
  for (const line of r.stdout.split("\n").map((s) => s.trimEnd()).filter(Boolean)) {
    const m = LINE.exec(line);
    if (m && (m[2] === l.id || m[2].startsWith(`${l.id}.`))) out.push(mk(m[1], m[2], m[3], m[4]));
    else out.push(mk("FAIL", `${l.id}.protocol`, `unparseable line: ${line.slice(0, 80)}`, "emit `LEVEL id message [\u2014 fix: ...]`, one line per result, id = the configured id or <id>.<name>"));
  }
  if (r.timedOut) return [...out, mk("WARN", l.id, `timed out after ${l.timeoutS}s (not a pass)`, `raise timeout_s or run ${l.run} by hand`)];
  const stderr = r.stderr.trim().split("\n")[0] ?? "";
  const why = stderr ? ` (${stderr.slice(0, 120)})` : "";
  if (!out.length) return [mk("FAIL", l.id, `printed no results${r.code ? `, exit ${r.code}` : ""}${why}`, `run ${l.run} by hand`)];
  if (r.code !== 0 && !out.some((x) => x.level === "FAIL")) out.push(mk("FAIL", l.id, `exited ${r.code ?? "abnormally"} without a FAIL line${why}`, `run ${l.run} by hand`));
  return out;
}

// src/lib/env-check.ts
var GROUPS = "abcdex";
var group = (r) => GROUPS.indexOf(r.id[0] ?? "x");
function collapse(rs) {
  const seen = /* @__PURE__ */ new Map();
  const out = [];
  for (const r of rs) {
    const first = seen.get(`${r.level}\0${r.message}`);
    if (first) first.also = [...first.also ?? [], r.id];
    else {
      const copy = { ...r };
      seen.set(`${r.level}\0${r.message}`, copy);
      out.push(copy);
    }
  }
  return out;
}
function envCheckMain(argv, d) {
  const f = parseFlags(argv, { bool: ["static", "json", "quiet", "compose-project"] });
  const root = repoRoot(d.run, d.cwd);
  if (!root) throw new UsageError("not a git repository");
  const cfgFile = join4(root, ".loops", "env-check.toml");
  if (!existsSync3(cfgFile)) throw new UsageError(`no ${cfgFile} (nothing to check)`);
  let text;
  try {
    text = readFileSync3(cfgFile, "utf8");
  } catch (e) {
    throw new UsageError(`cannot read ${cfgFile}: ${e.message}`);
  }
  const cfg = parseConfig(text, ".loops/env-check.toml");
  for (const l of cfg.locals) {
    if (!isExecutable(resolve2(root, l.run))) throw new UsageError(`local check ${l.id}: ${l.run} is missing or not executable`);
  }
  const isStatic = (f.static === true || d.env.CI === "true") && !f["compose-project"];
  const ls = d.run("git", ["ls-files", "-z"], { cwd: root });
  if (ls.code !== 0) throw new UsageError(`git ls-files failed${ls.stderr.trim() ? `: ${ls.stderr.trim().split("\n")[0]}` : ""}`);
  const tracked = ls.stdout.split("\0").filter(Boolean);
  let isWorktree = false;
  let worktrees = [];
  if (!isStatic) {
    const dir = (flag) => resolve2(root, git(d.run, root, ["rev-parse", flag])?.trim() ?? flag);
    isWorktree = dir("--git-dir") !== dir("--git-common-dir");
    worktrees = (git(d.run, root, ["worktree", "list", "--porcelain"]) ?? "").split("\n").flatMap((l) => l.startsWith("worktree ") ? [l.slice(9)] : []);
  }
  const ctx = { run: d.run, root, env: d.env, static: isStatic, cfg, tracked, isWorktree, worktrees };
  const home = d.env.HOME || homedir();
  const redact = (s) => home.length > 1 ? s.split(home).join("~") : s;
  if (f["compose-project"]) {
    if (cfg.compose?.mode !== "test") throw new UsageError("compose mode is not test; there is no project name");
    const { name, result } = composeProject(ctx);
    if (name && result.level !== "FAIL") d.out(redact(name));
    else d.err(redact(`env-check: ${result.message}`));
    return name && result.level !== "FAIL" ? 0 : 1;
  }
  const project = cfg.compose?.mode === "test" ? composeProject(ctx).name : null;
  const results = [
    ...pinChecks(ctx),
    ...sharedCheck(ctx),
    ...harnessChecks(ctx),
    ...composeChecks(ctx),
    ...cfg.locals.flatMap((l) => runLocal(ctx, l, project))
  ].map((r, i) => ({ r, i })).sort((a, b) => group(a.r) - group(b.r) || a.i - b.i).map(({ r }) => r);
  const shown = collapse(results).map((r) => ({
    ...r,
    id: redact(r.id),
    message: redact(r.message),
    fix: redact(r.fix ?? (r.level === "WARN" || r.level === "FAIL" ? "address the message above and re-run" : "")) || void 0
  }));
  const n = (level) => shown.filter((r) => r.level === level).length;
  const summary = { fail: n("FAIL"), warn: n("WARN"), pass: n("PASS"), skip: n("SKIP") };
  const exit = summary.fail ? 1 : 0;
  if (f.json) {
    const rs = shown.map((r) => ({ level: r.level, id: r.id, message: r.message, fix: r.fix ?? null, also: r.also ?? [], source: r.source }));
    d.out(JSON.stringify({ schema: 1, engine: VERSION, mode: isStatic ? "static" : "full", root: redact(root), results: rs, summary, exit }));
  } else {
    const lines = shown.filter((r) => !f.quiet || r.level === "WARN" || r.level === "FAIL").map((r) => `${r.level} ${r.id}  ${r.message}${r.fix ? ` \u2014 fix: ${r.fix}` : ""}${r.also ? ` (also: ${r.also.join(", ")})` : ""}`);
    lines.push(`env-check: ${summary.fail} FAIL, ${summary.warn} WARN, ${summary.pass} PASS, ${summary.skip} SKIP`);
    d.out(lines.join("\n"));
  }
  return exit;
}

// src/lib/zone-cli.ts
import { existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";
import { join as join5, relative, resolve as resolve3 } from "node:path";

// src/lib/zone.ts
var RANK = { green: 0, yellow: 1, red: 2 };
var SUPPORTED_SCHEMA = 1;
var COLUMNS = ["glob", "zone", "prod", "evidence class", "why"];
var splitCells = (line) => line.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
function parseRiskZones(text, file) {
  const lines = text.split(/\r?\n/);
  const fail = (n, msg) => {
    throw new UsageError(`${file}:${n}: ${msg}`);
  };
  const zonesAt = lines.findIndex((l) => /^## Zones\s*$/.test(l));
  if (zonesAt < 0) fail(1, "no `## Zones` section");
  const sectionEnd = (from) => {
    const i = lines.findIndex((l, n) => n > from && /^## /.test(l));
    return i < 0 ? lines.length : i;
  };
  let schema = null;
  for (let i = 0; i < zonesAt && !schema; i++) {
    const m = lines[i].startsWith(">") ? /Schema version (\d+)/.exec(lines[i]) : null;
    if (m) schema = { n: Number(m[1]), line: i + 1 };
  }
  if (!schema) fail(1, 'missing "Schema version N" in the header blockquote');
  else if (schema.n !== SUPPORTED_SCHEMA) fail(schema.line, `schema ${schema.n} unsupported by loops ${VERSION}`);
  const rows = [];
  let cols = null;
  let width = 0;
  let inTable = false;
  for (let i = zonesAt + 1; i < sectionEnd(zonesAt); i++) {
    const line = lines[i].trim();
    if (!line) inTable = false;
    if (/^[\s:|-]+$/.test(line) && line.includes("|") && line.includes("-")) {
      const prev = lines[i - 1]?.trim() ?? "";
      if (!line.startsWith("|") || prev && !prev.startsWith("|")) fail(i + 1, "table must use leading pipes");
      inTable = true;
    }
    if (inTable && !line.startsWith("|") && /(?<!\\)\|/.test(line) && !/^[\s:|-]+$/.test(line)) fail(i + 1, "table row must start with `|`");
    if (!line.startsWith("|") || /^\|[\s:|-]+$/.test(line)) continue;
    const cells = splitCells(line);
    if (!cols) {
      width = cells.length;
      cols = COLUMNS.map((name) => cells.findIndex((c) => c.toLowerCase().startsWith(name)));
      const missing = COLUMNS.filter((_, k) => cols[k] === -1);
      if (missing.length) fail(i + 1, `table header lacks column(s): ${missing.join(", ")}`);
      inTable = true;
      continue;
    }
    inTable = true;
    if (cells.length !== width) fail(i + 1, `expected ${width} columns, found ${cells.length}`);
    const cell = (k) => cells[cols[k]];
    const zone = cell(1).toLowerCase();
    if (!Object.hasOwn(RANK, zone)) fail(i + 1, `unknown zone "${cell(1)}" (green, yellow or red)`);
    const prod = cell(2).toLowerCase();
    if (prod !== "yes" && prod !== "no" && prod !== "?") fail(i + 1, `Prod must be yes, no or ?, found "${cell(2)}"`);
    const tokens = [...cell(0).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (!tokens.length) fail(i + 1, "Glob cell has no backticked glob");
    const evidence = cell(3).split(",").map((e) => e.trim().toLowerCase()).filter((e) => e && e !== "none");
    for (const glob of tokens) {
      let matchers = [];
      try {
        matchers = compileGlob(glob);
      } catch (e) {
        fail(i + 1, e.message);
      }
      rows.push({ line: i + 1, glob, zone, prod, evidence, matchers });
    }
  }
  if (!rows.length) fail(zonesAt + 1, "`## Zones` table has no rows");
  const ship = {};
  const shipAt = lines.findIndex((l) => /^## Ship prefix\s*$/.test(l));
  for (let i = shipAt + 1; shipAt >= 0 && i < sectionEnd(shipAt); i++) {
    const m = /^- ([^:]+):\s*(.*?)\s*$/.exec(lines[i]);
    if (m) ship[m[1].trim()] = /^"[^"]*"$/.test(m[2]) ? m[2].slice(1, -1) : m[2];
  }
  return { rows, ship };
}
function classifyPath(rz, path) {
  const rows = rz.rows.filter((r) => r.matchers.some((re) => re.test(path)));
  if (!rows.length) return { path, zone: "yellow", prod: false, evidence: [], rows, unmatched: true };
  const zone = rows.reduce((z, r) => RANK[r.zone] > RANK[z] ? r.zone : z, "green");
  const evidence = [...new Set(rows.flatMap((r) => r.evidence))].sort();
  return { path, zone, prod: rows.some((r) => r.prod !== "no"), evidence, rows, unmatched: false };
}
function summarize(infos) {
  const counts = { green: 0, yellow: 0, red: 0 };
  for (const p of infos) counts[p.zone]++;
  const zone = infos.reduce((z, p) => z === "none" || RANK[p.zone] > RANK[z] ? p.zone : z, "none");
  const drivers = [];
  const byRow = /* @__PURE__ */ new Map();
  const loose = [];
  for (const p of infos) {
    if (p.zone !== zone) continue;
    if (p.unmatched) loose.push(p.path);
    for (const r of p.rows) if (r.zone === zone) byRow.set(r, [...byRow.get(r) ?? [], p.path]);
  }
  for (const [row, paths] of byRow) drivers.push({ row, paths });
  if (loose.length) drivers.push({ row: null, paths: loose });
  return {
    zone,
    prodPaths: infos.filter((p) => p.prod).length,
    unmatched: infos.filter((p) => p.unmatched).length,
    evidence: [...new Set(infos.flatMap((p) => p.evidence))].sort(),
    counts,
    drivers
  };
}

// src/lib/zone-cli.ts
function parseNameStatus(z) {
  const t = z.split("\0");
  const paths = [];
  for (let i = 0; i < t.length && t[i]; ) {
    const n = t[i].startsWith("R") || t[i].startsWith("C") ? 2 : 1;
    paths.push(...t.slice(i + 1, i + 1 + n).filter(Boolean));
    i += 1 + n;
  }
  return paths;
}
function gitPaths(d, root, base, committed) {
  const g = (args) => {
    const r = d.run("git", args, { cwd: root });
    if (r.code !== 0) throw new UsageError(`git ${args[0]} failed: ${r.stderr.trim().split("\n")[0] ?? ""}`);
    return r.stdout;
  };
  const tried = base ? [base] : ["origin/HEAD", "origin/main", "main"];
  const ref = tried.find((x) => git(d.run, root, ["rev-parse", "--verify", "--quiet", `${x}^{commit}`]) !== null);
  if (!ref) throw new UsageError(`no base ref found (tried ${tried.join(", ")}); pass --base`);
  const mergeBase = g(["merge-base", ref, "HEAD"]).trim();
  const paths = parseNameStatus(g(["diff", "--name-status", "-M", "-z", mergeBase, "HEAD"]));
  if (!committed) {
    paths.push(...parseNameStatus(g(["diff", "--name-status", "-M", "-z", "HEAD"])));
    paths.push(...parseNameStatus(g(["diff", "--cached", "--name-status", "-M", "-z"])));
    paths.push(...g(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"));
  }
  return paths;
}
var plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
var LIST_CAP = 8;
function renderText(rz, ship, infos, s, explain) {
  if (s.zone === "none") return ["zone: none"];
  const lines = [`zone: ${s.zone}`];
  const note = s.unmatched ? `; ${s.unmatched} unmatched (counted as no)` : "";
  lines.push(
    `prod: ${s.prodPaths ? "yes" : "no"} (l7: ${s.prodPaths ? "required" : "not required"}; prod-touching: ${plural(s.prodPaths, "path")}${note})`,
    `evidence: ${s.evidence.join(", ") || "none"}`,
    "driving rows:"
  );
  for (const { row, paths } of s.drivers) {
    const shown = paths.slice(0, LIST_CAP).join(", ") + (paths.length > LIST_CAP ? `, (+${paths.length - LIST_CAP} more)` : "");
    lines.push(`  ${s.zone}  ${row ? `\`${row.glob}\`` : "(no row: default yellow)"}  ${plural(paths.length, "path")}: ${shown}`);
  }
  const inc = s.unmatched ? ` incl. ${s.unmatched} unmatched` : "";
  lines.push(`paths: ${infos.length} (red ${s.counts.red}, yellow ${s.counts.yellow}${inc}, green ${s.counts.green})`);
  lines.push(`ship: ${ship}`);
  if (s.zone === "green") {
    const alt = ["docs-only", "trivial S0"].flatMap((k) => rz.ship[k] ? [`${k}: ${rz.ship[k]}`] : []);
    if (alt.length) lines.push(`alt: ${alt.join(" | ")}`);
  }
  lines.push(
    "judgment left to L0: <category>, <one extra review chosen at L0>; docs-only / trivial S0 rows;",
    "  one-way changes (migration, deleted history, published release, public post) are red regardless"
  );
  if (explain) {
    lines.push("explain:");
    for (const p of infos) {
      const rows = p.unmatched ? "(no row: default yellow)" : p.rows.map((r) => `\`${r.glob}\``).join(" ");
      lines.push(`  ${p.zone.padEnd(6)} ${p.prod ? "prod" : "-   "}  ${p.path}  <- ${rows}`);
    }
  }
  return lines;
}
function zoneMain(argv, d) {
  const f = parseFlags(argv, {
    bool: ["committed", "stdin", "z", "json", "explain"],
    value: ["base", "file"],
    list: ["paths"]
  });
  if (f.paths && f.stdin) throw new UsageError("--paths and --stdin are mutually exclusive");
  const root = repoRoot(d.run, d.cwd) ?? d.cwd;
  const filePath = typeof f.file === "string" ? resolve3(d.cwd, f.file) : join5(root, "risk-zones.md");
  if (!existsSync4(filePath)) throw new UsageError(`cannot read ${filePath}`);
  const shown = relative(d.cwd, filePath).startsWith("..") ? filePath : relative(d.cwd, filePath);
  let text;
  try {
    text = readFileSync4(filePath, "utf8");
  } catch (e) {
    throw new UsageError(`cannot read ${filePath}: ${e.message}`);
  }
  const rz = parseRiskZones(text, shown);
  let raw;
  if (Array.isArray(f.paths)) raw = f.paths;
  else if (f.stdin) raw = d.readStdin().split(f.z ? "\0" : "\n").map((p) => f.z ? p : p.replace(/\r$/, ""));
  else if (repoRoot(d.run, d.cwd) === null) throw new UsageError("not a git repository; pass --paths or --stdin");
  else raw = gitPaths(d, root, typeof f.base === "string" ? f.base : void 0, f.committed === true);
  const paths = [...new Set(raw.map((p) => p.replace(/^\.\//, "")).filter(Boolean))].sort();
  const infos = paths.map((p) => classifyPath(rz, p));
  const s = summarize(infos);
  const ship = s.zone === "none" ? null : rz.ship[s.zone] ?? null;
  if (s.zone !== "none" && ship === null) throw new UsageError(`${shown}: no "- ${s.zone}:" bullet under "## Ship prefix"`);
  if (f.json) {
    d.out(
      JSON.stringify({
        schema: 1,
        zone: s.zone,
        prod: s.prodPaths > 0,
        prod_paths: s.prodPaths,
        unmatched: s.unmatched,
        evidence: s.evidence,
        counts: s.counts,
        driving_rows: s.drivers.map((x) => ({ glob: x.row?.glob ?? null, line: x.row?.line ?? null, paths: x.paths })),
        paths: infos.map((p) => ({ path: p.path, zone: p.zone, prod: p.prod, unmatched: p.unmatched, evidence: p.evidence, globs: p.rows.map((r) => r.glob) })),
        ship
      })
    );
  } else d.out(renderText(rz, ship ?? "", infos, s, f.explain === true).join("\n"));
  return 0;
}

// src/lib/loops-cli.ts
var USAGE = `loops ${VERSION}
usage: loops <command> [options]
  zone       [--base REF] [--committed] [--paths P... | --stdin [-z]] [--file F] [--json] [--explain]
  env-check  [--static] [--json] [--quiet] [--compose-project]
  --version`;
function realDeps() {
  return {
    run,
    cwd: process.cwd(),
    env: process.env,
    readStdin: () => readFileSync5(0, "utf8"),
    out: (s) => process.stdout.write(`${s}
`),
    err: (s) => process.stderr.write(`${s}
`)
  };
}
function main(argv, d = realDeps()) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === "--version" || cmd === "-V") d.out(`loops ${VERSION}`);
    else if (cmd === "-h" || cmd === "--help") d.out(USAGE);
    else if (cmd === "zone") return zoneMain(rest, d);
    else if (cmd === "env-check") return envCheckMain(rest, d);
    else throw new UsageError(cmd ? `unknown command ${cmd}
${USAGE}` : USAGE);
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    d.err(`${cmd ?? "loops"}: ${e.message}`);
    return 2;
  }
}

// src/bin/loops.ts
process.exitCode = main(process.argv.slice(2));
