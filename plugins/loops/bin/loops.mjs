#!/usr/bin/env node
import { createRequire as __loops_createRequire } from 'node:module';
const require = __loops_createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "node_modules/semver/internal/constants.js"(exports, module) {
    "use strict";
    var SEMVER_SPEC_VERSION = "2.0.0";
    var MAX_LENGTH = 256;
    var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991;
    var MAX_SAFE_COMPONENT_LENGTH = 16;
    var MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
    var RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module.exports = {
      MAX_LENGTH,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "node_modules/semver/internal/debug.js"(exports, module) {
    "use strict";
    var debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module.exports = debug;
  }
});

// node_modules/semver/internal/re.js
var require_re = __commonJS({
  "node_modules/semver/internal/re.js"(exports, module) {
    "use strict";
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants();
    var debug = require_debug();
    exports = module.exports = {};
    var re = exports.re = [];
    var safeRe = exports.safeRe = [];
    var src = exports.src = [];
    var safeSrc = exports.safeSrc = [];
    var t = exports.t = {};
    var R = 0;
    var LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    var safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    var makeSafeRegex = (value) => {
      for (const [token, max] of safeRegexReplacements) {
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value;
    };
    var createToken = (name, value, isGlobal) => {
      const safe = makeSafeRegex(value);
      const index = R++;
      debug(name, index, value);
      t[name] = index;
      src[index] = value;
      safeSrc[index] = safe;
      re[index] = new RegExp(value, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], true);
    createToken("COERCERTLFULL", src[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
    exports.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
    exports.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
    exports.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "node_modules/semver/internal/parse-options.js"(exports, module) {
    "use strict";
    var looseOption = Object.freeze({ loose: true });
    var emptyOpts = Object.freeze({});
    var parseOptions = (options) => {
      if (!options) {
        return emptyOpts;
      }
      if (typeof options !== "object") {
        return looseOption;
      }
      return options;
    };
    module.exports = parseOptions;
  }
});

// node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "node_modules/semver/internal/identifiers.js"(exports, module) {
    "use strict";
    var numeric = /^[0-9]+$/;
    var compareIdentifiers = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a === b ? 0 : a < b ? -1 : 1;
      }
      const anum = numeric.test(a);
      const bnum = numeric.test(b);
      if (anum && bnum) {
        a = +a;
        b = +b;
      }
      return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    };
    var rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "node_modules/semver/classes/semver.js"(exports, module) {
    "use strict";
    var debug = require_debug();
    var { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
    var { safeRe: re, t } = require_re();
    var parseOptions = require_parse_options();
    var { compareIdentifiers } = require_identifiers();
    var SemVer2 = class _SemVer {
      constructor(version, options) {
        options = parseOptions(options);
        if (version instanceof _SemVer) {
          if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
            return version;
          } else {
            version = version.version;
          }
        } else if (typeof version !== "string") {
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
        }
        if (version.length > MAX_LENGTH) {
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        }
        debug("SemVer", version, options);
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        const m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m) {
          throw new TypeError(`Invalid Version: ${version}`);
        }
        this.raw = version;
        this.major = +m[1];
        this.minor = +m[2];
        this.patch = +m[3];
        if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
          throw new TypeError("Invalid major version");
        }
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
          throw new TypeError("Invalid minor version");
        }
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
          throw new TypeError("Invalid patch version");
        }
        if (!m[4]) {
          this.prerelease = [];
        } else {
          this.prerelease = m[4].split(".").map((id) => {
            if (/^[0-9]+$/.test(id)) {
              const num = +id;
              if (num >= 0 && num < MAX_SAFE_INTEGER) {
                return num;
              }
            }
            return id;
          });
        }
        this.build = m[5] ? m[5].split(".") : [];
        this.format();
      }
      format() {
        this.version = `${this.major}.${this.minor}.${this.patch}`;
        if (this.prerelease.length) {
          this.version += `-${this.prerelease.join(".")}`;
        }
        return this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        debug("SemVer.compare", this.version, this.options, other);
        if (!(other instanceof _SemVer)) {
          if (typeof other === "string" && other === this.version) {
            return 0;
          }
          other = new _SemVer(other, this.options);
        }
        if (other.version === this.version) {
          return 0;
        }
        return this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.major < other.major) {
          return -1;
        }
        if (this.major > other.major) {
          return 1;
        }
        if (this.minor < other.minor) {
          return -1;
        }
        if (this.minor > other.minor) {
          return 1;
        }
        if (this.patch < other.patch) {
          return -1;
        }
        if (this.patch > other.patch) {
          return 1;
        }
        return 0;
      }
      comparePre(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.prerelease.length && !other.prerelease.length) {
          return -1;
        } else if (!this.prerelease.length && other.prerelease.length) {
          return 1;
        } else if (!this.prerelease.length && !other.prerelease.length) {
          return 0;
        }
        let i = 0;
        do {
          const a = this.prerelease[i];
          const b = other.prerelease[i];
          debug("prerelease compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      compareBuild(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        let i = 0;
        do {
          const a = this.build[i];
          const b = other.build[i];
          debug("build compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release, identifier, identifierBase) {
        if (release.startsWith("pre")) {
          if (!identifier && identifierBase === false) {
            throw new Error("invalid increment argument: identifier is empty");
          }
          if (identifier) {
            const match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
            if (!match || match[1] !== identifier) {
              throw new Error(`invalid identifier: ${identifier}`);
            }
          }
        }
        switch (release) {
          case "premajor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor = 0;
            this.major++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0;
            this.inc("patch", identifier, identifierBase);
            this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            if (this.prerelease.length === 0) {
              this.inc("patch", identifier, identifierBase);
            }
            this.inc("pre", identifier, identifierBase);
            break;
          case "release":
            if (this.prerelease.length === 0) {
              throw new Error(`version ${this.raw} is not a prerelease`);
            }
            this.prerelease.length = 0;
            break;
          case "major":
            if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
              this.major++;
            }
            this.minor = 0;
            this.patch = 0;
            this.prerelease = [];
            break;
          case "minor":
            if (this.patch !== 0 || this.prerelease.length === 0) {
              this.minor++;
            }
            this.patch = 0;
            this.prerelease = [];
            break;
          case "patch":
            if (this.prerelease.length === 0) {
              this.patch++;
            }
            this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            const base = Number(identifierBase) ? 1 : 0;
            if (this.prerelease.length === 0) {
              this.prerelease = [base];
            } else {
              let i = this.prerelease.length;
              while (--i >= 0) {
                if (typeof this.prerelease[i] === "number") {
                  this.prerelease[i]++;
                  i = -2;
                }
              }
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === false) {
                  throw new Error("invalid increment argument: identifier already exists");
                }
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === false) {
                prerelease = [identifier];
              }
              if (compareIdentifiers(this.prerelease[0], identifier) === 0) {
                if (isNaN(this.prerelease[1])) {
                  this.prerelease = prerelease;
                }
              } else {
                this.prerelease = prerelease;
              }
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release}`);
        }
        this.raw = this.format();
        if (this.build.length) {
          this.raw += `+${this.build.join(".")}`;
        }
        return this;
      }
    };
    module.exports = SemVer2;
  }
});

// node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "node_modules/semver/functions/parse.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var parse2 = (version, options, throwErrors = false) => {
      if (version instanceof SemVer2) {
        return version;
      }
      try {
        return new SemVer2(version, options);
      } catch (er) {
        if (!throwErrors) {
          return null;
        }
        throw er;
      }
    };
    module.exports = parse2;
  }
});

// node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "node_modules/semver/functions/valid.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var valid2 = (version, options) => {
      const v = parse2(version, options);
      return v ? v.version : null;
    };
    module.exports = valid2;
  }
});

// node_modules/semver/functions/clean.js
var require_clean = __commonJS({
  "node_modules/semver/functions/clean.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var clean = (version, options) => {
      const s = parse2(version.trim().replace(/^[=v]+/, ""), options);
      return s ? s.version : null;
    };
    module.exports = clean;
  }
});

// node_modules/semver/functions/inc.js
var require_inc = __commonJS({
  "node_modules/semver/functions/inc.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var inc2 = (version, release, options, identifier, identifierBase) => {
      if (typeof options === "string") {
        identifierBase = identifier;
        identifier = options;
        options = void 0;
      }
      try {
        return new SemVer2(
          version instanceof SemVer2 ? version.version : version,
          options
        ).inc(release, identifier, identifierBase).version;
      } catch (er) {
        return null;
      }
    };
    module.exports = inc2;
  }
});

// node_modules/semver/functions/diff.js
var require_diff = __commonJS({
  "node_modules/semver/functions/diff.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var diff = (version1, version2) => {
      const v1 = parse2(version1, null, true);
      const v2 = parse2(version2, null, true);
      const comparison = v1.compare(v2);
      if (comparison === 0) {
        return null;
      }
      const v1Higher = comparison > 0;
      const highVersion = v1Higher ? v1 : v2;
      const lowVersion = v1Higher ? v2 : v1;
      const highHasPre = !!highVersion.prerelease.length;
      const lowHasPre = !!lowVersion.prerelease.length;
      if (lowHasPre && !highHasPre) {
        if (!lowVersion.patch && !lowVersion.minor) {
          return "major";
        }
        if (lowVersion.compareMain(highVersion) === 0) {
          if (lowVersion.minor && !lowVersion.patch) {
            return "minor";
          }
          return "patch";
        }
      }
      const prefix = highHasPre ? "pre" : "";
      if (v1.major !== v2.major) {
        return prefix + "major";
      }
      if (v1.minor !== v2.minor) {
        return prefix + "minor";
      }
      if (v1.patch !== v2.patch) {
        return prefix + "patch";
      }
      return "prerelease";
    };
    module.exports = diff;
  }
});

// node_modules/semver/functions/major.js
var require_major = __commonJS({
  "node_modules/semver/functions/major.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var major = (a, loose) => new SemVer2(a, loose).major;
    module.exports = major;
  }
});

// node_modules/semver/functions/minor.js
var require_minor = __commonJS({
  "node_modules/semver/functions/minor.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var minor = (a, loose) => new SemVer2(a, loose).minor;
    module.exports = minor;
  }
});

// node_modules/semver/functions/patch.js
var require_patch = __commonJS({
  "node_modules/semver/functions/patch.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var patch = (a, loose) => new SemVer2(a, loose).patch;
    module.exports = patch;
  }
});

// node_modules/semver/functions/prerelease.js
var require_prerelease = __commonJS({
  "node_modules/semver/functions/prerelease.js"(exports, module) {
    "use strict";
    var parse2 = require_parse();
    var prerelease = (version, options) => {
      const parsed = parse2(version, options);
      return parsed && parsed.prerelease.length ? parsed.prerelease : null;
    };
    module.exports = prerelease;
  }
});

// node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "node_modules/semver/functions/compare.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var compare = (a, b, loose) => new SemVer2(a, loose).compare(new SemVer2(b, loose));
    module.exports = compare;
  }
});

// node_modules/semver/functions/rcompare.js
var require_rcompare = __commonJS({
  "node_modules/semver/functions/rcompare.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var rcompare = (a, b, loose) => compare(b, a, loose);
    module.exports = rcompare;
  }
});

// node_modules/semver/functions/compare-loose.js
var require_compare_loose = __commonJS({
  "node_modules/semver/functions/compare-loose.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var compareLoose = (a, b) => compare(a, b, true);
    module.exports = compareLoose;
  }
});

// node_modules/semver/functions/compare-build.js
var require_compare_build = __commonJS({
  "node_modules/semver/functions/compare-build.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var compareBuild = (a, b, loose) => {
      const versionA = new SemVer2(a, loose);
      const versionB = new SemVer2(b, loose);
      return versionA.compare(versionB) || versionA.compareBuild(versionB);
    };
    module.exports = compareBuild;
  }
});

// node_modules/semver/functions/sort.js
var require_sort = __commonJS({
  "node_modules/semver/functions/sort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var sort = (list2, loose) => list2.sort((a, b) => compareBuild(a, b, loose));
    module.exports = sort;
  }
});

// node_modules/semver/functions/rsort.js
var require_rsort = __commonJS({
  "node_modules/semver/functions/rsort.js"(exports, module) {
    "use strict";
    var compareBuild = require_compare_build();
    var rsort = (list2, loose) => list2.sort((a, b) => compareBuild(b, a, loose));
    module.exports = rsort;
  }
});

// node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "node_modules/semver/functions/gt.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var gt = (a, b, loose) => compare(a, b, loose) > 0;
    module.exports = gt;
  }
});

// node_modules/semver/functions/lt.js
var require_lt = __commonJS({
  "node_modules/semver/functions/lt.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var lt2 = (a, b, loose) => compare(a, b, loose) < 0;
    module.exports = lt2;
  }
});

// node_modules/semver/functions/eq.js
var require_eq = __commonJS({
  "node_modules/semver/functions/eq.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var eq = (a, b, loose) => compare(a, b, loose) === 0;
    module.exports = eq;
  }
});

// node_modules/semver/functions/neq.js
var require_neq = __commonJS({
  "node_modules/semver/functions/neq.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var neq = (a, b, loose) => compare(a, b, loose) !== 0;
    module.exports = neq;
  }
});

// node_modules/semver/functions/gte.js
var require_gte = __commonJS({
  "node_modules/semver/functions/gte.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var gte = (a, b, loose) => compare(a, b, loose) >= 0;
    module.exports = gte;
  }
});

// node_modules/semver/functions/lte.js
var require_lte = __commonJS({
  "node_modules/semver/functions/lte.js"(exports, module) {
    "use strict";
    var compare = require_compare();
    var lte = (a, b, loose) => compare(a, b, loose) <= 0;
    module.exports = lte;
  }
});

// node_modules/semver/functions/cmp.js
var require_cmp = __commonJS({
  "node_modules/semver/functions/cmp.js"(exports, module) {
    "use strict";
    var eq = require_eq();
    var neq = require_neq();
    var gt = require_gt();
    var gte = require_gte();
    var lt2 = require_lt();
    var lte = require_lte();
    var cmp2 = (a, op, b, loose) => {
      switch (op) {
        case "===":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a === b;
        case "!==":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a !== b;
        case "":
        case "=":
        case "==":
          return eq(a, b, loose);
        case "!=":
          return neq(a, b, loose);
        case ">":
          return gt(a, b, loose);
        case ">=":
          return gte(a, b, loose);
        case "<":
          return lt2(a, b, loose);
        case "<=":
          return lte(a, b, loose);
        default:
          throw new TypeError(`Invalid operator: ${op}`);
      }
    };
    module.exports = cmp2;
  }
});

// node_modules/semver/functions/coerce.js
var require_coerce = __commonJS({
  "node_modules/semver/functions/coerce.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var parse2 = require_parse();
    var { safeRe: re, t } = require_re();
    var coerce = (version, options) => {
      if (version instanceof SemVer2) {
        return version;
      }
      if (typeof version === "number") {
        version = String(version);
      }
      if (typeof version !== "string") {
        return null;
      }
      options = options || {};
      let match = null;
      if (!options.rtl) {
        match = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
      } else {
        const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
        let next;
        while ((next = coerceRtlRegex.exec(version)) && (!match || match.index + match[0].length !== version.length)) {
          if (!match || next.index + next[0].length !== match.index + match[0].length) {
            match = next;
          }
          coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
        }
        coerceRtlRegex.lastIndex = -1;
      }
      if (match === null) {
        return null;
      }
      const major = match[2];
      const minor = match[3] || "0";
      const patch = match[4] || "0";
      const prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "";
      const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
      return parse2(`${major}.${minor}.${patch}${prerelease}${build}`, options);
    };
    module.exports = coerce;
  }
});

// node_modules/semver/internal/lrucache.js
var require_lrucache = __commonJS({
  "node_modules/semver/internal/lrucache.js"(exports, module) {
    "use strict";
    var LRUCache = class {
      constructor() {
        this.max = 1e3;
        this.map = /* @__PURE__ */ new Map();
      }
      get(key) {
        const value = this.map.get(key);
        if (value === void 0) {
          return void 0;
        } else {
          this.map.delete(key);
          this.map.set(key, value);
          return value;
        }
      }
      delete(key) {
        return this.map.delete(key);
      }
      set(key, value) {
        const deleted = this.delete(key);
        if (!deleted && value !== void 0) {
          if (this.map.size >= this.max) {
            const firstKey = this.map.keys().next().value;
            this.delete(firstKey);
          }
          this.map.set(key, value);
        }
        return this;
      }
    };
    module.exports = LRUCache;
  }
});

// node_modules/semver/classes/range.js
var require_range = __commonJS({
  "node_modules/semver/classes/range.js"(exports, module) {
    "use strict";
    var SPACE_CHARACTERS = /\s+/g;
    var Range2 = class _Range {
      constructor(range, options) {
        options = parseOptions(options);
        if (range instanceof _Range) {
          if (range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease) {
            return range;
          } else {
            return new _Range(range.raw, options);
          }
        }
        if (range instanceof Comparator) {
          this.raw = range.value;
          this.set = [[range]];
          this.formatted = void 0;
          return this;
        }
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        this.raw = range.trim().replace(SPACE_CHARACTERS, " ");
        this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
        if (!this.set.length) {
          throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
        }
        if (this.set.length > 1) {
          const first = this.set[0];
          this.set = this.set.filter((c) => !isNullSet(c[0]));
          if (this.set.length === 0) {
            this.set = [first];
          } else if (this.set.length > 1) {
            for (const c of this.set) {
              if (c.length === 1 && isAny(c[0])) {
                this.set = [c];
                break;
              }
            }
          }
        }
        this.formatted = void 0;
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = "";
          for (let i = 0; i < this.set.length; i++) {
            if (i > 0) {
              this.formatted += "||";
            }
            const comps = this.set[i];
            for (let k = 0; k < comps.length; k++) {
              if (k > 0) {
                this.formatted += " ";
              }
              this.formatted += comps[k].toString().trim();
            }
          }
        }
        return this.formatted;
      }
      format() {
        return this.range;
      }
      toString() {
        return this.range;
      }
      parseRange(range) {
        const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
        const memoKey = memoOpts + ":" + range;
        const cached = cache.get(memoKey);
        if (cached) {
          return cached;
        }
        const loose = this.options.loose;
        const hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
        range = range.replace(hr, hyphenReplace(this.options.includePrerelease));
        debug("hyphen replace", range);
        range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace);
        debug("comparator trim", range);
        range = range.replace(re[t.TILDETRIM], tildeTrimReplace);
        debug("tilde trim", range);
        range = range.replace(re[t.CARETTRIM], caretTrimReplace);
        debug("caret trim", range);
        let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
        if (loose) {
          rangeList = rangeList.filter((comp) => {
            debug("loose invalid filter", comp, this.options);
            return !!comp.match(re[t.COMPARATORLOOSE]);
          });
        }
        debug("range list", rangeList);
        const rangeMap = /* @__PURE__ */ new Map();
        const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
        for (const comp of comparators) {
          if (isNullSet(comp)) {
            return [comp];
          }
          rangeMap.set(comp.value, comp);
        }
        if (rangeMap.size > 1 && rangeMap.has("")) {
          rangeMap.delete("");
        }
        const result = [...rangeMap.values()];
        cache.set(memoKey, result);
        return result;
      }
      intersects(range, options) {
        if (!(range instanceof _Range)) {
          throw new TypeError("a Range is required");
        }
        return this.set.some((thisComparators) => {
          return isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => {
            return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
              return rangeComparators.every((rangeComparator) => {
                return thisComparator.intersects(rangeComparator, options);
              });
            });
          });
        });
      }
      // if ANY of the sets match ALL of its comparators, then pass
      test(version) {
        if (!version) {
          return false;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer2(version, this.options);
          } catch (er) {
            return false;
          }
        }
        for (let i = 0; i < this.set.length; i++) {
          if (testSet(this.set[i], version, this.options)) {
            return true;
          }
        }
        return false;
      }
    };
    module.exports = Range2;
    var LRU = require_lrucache();
    var cache = new LRU();
    var parseOptions = require_parse_options();
    var Comparator = require_comparator();
    var debug = require_debug();
    var SemVer2 = require_semver();
    var {
      safeRe: re,
      t,
      comparatorTrimReplace,
      tildeTrimReplace,
      caretTrimReplace
    } = require_re();
    var { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants();
    var isNullSet = (c) => c.value === "<0.0.0-0";
    var isAny = (c) => c.value === "";
    var isSatisfiable = (comparators, options) => {
      let result = true;
      const remainingComparators = comparators.slice();
      let testComparator = remainingComparators.pop();
      while (result && remainingComparators.length) {
        result = remainingComparators.every((otherComparator) => {
          return testComparator.intersects(otherComparator, options);
        });
        testComparator = remainingComparators.pop();
      }
      return result;
    };
    var parseComparator = (comp, options) => {
      comp = comp.replace(re[t.BUILD], "");
      debug("comp", comp, options);
      comp = replaceCarets(comp, options);
      debug("caret", comp);
      comp = replaceTildes(comp, options);
      debug("tildes", comp);
      comp = replaceXRanges(comp, options);
      debug("xrange", comp);
      comp = replaceStars(comp, options);
      debug("stars", comp);
      return comp;
    };
    var isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
    var replaceTildes = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
    };
    var replaceTilde = (comp, options) => {
      const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE];
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("tilde", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
        } else if (pr) {
          debug("replaceTilde pr", pr);
          ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        debug("tilde return", ret);
        return ret;
      });
    };
    var replaceCarets = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
    };
    var replaceCaret = (comp, options) => {
      debug("caret", comp, options);
      const r = options.loose ? re[t.CARETLOOSE] : re[t.CARET];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("caret", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          if (M === "0") {
            ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
          } else {
            ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
          }
        } else if (pr) {
          debug("replaceCaret pr", pr);
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
          }
        } else {
          debug("no pr");
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}${z} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}${z} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
          }
        }
        debug("caret return", ret);
        return ret;
      });
    };
    var replaceXRanges = (comp, options) => {
      debug("replaceXRanges", comp, options);
      return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
    };
    var replaceXRange = (comp, options) => {
      comp = comp.trim();
      const r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
      return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
        debug("xRange", comp, ret, gtlt, M, m, p, pr);
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === "=" && anyX) {
          gtlt = "";
        }
        pr = options.includePrerelease ? "-0" : "";
        if (xM) {
          if (gtlt === ">" || gtlt === "<") {
            ret = "<0.0.0-0";
          } else {
            ret = "*";
          }
        } else if (gtlt && anyX) {
          if (xm) {
            m = 0;
          }
          p = 0;
          if (gtlt === ">") {
            gtlt = ">=";
            if (xm) {
              M = +M + 1;
              m = 0;
              p = 0;
            } else {
              m = +m + 1;
              p = 0;
            }
          } else if (gtlt === "<=") {
            gtlt = "<";
            if (xm) {
              M = +M + 1;
            } else {
              m = +m + 1;
            }
          }
          if (gtlt === "<") {
            pr = "-0";
          }
          ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
          ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
          ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        debug("xRange return", ret);
        return ret;
      });
    };
    var replaceStars = (comp, options) => {
      debug("replaceStars", comp, options);
      return comp.trim().replace(re[t.STAR], "");
    };
    var replaceGTE0 = (comp, options) => {
      debug("replaceGTE0", comp, options);
      return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
    };
    var hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
      if (isX(fM)) {
        from = "";
      } else if (isX(fm)) {
        from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
      } else if (isX(fp)) {
        from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
      } else if (fpr) {
        from = `>=${from}`;
      } else {
        from = `>=${from}${incPr ? "-0" : ""}`;
      }
      if (isX(tM)) {
        to = "";
      } else if (isX(tm)) {
        to = `<${+tM + 1}.0.0-0`;
      } else if (isX(tp)) {
        to = `<${tM}.${+tm + 1}.0-0`;
      } else if (tpr) {
        to = `<=${tM}.${tm}.${tp}-${tpr}`;
      } else if (incPr) {
        to = `<${tM}.${tm}.${+tp + 1}-0`;
      } else {
        to = `<=${to}`;
      }
      return `${from} ${to}`.trim();
    };
    var testSet = (set, version, options) => {
      for (let i = 0; i < set.length; i++) {
        if (!set[i].test(version)) {
          return false;
        }
      }
      if (version.prerelease.length && !options.includePrerelease) {
        for (let i = 0; i < set.length; i++) {
          debug(set[i].semver);
          if (set[i].semver === Comparator.ANY) {
            continue;
          }
          if (set[i].semver.prerelease.length > 0) {
            const allowed = set[i].semver;
            if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
              return true;
            }
          }
        }
        return false;
      }
      return true;
    };
  }
});

// node_modules/semver/classes/comparator.js
var require_comparator = __commonJS({
  "node_modules/semver/classes/comparator.js"(exports, module) {
    "use strict";
    var ANY = Symbol("SemVer ANY");
    var Comparator = class _Comparator {
      static get ANY() {
        return ANY;
      }
      constructor(comp, options) {
        options = parseOptions(options);
        if (comp instanceof _Comparator) {
          if (comp.loose === !!options.loose) {
            return comp;
          } else {
            comp = comp.value;
          }
        }
        comp = comp.trim().split(/\s+/).join(" ");
        debug("comparator", comp, options);
        this.options = options;
        this.loose = !!options.loose;
        this.parse(comp);
        if (this.semver === ANY) {
          this.value = "";
        } else {
          this.value = this.operator + this.semver.version;
        }
        debug("comp", this);
      }
      parse(comp) {
        const r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR];
        const m = comp.match(r);
        if (!m) {
          throw new TypeError(`Invalid comparator: ${comp}`);
        }
        this.operator = m[1] !== void 0 ? m[1] : "";
        if (this.operator === "=") {
          this.operator = "";
        }
        if (!m[2]) {
          this.semver = ANY;
        } else {
          this.semver = new SemVer2(m[2], this.options.loose);
        }
      }
      toString() {
        return this.value;
      }
      test(version) {
        debug("Comparator.test", version, this.options.loose);
        if (this.semver === ANY || version === ANY) {
          return true;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer2(version, this.options);
          } catch (er) {
            return false;
          }
        }
        return cmp2(version, this.operator, this.semver, this.options);
      }
      intersects(comp, options) {
        if (!(comp instanceof _Comparator)) {
          throw new TypeError("a Comparator is required");
        }
        if (this.operator === "") {
          if (this.value === "") {
            return true;
          }
          return new Range2(comp.value, options).test(this.value);
        } else if (comp.operator === "") {
          if (comp.value === "") {
            return true;
          }
          return new Range2(this.value, options).test(comp.semver);
        }
        options = parseOptions(options);
        if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
          return false;
        }
        if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
          return false;
        }
        if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
          return true;
        }
        if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
          return true;
        }
        if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
          return true;
        }
        if (cmp2(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
          return true;
        }
        if (cmp2(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
          return true;
        }
        return false;
      }
    };
    module.exports = Comparator;
    var parseOptions = require_parse_options();
    var { safeRe: re, t } = require_re();
    var cmp2 = require_cmp();
    var debug = require_debug();
    var SemVer2 = require_semver();
    var Range2 = require_range();
  }
});

// node_modules/semver/functions/satisfies.js
var require_satisfies = __commonJS({
  "node_modules/semver/functions/satisfies.js"(exports, module) {
    "use strict";
    var Range2 = require_range();
    var satisfies2 = (version, range, options) => {
      try {
        range = new Range2(range, options);
      } catch (er) {
        return false;
      }
      return range.test(version);
    };
    module.exports = satisfies2;
  }
});

// node_modules/semver/ranges/to-comparators.js
var require_to_comparators = __commonJS({
  "node_modules/semver/ranges/to-comparators.js"(exports, module) {
    "use strict";
    var Range2 = require_range();
    var toComparators = (range, options) => new Range2(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
    module.exports = toComparators;
  }
});

// node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = __commonJS({
  "node_modules/semver/ranges/max-satisfying.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var Range2 = require_range();
    var maxSatisfying = (versions, range, options) => {
      let max = null;
      let maxSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range2(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!max || maxSV.compare(v) === -1) {
            max = v;
            maxSV = new SemVer2(max, options);
          }
        }
      });
      return max;
    };
    module.exports = maxSatisfying;
  }
});

// node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = __commonJS({
  "node_modules/semver/ranges/min-satisfying.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var Range2 = require_range();
    var minSatisfying = (versions, range, options) => {
      let min = null;
      let minSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range2(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!min || minSV.compare(v) === 1) {
            min = v;
            minSV = new SemVer2(min, options);
          }
        }
      });
      return min;
    };
    module.exports = minSatisfying;
  }
});

// node_modules/semver/ranges/min-version.js
var require_min_version = __commonJS({
  "node_modules/semver/ranges/min-version.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var Range2 = require_range();
    var gt = require_gt();
    var minVersion = (range, loose) => {
      range = new Range2(range, loose);
      let minver = new SemVer2("0.0.0");
      if (range.test(minver)) {
        return minver;
      }
      minver = new SemVer2("0.0.0-0");
      if (range.test(minver)) {
        return minver;
      }
      minver = null;
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let setMin = null;
        comparators.forEach((comparator) => {
          const compver = new SemVer2(comparator.semver.version);
          switch (comparator.operator) {
            case ">":
              if (compver.prerelease.length === 0) {
                compver.patch++;
              } else {
                compver.prerelease.push(0);
              }
              compver.raw = compver.format();
            /* fallthrough */
            case "":
            case ">=":
              if (!setMin || gt(compver, setMin)) {
                setMin = compver;
              }
              break;
            case "<":
            case "<=":
              break;
            /* istanbul ignore next */
            default:
              throw new Error(`Unexpected operation: ${comparator.operator}`);
          }
        });
        if (setMin && (!minver || gt(minver, setMin))) {
          minver = setMin;
        }
      }
      if (minver && range.test(minver)) {
        return minver;
      }
      return null;
    };
    module.exports = minVersion;
  }
});

// node_modules/semver/ranges/valid.js
var require_valid2 = __commonJS({
  "node_modules/semver/ranges/valid.js"(exports, module) {
    "use strict";
    var Range2 = require_range();
    var validRange2 = (range, options) => {
      try {
        return new Range2(range, options).range || "*";
      } catch (er) {
        return null;
      }
    };
    module.exports = validRange2;
  }
});

// node_modules/semver/ranges/outside.js
var require_outside = __commonJS({
  "node_modules/semver/ranges/outside.js"(exports, module) {
    "use strict";
    var SemVer2 = require_semver();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var Range2 = require_range();
    var satisfies2 = require_satisfies();
    var gt = require_gt();
    var lt2 = require_lt();
    var lte = require_lte();
    var gte = require_gte();
    var outside = (version, range, hilo, options) => {
      version = new SemVer2(version, options);
      range = new Range2(range, options);
      let gtfn, ltefn, ltfn, comp, ecomp;
      switch (hilo) {
        case ">":
          gtfn = gt;
          ltefn = lte;
          ltfn = lt2;
          comp = ">";
          ecomp = ">=";
          break;
        case "<":
          gtfn = lt2;
          ltefn = gte;
          ltfn = gt;
          comp = "<";
          ecomp = "<=";
          break;
        default:
          throw new TypeError('Must provide a hilo val of "<" or ">"');
      }
      if (satisfies2(version, range, options)) {
        return false;
      }
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let high = null;
        let low = null;
        comparators.forEach((comparator) => {
          if (comparator.semver === ANY) {
            comparator = new Comparator(">=0.0.0");
          }
          high = high || comparator;
          low = low || comparator;
          if (gtfn(comparator.semver, high.semver, options)) {
            high = comparator;
          } else if (ltfn(comparator.semver, low.semver, options)) {
            low = comparator;
          }
        });
        if (high.operator === comp || high.operator === ecomp) {
          return false;
        }
        if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
          return false;
        } else if (low.operator === ecomp && ltfn(version, low.semver)) {
          return false;
        }
      }
      return true;
    };
    module.exports = outside;
  }
});

// node_modules/semver/ranges/gtr.js
var require_gtr = __commonJS({
  "node_modules/semver/ranges/gtr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var gtr = (version, range, options) => outside(version, range, ">", options);
    module.exports = gtr;
  }
});

// node_modules/semver/ranges/ltr.js
var require_ltr = __commonJS({
  "node_modules/semver/ranges/ltr.js"(exports, module) {
    "use strict";
    var outside = require_outside();
    var ltr = (version, range, options) => outside(version, range, "<", options);
    module.exports = ltr;
  }
});

// node_modules/semver/ranges/intersects.js
var require_intersects = __commonJS({
  "node_modules/semver/ranges/intersects.js"(exports, module) {
    "use strict";
    var Range2 = require_range();
    var intersects = (r1, r2, options) => {
      r1 = new Range2(r1, options);
      r2 = new Range2(r2, options);
      return r1.intersects(r2, options);
    };
    module.exports = intersects;
  }
});

// node_modules/semver/ranges/simplify.js
var require_simplify = __commonJS({
  "node_modules/semver/ranges/simplify.js"(exports, module) {
    "use strict";
    var satisfies2 = require_satisfies();
    var compare = require_compare();
    module.exports = (versions, range, options) => {
      const set = [];
      let first = null;
      let prev = null;
      const v = versions.sort((a, b) => compare(a, b, options));
      for (const version of v) {
        const included = satisfies2(version, range, options);
        if (included) {
          prev = version;
          if (!first) {
            first = version;
          }
        } else {
          if (prev) {
            set.push([first, prev]);
          }
          prev = null;
          first = null;
        }
      }
      if (first) {
        set.push([first, null]);
      }
      const ranges = [];
      for (const [min, max] of set) {
        if (min === max) {
          ranges.push(min);
        } else if (!max && min === v[0]) {
          ranges.push("*");
        } else if (!max) {
          ranges.push(`>=${min}`);
        } else if (min === v[0]) {
          ranges.push(`<=${max}`);
        } else {
          ranges.push(`${min} - ${max}`);
        }
      }
      const simplified = ranges.join(" || ");
      const original = typeof range.raw === "string" ? range.raw : String(range);
      return simplified.length < original.length ? simplified : range;
    };
  }
});

// node_modules/semver/ranges/subset.js
var require_subset = __commonJS({
  "node_modules/semver/ranges/subset.js"(exports, module) {
    "use strict";
    var Range2 = require_range();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var satisfies2 = require_satisfies();
    var compare = require_compare();
    var subset = (sub, dom, options = {}) => {
      if (sub === dom) {
        return true;
      }
      sub = new Range2(sub, options);
      dom = new Range2(dom, options);
      let sawNonNull = false;
      OUTER: for (const simpleSub of sub.set) {
        for (const simpleDom of dom.set) {
          const isSub = simpleSubset(simpleSub, simpleDom, options);
          sawNonNull = sawNonNull || isSub !== null;
          if (isSub) {
            continue OUTER;
          }
        }
        if (sawNonNull) {
          return false;
        }
      }
      return true;
    };
    var minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
    var minimumVersion = [new Comparator(">=0.0.0")];
    var simpleSubset = (sub, dom, options) => {
      if (sub === dom) {
        return true;
      }
      if (sub.length === 1 && sub[0].semver === ANY) {
        if (dom.length === 1 && dom[0].semver === ANY) {
          return true;
        } else if (options.includePrerelease) {
          sub = minimumVersionWithPreRelease;
        } else {
          sub = minimumVersion;
        }
      }
      if (dom.length === 1 && dom[0].semver === ANY) {
        if (options.includePrerelease) {
          return true;
        } else {
          dom = minimumVersion;
        }
      }
      const eqSet = /* @__PURE__ */ new Set();
      let gt, lt2;
      for (const c of sub) {
        if (c.operator === ">" || c.operator === ">=") {
          gt = higherGT(gt, c, options);
        } else if (c.operator === "<" || c.operator === "<=") {
          lt2 = lowerLT(lt2, c, options);
        } else {
          eqSet.add(c.semver);
        }
      }
      if (eqSet.size > 1) {
        return null;
      }
      let gtltComp;
      if (gt && lt2) {
        gtltComp = compare(gt.semver, lt2.semver, options);
        if (gtltComp > 0) {
          return null;
        } else if (gtltComp === 0 && (gt.operator !== ">=" || lt2.operator !== "<=")) {
          return null;
        }
      }
      for (const eq of eqSet) {
        if (gt && !satisfies2(eq, String(gt), options)) {
          return null;
        }
        if (lt2 && !satisfies2(eq, String(lt2), options)) {
          return null;
        }
        for (const c of dom) {
          if (!satisfies2(eq, String(c), options)) {
            return false;
          }
        }
        return true;
      }
      let higher, lower;
      let hasDomLT, hasDomGT;
      let needDomLTPre = lt2 && !options.includePrerelease && lt2.semver.prerelease.length ? lt2.semver : false;
      let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
      if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt2.operator === "<" && needDomLTPre.prerelease[0] === 0) {
        needDomLTPre = false;
      }
      for (const c of dom) {
        hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
        hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
        if (gt) {
          if (needDomGTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
              needDomGTPre = false;
            }
          }
          if (c.operator === ">" || c.operator === ">=") {
            higher = higherGT(gt, c, options);
            if (higher === c && higher !== gt) {
              return false;
            }
          } else if (gt.operator === ">=" && !satisfies2(gt.semver, String(c), options)) {
            return false;
          }
        }
        if (lt2) {
          if (needDomLTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
              needDomLTPre = false;
            }
          }
          if (c.operator === "<" || c.operator === "<=") {
            lower = lowerLT(lt2, c, options);
            if (lower === c && lower !== lt2) {
              return false;
            }
          } else if (lt2.operator === "<=" && !satisfies2(lt2.semver, String(c), options)) {
            return false;
          }
        }
        if (!c.operator && (lt2 || gt) && gtltComp !== 0) {
          return false;
        }
      }
      if (gt && hasDomLT && !lt2 && gtltComp !== 0) {
        return false;
      }
      if (lt2 && hasDomGT && !gt && gtltComp !== 0) {
        return false;
      }
      if (needDomGTPre || needDomLTPre) {
        return false;
      }
      return true;
    };
    var higherGT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
    };
    var lowerLT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
    };
    module.exports = subset;
  }
});

// node_modules/semver/index.js
var require_semver2 = __commonJS({
  "node_modules/semver/index.js"(exports, module) {
    "use strict";
    var internalRe = require_re();
    var constants2 = require_constants();
    var SemVer2 = require_semver();
    var identifiers = require_identifiers();
    var parse2 = require_parse();
    var valid2 = require_valid();
    var clean = require_clean();
    var inc2 = require_inc();
    var diff = require_diff();
    var major = require_major();
    var minor = require_minor();
    var patch = require_patch();
    var prerelease = require_prerelease();
    var compare = require_compare();
    var rcompare = require_rcompare();
    var compareLoose = require_compare_loose();
    var compareBuild = require_compare_build();
    var sort = require_sort();
    var rsort = require_rsort();
    var gt = require_gt();
    var lt2 = require_lt();
    var eq = require_eq();
    var neq = require_neq();
    var gte = require_gte();
    var lte = require_lte();
    var cmp2 = require_cmp();
    var coerce = require_coerce();
    var Comparator = require_comparator();
    var Range2 = require_range();
    var satisfies2 = require_satisfies();
    var toComparators = require_to_comparators();
    var maxSatisfying = require_max_satisfying();
    var minSatisfying = require_min_satisfying();
    var minVersion = require_min_version();
    var validRange2 = require_valid2();
    var outside = require_outside();
    var gtr = require_gtr();
    var ltr = require_ltr();
    var intersects = require_intersects();
    var simplifyRange = require_simplify();
    var subset = require_subset();
    module.exports = {
      parse: parse2,
      valid: valid2,
      clean,
      inc: inc2,
      diff,
      major,
      minor,
      patch,
      prerelease,
      compare,
      rcompare,
      compareLoose,
      compareBuild,
      sort,
      rsort,
      gt,
      lt: lt2,
      eq,
      neq,
      gte,
      lte,
      cmp: cmp2,
      coerce,
      Comparator,
      Range: Range2,
      satisfies: satisfies2,
      toComparators,
      maxSatisfying,
      minSatisfying,
      minVersion,
      validRange: validRange2,
      outside,
      gtr,
      ltr,
      intersects,
      simplifyRange,
      subset,
      SemVer: SemVer2,
      re: internalRe.re,
      src: internalRe.src,
      tokens: internalRe.t,
      SEMVER_SPEC_VERSION: constants2.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: constants2.RELEASE_TYPES,
      compareIdentifiers: identifiers.compareIdentifiers,
      rcompareIdentifiers: identifiers.rcompareIdentifiers
    };
  }
});

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS2 = Symbol.for("yaml.alias");
    var DOC = Symbol.for("yaml.document");
    var MAP = Symbol.for("yaml.map");
    var PAIR = Symbol.for("yaml.pair");
    var SCALAR = Symbol.for("yaml.scalar");
    var SEQ = Symbol.for("yaml.seq");
    var NODE_TYPE = Symbol.for("yaml.node.type");
    var isAlias2 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS2;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap3 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar2 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq2 = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS2:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar2(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS2;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias2;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap3;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar2;
    exports.isSeq = isSeq2;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove node");
    function visit2(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit2.BREAK = BREAK;
    visit2.SKIP = SKIP;
    visit2.REMOVE = REMOVE;
    function visit_(key, node, visitor, path) {
      const ctrl = callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visit_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = visit_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path) {
      const ctrl = await callVisitor(key, node, visitor, path);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path, ctrl);
        return visitAsync_(key, ctrl, visitor, path);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path = Object.freeze(path.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path = Object.freeze(path.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path) {
      if (typeof visitor === "function")
        return visitor(key, node, path);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path);
      return void 0;
    }
    function replaceNode(key, path, node) {
      const parent = path[path.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit2;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit2 = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res2 = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res2;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts2 = line.trim().split(/[ \t]+/);
        const name = parts2.shift();
        switch (name) {
          case "%TAG": {
            if (parts2.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts2.length < 2)
                return false;
            }
            const [handle, prefix] = parts2;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts2.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts2;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit2.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit2 = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit2.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i) => toJS(v, String(i), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res3) => {
          data.res = res3;
          delete ctx.onCreate;
        };
        const res2 = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res2);
        return res2;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res2 = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res3 } of ctx.anchors.values())
            onAnchor(res3, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res2 }, "", res2) : res2;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit2 = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit2.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        if (found && ctx) {
          const { anchors: anchors2, doc: doc2, maxAliasCount } = ctx;
          let data = anchors2.get(found);
          if (!data) {
            toJS.toJS(found, null, ctx);
            data = anchors2.get(found);
          }
          if (data?.res === void 0) {
            const msg = "This should not happen: Alias anchor was not resolved?";
            throw new ReferenceError(msg);
          }
          if (maxAliasCount >= 0) {
            data.count += 1;
            if (data.aliasCount === 0)
              data.aliasCount = getAliasCount(doc2, found, anchors2);
            if (data.count * data.aliasCount > maxAliasCount) {
              const msg = "Excessive alias count indicates a resource exhaustion attack";
              throw new ReferenceError(msg);
            }
          }
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const source = this.resolve(ctx.doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        return ctx.anchors.get(source).res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path, value) {
      let v = value;
      for (let i = path.length - 1; i >= 0; --i) {
        const k = path[i];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path, value) {
        if (isEmptyPath(path))
          this.add(value);
        else {
          const [key, ...rest] = path;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        const [key, ...rest] = path;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path) {
        const [key, ...rest] = path;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        const [key, ...rest] = path;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split2 = void 0;
      let prev = void 0;
      let overflow = false;
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split2 = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split2 = i;
          }
          if (i >= end) {
            if (split2) {
              folds.push(split2);
              end = split2 + endStep;
              split2 = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split2 = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res2 = text.slice(0, folds[0]);
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
        if (fold === 0)
          res2 = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res2 += `${text[fold]}\\`;
          res2 += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res2;
    }
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res2 = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res2 : foldFlowLines.foldFlowLines(res2, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res2 = _stringify(type);
      if (res2 === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res2 = _stringify(t);
        if (res2 === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res2;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify2(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify2;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify2.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify2.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify2 = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify2.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify3 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify3(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify2.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify2.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts2 = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res2 = parts2.replace(/_/g, "").split(":").reduce((res3, p) => res3 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res2 : res2;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts2 = [value % _60];
      if (value < 60) {
        parts2.unshift(0);
      } else {
        value = (value - parts2[0]) / _60;
        parts2.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts2[0]) / _60;
          parts2.unshift(value);
        }
      }
      return sign + parts2.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify2 = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify2.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify2.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify2.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path) {
        if (Collection.isEmptyPath(path)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path, keepScalar) {
        if (Collection.isEmptyPath(path))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path) {
        if (Collection.isEmptyPath(path))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path, value) {
        if (Collection.isEmptyPath(path)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res2 = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res3 } of ctx.anchors.values())
            onAnchor(res3, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res2 }, "", res2) : res2;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep: sep2, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep2?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep2) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep2 ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep2, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep2 = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep2 + cb;
              sep2 = "";
              break;
            }
            case "newline":
              if (comment)
                sep2 += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap3 = fc.start.source === "{";
      const fcName = isMap3 ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap3 ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
        const { start, key, sep: sep2, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep2?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep2 && !value) {
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap3 && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap3 && !sep2 && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep2, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep2 ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap3 && !props.found && ctx.options.strict) {
              if (sep2)
                for (const st of sep2) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep2, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap3) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap3 ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res2 = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res2) ? res2 : new Scalar.Scalar(res2);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep2 = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep2 + indent.slice(trimIndent) + content;
          sep2 = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep2 === " ")
            sep2 = "\n";
          else if (!prevMoreIndented && sep2 === "\n")
            sep2 = "\n\n";
          value += sep2 + indent.slice(trimIndent) + content;
          sep2 = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep2 === "\n")
            value += "\n";
          else
            sep2 = "\n";
        } else {
          value += sep2 + content;
          sep2 = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split2 = source.split(/\n( *)/);
      const first = split2[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i = 1; i < split2.length; i += 2)
        lines.push([split2[i], split2[i + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return unfoldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function unfoldLines(source) {
      const line = /(.*?)\r?\n/sy;
      let match = line.exec(source);
      if (!match)
        return source;
      let trimEnd, trimBoth;
      try {
        trimEnd = new RegExp("(?<![ 	])[ 	]+$");
        trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
      } catch {
        trimEnd = /[ \t]+$/;
        trimBoth = /^[ \t]+|[ \t]+$/g;
      }
      let res2 = match[1].replace(trimEnd, "");
      let sep2 = " ";
      let pos = line.lastIndex;
      while (match = line.exec(source)) {
        const lm = match[1].replace(trimBoth, "");
        if (lm === "") {
          if (sep2 === "\n")
            res2 += sep2;
          else
            sep2 = "\n";
        } else {
          res2 += sep2 + lm;
          sep2 = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res2 + sep2 + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res2 = "";
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res2 += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res2 += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res2 += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res2 += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res2 += i > wsStart ? source.slice(wsStart, i + 1) : ch;
        } else {
          res2 += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res2;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res2 = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res2) ? res2 : new Scalar.Scalar(res2);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify2 = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res2 = "";
          for (const tok of token.props)
            res2 += stringifyToken(tok);
          return res2 + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res2 = "";
          for (const item of token.items)
            res2 += stringifyItem(item);
          return res2;
        }
        case "flow-collection": {
          let res2 = token.start.source;
          for (const item of token.items)
            res2 += stringifyItem(item);
          for (const st of token.end)
            res2 += st.source;
          return res2;
        }
        case "document": {
          let res2 = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res2 += st.source;
          return res2;
        }
        default: {
          let res2 = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res2 += st.source;
          return res2;
        }
      }
    }
    function stringifyItem({ start, key, sep: sep2, value }) {
      let res2 = "";
      for (const st of start)
        res2 += st.source;
      if (key)
        res2 += stringifyToken(key);
      if (sep2)
        for (const st of sep2)
          res2 += st.source;
      if (value)
        res2 += stringifyToken(value);
      return res2;
    }
    exports.stringify = stringify2;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = Symbol("break visit");
    var SKIP = Symbol("skip children");
    var REMOVE = Symbol("remove item");
    function visit2(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit2.BREAK = BREAK;
    visit2.SKIP = SKIP;
    visit2.REMOVE = REMOVE;
    visit2.itemAtPath = (cst, path) => {
      let item = cst;
      for (const [field, index] of path) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit2.parentCollection = (cst, path) => {
      const parent = visit2.itemAtPath(cst, path.slice(0, -1));
      const field = path[path.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path, item, visitor) {
      let ctrl = visitor(item, path);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
    }
    exports.visit = visit2;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar2 = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar2;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote2 = this.charAt(0);
        let end = this.buffer.indexOf(quote2, this.pos + 1);
        if (quote2 === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter2 = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter2;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list2, type) {
      for (let i = 0; i < list2.length; ++i)
        if (list2[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list2) {
      for (let i = 0; i < list2.length; ++i) {
        switch (list2[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep2;
          if (scalar.end) {
            sep2 = scalar.end;
            sep2.push(this.sourceToken);
            delete scalar.end;
          } else
            sep2 = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep: sep2 }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep2 = it.sep;
                  sep2.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep: sep2 }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs);
              } else {
                Object.assign(it, { key: fs, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs, sep: [] });
              else if (it.sep)
                this.stack.push(fs);
              else
                Object.assign(it, { key: fs, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep2 = fc.end.splice(1, fc.end.length);
            sep2.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep: sep2 }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments2(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument2(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse2(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument2(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify2(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse2;
    exports.parseAllDocuments = parseAllDocuments2;
    exports.parseDocument = parseDocument2;
    exports.stringify = stringify2;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit2 = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit2.visit;
    exports.visitAsync = visit2.visitAsync;
  }
});

// src/lib/loops-cli.ts
import { readFileSync as readFileSync8 } from "node:fs";
import { homedir as homedir2 } from "node:os";

// src/lib/env-check.ts
import { readFileSync as readFileSync6, existsSync as existsSync4 } from "node:fs";
import { homedir } from "node:os";
import { join as join6, resolve as resolve3 } from "node:path";

// src/lib/env-config.ts
import { isAbsolute as isAbsolute3, normalize as normalize2 } from "node:path";

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
function peekTable(ctx, key, table4, meta, type) {
  let t = table4;
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
function parse(toml2, options = {}) {
  let ctx = {
    s: toml2,
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
  if (toml2.charCodeAt(0) === 65279)
    ctx.p++;
  skipVoid(ctx);
  while (ctx.p < toml2.length) {
    if (toml2.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml2.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      skipping = false;
      let k = parseKey(
        ctx,
        93
        /* ] */
      );
      if (isTableArray) {
        if (toml2.charCodeAt(ctx.p) !== 93) {
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
    if (ctx.p < toml2.length && (tmp = toml2.charCodeAt(ctx.p)) !== 10 && (tmp !== 13 || toml2.charCodeAt(ctx.p + 1) !== 10)) {
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
import { accessSync, closeSync, constants, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
var UsageError = class extends Error {
};
var MAX_BUFFER = 64 * 1024 * 1024;
var GRACE_MS = 2e3;
var PS_TIMEOUT_MS = 5e3;
var SETTLE_MS = 500;
var LSTART_SLACK_MS = 2500;
var LSTART_TICK_MS = 1e3;
function backstopMs(timeoutMs) {
  return timeoutMs + 2 * PS_TIMEOUT_MS + GRACE_MS + SETTLE_MS + 3e3;
}
function findPs(pathVar = process.env.PATH, system = ["/bin/ps", "/usr/bin/ps"]) {
  for (const f of system) if (isExecutable(f)) return f;
  const p = which("ps", pathVar);
  return p && isAbsolute(p) ? p : null;
}
var SUPERVISOR = `
const { spawn, spawnSync } = require("node:child_process");
const { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } = require("node:fs");
const { constants } = require("node:os");
const { dirname } = require("node:path");
const o = JSON.parse(readFileSync(0, "utf8"));
const GRACE_MS = ${GRACE_MS}, PS_TIMEOUT_MS = ${PS_TIMEOUT_MS}, SLACK = ${LSTART_SLACK_MS}, TICK = ${LSTART_TICK_MS};
let child = null, error = null, timedOut = false, done = false, timer = null, terminating = false, closed = false, settling = false, tee = null;
// Every live pid of the check seen so far, the leader and its descendants, with the start time each had when first seen.
const seen = new Set(), starts = new Map();
// When the leader exited (its pid is then free to be reused), and whether the leader's group is still the check's.
let leaderExitMs = null, groupOk = true;
// One \`ps -A -o pid=,ppid=,pgid=,lstart=\` listing in UTC (start times parsed to ms, NaN when one does not parse), or
// null without a usable ps (then the sweep keeps what it knew).
const list = () => {
  if (!o.ps) return null;
  const r = spawnSync(o.ps, ["-A", "-o", "pid=,ppid=,pgid=,lstart="], { env: { LC_ALL: "C", TZ: "UTC0" }, encoding: "utf8", timeout: PS_TIMEOUT_MS });
  if (!r.stdout) return null;
  const rows = [];
  for (const line of r.stdout.split("\\n")) {
    const m = /^\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\S.*?)\\s*$/.exec(line);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], pgid: +m[3], at: Date.parse(m[4].replace(/\\s+/g, " ") + " UTC") });
  }
  return rows;
};
// Drop every seen pid that is gone or now has another start time (exited, maybe reused; two listings of one process
// differ by at most TICK, so a pid whose start moved further is another process), then add every live
// descendant of the rest: a setsid child whose parent is still alive is found; a daemon already reparented to init is
// not. Once the leader has exited, its group is still the check's only while a member started before that.
const sweep = () => {
  const rows = list();
  if (!rows) return;
  const live = new Map(rows.map((x) => [x.pid, x]));
  for (const p of [...seen]) {
    const x = live.get(p);
    if (!x || Math.abs(x.at - starts.get(p)) > TICK) seen.delete(p);
    else if (Number.isNaN(starts.get(p))) starts.set(p, x.at);
  }
  const kids = new Map();
  for (const x of rows) kids.set(x.ppid, [...(kids.get(x.ppid) || []), x.pid]);
  const todo = [...seen];
  while (todo.length) for (const k of kids.get(todo.pop()) || []) if (k !== process.pid && !seen.has(k)) { seen.add(k); starts.set(k, live.get(k).at); todo.push(k); }
  if (leaderExitMs !== null) groupOk = rows.some((x) => x.pgid === child.pid && !(x.at > leaderExitMs + SLACK));
};
const signal = (sig) => {
  if (groupOk) try { process.kill(-child.pid, sig); } catch {}
  for (const p of seen) try { process.kill(p, sig); } catch {}
};
const alive = () => {
  if (groupOk) try { process.kill(-child.pid, 0); return true; } catch {}
  for (const p of seen) try { process.kill(p, 0); return true; } catch {}
  return false;
};
// The one way a check is ended early. It turns off the orphan poll and the timer and ignores a repeat call (a second
// Ctrl-C), sends sig to the group and every swept pid, and waits up to GRACE_MS for them all to exit, staying alive
// after the leader exits and when the engine is gone. Then it sweeps again and SIGKILLs the group and every pid seen.
const terminate = (sig, then) => {
  if (terminating) return;
  terminating = true;
  clearInterval(poll);
  clearTimeout(timer);
  if (!child || !child.pid) return then();
  sweep();
  signal(sig);
  const end = Date.now() + GRACE_MS;
  const wait = () => {
    if (alive() && Date.now() < end) return void setTimeout(wait, 25);
    sweep();
    signal("SIGKILL");
    then();
  };
  wait();
};
const orphan = () => process.ppid !== o.parent;
// An engine that is gone left its run dir behind: remove it on the way out. While the engine lives it reads the
// pidfile and the stdout copy after a supervisor it lost, and removes the dir itself.
process.on("exit", () => {
  if (!o.pidfile || !orphan()) return;
  try { if (tee !== null) closeSync(tee); } catch {}
  try { rmSync(dirname(o.pidfile), { recursive: true, force: true }); } catch {}
});
const poll = setInterval(() => { if (orphan()) terminate("SIGTERM", () => process.exit(1)); }, 100);
poll.unref();
for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => terminate(s === "SIGINT" ? "SIGINT" : "SIGTERM", () => process.exit(128 + constants.signals[s])));
// The pipes to the engine are non-blocking: a full one (64 KB) throws EAGAIN until the engine drains it, so wait a ms.
const nap = new Int32Array(new SharedArrayBuffer(4));
const put = (fd, b) => {
  for (let at = 0; at < b.length; ) {
    try { at += writeSync(fd, b, at, b.length - at); } catch (e) { if (e.code !== "EAGAIN") throw e; Atomics.wait(nap, 0, 0, 1); }
  }
};
const bufs = [[], []], sizes = [0, 0];
const finish = (code, signal) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  const st = timedOut || error ? { code: null, signal: null, error, timedOut } : { code, signal, error: null, timedOut };
  try {
    put(2, Buffer.from(JSON.stringify(st) + "\\n"));
    put(2, Buffer.concat(bufs[1]));
    put(1, Buffer.concat(bufs[0]));
  } catch {
    process.exit(1);
  }
  process.exit(0);
};
// After a terminate that ends in a result: the kill closes the pipes; one held by a process that left the group would not.
const settle = () => { settling = true; if (closed) finish(null, null); else setTimeout(() => finish(null, null), ${SETTLE_MS}); };
if (orphan()) process.exit(1);
if (o.out) try { tee = openSync(o.out, "a"); } catch {}
const startMs = Date.now();
child = spawn(o.cmd, o.args, { env: o.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
if (child.pid) {
  seen.add(child.pid);
  starts.set(child.pid, NaN);
  if (o.pidfile) try { writeFileSync(o.pidfile + ".tmp", JSON.stringify({ pgid: child.pid, startMs, spawnedMs: Date.now() })); renameSync(o.pidfile + ".tmp", o.pidfile); } catch {}
}
child.on("error", (e) => { error = e.code || String(e); finish(null, null); });
// A reaped leader's pid is free: never signal it on its own again.
child.on("exit", () => { leaderExitMs = Date.now(); seen.delete(child.pid); });
[child.stdout, child.stderr].forEach((s, i) => s.on("data", (b) => {
  sizes[i] += b.length;
  if (sizes[i] <= o.max) {
    bufs[i].push(b);
    if (i === 0 && tee !== null) try { writeSync(tee, b); } catch {}
  } else if (!terminating) { error = "ENOBUFS"; terminate("SIGKILL", settle); }
}));
child.on("close", (code, signal) => { closed = true; if (!terminating) finish(code, signal); else if (settling) finish(null, null); });
if (o.timeoutMs) timer = setTimeout(() => { timedOut = true; error = "ETIMEDOUT"; terminate("SIGTERM", settle); }, o.timeoutMs);
`;
var run = (cmd, args, opts = {}) => {
  if (opts.group) return runGroup(cmd, args, opts);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    timeout: opts.timeoutMs,
    // SIGTERM can be trapped or ignored; a deadline has to hold.
    killSignal: "SIGKILL",
    encoding: "utf8",
    maxBuffer: MAX_BUFFER
  });
  const errCode = r.error?.code;
  const abend = r.status === null ? errCode ?? r.signal ?? void 0 : void 0;
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: errCode === "ETIMEDOUT", notFound: errCode === "ENOENT", abend };
};
function runGroup(cmd, args, opts) {
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "loops-run-"));
  } catch {
  }
  try {
    const [pidfile, out] = dir ? [join(dir, "group.pid"), join(dir, "out")] : [null, null];
    const ps = opts.ps === void 0 ? findPs() : opts.ps;
    const input = JSON.stringify({ cmd, args, env: opts.env ?? process.env, timeoutMs: opts.timeoutMs, max: MAX_BUFFER, parent: process.pid, pidfile, out, ps });
    const r = spawnSync(process.execPath, ["-e", SUPERVISOR], {
      cwd: opts.cwd,
      env: {},
      input,
      // A backstop only: the supervisor keeps the deadline; backstopMs covers its worst case to end the check.
      timeout: opts.timeoutMs === void 0 ? void 0 : backstopMs(opts.timeoutMs),
      killSignal: "SIGKILL",
      encoding: "utf8",
      maxBuffer: 2 * MAX_BUFFER
    });
    const errCode = r.error?.code;
    const nl = (r.stderr ?? "").indexOf("\n");
    let st = null;
    try {
      st = nl < 0 ? null : JSON.parse(r.stderr.slice(0, nl));
    } catch {
    }
    if (!st || r.status !== 0) {
      const why = errCode ?? r.signal ?? `supervisor exited ${r.status}`;
      const cleaned = pidfile ? reapLost(pidfile, () => psStarts(ps)) : "unverified";
      return { code: null, stdout: out ? printed(out) : "", stderr: "", timedOut: errCode === "ETIMEDOUT", notFound: errCode === "ENOENT", abend: why, lost: true, cleaned };
    }
    const abend = st.code === null ? st.error ?? st.signal ?? void 0 : void 0;
    return { code: st.code, stdout: r.stdout, stderr: r.stderr.slice(nl + 1), timedOut: st.timedOut, notFound: st.error === "ENOENT", abend, lost: false, cleaned: "yes" };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
function printed(out) {
  try {
    const s = readFileSync(out, "utf8");
    return s.slice(0, s.lastIndexOf("\n") + 1);
  } catch {
    return "";
  }
}
function psStarts(ps = findPs()) {
  if (!ps) return null;
  const r = spawnSync(ps, ["-A", "-o", "pid=,pgid=,lstart="], { env: { LC_ALL: "C", TZ: "UTC0" }, encoding: "utf8", timeout: PS_TIMEOUT_MS });
  return r.status === 0 ? r.stdout : null;
}
function groupOwner(listing, pgid, startMs, spawnedMs) {
  let found = false;
  let leader = null;
  for (const line of listing.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (!m || Number(m[2]) !== pgid) continue;
    const at = Date.parse(`${m[3].replace(/\s+/g, " ")} UTC`);
    if (Number.isNaN(at)) return "unknown";
    if (at < startMs - LSTART_SLACK_MS) return "other";
    if (Number(m[1]) === pgid) leader = at;
    found = true;
  }
  if (!found) return "gone";
  if (leader === null) return "unknown";
  return leader > spawnedMs + LSTART_SLACK_MS ? "other" : "ours";
}
function reapLost(pidfile, ps = psStarts) {
  let rec;
  try {
    rec = JSON.parse(readFileSync(pidfile, "utf8"));
  } catch {
    return "unverified";
  }
  const { pgid, startMs, spawnedMs } = rec ?? {};
  if (!Number.isSafeInteger(pgid) || pgid <= 1 || pgid === process.pid || typeof startMs !== "number" || typeof spawnedMs !== "number") return "unverified";
  const listing = ps();
  if (listing === null) return "unverified";
  const owner = groupOwner(listing, pgid, startMs, spawnedMs);
  if (owner === "unknown") return "unverified";
  if (owner === "other") return "no";
  if (owner === "ours") {
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
    }
  }
  return "yes";
}
function shQuote(s) {
  return /^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
var SEGMENT = /[\p{L}\p{N}\p{M}._+@%~-]/u;
var NAME = /[\p{L}\p{N}\p{M}]/u;
function joined(s, i) {
  for (; i < s.length && SEGMENT.test(s[i]); i++) if (NAME.test(s[i])) return true;
  return false;
}
function redactHome(s, home) {
  home = home.replace(/\/+$/, "");
  if (home.length <= 1 || !home.startsWith("/")) return s;
  let out = "";
  let from = 0;
  for (let i = s.indexOf(home); i !== -1; i = s.indexOf(home, Math.max(from, i + 1))) {
    const before = s[i - 1] ?? "";
    const after2 = s[i + home.length] ?? "";
    if (before && SEGMENT.test(before) || joined(s, i + home.length)) continue;
    const quoted = i > from && before === "'" && (after2 === "/" || after2 === "'");
    out += `${s.slice(from, quoted ? i - 1 : i)}${quoted ? after2 === "/" ? "~/'" : "~" : "~"}`;
    from = i + home.length + (quoted ? 1 : 0);
  }
  return out + s.slice(from);
}
var GIT_LOCAL_ENV = ["GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_SHALLOW_FILE", "GIT_COMMON_DIR"];
function realOrNull(p) {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}
function gitEnv(env, own) {
  const out = { ...env };
  for (const k of GIT_LOCAL_ENV) delete out[k];
  const index = env.GIT_INDEX_FILE;
  const gitDir = own?.gitDir ? realOrNull(own.gitDir) : null;
  const file = index && own && gitDir ? realOrNull(resolve(own.root, index)) : null;
  if (file && dirname(file) === gitDir) out.GIT_INDEX_FILE = index;
  return out;
}
function git(r, cwd, args, env) {
  const res2 = r("git", args, { cwd, env });
  return res2.code === 0 ? res2.stdout : null;
}
function repoRoot(r, cwd, env) {
  return git(r, cwd, ["rev-parse", "--show-toplevel"], env)?.trim() || null;
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
var SHIM_MAX = 1 << 20;
function shimOf(file) {
  let real;
  try {
    real = realpathSync(file);
  } catch {
    return null;
  }
  if (/^mise(\.exe)?$/.test(basename(real)) && !/^mise(\.exe)?$/.test(basename(file))) return { manager: "mise", cmd: real, providers: [] };
  const buf = Buffer.alloc(4096);
  let head;
  let n;
  let fd;
  try {
    fd = openSync(file, "r");
    n = readSync(fd, buf, 0, buf.length, 0);
    head = buf.subarray(0, n).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== void 0) closeSync(fd);
  }
  if (!/^# asdf-plugin:/m.test(head)) return null;
  if (n === buf.length) {
    try {
      if (statSync(file).size <= SHIM_MAX) head = readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }
  const m = /^\s*exec\s+(?:"([^"]+)"|(\S+))\s+exec\s/m.exec(head);
  const cmd = m?.[1] ?? m?.[2];
  const providers = [...head.matchAll(/^# asdf-plugin:[ \t]+(\S+)[ \t]+(\S+)/gm)].map((p) => ({ plugin: p[1], version: p[2] }));
  return { manager: "asdf", cmd: cmd && isAbsolute(cmd) && basename(cmd) === "asdf" ? cmd : null, providers };
}
function parseFlags(argv, spec) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const m = /^--?([A-Za-z][\w-]*)(?:=(.*))?$/.exec(arg);
    if (!m) throw new UsageError(`unexpected argument ${arg}`);
    const [, name = "", inline] = m;
    if (spec.bool?.includes(name) && inline === void 0) out[name] = true;
    else if (spec.opt?.includes(name)) {
      if (inline === "") throw new UsageError(`--${name}= needs a value (write --${name} bare, or --${name}=<value>)`);
      const next = argv[i + 1];
      if (inline === void 0 && next !== void 0 && !next.startsWith("-")) {
        throw new UsageError(`unexpected argument ${next}: --${name} takes its value after "=" (write --${name}=${next})`);
      }
      if (name in out) throw new UsageError(`--${name} given twice (write it once, with every id in one comma list)`);
      out[name] = inline ?? true;
    } else if (spec.value?.includes(name)) {
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
var import_semver = __toESM(require_semver2(), 1);
import { existsSync, readFileSync as readFileSync2 } from "node:fs";
import { basename as basename2, isAbsolute as isAbsolute2, join as join2, normalize, sep } from "node:path";
var import_yaml = __toESM(require_dist(), 1);

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

// src/lib/text.ts
var short = (xs, n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ` (+${xs.length - n} more)` : "");
function cut(s, n) {
  let out = "";
  let i = 0;
  for (const cp of s) {
    if (i++ === n) return `${out}\u2026`;
    out += cp;
  }
  return s;
}
var CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]/;
var ESCAPED = /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]|—(?=\s*fix:)|-(?=-\s*fix:)/g;
var NAMED = { "	": "\\t", "\n": "\\n", "\r": "\\r" };
function escapeCtl(s) {
  return s.replace(ESCAPED, (c) => NAMED[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function quote(s, n = 80) {
  return `"${cut(s, n).replace(/[\\"]/g, "\\$&")}"`;
}
var JSON_RAW = /[\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;
function jsonText(v) {
  return JSON.stringify(v).replace(JSON_RAW, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// src/lib/pins.ts
var PinError = class extends Error {
  constructor(m, fix) {
    super(m);
    this.fix = fix;
  }
};
var VER = /(\d+(?:\.\d+){0,2}(?:-(?:alpha|beta|rc|preview|pre|dev|next|nightly|canary|snapshot|ea)(?![a-z])(?:[.-]?\d[0-9a-z]*)*|\.?(?:alpha|beta|preview|pre|dev|rc|a|b|c)\d+(?:\.\d+)*)?)/i;
var ver = (s) => VER.exec(s)?.[1]?.replace(/[.-]+$/, "") ?? null;
var split = (v) => {
  const m = /^(\d+(?:\.\d+)*)-?(.*)$/.exec(v);
  return m ? [m[1].split(".").map(Number), m[2]] : [[NaN], v];
};
var preCmp = (p, q) => p === q ? 0 : !p ? 1 : !q ? -1 : Math.sign(p.localeCompare(q, "en", { numeric: true })) || (p < q ? -1 : 1);
var unsupported = (v, file, line) => new PinError(`unsupported form "${v}" in ${file}:${line}; pin an exact version`);
var lineAt = (text, index) => text.slice(0, Math.max(index, 0)).split("\n").length;
var exact = (s) => {
  const v = /^v?\d/i.test(s) ? ver(s) : null;
  return v !== null && s.replace(/^v/i, "").replace(/(?:\.[xX*])+$/, "") === v ? v : null;
};
var OP = /^(?:~>|===?|!=|<=|>=|~=|[<>=~^])/;
var isRange = (s) => {
  const toks = s.replace(/(~>|===?|!=|<=|>=|~=|[<>=~^])\s+(?=v?\d)/gi, "$1").split(/\s*(?:\|\||,)\s*|\s+-\s+|\s+/);
  return (toks.length > 1 || OP.test(s)) && toks.every((t) => exact(t.replace(OP, "")) !== null);
};
function semverRange(range, pep440) {
  if (!isRange(range) || /!=|===/.test(range)) return null;
  const toks = range.replace(/(~>|==|<=|>=|~=|[<>=~^])\s+(?=v?\d)/gi, "$1");
  if (toks.split(/\s*(?:\|\||,)\s*|\s+-\s+|\s+/).some((t) => /[a-z]/i.test(exact(t.replace(OP, "")) ?? ""))) return null;
  if (!pep440) return /~=|==|,/.test(toks) ? null : (0, import_semver.validRange)(toks);
  if (/\s-\s|~>/.test(toks)) return null;
  const one = (c) => {
    const [, op = "==", v] = /^(~=|==|<=|>=|[<>=^~])?(.*)$/.exec(c);
    const wild = /\.[xX*]$/.test(v);
    const n = exact(v).split(".").map(Number);
    const pad = [...n, 0, 0].slice(0, 3).join(".");
    if (op === "^" || op === "~") return c;
    if (op === "==") return wild ? `${n.join(".")}.x` : pad;
    if (op === "=" || wild) return null;
    if (op !== "~=") return `${op}${pad}`;
    if (n.length < 2) return null;
    const up = n.slice(0, -1);
    up[up.length - 1] += 1;
    return `>=${pad} <${[...up, 0, 0].slice(0, 3).join(".")}`;
  };
  const alts = toks.split(/\s*\|\|\s*/).map((a) => a.split(/\s*,\s*|\s+/).map(one));
  return alts.some((a) => a.includes(null)) ? null : (0, import_semver.validRange)(alts.map((a) => a.join(" ")).join(" || "));
}
var after = (v) => ["patch", "minor", "major"].map((p) => (0, import_semver.inc)(v, p)).find((x) => x !== null && (0, import_semver.valid)(x) !== null) ?? null;
var deciding = (pin, r) => {
  const n = pin.split(".").map(Number);
  const lo = [...n, 0, 0].slice(0, 3).join(".");
  const up = [...n];
  up[up.length - 1] += 1;
  const hi = [...up, 0, 0].slice(0, 3).join(".");
  const at = /* @__PURE__ */ new Set([lo]);
  for (const alt of new import_semver.Range(r).set)
    for (const c of alt) {
      if (!(c.semver instanceof import_semver.SemVer)) continue;
      const core = `${c.semver.major}.${c.semver.minor}.${c.semver.patch}`;
      for (const v of [core, after(core)]) if (v !== null && !(0, import_semver.lt)(v, lo) && (0, import_semver.lt)(v, hi)) at.add(v);
    }
  return [...at].map((v) => (0, import_semver.satisfies)(v, r));
};
function inRange(pin, range, pep440 = false) {
  const r = semverRange(range, pep440);
  if (r === null || !/^\d+(?:\.\d+){0,2}$/.test(pin)) return null;
  const set = pin.split(".").length < 3 ? `${pin}.x` : pin;
  if ((0, import_semver.validRange)(set) === null) return null;
  const ok = deciding(pin, r);
  return ok.every(Boolean) ? "inside" : ok.some(Boolean) ? "partly" : "outside";
}
var classify = (raw, tool) => {
  const s = tool === "node" ? raw.replace(/^=\s*(?=v?\d)/, "") : raw;
  const t = /^(~>?|\^)\s*v?(\d+(?:\.\d+)?)(?:\.[xX*])?$/.exec(s);
  if (t && !(t[1] === "^" && t[2].includes("."))) return { v: t[2] };
  if (isRange(s)) return { v: raw, range: true };
  const v = exact(s);
  return v === null ? null : { v };
};
var pinAt = (raw, tool, file, line) => {
  const f = classify(raw, tool);
  if (!f || f.range) throw unsupported(raw, file, line);
  return [{ v: f.v }];
};
var ALIAS = { node: ["node", "nodejs"], go: ["go", "golang"] };
var IMAGE = { go: "golang" };
var toolVersions = (text, tool, _root, file) => {
  const names2 = Object.hasOwn(ALIAS, tool) ? ALIAS[tool] : [tool];
  return text.split("\n").flatMap((line, i) => {
    const m = /^\s*(\S+)\s+(\S+)/.exec(line);
    return m && names2.includes(m[1]) ? pinAt(m[2], tool, file, i + 1) : [];
  });
};
var plain = (text, tool, _root, file) => {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  const i = lines.findIndex((l) => l);
  if (i < 0) throw new PinError(`no version in ${file}`);
  const f = classify(lines[i], tool);
  if (f?.range) throw new PinError(`"${lines[i]}" is a range, not a pinned version`);
  if (!f) throw unsupported(lines[i], file, i + 1);
  return [f];
};
var goMod = (text, tool, _root, file) => {
  const m = tool === "go" ? /^toolchain[ \t]+go([^\r\n]*)/m.exec(text) ?? /^go[ \t]+([^\r\n]*)/m.exec(text) : null;
  return m ? pinAt(m[1].replace(/\/\/.*/, "").trim(), tool, file, lineAt(text, m.index)) : [];
};
var pkg = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new PinError("not valid JSON");
  }
};
var engines = (text, tool) => {
  const e = pkg(text).engines?.[tool];
  if (e === void 0) return [];
  if (typeof e !== "string") throw new PinError(`engines.${tool} is not a string`);
  return [{ v: e.trim(), range: true }];
};
var pkgVersion = (text, tool, root, file) => {
  const p = pkg(text);
  const volta = p.volta && typeof p.volta === "object" && Object.hasOwn(p.volta, tool) ? p.volta[tool] : void 0;
  if (volta !== void 0 && typeof volta !== "string") throw new PinError(`volta.${tool} is not a string`);
  if (volta === void 0) {
    const out = engines(text, tool, root, file);
    if (!out.length) throw new PinError(`no volta.${tool} or engines.${tool}`);
    return out;
  }
  return pinAt(volta.trim(), tool, file, lineAt(text, text.indexOf(JSON.stringify(volta), text.indexOf('"volta"'))));
};
var toml = (text) => {
  try {
    return parse(text);
  } catch (e) {
    throw new PinError(`not valid TOML: ${e.message.split("\n")[0]}`);
  }
};
var table = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : void 0;
var pyproject = (text) => {
  const doc = toml(text);
  if ("project" in doc) {
    const rp2 = table(doc.project)?.["requires-python"];
    if (rp2 === void 0) throw new PinError("no project.requires-python");
    if (typeof rp2 !== "string") throw new PinError("requires-python is not a string");
    return [{ v: rp2.trim(), range: true, pep440: true }];
  }
  const py = table(table(table(doc.tool)?.poetry)?.dependencies)?.python;
  if (py === void 0) throw new PinError("no project.requires-python or tool.poetry.dependencies.python");
  if (typeof py !== "string") throw new PinError("tool.poetry.dependencies.python is not a string");
  return [{ v: py.trim(), range: true, pep440: true }];
};
var pipfile = (text, tool, _root, file) => {
  const req = table(toml(text).requires);
  const key = req && "python_full_version" in req ? "python_full_version" : "python_version";
  const v = req?.[key];
  if (v === void 0) throw new PinError("no requires.python_version");
  if (typeof v !== "string") throw new PinError(`requires.${key} is not a string`);
  const f = classify(v.trim(), tool);
  if (!f) throw unsupported(v.trim(), file, lineAt(text, text.search(new RegExp(`^[ \\t]*${key}[ \\t]*=`, "m"))));
  return [f.range ? { ...f, pep440: true } : f];
};
var imageTag = (t) => t.replace(/^(v?\d+(?:\.\d+)*)-dev(?![.-]?\d)/i, "$1");
var tagVer = (t) => {
  const raw = t.split("$")[0];
  const lit = imageTag(raw);
  const v = /^v?\d/i.test(lit) ? ver(lit) : null;
  return v !== null && (!t.includes("$") || /^[-_]/.test(lit.slice(lit.indexOf(v) + v.length)) && ver(imageTag(`${raw}1`)) === v) ? v : null;
};
var logicalLines = (text, file) => {
  const phys = text.replace(/^\uFEFF/, "").split("\n").map((l) => l.replace(/\r$/, ""));
  for (let i = 0; i < phys.length; i++) {
    const d = /^\s*#\s*([a-z]+)\s*=\s*(.*?)\s*$/i.exec(phys[i]);
    if (!d) break;
    if (d[1].toLowerCase() === "escape" && d[2] !== "\\") throw unsupported(`escape=${d[2]}`, file, i + 1);
  }
  const out = [];
  const close = (ins, i) => {
    if (!ins.text.trim()) return i;
    out.push(ins);
    if (!/^\s*(?:RUN|COPY|ADD)\s/i.test(ins.text)) return i;
    for (const w of ins.text.match(/(?:[^\s"'\\]|\\.?|"(?:[^"\\]|\\.)*"?|'[^']*'?)+/g) ?? []) {
      const h = /^\d*<<(-?)([^<]+)$/.exec(w);
      const name = h?.[2].replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'|\\(.)/g, (_q, dq, sq, esc) => dq?.replace(/\\(.)/g, "$1") ?? sq ?? esc ?? "");
      if (!h || !name) continue;
      const start = i;
      while (++i < phys.length && (h[1] ? phys[i].replace(/^\t+/, "") : phys[i]) !== name) ;
      if (i >= phys.length) throw new PinError(`unterminated heredoc <<${name} in ${file}:${start + 1}`);
    }
    return i;
  };
  let cur = null;
  let end = 0;
  for (let i = 0; i < phys.length; i++) {
    const line = phys[i];
    if (/^\s*#/.test(line) || cur && !line.trim()) continue;
    const cont = /\\[ \t]*$/.exec(line);
    const body = cont ? line.slice(0, cont.index) : line;
    cur ??= { text: "", lines: [] };
    cur.text += body;
    for (let k = 0; k < body.length; k++) cur.lines.push(i + 1);
    end = i;
    if (cont) continue;
    i = close(cur, i);
    cur = null;
  }
  if (cur) close(cur, end);
  return out;
};
var EXPAND_MAX = 4096;
var expand = (w, env, unset) => {
  let out = "";
  let q = "";
  for (let i = 0; i < w.length; i++) {
    if (out.length > EXPAND_MAX) return null;
    const c = w[i];
    if (q !== "'" && c === "\\") out += w[++i] ?? "";
    else if ((c === '"' || c === "'") && (!q || q === c)) q = q ? "" : c;
    else if (c !== "$" || q === "'") out += c;
    else if (w[i + 1] === "{") {
      let j = i + 2;
      for (let depth = 1; j < w.length && (depth += w[j] === "{" ? 1 : w[j] === "}" ? -1 : 0); j++) ;
      const m = /^([A-Za-z_]\w*)(?:(:?[-+])(.*))?$/s.exec(w.slice(i + 2, j));
      if (!m || j >= w.length) return null;
      const v = env.get(m[1]);
      const set = m[2]?.startsWith(":") ? !!v : v !== void 0;
      const r = !m[2] ? v ?? unset ?? null : m[2].endsWith("-") ? set ? v : expand(m[3], env, unset) : set ? expand(m[3], env, unset) : "";
      if (r === null) return null;
      out += r;
      i = j;
    } else {
      const name = /^[A-Za-z_]\w*/.exec(w.slice(i + 1))?.[0];
      if (!name) out += c;
      else if (!env.has(name) && unset === void 0) return null;
      else out += env.get(name) ?? unset, i += name.length;
    }
  }
  return out.length > EXPAND_MAX ? null : out;
};
var dockerfile = (text, tool, _root, file, _calls, notes, bare) => {
  const logical = logicalLines(text, file);
  const at = (l, index) => l.lines[Math.min(index, l.lines.length - 1)] ?? 1;
  const out = [];
  const key = `${tool.toUpperCase().replace(/\W/g, "_")}_VERSION`;
  const words = (s) => s.matchAll(/(?:[^\s"'\\]|\\.?|"(?:[^"\\]|\\.)*"?|'[^']*'?)+/gs);
  const HELD = "\0";
  const UNSET = "";
  const scope = (seed, unset) => {
    const env = new Map(seed);
    for (const l of logical) {
      if (/^\s*FROM\s/i.test(l.text)) break;
      const m = /^\s*ARG\s+(.*)$/is.exec(l.text);
      for (const p of m ? words(m[1]) : []) {
        const [, name, eq, val] = /^([A-Za-z_]\w*)(=?)(.*)$/s.exec(p[0]) ?? [];
        const v = name && eq ? expand(val, env, unset) : null;
        if (name && v !== null) env.set(name, v);
        else if (name && !(seed.length && name === key && !eq)) env.delete(name);
      }
    }
    return env;
  };
  const global = scope([]);
  const held = scope(global.has(key) ? [] : [[key, HELD]], UNSET);
  const skipped3 = [];
  const stages = /* @__PURE__ */ new Set();
  for (const l of logical) {
    const m = /^(\s*FROM\s+(?:--\S+\s+)*)(\S+)(?:\s+AS\s+(\S+))?/i.exec(l.text);
    if (!m) continue;
    let image = m[2];
    if (image.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, "$V").split("@")[0].split("/").pop().split(":")[0].includes("$")) {
      const r = expand(image, global);
      const h = r ? null : expand(image, held, UNSET);
      const [hn = "", ht = ""] = h?.split("@")[0].split("/").pop().split(":") ?? [];
      if (h && hn === (IMAGE[tool] ?? tool) && ht.startsWith(HELD)) {
        skipped3.push(`FROM ${image} (line ${at(l, m[1].length)})`);
        if (m[3]) stages.add(m[3].toLowerCase());
        continue;
      }
      if (!r) {
        notes?.push(`FROM ${image} (line ${at(l, m[1].length)}): image set at build time, not compared`);
        if (m[3]) stages.add(m[3].toLowerCase());
        continue;
      }
      image = r;
    }
    const [name = "", tag = ""] = image.split("@")[0].split("/").pop().split(":");
    const stageRef = image === name && stages.has(name.toLowerCase());
    if (m[3]) stages.add(m[3].toLowerCase());
    if (stageRef || name !== (IMAGE[tool] ?? tool)) continue;
    if (/^\$\{?(\w+)/.exec(tag)?.[1].toUpperCase() === key) {
      skipped3.push(`FROM ${image} (line ${at(l, m[1].length)})`);
      continue;
    }
    const v = tag ? tagVer(tag) : null;
    if (v === null) throw unsupported(image, file, at(l, m[1].length));
    out.push({ v });
  }
  for (const l of logical) {
    const m = /^(\s*ARG\s+)(.*)$/is.exec(l.text);
    if (!m) continue;
    for (const p of words(m[2])) {
      if (!/^(?:[^"'\\]|\\.|"(?:[^"\\]|\\.)*"|'[^']*')*$/s.test(p[0]) && new RegExp(`\\b${key}\\b`, "i").test(m[2]))
        throw unsupported(m[2].trim(), file, at(l, m[1].length));
      const pair = /^([A-Za-z_]\w*)=(.*)$/s.exec(p[0]);
      if (pair?.[1].toUpperCase() !== key) continue;
      const v = pair[2].replace(/^"([^"]*)"$|^'([^']*)'$/, "$1$2");
      out.push(...pinAt(v, tool, file, at(l, m[1].length + p.index + pair[1].length + 1)));
    }
  }
  if (!out.length) bare?.push(...skipped3);
  return out;
};
var BY_NAME = {
  "go.mod": goMod,
  "go.work": goMod,
  ".tool-versions": toolVersions,
  "package.json": pkgVersion,
  "pyproject.toml": pyproject,
  Pipfile: pipfile,
  ".nvmrc": plain,
  ".node-version": plain,
  ".python-version": plain,
  ".go-version": plain
};
var VERSION_FILES = Object.keys(BY_NAME);
var ACTIONS = {
  "setup-go": ["actions/setup-go", "go", "go-version"],
  "setup-node": ["actions/setup-node", "node", "node-version"],
  "setup-python": ["actions/setup-python", "python", "python-version"],
  "golangci-action": ["golangci/golangci-lint-action", "golangci-lint", "version"],
  "goreleaser-action": ["goreleaser/goreleaser-action", "goreleaser", "version"]
};
var refVer = (uses) => {
  const m = /@v(\d+)(?:\.(\d+))?/i.exec(uses);
  return m ? [Number(m[1]), m[2] === void 0 ? Infinity : Number(m[2])] : null;
};
var DEFAULTS = {
  // actions/setup-go v7.0.0 src/main.ts: no version installs nothing, and GOTOOLCHAIN=local keeps go.mod's toolchain out.
  "setup-go": () => null,
  // actions/setup-node v7.1.0 src/main.ts resolveVersionInput: no default version file.
  "setup-node": () => null,
  // actions/setup-python v7.1.0 src/setup-python.ts resolveVersionInputFromDefaultFile (added in v4.7.0): .python-version
  // at the workspace root.
  "setup-python": (root, tool, ref) => ref && (ref[0] < 4 || ref[0] === 4 && ref[1] < 7) || !existsSync(join2(root, ".python-version")) ? null : plain(readFileSync2(join2(root, ".python-version"), "utf8"), tool, root, ".python-version"),
  // golangci/golangci-lint-action v9.3.0 src/version.ts getRequestedVersion: the module's version in
  // <working-directory>/go.mod (`golangci-lint/v2` from v7.0.0, `golangci-lint` in v6.5.0), else latest. Before v6.5.0, and
  // in every install-mode but `binary` (goinstall installs latest, none installs nothing), go.mod is never read.
  "golangci-action": (root, tool, ref, wd, mode) => {
    if (ref && (ref[0] < 6 || ref[0] === 6 && ref[1] < 5) || mode !== "binary") return null;
    const mod = wd === null ? null : normalize(join2(wd, "go.mod"));
    if (mod === null || isAbsolute2(mod) || mod.startsWith(`..${sep}`) || !existsSync(join2(root, mod))) return null;
    const text = readFileSync2(join2(root, mod), "utf8");
    const m = (ref && ref[0] <= 6 ? /github.com\/golangci\/golangci-lint\s(v\S+)/ : /github.com\/golangci\/golangci-lint\/v2\s(v\S+)/).exec(text);
    return m ? pinAt(m[1], tool, mod, lineAt(text, m.index)) : null;
  },
  // goreleaser/goreleaser-action v7.3.0 src/context.ts (and v6.0.0 action.yml): `~> v2`, a range; v5.0.0 and earlier: latest.
  "goreleaser-action": (_root, _tool, ref) => ref && ref[0] <= 5 ? null : [{ v: "~> v2", range: true }]
};
function setup(kind) {
  const [action, forTool, key] = ACTIONS[kind];
  const named2 = new RegExp(`^${action}@`, "i");
  return (text, tool, root, file, calls) => {
    if (tool !== forTool) return [];
    const lc = new import_yaml.LineCounter();
    const doc = (0, import_yaml.parseDocument)(text, { lineCounter: lc });
    if (doc.errors.length) throw new PinError(`not valid YAML: ${doc.errors[0].message.split("\n")[0]}`);
    const line = (n) => `line ${lc.linePos(n.range?.[0] ?? 0).line}`;
    const deref = (n) => {
      if (!(0, import_yaml.isAlias)(n)) return n;
      const r = n.resolve(doc);
      if (!r) throw new PinError(`alias *${n.source} at ${line(n)} has no anchor`);
      return r;
    };
    const keyOf = (n) => {
      const k = deref(n);
      return (0, import_yaml.isScalar)(k) ? String(k.value) : null;
    };
    const uses = (n) => {
      const v = deref(n);
      return (0, import_yaml.isScalar)(v) && typeof v.value === "string" && named2.test(v.value.trim());
    };
    const scalar = (k, n) => {
      const v = deref(n);
      if (!(0, import_yaml.isScalar)(v)) throw new PinError(`${k} "${text.slice(v.range[0], v.range[1]).trim()}" is not a literal version at ${line(v)}`);
      if (v.value === null) return "";
      const s = String(v.value);
      if (typeof v.value === "number" && v.source !== s) throw new PinError(`${k}: unquoted ${v.source} reads as ${s}; quote it`);
      if (s.includes("${{")) throw new PinError(`${k} "${s.trim()}" is not a literal version`);
      return s.trim();
    };
    const read = (step) => {
      const w = deref(step.get("with", true));
      const ins = [];
      let wd = ".";
      let mode = "binary";
      if (w !== void 0 && !((0, import_yaml.isScalar)(w) && w.value === null)) {
        if (!(0, import_yaml.isMap)(w)) throw new PinError(`with: of ${action} at ${line(w)} is not a mapping`);
        for (const p of w.items) {
          const k = keyOf(p.key)?.toLowerCase();
          if (k === "<<") throw new PinError(`with: of ${action} at ${line(w)} uses a merge key, which Actions does not read`);
          if (k === key || k === `${key}-file`) ins.push([k, scalar(k, p.value), lc.linePos(deref(p.value)?.range?.[0] ?? 0).line]);
          if (k === "working-directory") {
            const v = deref(p.value);
            wd = (0, import_yaml.isScalar)(v) && typeof v.value === "string" && !v.value.includes("${{") ? v.value.trim() || "." : null;
          }
          if (k === "install-mode") {
            const v = deref(p.value);
            mode = (0, import_yaml.isScalar)(v) && (v.value === null || typeof v.value === "string") ? (v.value ?? "").trim().toLowerCase() || "binary" : null;
          }
        }
      }
      if (!ins.length) {
        const u = deref(step.get("uses", true));
        const found = DEFAULTS[kind](root, tool, refVer(u.value), wd, mode);
        if (!found) throw new PinError(`${action.split("/")[1]} step without a version in ${file}:${lc.linePos(u.range[0]).line}`);
        return found;
      }
      if (!ins.some(([, v]) => v)) throw new PinError(`${ins[0][0]} has no value`);
      const used = ins.some(([k, v]) => k === key && v) ? ins.filter(([k]) => k === key) : ins;
      const out2 = [];
      for (const [k, val, at] of used) {
        if (!val) continue;
        if (k === key) {
          for (const l of val.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
            const f = classify(l, tool);
            if (!f) throw unsupported(l, file, at);
            out2.push(f);
          }
        } else if (!existsSync(join2(root, val))) throw new PinError(`${key}-file ${val} not found`);
        else if (!Object.hasOwn(BY_NAME, basename2(val)))
          throw new PinError(`unsupported form: ${k} ${val} in ${file}:${at} is not a supported version file (${VERSION_FILES.join(", ")}); pin an exact version`);
        else {
          const found = BY_NAME[basename2(val)](readFileSync2(join2(root, val), "utf8"), tool, root, normalize(val));
          if (!found.length) throw new PinError(`${key}-file ${val} has no ${tool} version`);
          out2.push(...found);
        }
      }
      return out2;
    };
    const lists = [];
    const top = deref(doc.contents);
    if ((0, import_yaml.isMap)(top)) {
      const jobs = deref(top.get("jobs", true));
      if ((0, import_yaml.isMap)(jobs)) for (const p of jobs.items) {
        const job = deref(p.value);
        if (!(0, import_yaml.isMap)(job)) continue;
        lists.push(job.get("steps", true));
        const ref = job.get("uses", true);
        const v = deref(ref);
        if (ref && (0, import_yaml.isScalar)(v) && typeof v.value === "string")
          calls?.push(`job ${keyOf(p.key) ?? "?"} calls reusable workflow ${v.value.trim()} (${line(ref)})`);
      }
      const runs2 = deref(top.get("runs", true));
      if ((0, import_yaml.isMap)(runs2)) lists.push(runs2.get("steps", true));
    }
    const steps = /* @__PURE__ */ new Set();
    const out = [];
    for (const list2 of lists.map(deref)) {
      if (!(0, import_yaml.isSeq)(list2)) continue;
      for (const s of list2.items.map(deref)) {
        if (!(0, import_yaml.isMap)(s) || steps.has(s) || !uses(s.get("uses", true))) continue;
        steps.add(s);
        out.push(...read(s));
      }
    }
    (0, import_yaml.visit)(doc, {
      Pair(_, p, path) {
        if (keyOf(p.key) === "uses" && uses(p.value) && !steps.has(path.at(-1))) throw new PinError(`the ${action} step at ${line(p.value)} cannot be read`);
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
  "setup-go": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-go"), action: ACTIONS["setup-go"][0] },
  "setup-node": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-node"), action: ACTIONS["setup-node"][0] },
  "setup-python": { file: ".github/workflows/*.{yml,yaml}", parse: setup("setup-python"), action: ACTIONS["setup-python"][0] },
  "golangci-action": { file: ".github/workflows/*.{yml,yaml}", parse: setup("golangci-action"), action: ACTIONS["golangci-action"][0] },
  "goreleaser-action": { file: ".github/workflows/*.{yml,yaml}", parse: setup("goreleaser-action"), action: ACTIONS["goreleaser-action"][0] }
};
var SOURCE_KINDS = Object.fromEntries(Object.entries(KINDS).map(([k, { file }]) => [k, file]));
var splitSource = (spec) => {
  const i = spec.indexOf(":");
  return i < 0 ? [spec, void 0] : [spec.slice(0, i), spec.slice(i + 1)];
};
var isSourceKind = (spec) => Object.hasOwn(KINDS, splitSource(spec)[0]);
function sourceFiles(tracked, spec) {
  const [kind, path] = splitSource(spec);
  const target = path ?? KINDS[kind].file;
  const res2 = isGlob(target) ? compileGlob(target) : null;
  return { target, files: res2 ? tracked.filter((f) => res2.some((re) => re.test(f))) : [target] };
}
function sourceAbsent(root, tracked, spec) {
  const { target, files } = sourceFiles(tracked, spec);
  return !files.length || !isGlob(target) && !existsSync(join2(root, target));
}
function readSource(root, tracked, tool, spec, notes) {
  const [kind] = splitSource(spec);
  const k = KINDS[kind];
  const { target, files } = sourceFiles(tracked, spec);
  if (!files.length) throw new PinError(`${spec}: no file matches ${target}`);
  const out = [];
  const skipped3 = [];
  const unknown = [];
  const bare = [];
  for (const f of files) {
    if (!existsSync(join2(root, f))) throw new PinError(`${spec}: ${f} not found`);
    const calls = [];
    const said = [];
    let found;
    try {
      found = k.parse(readFileSync2(join2(root, f), "utf8"), tool, root, f, calls, said, bare);
    } catch (e) {
      throw new PinError(`${spec}: ${f}: ${e.message}`);
    }
    for (const x of found) out.push({ src: `${kind}:${f}`, v: x.v, range: x.range ?? false, ...x.pep440 && { pep440: true } });
    unknown.push(...said.map((n) => `${kind}:${f}: ${n}`));
    if (!found.length && calls.length) skipped3.push([f, `${short(calls, 3)}, ${calls.length === 1 ? "whose" : "their"} with: inputs are not read`]);
  }
  if (!out.length && (!unknown.length || bare.length)) {
    const msg = `${spec}: no ${tool} version found in ${files.length === 1 ? files[0] : `${files.length} files (${short(files)})`}`;
    if (!skipped3.length) throw new PinError(msg);
    throw new PinError(
      `${msg}; ${skipped3.map(([f, s]) => files.length === 1 ? s : `${f}: ${s}`).join("; ")}`,
      `pin the version in a step that uses ${k.action} in a workflow of this repo, or remove the ${kind} source from .loops/env-check.toml (reusable-workflow inputs are not read)`
    );
  }
  notes?.push(...skipped3.map(([f, s]) => `${kind}:${f}: ${s}`), ...unknown);
  return out;
}
var DEPTH = { exact: 3, minor: 2, major: 1 };
function cmp(a, b, depth = 3) {
  const [x, p] = split(a);
  const [y, q] = split(b);
  for (let i = 0; i < Math.min(depth, x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return p && depth >= x.length || q && depth >= y.length ? preCmp(p, q) : 0;
}
var parts = (v) => split(v)[0].length;
var pinsOf = (vals) => vals.filter((x) => !x.range);
var pinOf = (vals, _mode) => pinsOf(vals).reduce((a, b) => parts(b.v) > parts(a.v) ? b : a).v;
function disagreement(vals, mode) {
  const pins = pinsOf(vals);
  const bad = pins.some((x, i) => pins.slice(i + 1).some((y) => cmp(x.v, y.v, DEPTH[mode]) !== 0));
  return bad ? pins.map((x) => `${x.src}=${x.v}`).join(", ") + ` disagree (${mode})` : null;
}
function diffPart(a, b) {
  const [x] = split(a);
  const [y] = split(b);
  if (x[0] !== y[0]) return "major";
  return x.length > 1 && y.length > 1 && x[1] !== y[1] ? "minor" : "patch";
}
var localOk = (local, pin, mode) => cmp(local, pin, DEPTH[mode]) === 0;

// src/lib/version.ts
var VERSION = "0.8.0";

// src/lib/env-config.ts
function table2(v, where, allowed) {
  if (v === null || typeof v !== "object" || Array.isArray(v) || v instanceof Date) throw new UsageError(`${where} must be a table`);
  for (const k of Object.keys(v)) if (!allowed.includes(k)) throw new UsageError(`${where}: unknown key "${k}" (a key from a newer loops needs a newer engine: update agentic-tools, and set engine = ">=0.8.0" or the version that added it, so an older engine says so)`);
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
var RESERVED_IDS = ["x.none", "x.required"];
var RESERVED_ROWS = { "x.none": '"no check ran"', "x.required": '"required check missing"' };
var isReserved = (id) => RESERVED_IDS.includes(id);
var isStr = (v) => typeof v === "string" && v !== "";
var isBool = (v) => typeof v === "boolean";
var isStrs = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x !== "");
var isNonEmptyStrs = (v) => isStrs(v) && v.length > 0;
var isProjectName = (v) => typeof v === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(v);
var oneOf = (...opts) => (v) => typeof v === "string" && opts.includes(v);
var list = (v, where) => {
  if (!Array.isArray(v)) throw new UsageError(`${where} must be an array of tables`);
  return v;
};
function localOf(v, where) {
  const all = (s) => ({ major: s, minor: s, patch: s });
  const what = "fail|warn|off or a { major, minor, patch } table";
  if (v === void 0 || typeof v === "string") return all(pick({ local: v }, "local", where, oneOf("fail", "warn", "off"), what, "warn"));
  if (v === null || typeof v !== "object" || Array.isArray(v) || v instanceof Date) throw new UsageError(`${where}: local must be ${what}`);
  const t = table2(v, `${where}: local`, ["major", "minor", "patch"]);
  const part = (k) => {
    const s = t[k] ?? "warn";
    if (!oneOf("fail", "warn", "info", "off")(s)) throw new UsageError(`${where}: local.${k} must be fail|warn|info|off`);
    return s;
  };
  return { major: part("major"), minor: part("minor"), patch: part("patch") };
}
function checkEngine(range) {
  const m = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) throw new UsageError(`engine must look like ">=0.4.0", found "${range}"`);
  const want = m.slice(1).map(Number);
  const have = VERSION.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) {
      if (have[i] < want[i]) throw new UsageError(`config needs loops ${range}, this is ${VERSION}; update agentic-tools (stable checkout: git pull; CI: bump the action's pinned SHA)`);
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
  const top = table2(raw, file, ["schema_version", "engine", "shared_checkout", "pins", "harness", "compose", "local"]);
  if (top.schema_version !== 1) {
    const what = top.schema_version === void 0 ? "is missing" : `${String(top.schema_version)} is unsupported by loops ${VERSION}`;
    throw new UsageError(`${file}: schema_version ${what} (want 1)`);
  }
  if (top.engine !== void 0) checkEngine(pick(top, "engine", "engine", isStr, "a string"));
  const shared = top.shared_checkout === void 0 ? null : table2(top.shared_checkout, "[shared_checkout]", ["hint"]);
  const sharedHint = shared && pick(shared, "hint", "[shared_checkout]", isStr, "a string", "use a git worktree");
  const pins = list(top.pins ?? [], "[[pins]]").map((p, i) => {
    const where = `[[pins]] #${i + 1}`;
    const t = table2(p, where, ["tool", "sources", "optional", "compare", "local", "range"]);
    const sources = pick(t, "sources", where, isStrs, "a list of strings");
    for (const s of sources) if (!isSourceKind(s)) throw new UsageError(`${where}: unknown source kind in "${s}"`);
    if (!sources.length) throw new UsageError(`${where}: sources is empty`);
    const optional = pick(t, "optional", where, isStrs, "a list of strings", []);
    for (const s of optional) if (!sources.includes(s)) throw new UsageError(`${where}: optional "${s}" is not in sources (list a source exactly as written there)`);
    if (t.compare === "floor")
      throw new UsageError(`${where}: compare = floor was removed in loops 0.6.0: compare no longer reads ranges; use exact, minor or major, and set range = "check" (0.8.0) to check the pin against each range`);
    return {
      tool: pick(t, "tool", where, isStr, "a string"),
      sources,
      optional,
      compare: pick(t, "compare", where, oneOf("exact", "minor", "major"), "exact|minor|major", "exact"),
      local: localOf(t.local, where),
      range: pick(t, "range", where, oneOf("check", "info"), "check|info", "info")
    };
  });
  const h = table2(top.harness ?? {}, "[harness]", ["tools", "files", "entrypoints", "tracked", "sparse", "node_modules"]);
  const isEntry = (v) => v === "auto" || isStrs(v);
  const harness = {
    tools: pick(h, "tools", "[harness]", isStrs, "a list of strings", []),
    files: pick(h, "files", "[harness]", isStrs, "a list of strings", []),
    entrypoints: pick(h, "entrypoints", "[harness]", isEntry, '"auto" or a list of paths', []),
    tracked: pick(h, "tracked", "[harness]", isBool, "a boolean", false),
    sparse: pick(h, "sparse", "[harness]", oneOf("warn", "off"), "warn|off", "off") === "warn",
    // 0.8.0: d.node_modules, full mode only.
    nodeModules: pick(h, "node_modules", "[harness]", oneOf("fail", "warn", "off"), "fail|warn|off", "off")
  };
  const c = table2(top.compose ?? {}, "[compose]", ["mode", "files", "inputs", "containers", "derive", "allow_container_name", "main_project", "main_files"]);
  const compose = top.compose === void 0 ? null : {
    mode: pick(c, "mode", "[compose]", oneOf("none", "test"), "none|test", "none"),
    files: pick(c, "files", "[compose]", isStrs, "a list of strings", []),
    inputs: pick(c, "inputs", "[compose]", isStrs, "a list of globs", []),
    containers: pick(c, "containers", "[compose]", oneOf("fail", "warn"), "fail|warn", "fail"),
    derive: pick(c, "derive", "[compose]", oneOf("slug-hash", "dirname"), "slug-hash|dirname", "dirname"),
    allowContainerName: pick(c, "allow_container_name", "[compose]", isStrs, "a list of strings", []),
    // The `-p` name the repo's wrappers give the main checkout (0.8.0): Compose's project-name form, as -p takes it.
    mainProject: c.main_project === void 0 ? null : pick(c, "main_project", "[compose]", isProjectName, "a Compose project name (lowercase letters, digits, - and _, starting with a letter or digit)"),
    // The main checkout's file set (0.8.0); null: the main checkout uses files.
    mainFiles: c.main_files === void 0 ? null : pick(c, "main_files", "[compose]", isNonEmptyStrs, "a non-empty list of strings")
  };
  if (compose?.mode === "test" && !compose.files.length) throw new UsageError("[compose]: mode test needs files");
  const seen = /* @__PURE__ */ new Set();
  const locals = list(top.local ?? [], "[[local]]").map((l, i) => {
    const where = `[[local]] #${i + 1}`;
    const t = table2(l, where, ["id", "run", "static", "timeout_s", "needs"]);
    const id = pick(t, "id", where, isStr, "a string");
    if (!/^[a-ex]\.[\w.-]+$/.test(id)) throw new UsageError(`${where}: id "${id}" must look like <a-e or x>.<name>`);
    if (isReserved(id)) throw new UsageError(`${where}: id ${id} is reserved for env-check's own ${RESERVED_ROWS[id]} row`);
    if (seen.has(id)) throw new UsageError(`${where}: duplicate id ${id}`);
    seen.add(id);
    const timeoutS = pick(t, "timeout_s", where, (v) => typeof v === "number" && v >= 1e-3 && Number.isSafeInteger(Math.round(v * 1e3)), "a positive number of seconds (at least 0.001)", 15);
    const timeoutMs = Math.round(timeoutS * 1e3);
    const run2 = pick(t, "run", where, isStr, "a path");
    if (isAbsolute3(run2) || /^\.\.(\/|$)/.test(normalize2(run2))) throw new UsageError(`${where}: run "${run2}" must be a repo-relative path`);
    const needs = pick(t, "needs", where, (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && /^[A-Za-z0-9_][\w.+-]*$/.test(x)), "a list of command names (no paths)", []);
    return { id, run: run2, static: pick(t, "static", where, isBool, "a boolean", false), needs, timeoutS, timeoutMs };
  });
  return { sharedHint, pins, harness, compose, locals };
}

// src/lib/env-checks.ts
var import_yaml2 = __toESM(require_dist(), 1);
import { createHash } from "node:crypto";
import { existsSync as existsSync3, readFileSync as readFileSync5, realpathSync as realpathSync2, statSync as statSync3 } from "node:fs";
import { basename as basename3, delimiter as delimiter2, dirname as dirname3, isAbsolute as isAbsolute4, join as join5, normalize as normalize4, resolve as resolve2 } from "node:path";

// src/lib/compose-config.ts
var REMOTE_OFF = { COMPOSE_EXPERIMENTAL_GIT_REMOTE: "0", COMPOSE_EXPERIMENTAL_OCI_REMOTE: "0", GIT_ALLOW_PROTOCOL: "file" };
var isSwitch = (k) => Object.hasOwn(REMOTE_OFF, k);
var COMPOSE_CONFIG_TIMEOUT_MS = 1e4;
var TOO_OLD = /^(?:docker: )?unknown flag:? --no-env-resolution\b/m;
var WARNING_LINES = [/^time=.* level=warning/, /^WARNING: /];
var NO_PLUGIN = /^(?:docker: )?(?:unknown flag:? --short\b|'compose' is not a docker command|unknown command: docker compose)/m;
var NO_FILE = "no configuration file provided: not found";
var REQUIRED = /^(?:error while interpolating [^\n]*?: )?required variable (\w+) is missing a value/;
function rerun(e) {
  const unset = (e.scrubbed ?? []).map((n) => `-u ${shQuote(n)}`);
  const off = Object.entries(REMOTE_OFF).map(([k, v]) => `${k}=${v}`);
  return `cd ${shQuote(e.cwd)} && env ${[...unset, ...off].join(" ")} ${e.cmd}`;
}
var seconds = `${COMPOSE_CONFIG_TIMEOUT_MS / 1e3}s`;
var abended = (r) => r.abend?.startsWith("SIG") || r.abend === "ENOBUFS" ? `was killed (${r.abend})` : `could not run (${r.abend ?? "no exit code"})`;
function composeVersion(run2, cwd, env) {
  const r = run2("docker", ["compose", "version", "--short"], { cwd, env, timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS });
  if (r.timedOut) return { error: `docker compose version timed out after ${seconds}` };
  if (r.notFound) return { unavailable: "docker is not installed" };
  if (r.code === null) return { error: `docker compose version ${abended(r)}` };
  if (r.code !== 0) {
    const why = r.stderr.split("\n").filter((l) => !WARNING_LINES.some((w) => w.test(l))).join("\n");
    return NO_PLUGIN.test(why) ? { unavailable: `docker compose version exited ${r.code}` } : { error: `docker compose version exited ${r.code}` };
  }
  return { version: r.stdout.trim() };
}
function probe(o, flags) {
  const scrubbed = o.scrub ? Object.keys(o.env).filter((k) => k.startsWith("COMPOSE_") && !isSwitch(k)).sort() : [];
  const kept = o.scrub ? Object.fromEntries(Object.entries(o.env).filter(([k]) => !k.startsWith("COMPOSE_"))) : o.env;
  const env = { ...kept, ...REMOTE_OFF };
  const fileArgs = (o.files ?? []).flatMap((f) => ["-f", f]);
  const args = ["compose", ...fileArgs, "config", ...flags, "--format", "json"];
  const r = o.run("docker", args, { cwd: o.root, env, timeoutMs: COMPOSE_CONFIG_TIMEOUT_MS });
  const fail = (kind, how, variable) => ({
    error: `docker compose config ${how}`,
    kind,
    cmd: ["docker", "compose", ...fileArgs, "config", "--no-env-resolution", "-q"].map(shQuote).join(" "),
    cwd: o.root,
    ...scrubbed.length ? { scrubbed } : {},
    ...variable ? { variable } : {}
  });
  if (r.timedOut) return fail("timeout", `timed out after ${seconds}`);
  if (r.notFound) return fail("gone", "could not start (its directory is gone)");
  if (r.code === null) return fail("abend", abended(r));
  if (r.code !== 0) {
    if (TOO_OLD.test(r.stderr)) return fail("tooOld", "is too old (needs --no-env-resolution)");
    const rest = r.stderr.split("\n").filter((l) => !WARNING_LINES.some((w) => w.test(l))).join("\n").trim();
    if (rest === NO_FILE) return { noFile: true };
    const v = REQUIRED.exec(rest.split("\n")[0])?.[1];
    return v ? fail("interp", `exited ${r.code}: required variable ${v} is missing a value`, v) : fail("exit", `exited ${r.code}`);
  }
  try {
    return { model: JSON.parse(r.stdout), fail };
  } catch {
    return fail("json", "printed invalid JSON");
  }
}
var nameOf = (model) => model?.name;
function composeName(o) {
  const p = probe(o, ["--no-env-resolution"]);
  if (!("model" in p)) return p;
  const name = nameOf(p.model);
  if (typeof name !== "string" || name === "") return p.fail("noName", "printed no project name");
  return { name };
}
function composeNameRaw(o) {
  const p = probe(o, ["--no-env-resolution", "--no-interpolate", ...o.normalize ? [] : ["--no-normalize"]]);
  if ("noFile" in p) return { error: "docker compose config found no compose file", kind: "exit", cmd: "", cwd: o.root };
  if (!("model" in p)) return p;
  const name = nameOf(p.model);
  return { raw: typeof name === "string" && name !== "" ? name : null };
}

// src/lib/compose-env.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join3 } from "node:path";
var NAME2 = /[A-Za-z_][A-Za-z0-9_]*/y;
var KEY = /(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.]*)[ \t]*([=:]?)[ \t]*/y;
function resolveTemplate(t, vars) {
  let out = "";
  for (let i = 0; i < t.length; ) {
    const ch = t[i];
    if (ch !== "$") {
      out += ch;
      i++;
      continue;
    }
    const next = t[i + 1];
    if (next === "$") {
      out += "$";
      i += 2;
      continue;
    }
    if (next !== "{") {
      NAME2.lastIndex = i + 1;
      const m2 = NAME2.exec(t);
      if (!m2) return null;
      const v2 = vars.get(m2[0]);
      if (v2 === void 0 || v2 === null) return null;
      out += v2;
      i = NAME2.lastIndex;
      continue;
    }
    NAME2.lastIndex = i + 2;
    const m = NAME2.exec(t);
    if (!m) return null;
    let j = NAME2.lastIndex;
    const op = /^(:-|-|:\?|\?|:\+|\+)?/.exec(t.slice(j))[0];
    j += op.length;
    let depth = 0;
    let end = -1;
    for (let k = j; k < t.length; k++) {
      if (t[k] === "$" && t[k + 1] === "$") k++;
      else if (t[k] === "$" && t[k + 1] === "{") {
        depth++;
        k++;
      } else if (t[k] === "}") {
        if (depth === 0) {
          end = k;
          break;
        }
        depth--;
      }
    }
    if (end < 0 || !op && end !== j) return null;
    const arg = t.slice(j, end);
    const v = vars.get(m[0]);
    if (v === null) return null;
    const set = v !== void 0;
    const full = set && v !== "";
    let got;
    if (op === ":-") got = full ? v : resolveTemplate(arg, vars);
    else if (op === "-") got = set ? v : resolveTemplate(arg, vars);
    else if (op === ":?") got = full ? v : null;
    else if (op === "?") got = set ? v : null;
    else if (op === ":+") got = full ? resolveTemplate(arg, vars) : "";
    else if (op === "+") got = set ? resolveTemplate(arg, vars) : "";
    else got = set ? v : null;
    if (got === null) return null;
    out += got;
    i = end + 1;
  }
  return out;
}
var eol = (s, i) => {
  const n = s.indexOf("\n", i);
  return n < 0 ? s.length : n;
};
function parseDotEnv(s) {
  const vars = /* @__PURE__ */ new Map();
  for (let i = 0; i < s.length; ) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === "#") {
      i = eol(s, i);
      continue;
    }
    KEY.lastIndex = i;
    const m = KEY.exec(s);
    if (!m) {
      i = eol(s, i);
      continue;
    }
    const key = m[1];
    i = KEY.lastIndex;
    if (!m[2]) {
      vars.set(key, null);
      i = eol(s, i);
      continue;
    }
    const q = s[i];
    if (q === "'" || q === '"') {
      let k = i + 1;
      while (k < s.length && s[k] !== q) k += s[k] === "\\" && (q === '"' || s[k + 1] === "'") ? 2 : 1;
      if (k >= s.length) {
        vars.set(key, null);
        break;
      }
      const inner = s.slice(i + 1, k);
      i = eol(s, k + 1);
      if (q === "'") vars.set(key, inner.replace(/\\'/g, "'"));
      else if (inner.includes("\\$")) vars.set(key, null);
      else {
        const un = inner.replace(/\\(.)/g, (_, c) => ({ n: "\n", r: "\r", t: "	" })[c] ?? c);
        vars.set(key, un.includes("$") ? resolveTemplate(un, vars) : un);
      }
      continue;
    }
    const end = eol(s, i);
    let v = s.slice(i, end);
    const hash = v.search(/\s#/);
    if (hash >= 0) v = v.slice(0, hash);
    v = v.trim();
    i = end;
    vars.set(key, v.includes("$") ? resolveTemplate(v, vars) : v);
  }
  return vars;
}
function readDotEnv(pdir) {
  try {
    return parseDotEnv(readFileSync3(join3(pdir, ".env"), "utf8"));
  } catch {
    return /* @__PURE__ */ new Map();
  }
}

// src/lib/node-modules.ts
import { existsSync as existsSync2, readFileSync as readFileSync4, statSync as statSync2 } from "node:fs";
import { dirname as dirname2, join as join4, normalize as normalize3 } from "node:path";
function detectLibc(os, ldd, report) {
  if (os !== "linux") return null;
  const text = ldd();
  if (text !== null) return text.includes("musl") ? "musl" : text.includes("GNU C Library") ? "glibc" : null;
  const r = report();
  if (r?.header?.glibcVersionRuntime) return "glibc";
  const libs = Array.isArray(r?.sharedObjects) ? r.sharedObjects : [];
  return libs.some((f) => typeof f === "string" && (f.includes("libc.musl-") || f.includes("ld-musl-"))) ? "musl" : null;
}
function hostPlatform() {
  const ldd = () => {
    try {
      return readFileSync4("/usr/bin/ldd", "utf8");
    } catch {
      return null;
    }
  };
  const report = () => {
    const rep = process.report;
    if (!rep) return null;
    const saved = rep.excludeNetwork;
    rep.excludeNetwork = true;
    try {
      return rep.getReport();
    } finally {
      rep.excludeNetwork = saved;
    }
  };
  return { os: process.platform, cpu: process.arch, libc: detectLibc(process.platform, ldd, report) };
}
function listOk(value, raw) {
  const list2 = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  if (!list2.length || list2.length === 1 && list2[0] === "any") return true;
  let negated = 0;
  let match = false;
  for (const e of list2) {
    if (e.startsWith("!")) {
      negated++;
      if (e.slice(1) === value) return false;
    } else if (e === value) match = true;
  }
  return match || negated === list2.length;
}
function eligible(p, pf) {
  if (p.os !== void 0 && !listOk(pf.os, p.os)) return false;
  if (p.cpu !== void 0 && !listOk(pf.cpu, p.cpu)) return false;
  if (p.libc !== void 0 && (pf.os !== "linux" || pf.libc === null || !listOk(pf.libc, p.libc))) return false;
  return true;
}
function resolveDep(packages, key, name) {
  for (let at = key; at !== null; ) {
    const k = at === "" ? `node_modules/${name}` : `${at}/node_modules/${name}`;
    if (Object.hasOwn(packages, k)) return k;
    if (at === "") at = null;
    else {
      const i = at.lastIndexOf("node_modules/");
      at = i <= 0 ? "" : at.slice(0, i - 1);
    }
  }
  return null;
}
var names = (deps) => deps && typeof deps === "object" && !Array.isArray(deps) ? Object.keys(deps) : [];
function skipped(packages, pf) {
  const out = /* @__PURE__ */ new Set();
  const users = /* @__PURE__ */ new Map();
  for (const [k, p] of Object.entries(packages)) {
    if (!p || typeof p !== "object") continue;
    if (rootTree(k) && !eligible(p, pf)) out.add(k);
    const deps = [...names(p.dependencies), ...names(p.optionalDependencies), ...k === "" ? names(p.devDependencies) : []];
    for (const name of deps) {
      const to = resolveDep(packages, k, name);
      if (to !== null) users.set(to, (users.get(to) ?? /* @__PURE__ */ new Set()).add(k));
    }
  }
  for (let grew = true; grew; ) {
    grew = false;
    for (const [k, p] of Object.entries(packages)) {
      if (out.has(k) || !rootTree(k) || !p || !(p.optional || p.devOptional)) continue;
      const by = users.get(k);
      if (by?.size && [...by].every((u) => out.has(u))) {
        out.add(k);
        grew = true;
      }
    }
  }
  return out;
}
var MAX_BRACES = 1024;
function braces(glob) {
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "\\") {
      i++;
      continue;
    }
    if (glob[i] !== "{") continue;
    const parts2 = [];
    let depth = 0;
    let from = i + 1;
    let close = -1;
    for (let j = i; j < glob.length && close < 0; j++) {
      const c = glob[j];
      if (c === "\\") j++;
      else if (c === "{") depth++;
      else if (c === "," && depth === 1) {
        parts2.push(glob.slice(from, j));
        from = j + 1;
      } else if (c === "}" && --depth === 0) {
        parts2.push(glob.slice(from, j));
        close = j;
      }
    }
    if (close < 0) return [glob];
    let alts = parts2;
    if (parts2.length === 1) {
      const m = /^(-?\d+)\.\.(-?\d+)$/.exec(parts2[0]);
      if (!m) {
        i = close;
        continue;
      }
      const [a, b] = [Number(m[1]), Number(m[2])];
      if (Math.abs(b - a) >= MAX_BRACES) return [glob];
      alts = [];
      for (let k = a; a <= b ? k <= b : k >= b; k += a <= b ? 1 : -1) alts.push(String(k));
    }
    const pre = glob.slice(0, i);
    const post = glob.slice(close + 1);
    const out = [];
    for (const alt of alts) {
      out.push(...braces(pre + alt + post));
      if (out.length > MAX_BRACES) return [glob];
    }
    return out;
  }
  return [glob];
}
function segRe(pat) {
  const esc = (c) => c.replace(/[.*+?^$()|[\]{}\\/-]/g, "\\$&");
  let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "\\" && i + 1 < pat.length) re += esc(pat[++i]);
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      let j = i + 1;
      const neg = pat[j] === "!" || pat[j] === "^";
      if (neg) j++;
      const end = pat.indexOf("]", j + 1);
      if (end < 0) {
        re += "\\[";
        continue;
      }
      const body = pat.slice(j, end).replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\^/g, "\\^");
      re += `[${neg ? "^" : ""}${body}]`;
      i = end;
    } else re += esc(c);
  }
  return new RegExp("^" + re + "$");
}
function globMatch(glob, path) {
  const p = path.split("/").filter((x) => x && x !== ".");
  return braces(glob).some((one) => {
    const g = normalize3(one).replace(/\/+$/, "").split("/").filter((x) => x && x !== ".");
    const go = (i, j) => {
      if (i === g.length) return j === p.length;
      if (g[i] === "**") return go(i + 1, j) || j < p.length && go(i, j + 1);
      return j < p.length && segRe(g[i]).test(p[j]) && go(i + 1, j + 1);
    };
    return go(0, 0);
  });
}
function isMember(globs, rel) {
  const neg = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1));
  return globs.some((g) => !g.startsWith("!") && globMatch(g, rel)) && !neg.some((g) => globMatch(g, rel));
}
function readLock(file) {
  let text;
  try {
    text = readFileSync4(file, "utf8");
  } catch (e) {
    return e.code === "ENOENT" ? "missing" : null;
  }
  try {
    const j = JSON.parse(text);
    const packages = j.packages && typeof j.packages === "object" && !Array.isArray(j.packages) ? j.packages : {};
    return { ok: true, version: j.lockfileVersion, packages };
  } catch (e) {
    return { ok: false, why: `not valid JSON (${e.message.split("\n")[0]})` };
  }
}
var isDir = (p) => {
  try {
    return statSync2(p).isDirectory();
  } catch {
    return false;
  }
};
var rootTree = (key) => key.startsWith("node_modules/");
var label = (key) => key.slice("node_modules/".length);
var same = (a, b) => (a ?? null) === (b ?? null);
var pkgs = (n) => `${n} package${n === 1 ? "" : "s"}`;
function workspaces(r) {
  const w = r.packages[""]?.workspaces;
  const list2 = Array.isArray(w) ? w : w && typeof w === "object" && Array.isArray(w.packages) ? w.packages : [];
  return list2.filter((x) => typeof x === "string");
}
function nodeModulesRows(root, tracked, level, pf, sparse = () => false) {
  const LEVEL = level === "fail" ? "FAIL" : "WARN";
  const row = (lvl, message, fix) => ({ level: lvl, id: "d.node_modules", message, fix, source: "builtin" });
  const locks = tracked.filter((f) => (f === "package-lock.json" || f.endsWith("/package-lock.json")) && !f.split("/").includes("node_modules"));
  const read = new Map(locks.map((f) => [f, readLock(join4(root, f))]));
  const members = /* @__PURE__ */ new Set();
  for (const [f, r] of read) {
    if (!r || r === "missing" || !r.ok) continue;
    const globs = workspaces(r);
    if (!globs.length) continue;
    for (const p of Object.values(r.packages)) {
      if (!p?.link || typeof p.resolved !== "string") continue;
      const rel = normalize3(p.resolved);
      if (isMember(globs, rel)) members.add(normalize3(join4(dirname2(f), rel)));
    }
  }
  const out = [];
  let compared = 0;
  for (const f of locks) {
    const dir = dirname2(f);
    if (members.has(dir)) continue;
    compared++;
    const fix = dir === "." ? "npm ci" : `(cd ${shQuote(dir)} && npm ci)`;
    const r = read.get(f);
    if (r === "missing" && sparse(f)) {
      out.push(row("INFO", `${f}: not checked out (sparse checkout), not compared`));
      continue;
    }
    if (!r || r === "missing") {
      out.push(row(LEVEL, `${f}: cannot read the lockfile`, `restore it (git checkout -- ${shQuote(f)})`));
      continue;
    }
    if (!r.ok) {
      out.push(row(LEVEL, `${f}: ${r.why}`, `restore it (git checkout -- ${shQuote(f)}) or regenerate it with npm install`));
      continue;
    }
    if (r.version !== 2 && r.version !== 3) {
      out.push(row("INFO", `${f}: unsupported lockfile (lockfileVersion ${String(r.version)}; 2 and 3 are read), not compared`));
      continue;
    }
    const skip = skipped(r.packages, pf);
    const want = Object.entries(r.packages).filter(([k, p]) => rootTree(k) && p && typeof p === "object" && !skip.has(k));
    const nm = join4(root, dir, "node_modules");
    if (!isDir(nm)) {
      out.push(want.length ? row(LEVEL, `${f}: node_modules/ missing (${pkgs(want.length)} to install)`, fix) : row("PASS", `${f}: no packages to install`));
      continue;
    }
    const installed = readLock(join4(nm, ".package-lock.json"));
    const hidden = installed === "missing" ? null : installed;
    if (!hidden || !hidden.ok || hidden.version !== 2 && hidden.version !== 3) {
      if (!want.length && !hidden) {
        out.push(row("PASS", `${f}: no packages to install`));
        continue;
      }
      const why = !hidden ? "no node_modules/.package-lock.json" : !hidden.ok ? `node_modules/.package-lock.json is ${hidden.why}` : `node_modules/.package-lock.json has lockfileVersion ${String(hidden.version)}`;
      out.push(row("WARN", `${f}: cannot verify node_modules (${why}; it is written by npm 7 or later)`, fix));
      continue;
    }
    const diffs = [];
    const optional = [];
    for (const [k, p] of want) {
      const h = hidden.packages[k];
      const name = label(k);
      if (p.link) {
        if (!h || !existsSync2(join4(root, dir, k))) diffs.push([k, `workspace link ${name} missing`]);
        continue;
      }
      if (!h) {
        if (p.optional || p.devOptional) optional.push(name);
        else if (p.inBundle) continue;
        else diffs.push([k, p.dev ? `dev package ${name} not installed (an install with --omit=dev? npm ci installs dev packages)` : `${name} not installed`]);
      } else if (!same(p.version, h.version)) diffs.push([k, `${name} is ${String(h.version ?? "unversioned")}, the lockfile wants ${String(p.version ?? "none")}`]);
      else if (!same(p.integrity, h.integrity)) diffs.push([k, `${name}${p.version ? ` ${p.version}` : ""} integrity differs from the lockfile`]);
    }
    for (const k of Object.keys(hidden.packages)) if (rootTree(k) && !Object.hasOwn(r.packages, k)) diffs.push([k, `${label(k)} is installed but not in the lockfile`]);
    diffs.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (diffs.length) {
      const more = diffs.length > 1 ? ` (and ${diffs.length - 1} more)` : "";
      out.push(row(LEVEL, `${f}: ${diffs[0][1]}${more}`, fix));
    } else if (optional.length) {
      const more = optional.length > 1 ? ` (and ${optional.length - 1} more)` : "";
      out.push(row("WARN", `${f}: optional package ${optional.sort()[0]} not installed${more}; npm skips an optional package whose install failed`, `${fix}, and read its output for the optional package's error`));
    } else out.push(row("PASS", `${f}: node_modules matches (${pkgs(want.length)})`));
  }
  if (!out.length) out.push(row("INFO", locks.length && !compared ? "every tracked package-lock.json is a workspace member's; none compared" : "no tracked package-lock.json to compare"));
  return out;
}

// src/lib/env-checks.ts
var res = (level, id, message, fix) => ({ level, id, message, fix, source: "builtin" });
var CFG = ".loops/env-check.toml";
var rp = (p) => {
  try {
    return realpathSync2(p);
  } catch {
    return p;
  }
};
var gitDirAt = (p) => {
  try {
    const m = statSync3(p).isFile() ? /^gitdir: (.+)/.exec(readFileSync5(p, "utf8")) : null;
    return m ? resolve2(dirname3(p), m[1].trim()) : p;
  } catch {
    return p;
  }
};
var VERSION_CMD = { go: ["go", ["version"]], node: ["node", ["--version"]], python: ["python3", ["--version"]] };
var NO_INTERP = "could not start (missing interpreter in its #! line?)";
var PROBE_TIMEOUT_MS = 1e4;
function installFix(root, tool, want, pins) {
  const generic = `install ${tool} ${want} (asdf install, mise install, or your package manager)`;
  const names2 = Object.hasOwn(ALIAS, tool) ? ALIAS[tool] : [tool];
  const written = (file2) => {
    try {
      return readFileSync5(join5(root, file2), "utf8").split("\n").some((l) => {
        const m = /^\s*(\S+)\s+(\S+)/.exec(l);
        return !!m && names2.includes(m[1]) && m[2] === want;
      });
    } catch {
      return false;
    }
  };
  const TV = "tool-versions:";
  const file = /^\d+(?:\.\d+)*$/.test(want) ? pins.map((v) => v.src).find((src) => src.startsWith(TV) && written(src.slice(TV.length)))?.slice(TV.length) : void 0;
  if (file === void 0) return generic;
  if (!Object.hasOwn(ALIAS, tool)) return `install ${tool} ${want}: asdf install ${tool} ${want}, or mise install ${tool}@${want}`;
  if (basename3(file) !== ".tool-versions") return generic;
  const dir = dirname3(file);
  return `install ${tool} ${want}: run asdf install (or mise install) in ${dir === "." ? "the repo root" : shQuote(dir)}, which installs the ${file} pins`;
}
function pinChecks(c) {
  const out = [];
  for (const pin of c.cfg.pins) {
    const id = `a.pins.${pin.tool}`;
    let vals;
    const notes = [];
    const present = pin.sources.filter((s) => !pin.optional.includes(s) || !sourceAbsent(c.root, c.tracked, s));
    if (!present.length) {
      out.push(res("SKIP", id, `no source present (all optional: ${pin.sources.join(", ")})`));
      continue;
    }
    try {
      vals = present.flatMap((s) => readSource(c.root, c.tracked, pin.tool, s, notes));
    } catch (e) {
      if (!(e instanceof PinError)) throw e;
      out.push(res("FAIL", id, e.message, e.fix ?? `fix the source file or the sources in ${CFG}`));
      continue;
    }
    const pins = vals.filter((v) => !v.range);
    const srcs = (xs) => [...new Set(xs.map((v) => v.src))].join(", ");
    const seen = /* @__PURE__ */ new Set();
    const ranges = vals.filter((v) => v.range && !seen.has(`${v.src}\0${v.v}`) && seen.add(`${v.src}\0${v.v}`));
    const info = (v, why = "") => res("INFO", id, `${v.src}: "${v.v}" is a range, not compared${why}`);
    const noted = [...new Set(notes)].map((n) => res("INFO", id, n));
    if (!pins.length) {
      out.push(res("FAIL", id, `no exact pin among sources (${srcs(vals) || present.join(", ")}); pin an exact version in a supported source`, `add a source that pins an exact version to ${CFG}`), ...ranges.map((v) => info(v)), ...noted);
      continue;
    }
    const bad = disagreement(vals, pin.compare);
    const want = pinOf(vals);
    const distinct = [...new Set(pins.map((v) => v.v))];
    const named2 = (w) => distinct.length > 1 ? `${w} (${srcs(pins.filter((v) => v.v === w))})` : w;
    const ranged = (v) => {
      if (pin.range === "info") return info(v);
      if (bad) return info(v, " (the pins disagree)");
      const at2 = distinct.map((w) => [w, inRange(w, v.v, v.pep440)]);
      const first = (k) => at2.find(([, a]) => a === k)?.[0];
      const outside = first("outside");
      const partly = first("partly");
      return outside !== void 0 ? res("FAIL", id, `${v.src}: pin ${named2(outside)} is outside "${v.v}"`, `pin a version inside the range, or change the range`) : partly !== void 0 ? res("WARN", id, `${v.src}: pin ${named2(partly)} is only partly inside "${v.v}"`, `pin a version the range wholly allows (a series pin names every version in it), or widen the range`) : first(null) !== void 0 ? info(v, ' (not a form range = "check" reads)') : res("PASS", id, `${v.src}: ${distinct.length > 1 ? `pins ${distinct.map(named2).join(", ")} are` : `pin ${want} is`} inside "${v.v}"`);
    };
    out.push(bad ? res("FAIL", id, bad, `align the pinned versions, or loosen compare in ${CFG}`) : res("PASS", id, `${pin.tool} ${want} (${srcs(pins)})`), ...ranges.map(ranged), ...noted);
    const sev = pin.local;
    if (c.static || Object.values(sev).every((s) => s === "off")) continue;
    const [bin, args] = Object.hasOwn(VERSION_CMD, pin.tool) ? VERSION_CMD[pin.tool] : [pin.tool, ["--version"]];
    const r = c.run(bin, args, { cwd: c.root, env: { ...gitEnv(c.env, c), GOTOOLCHAIN: "local", GOPROXY: "off", MISE_AUTO_INSTALL: "0" }, timeoutMs: PROBE_TIMEOUT_MS });
    const have = r.code === 0 ? ver(r.stdout + r.stderr) : null;
    const lid = `a.local.${pin.tool}`;
    const row = (s, message, fix) => void (s !== "off" && out.push(res(s.toUpperCase(), lid, message, fix)));
    const fixFor = (w) => bad ? `align the pins first (${id}); env-check then names the version to install` : installFix(c.root, pin.tool, w, pins);
    const of = (w) => bad ? ` (${srcs(pins.filter((v) => v.v === w))})` : "";
    const cmd = [bin, ...args].join(" ");
    const said = (...texts) => {
      const l = texts.flatMap((t) => t.split("\n")).map((x) => x.trim()).find(Boolean);
      return l ? `: ${cut(c.redact(l), 120)}` : "";
    };
    const at = r.notFound ? which(bin, c.env.PATH) : null;
    const failed = r.timedOut ? `${cmd} timed out after ${PROBE_TIMEOUT_MS / 1e3}s` : r.notFound ? at ? `${at} ${NO_INTERP}` : `${bin} not found on PATH` : r.code === null ? `${cmd} could not run (${r.abend ?? "killed"})` : r.code !== 0 ? `${cmd} exited ${r.code}${said(r.stderr, r.stdout)}` : null;
    if (failed !== null || have === null) row(sev.major, failed ?? `${cmd} printed no version${said(r.stdout, r.stderr)}`, fixFor(want));
    else {
      for (const w of bad ? [...new Set(pins.map((v) => v.v))] : [want]) {
        if (localOk(have, w, pin.compare)) out.push(res("PASS", lid, `local ${pin.tool} ${have} matches pin ${w}${of(w)}`));
        else row(sev[diffPart(have, w)], `local ${pin.tool} ${have} does not match pin ${w}${of(w)}`, fixFor(w));
      }
    }
    const amb = ambiguousShim(c, bin);
    if (amb) out.push(res("WARN", lid, amb, `find the stray copy (asdf which ${bin}, then the bin dir of each listed provider; a Go-installed tool is in that Go install's bin dir), remove it, then run asdf reshim; ask the machine owner if unsure`));
  }
  return out;
}
function ambiguousShim(c, bin) {
  const p = which(bin, c.env.PATH);
  const s = p ? shimOf(p) : null;
  if (!s || s.manager !== "asdf") return null;
  const found = [...new Set(s.providers.map((x) => x.plugin))].flatMap((plugin) => {
    const v = asdfActive(c, plugin).find((a) => s.providers.some((x) => x.plugin === plugin && x.version === a));
    return v ? [`${plugin} ${v}`] : [];
  });
  if (found.length < 2) return null;
  return `ambiguous shim: provided by ${found.slice(0, -1).join(", ")} and ${found.at(-1)} (shim ${p})`;
}
function asdfActive(c, plugin) {
  const env = c.env[`ASDF_${plugin.toUpperCase().replace(/-/g, "_")}_VERSION`]?.trim();
  if (env) return env.split(/\s+/);
  const listed = (dir) => {
    let text;
    try {
      text = readFileSync5(join5(dir, ".tool-versions"), "utf8");
    } catch {
      return null;
    }
    for (const l of text.split("\n")) {
      const [name, ...vs] = l.replace(/#.*/, "").trim().split(/\s+/);
      if (name === plugin && vs.length) return vs;
    }
    return null;
  };
  for (let d = c.root; ; d = dirname3(d)) {
    const v = listed(d);
    if (v) return v;
    if (dirname3(d) === d) break;
  }
  return c.env.HOME && listed(c.env.HOME) || [];
}
function sharedCheck(c) {
  if (c.cfg.sharedHint === null) return [];
  const unread = (cmd) => [res("FAIL", "c.shared", "could not read git metadata", `rerun ${cmd} to see why`)];
  if (c.gitDir === null) return unread("git rev-parse --git-dir --git-common-dir");
  if (c.static) return [res("SKIP", "c.shared", "not checked in --static mode")];
  for (const [k, want, what] of [["GIT_DIR", c.gitDir, "git metadata"], ["GIT_WORK_TREE", c.root, "files"]]) {
    const at = c.env[k] ? rp(k === "GIT_DIR" ? gitDirAt(resolve2(c.cwd, c.env[k])) : resolve2(c.cwd, c.env[k])) : null;
    if (at && at !== rp(want)) return [res("FAIL", "c.shared", `${k} points at another checkout's ${what}; git commands here act on ${at}`, "unset GIT_DIR GIT_WORK_TREE")];
  }
  if (c.isWorktree) {
    if (!c.worktreesRead) return unread("git worktree list --porcelain");
    const me = rp(c.root);
    let at = null;
    try {
      at = dirname3(resolve2(c.gitDir, readFileSync5(join5(c.gitDir, "gitdir"), "utf8").trim()));
    } catch {
    }
    if (at && rp(at) === me && c.worktrees.some((w) => rp(w) === me)) return [res("PASS", "c.shared", "in a linked worktree")];
    if (at && rp(at) !== me && existsSync3(join5(at, ".git"))) return [res("FAIL", "c.shared", "this folder shares another worktree's git metadata (copied?)", "recreate it with git worktree add; do not run git worktree repair here")];
    return [res("FAIL", "c.shared", at ? `worktree moved: git has it registered at ${at}${existsSync3(at) ? "" : ", which is missing"}` : "worktree moved: git has no folder registered for its metadata", "run git worktree repair here")];
  }
  if (c.env.ENV_CHECK_ALLOW_MAIN === "1") return [res("INFO", "c.shared", "shared checkout allowed by ENV_CHECK_ALLOW_MAIN")];
  return [res("FAIL", "c.shared", "this is the shared checkout; agents and branches belong in a worktree", c.cfg.sharedHint)];
}
function autoEntrypoints(c) {
  const re = compileGlob(".github/workflows/*.{yml,yaml}");
  const found = /* @__PURE__ */ new Set();
  for (const f of c.tracked.filter((t) => re.some((r) => r.test(t)) && existsSync3(join5(c.root, t)))) {
    for (const m of readFileSync5(join5(c.root, f), "utf8").matchAll(/^\s*(?:-\s+)?(?:run:\s+(?:[|>][+-]?\s*)?)?\.\/([\w./-]+)/gm)) found.add(m[1]);
  }
  return [...found].sort();
}
function shimProblem(c, tool, p) {
  const s = shimOf(p);
  if (!s) return null;
  const cmd = s.cmd ?? which(s.manager, c.env.PATH);
  if (!cmd) return `${s.manager} not on PATH`;
  const r = c.run(cmd, ["which", tool], { cwd: c.root, env: c.env, timeoutMs: PROBE_TIMEOUT_MS });
  const how = `${s.manager} which ${tool}`;
  const said = [r.stderr, r.stdout].flatMap((t) => t.split("\n")).map((x) => x.trim()).find(Boolean);
  if (r.timedOut) return `${how} timed out after ${PROBE_TIMEOUT_MS / 1e3}s`;
  if (r.notFound) return isExecutable(cmd) ? `${s.manager} at ${cmd} ${NO_INTERP}` : `${s.manager} not found at ${cmd}`;
  if (r.code === null) return `${how} could not run (${r.abend ?? "killed"})`;
  const inactive = s.manager === "mise" && r.code === 1 && /is a mise bin however it is not currently active/.test(r.stderr);
  if (r.code !== 0) return inactive && fallsBackTo(c, tool, p) ? null : `${how} exited ${r.code}${said ? `: ${cut(c.redact(said), 120)}` : ""}`;
  return r.stdout.trim() ? null : `${how} printed no path`;
}
function fallsBackTo(c, tool, p) {
  const dirs = (c.env.PATH ?? "").split(delimiter2);
  const at = dirs.findIndex((d) => d && join5(d, tool) === p);
  return at >= 0 && dirs.slice(at + 1).some((d) => d !== "" && isExecutable(join5(d, tool)) && !shimOf(join5(d, tool)));
}
function harnessChecks(c) {
  const h = c.cfg.harness;
  const out = [];
  if (h.tools.length && !c.static) {
    const missing = [];
    const unresolved = [];
    for (const t of h.tools) {
      const p = which(t, c.env.PATH);
      const why = p ? shimProblem(c, t, p) : null;
      if (!p) missing.push(t);
      else if (why) unresolved.push(`${t} (${why})`);
    }
    if (missing.length) out.push(res("FAIL", "d.tools", `missing on PATH: ${missing.join(", ")}`, "install the missing tools"));
    if (unresolved.length) {
      out.push(
        res(
          "FAIL",
          "d.tools",
          `version-manager shim resolves no version here: ${unresolved.join("; ")}`,
          "set a version for this checkout (a .tool-versions line for asdf, mise use <tool>@<version> for mise), put the version manager on PATH, or install the tool outside it"
        )
      );
    }
    if (!missing.length && !unresolved.length) out.push(res("PASS", "d.tools", `present: ${h.tools.join(", ")}`));
  }
  if (h.files.length) {
    const kind = (f) => {
      try {
        const s = statSync3(join5(c.root, f));
        return !s.isFile() ? "other" : s.size === 0 ? "missing" : "ok";
      } catch {
        return "missing";
      }
    };
    const kinds = h.files.map(kind);
    const missing = h.files.filter((_, i) => kinds[i] === "missing");
    const other = h.files.filter((_, i) => kinds[i] === "other");
    const parts2 = [missing.length ? `missing or empty: ${missing.join(", ")}` : "", other.length ? `not a regular file: ${other.join(", ")}` : ""].filter(Boolean);
    const fix = `restore the files (git checkout) or fix [harness] files${other.length ? " (list a file inside a directory, not the directory)" : ""}`;
    out.push(parts2.length ? res("FAIL", "d.files", parts2.join("; "), fix) : res("PASS", "d.files", `present: ${h.files.join(", ")}`));
  }
  const entries = h.entrypoints === "auto" ? autoEntrypoints(c) : h.entrypoints;
  if (h.entrypoints === "auto" && !entries.length) out.push(res("INFO", "d.entrypoints", "auto: no ./ command in tracked .github/workflows; nothing to check"));
  if (entries.length) {
    const bad = entries.filter((e) => !isExecutable(join5(c.root, e)));
    out.push(bad.length ? res("FAIL", "d.entrypoints", `missing or not executable: ${short(bad)}`, `chmod +x ${bad.slice(0, 3).join(" ")}`) : res("PASS", "d.entrypoints", `${entries.length} executable`));
  }
  const [deletedZ, stagedZ] = h.tracked ? ["-d", "-s"].map((f) => git(c.run, c.root, ["ls-files", f, "-z"], gitEnv(c.env, c))) : [];
  if (h.tracked && (deletedZ == null || stagedZ == null)) out.push(res("FAIL", "d.tracked", "git ls-files failed", "run git status to see what is wrong with the index"));
  else if (h.tracked) {
    const deleted = deletedZ.split("\0").filter(Boolean);
    const lost = stagedZ.split("\0").flatMap((l) => l.startsWith("100755 ") ? [l.split("	")[1] ?? ""] : []).filter((p) => p && existsSync3(join5(c.root, p)) && !isExecutable(join5(c.root, p)));
    const parts2 = [deleted.length ? `deleted: ${short(deleted)}` : "", lost.length ? `exec bit lost: ${short(lost)}` : ""].filter(Boolean);
    out.push(parts2.length ? res("FAIL", "d.tracked", parts2.join("; "), "git checkout -- <path> to restore, chmod +x for exec bits") : res("PASS", "d.tracked", "no tracked file deleted, exec bits intact"));
  }
  if (h.sparse && !c.static) {
    const on = git(c.run, c.root, ["config", "--type=bool", "--default=false", "--get", "core.sparseCheckout"], gitEnv(c.env, c))?.trim();
    if (on === "true") out.push(res("WARN", "d.sparse", "sparse checkout is enabled; tools may not see every file", "git sparse-checkout disable"));
    else if (on === "false") out.push(res("PASS", "d.sparse", "sparse checkout is off"));
    else out.push(res("WARN", "d.sparse", "could not read core.sparseCheckout", "run git config --type=bool --get core.sparseCheckout to see what is wrong"));
  }
  if (h.nodeModules !== "off" && !c.static) {
    const sparse = (f) => git(c.run, c.root, ["ls-files", "-t", "-z", "--", `:(literal)${f}`], gitEnv(c.env, c))?.startsWith("S ") ?? false;
    out.push(...nodeModulesRows(c.root, c.tracked, h.nodeModules, c.platform ?? hostPlatform(), sparse));
  }
  return out;
}
var norm = (s) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "");
var COMPOSE_FILE = /(^|\/)(docker-)?compose([.-][\w.-]+)?\.ya?ml$/i;
var COMPOSE_KEYS = ["services", "include", "networks", "volumes", "configs", "secrets", "models"];
var table3 = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : void 0;
var isMetaKey = (k) => k === "name" || k === "version" || k.startsWith("x-");
function readCompose(file) {
  let text;
  try {
    text = readFileSync5(file, "utf8");
  } catch {
    return "cannot be read";
  }
  const docs = (0, import_yaml2.parseAllDocuments)(text, { merge: true, schema: "core" });
  if (!docs.length) return [null];
  const out = [];
  for (const doc of docs) {
    const err = doc.errors[0];
    if (err) return `is not valid YAML: ${err.message.split("\n")[0]}`;
    if (doc.directives?.yaml.explicit && doc.directives.yaml.version !== "1.1") return "has a %YAML directive other than 1.1, which Compose rejects";
    if (!(0, import_yaml2.isMap)(doc.contents)) {
      out.push(null);
      continue;
    }
    try {
      out.push(doc.toJS({ maxAliasCount: -1 }));
    } catch (e) {
      return `is not valid YAML: ${e.message.split("\n")[0]}`;
    }
  }
  return out;
}
function isComposeFile(c, f) {
  const m = COMPOSE_FILE.exec(f);
  if (!m) return false;
  if (!m[3]?.startsWith("-")) return true;
  const docs = readCompose(join5(c.root, f));
  if (typeof docs === "string") return true;
  const keys = docs.flatMap((d) => d ? Object.keys(d) : []);
  return keys.some((k) => COMPOSE_KEYS.includes(k)) || keys.some((k) => k !== "version") && keys.every(isMetaKey);
}
var normProject = (s) => s.toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[_-]+/, "");
var isProject = (s) => s !== "" && normProject(s) === s;
var isMainRoot = (c, root) => root === c.root ? !c.isWorktree : rp(root) === rp(c.worktrees[0] ?? c.root);
var filesFor = (c, root) => (isMainRoot(c, root) ? c.cfg.compose.mainFiles : null) ?? c.cfg.compose.files;
var filesKey = (c, root) => isMainRoot(c, root) && c.cfg.compose.mainFiles ? "main_files" : "files";
var projectDir = (c, root) => dirname3(resolve2(root, filesFor(c, root)[0]));
function derive(c, root) {
  const main2 = c.worktrees[0] ?? c.root;
  if (c.cfg.compose?.derive === "dirname" || rp(root) === rp(main2)) return normProject(basename3(projectDir(c, root)));
  const hash = createHash("sha1").update(rp(root)).digest("hex").slice(0, 6);
  return `${norm(basename3(main2)) || "wt"}-${norm(basename3(root)).slice(0, 24)}-${hash}`;
}
function runs(c, root) {
  const files = filesFor(c, root);
  let dir = projectDir(c, root);
  while (!existsSync3(dir) && dir !== root) dir = dirname3(dir);
  const atRoot = rp(dir) === rp(root);
  return [
    ...files.every((f) => existsSync3(join5(root, f))) ? [{ dir: root, pdir: projectDir(c, root), files, label: "configured run" }] : [],
    { dir, pdir: dir, label: atRoot ? "root plain run" : "project-dir plain run" },
    ...atRoot ? [] : [{ dir: root, pdir: root, label: "root plain run" }]
  ];
}
var LABELS = ["", ".working_dir", ".config_files", ".environment_file"].map((l) => `{{json (.Label "com.docker.compose.project${l}")}}`);
var PS_FORMAT = `[{{json .Names}},{{json .State}},{{json .CreatedAt}},${LABELS.join(",")}]`;
function listContainers(c) {
  const r = c.run("docker", ["ps", "-a", "--format", PS_FORMAT], { cwd: c.root, env: c.env, timeoutMs: PROBE_TIMEOUT_MS });
  if (r.timedOut) return { failed: `docker ps timed out after ${PROBE_TIMEOUT_MS / 1e3}s`, timedOut: true };
  if (r.code !== 0) return { failed: r.notFound ? "docker not found" : `docker ps exit ${r.code ?? r.abend ?? "abnormal"}`, timedOut: false };
  try {
    return r.stdout.split("\n").filter(Boolean).map((l) => {
      const [name, state, at, project, workingDir, configFiles, envFile] = JSON.parse(l);
      const created = Date.parse(at.replace(/^(\S+) (\S+) ([+-]\d\d)(\d\d).*/, "$1T$2$3:$4"));
      return { name, state, created, project, workingDir, configFiles, envFile };
    });
  } catch {
    return { failed: "docker ps printed a listing loops cannot read", timedOut: false };
  }
}
function canon(p) {
  if (!isAbsolute4(p)) return p;
  for (let head = p, tail = ""; ; tail = `/${basename3(head)}${tail}`, head = dirname3(head)) {
    try {
      return realpathSync2.native(head) + tail;
    } catch {
      if (dirname3(head) === head) return p;
    }
  }
}
function strays(c, ps, projects) {
  const roots = c.worktrees.map((w) => [canon(w), w]).sort((a, b) => b[0].length - a[0].length);
  const out = /* @__PURE__ */ new Map();
  for (const k of ps.filter((k2) => projects.includes(k2.project))) {
    const wd = canon(k.workingDir);
    const owner = roots.find(([r]) => wd === r || wd.startsWith(`${r}/`));
    if (owner?.[0] === canon(c.root)) continue;
    const whose = !owner ? "outside every checkout" : owner[0] === canon(c.worktrees[0]) ? "the main checkout" : `worktree ${owner[1]}`;
    out.set(`${k.project}\0${k.workingDir}`, [k.project, k.workingDir, whose]);
  }
  return [...out.values()];
}
var shellCompose = (c) => Object.keys(c.env).filter((k) => k.startsWith("COMPOSE_") && !isSwitch(k)).sort();
function cellsOf(c, root, whose, scrubs) {
  const set = shellCompose(c);
  return runs(c, root).flatMap((r) => scrubs.map((scrub) => ({ ...r, whose, pre: root === c.root && scrub ? `without your shell's COMPOSE_* (${set.join(", ")}), ` : "", r: composeName({ root: r.dir, files: r.files, env: c.env, scrub, run: c.run }) })));
}
var NOTHING = { names: [], templated: false };
function recoverer(c) {
  const seen = /* @__PURE__ */ new Map();
  let timedOut = false;
  const once = (p) => {
    const o = { root: p.dir, files: p.files, env: c.env, scrub: true, run: c.run };
    const raw = composeNameRaw(o);
    if ("error" in raw) {
      timedOut ||= raw.kind === "timeout";
      return NOTHING;
    }
    const literal = raw.raw !== null && !raw.raw.includes("$") ? normProject(raw.raw) : null;
    const norm2 = composeNameRaw({ ...o, normalize: true });
    if ("error" in norm2) timedOut ||= norm2.kind === "timeout";
    const answer = "error" in norm2 ? null : norm2.raw;
    const names2 = new Set(literal ? [literal] : []);
    if (raw.raw !== null && literal === null) {
      const dotenv = readDotEnv(p.pdir);
      const local = resolveTemplate(raw.raw, dotenv);
      const resolved = local === null ? "" : normProject(local);
      if (resolved) names2.add(resolved);
      const own = dotenv.get("COMPOSE_PROJECT_NAME");
      if (own) names2.add(normProject(own));
      const beat = !!own || answer !== null && answer !== normProject(raw.raw);
      if (beat && answer) names2.add(answer);
      return { names: [...names2], templated: !resolved && !beat };
    } else if (answer) names2.add(answer);
    return { names: [...names2], templated: false };
  };
  return (p) => {
    const kind = p.r.kind;
    if (kind !== "interp" && kind !== "exit") return NOTHING;
    const key = `${rp(p.dir)}\0${(p.files ?? []).join("\0")}`;
    const hit = seen.get(key);
    if (hit) return hit;
    const got = timedOut ? NOTHING : once(p);
    seen.set(key, got);
    return got;
  };
}
function peers(c) {
  const main2 = rp(c.worktrees[0] ?? c.root);
  const recover = recoverer(c);
  return c.worktrees.filter((w) => rp(w) !== rp(c.root)).map((w) => {
    const isMain = rp(w) === main2;
    const holder = isMain ? "the main checkout" : `worktree ${w}`;
    const exists = existsSync3(w);
    const cells = c.isWorktree && exists ? cellsOf(c, w, `${holder}'s `, [true]) : [];
    const failed = cells.filter((p) => "error" in p.r);
    const got = failed.map(recover);
    const mainProject = isMain ? c.cfg.compose.mainProject : null;
    const recovered = [...mainProject ? [mainProject] : [], ...isMain && failed.length ? [derive(c, w)] : [], ...got.flatMap((g) => g.names)];
    return { root: w, holder, isMain, exists, files: filesFor(c, w), derived: isMain ? null : derive(c, w), cells, failed, recovered, templated: got.some((g) => g.templated) };
  });
}
var named = (p) => "name" in p.r ? p.r.name : void 0;
function heldOf(ps) {
  const held = /* @__PURE__ */ new Map();
  for (const p of ps) {
    if (p.derived !== null && !held.has(p.derived)) held.set(p.derived, p.exists ? p.holder : `${p.holder} (gone, until git worktree prune)`);
    for (const n of [...p.cells.map(named), ...p.recovered]) if (n && !held.has(n)) held.set(n, p.holder);
  }
  return held;
}
function peerWarnings(ps, name, kept) {
  return ps.flatMap((p) => {
    const [first, ...more] = p.failed;
    if (!first) return [];
    const where = p.isMain ? "checkout" : "worktree";
    const also = more.length ? `, and ${more.length} more run${more.length > 1 ? "s" : ""}` : "";
    const keep = kept ? `this checkout keeps project ${name} (checked against every name loops can know)` : `this checkout's project ${name} was checked against every name loops can know`;
    const tpl = p.templated ? `; its name: reads a variable loops could not resolve from that ${where}'s .env` : "";
    const message = `${p.isMain ? "main checkout" : "peer worktree"} ${p.root}: ${first.label}: ${first.r.error}${also}; ${keep}, but a name set only in that ${where}'s shell cannot be checked until its stack runs${tpl}`;
    const fix = `run bin/env-check in ${p.root} (its e.project row names the fix there)${p.isMain ? "" : `; if that worktree is abandoned, git worktree remove ${shQuote(p.root)} (refuses when it has changes)`}`;
    return [res("WARN", "e.project", message, fix)];
  });
}
var UPGRADE_FIX = "upgrade Docker Compose to one whose config takes --no-env-resolution";
var interpFix = (v, pdir) => `set ${v} in ${join5(pdir, ".env")} or export it; copy its line from .env.example when one defines it; if it is a secret you do not have, ask the repo owner`;
var NO_NAME_FIX = "Compose exited 0 without a usable project name; check `docker compose version` and upgrade Docker Compose";
function composeProject(c) {
  const id = "e.project";
  const { derive: how, mainProject } = c.cfg.compose;
  const files = filesFor(c, c.root);
  const key = filesKey(c, c.root);
  const one = (level, message, fix, name2 = null) => ({ name: name2, results: [res(level, id, message, fix)], withheld: level === "FAIL", answers: [], warnings: [] });
  const missing = files.filter((f) => !existsSync3(join5(c.root, f)));
  if (missing.length === files.length) return one("FAIL", `no compose file found (${files.join(", ")})`, `fix [compose] ${key} in ${CFG}`);
  if (missing.length) return one("FAIL", `compose file missing: ${missing.join(", ")}`, `restore ${missing[0]} or fix [compose] ${key} in ${CFG}`);
  if (c.static) return one("PASS", "compose files present (project name not resolved in --static)");
  const envName = c.env.COMPOSE_PROJECT_NAME || void 0;
  if (envName && !isProject(envName)) return one("FAIL", `your shell's COMPOSE_PROJECT_NAME ${JSON.stringify(envName)} is not a Compose project name (lowercase letters, digits, - and _, starting with a letter or digit)`, "export a COMPOSE_PROJECT_NAME of that form, or unset it");
  if (c.gitDir === null) return one("FAIL", "could not read git metadata", "rerun git rev-parse --git-dir --git-common-dir to see why");
  if (c.isWorktree ? c.worktrees.length < 2 || rp(c.worktrees[0]) === rp(c.root) : !c.worktrees.length) return one("FAIL", "git worktree list did not list the main checkout; the names other checkouts hold are unknown", `rerun to see why: cd ${shQuote(c.root)} && git worktree list --porcelain`);
  if (!c.isWorktree && mainProject && envName && envName !== mainProject) return one("FAIL", `your shell's COMPOSE_PROJECT_NAME ${envName} is not [compose] main_project ${mainProject}: a run here without -p would use another stack than the config names`, `unset COMPOSE_PROJECT_NAME, or set main_project = "${envName}" in ${CFG}`);
  const mainName = c.isWorktree ? null : mainProject;
  const v = composeVersion(c.run, c.root, c.env);
  if ("unavailable" in v) return one("SKIP", `compose unavailable (${v.unavailable}); nothing to collide with`, void 0, envName ?? (c.isWorktree ? derive(c, c.root) : mainName));
  if ("error" in v) return one("FAIL", `compose: ${v.error}`, `rerun to see why: cd ${shQuote(c.root)} && docker compose version`);
  const failed = (p) => {
    const e = p.r;
    const fix = e.kind === "interp" && own.includes(p) ? interpFix(e.variable, p.pdir) : e.kind === "tooOld" ? UPGRADE_FIX : e.kind === "json" || e.kind === "noName" ? NO_NAME_FIX : `rerun to see Compose's error: ${rerun(e)}`;
    return res("FAIL", id, `${p.pre}${p.whose}${p.label}: ${e.error}`, fix);
  };
  const own = cellsOf(c, c.root, c.isWorktree ? "this worktree's " : "this checkout's ", shellCompose(c).length ? [false, true] : [false]);
  if (!envName && !c.isWorktree && !mainName && "error" in own[0].r) return { name: null, results: [failed(own[0])], withheld: true, answers: [], warnings: [] };
  if (!envName && !c.isWorktree && "noFile" in own[0].r) return one("FAIL", "this checkout's configured run: docker compose config found no compose file", `fix [compose] ${key} in ${CFG}`);
  const name = envName ?? (c.isWorktree ? derive(c, c.root) : mainName ?? named(own[0]));
  if (!name) return one("FAIL", `no project name derives from directory ${basename3(projectDir(c, c.root))}`, "set COMPOSE_PROJECT_NAME, or declare name: in the compose file");
  const others = peers(c);
  const held = heldOf(others);
  const fails = [];
  for (const p of own) if ("error" in p.r) fails.push([failed(p), !c.isWorktree && !mainName && !!p.files]);
  const holder = held.get(name);
  const rename = `export another COMPOSE_PROJECT_NAME${how === "dirname" ? `, set derive = "slug-hash" in ${CFG}` : ""}, or rename ${holder}`;
  const mainPath = c.worktrees[0] ?? c.root;
  const byMain = c.isWorktree && holder === "the main checkout";
  const viaMainProject = byMain && name === mainProject;
  const dirnameClash = byMain && !envName && how === "dirname" && !viaMainProject && name === derive(c, mainPath);
  const atRoot = rp(projectDir(c, c.root)) === rp(c.root);
  const slug = `set derive = "slug-hash" in ${CFG}, which renames every worktree's project, so first stop each worktree's stack (docker compose down, without -v)`;
  const clash = `${atRoot ? `rename this worktree's directory: git worktree move ${shQuote(c.root)} <new-path>; or ` : ""}${slug}`;
  if (holder && dirnameClash) fails.push([res("FAIL", id, `this worktree would use project ${name}, which the main checkout uses: the main checkout ${mainPath} and this worktree ${c.root} derive one name under derive = "dirname"`, clash), true]);
  else if (holder && viaMainProject) fails.push([res("FAIL", id, `this worktree would use project ${name}, which the main checkout uses: it is [compose] main_project in ${CFG}`, `${envName ? "export another COMPOSE_PROJECT_NAME" : how === "dirname" ? clash : "export another COMPOSE_PROJECT_NAME"}, or set another main_project in ${CFG}`), true]);
  else if (holder) fails.push([res("FAIL", id, `${c.isWorktree ? "this worktree" : "this checkout"} would use project ${name}, which ${holder} uses`, byMain && !envName && how === "dirname" ? clash : rename), true]);
  const unset = c.env.COMPOSE_PROJECT_NAME === "" ? "unset the empty COMPOSE_PROJECT_NAME, then " : "";
  for (const p of c.isWorktree ? own : []) {
    const a = named(p);
    const mine = [name, derive(c, c.root), ...rp(p.pdir) === rp(c.root) ? [normProject(basename3(c.root))] : []];
    if (a === void 0 || mine.includes(a) && !held.has(a)) continue;
    const by = held.get(a);
    const fix = `${unset}add COMPOSE_PROJECT_NAME=${name} to ${join5(p.pdir, ".env")}, or export it, or always pass -p ${name}`;
    fails.push([res("FAIL", id, `${p.pre}${p.label} would use project ${a}, ${by ? `which ${by} uses` : `not ${name}`}`, fix), false]);
  }
  const answers = [...new Set(own.flatMap((p) => named(p) ?? []))];
  const ps = listContainers(c);
  const gone = (d) => {
    try {
      statSync3(d);
      return false;
    } catch (e) {
      return ["ENOENT", "ENOTDIR"].includes(e.code ?? "");
    }
  };
  const stop = (p, d) => `${p === name ? "export another COMPOSE_PROJECT_NAME" : `always pass -p ${name}`}${isAbsolute4(d) && !gone(d) ? `; leave that stack to whoever runs it from ${shQuote(d)}` : `, or stop that stack: docker compose -p ${p} down`}`;
  if (!Array.isArray(ps) && ps.timedOut) fails.unshift([res("FAIL", id, `running stacks not checked (${ps.failed})`, "rerun to see why: docker ps -a"), true]);
  else if (Array.isArray(ps)) fails.unshift(...strays(c, ps, [name, ...answers]).map(([p, d, by]) => [res("FAIL", id, `project ${p} was started from project directory ${d || "(no working_dir label)"} (${by})`, stop(p, d)), p === name]));
  const source = envName ? "COMPOSE_PROJECT_NAME" : c.isWorktree ? `derived: ${how}` : mainName ? "main_project" : "compose";
  const note = Array.isArray(ps) || ps.timedOut ? "" : `; running stacks not checked (${ps.failed})`;
  if (!fails.length) return { name, results: [res("PASS", id, `${name} (${source})${note}`)], withheld: false, answers, ps, warnings: peerWarnings(others, name, true) };
  const withheld = fails.some(([, w]) => w);
  const results = [...fails.filter(([, w]) => w), ...fails.filter(([, w]) => !w)].map(([r]) => r);
  results[0] = { ...results[0], message: results[0].message + note };
  return { name: withheld ? null : name, results, withheld, answers, ps, warnings: peerWarnings(others, name, !withheld) };
}
function containersCheck(c, { name: project, results, ps }) {
  const cfg = c.cfg.compose;
  const id = "b.containers";
  if (!cfg.inputs.length) return [];
  if (!project) return results[0].level === "SKIP" ? [res("SKIP", id, "project unknown (compose unavailable)")] : [];
  const all = ps ?? listContainers(c);
  if (!Array.isArray(all)) return [res("SKIP", id, `docker is not available (${all.failed})`)];
  const running = all.filter((k) => k.project === project && k.state === "running");
  if (!running.length) return [res("SKIP", id, `stack down (no running container for project ${project})`)];
  const matchers = cfg.inputs.flatMap((g) => compileGlob(g));
  const files = c.tracked.filter((f) => matchers.some((re) => re.test(f)));
  if (!files.length) return [res("SKIP", id, "no commit touches the [compose] inputs")];
  const level = cfg.containers === "fail" ? "FAIL" : "WARN";
  const logged = git(c.run, c.root, ["log", "-1", "--no-show-signature", "--format=%ct", "--", ...files], gitEnv(c.env, c))?.trim();
  const ct = logged === void 0 || !/^\d*$/.test(logged) ? NaN : Number(logged);
  if (Number.isNaN(ct)) return [res(level, id, "loops cannot read the commit time of the compose inputs, so it cannot tell whether the running containers are older")];
  if (!ct) return [res("SKIP", id, "no commit touches the [compose] inputs")];
  const mtimes = files.map((f) => {
    try {
      return [f, statSync3(join5(c.root, f)).mtimeMs];
    } catch {
      return [f, NaN];
    }
  });
  const unstat = mtimes.filter(([, t]) => Number.isNaN(t)).map(([f]) => f);
  if (unstat.length) return [res(level, id, `loops cannot read the modification time of ${short(unstat)}, so it cannot tell whether the running containers are older`, `restore ${short(unstat)} or make it readable, then re-run`)];
  const newest = mtimes.reduce((n, [, t]) => Math.max(n, t), ct * 1e3);
  const stale = running.filter((k) => !(k.created >= newest));
  const unreadable = stale.filter((k) => Number.isNaN(k.created)).map((k) => k.name);
  const quote2 = (s) => /^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  const rel = (p) => p === c.root ? "." : p.startsWith(`${c.root}/`) ? p.slice(c.root.length + 1) : p;
  const split2 = (v) => v.split(/,(?=\/)/);
  const agreed = new Set(stale.map((k) => JSON.stringify([k.configFiles, k.workingDir, k.envFile])));
  const [started = "", wd = "", envFile = ""] = agreed.size === 1 ? JSON.parse([...agreed][0]) : [];
  const own = split2(started);
  const fs = own.every((f) => isAbsolute4(f) && existsSync3(f)) ? own.map(rel) : filesFor(c, c.root);
  const args = fs.map((f) => ` -f ${quote2(f)}`);
  if (wd && rel(wd) !== normalize4(dirname3(fs[0]))) args.push(` --project-directory ${quote2(rel(wd))}`);
  if (envFile) args.push(...split2(envFile).map((f) => ` --env-file ${quote2(rel(f))}`));
  const fix = `docker compose -p ${project}${args.join("")} up -d --build --force-recreate${unreadable.length && level === "FAIL" ? `; if docker ps prints CreatedAt in a form loops cannot read, set [compose] containers = "warn" in ${CFG}` : ""}`;
  const why = unreadable.length ? ` (loops cannot read ${unreadable.length === 1 && stale.length === 1 ? "its creation time" : `the creation time of ${short(unreadable)}`})` : "";
  return [stale.length ? res(level, id, `${short(stale.map((k) => k.name))} created before the newest change to the compose inputs${why}`, fix) : res("PASS", id, `${running.length} running container(s) are newer than the compose inputs`)];
}
function composeChecks(c, project) {
  if (!c.cfg.compose) return [];
  const { mode, allowContainerName } = c.cfg.compose;
  const files = filesFor(c, c.root);
  if (mode === "none") {
    const tracked = c.tracked.filter((f) => isComposeFile(c, f));
    return [tracked.length ? res("FAIL", "e.none", `config says compose mode none but ${short(tracked)} is tracked`, `set [compose] mode = "test" and list the files in ${CFG}`) : res("PASS", "e.none", "no compose file tracked")];
  }
  const read = files.filter((f) => existsSync3(join5(c.root, f))).map((f) => ({ f, docs: readCompose(join5(c.root, f)) }));
  const unread = read.filter((r) => typeof r.docs === "string").map((r) => r.f);
  const names2 = read.flatMap((r) => typeof r.docs === "string" ? [] : r.docs).flatMap((d) => Object.values(table3(d?.services) ?? {})).flatMap((s) => {
    const n = table3(s)?.container_name;
    return n == null || n === "" ? [] : [String(n)];
  }).filter((n) => !allowContainerName.includes(n));
  if (!project) throw new Error("composeChecks: compose mode test needs the resolved project");
  return [
    ...project.results,
    ...project.warnings,
    ...c.static || project.results.some((r) => r.level === "FAIL") ? [] : containersCheck(c, project),
    unread.length ? res("WARN", "e.container_name", `cannot read container_name: ${short(unread)} does not parse as a compose file`, "fix the file until docker compose config accepts it") : names2.length ? res("WARN", "e.container_name", `fixed container_name ${short([...new Set(names2)])} collides across worktrees`, `drop container_name, or list it in allow_container_name in ${CFG}`) : res("PASS", "e.container_name", "no fixed container_name")
  ];
}
var LINE = /^(PASS|WARN|FAIL|SKIP|INFO) (\S+) (.+?)(?: (?:—|--) fix:(?: (.*))?)?$/;
function runLocal(c, l, project) {
  if (c.static && !l.static) return [{ ...res("SKIP", l.id, "not run in --static mode"), source: "local" }];
  const lacking = l.needs.flatMap((n) => {
    const p = which(n, c.env.PATH);
    const why2 = p && !c.static ? shimProblem(c, n, p) : null;
    return !p ? [n] : why2 ? [`${n} (${why2})`] : [];
  });
  if (lacking.length) {
    return [{ ...res("SKIP", l.id, `${lacking.join(", ")} not installed`, `install ${lacking.length > 1 ? "them" : "it"} and put ${lacking.length > 1 ? "them" : "it"} on PATH (for an asdf or mise shim, set a version for this checkout)`), source: "local" }];
  }
  const env = {
    // gitEnv: a foreign GIT_DIR is dropped, a hook's own index and GIT_CONFIG_PARAMETERS/COUNT stay.
    ...gitEnv(c.env, c),
    ENV_CHECK_ROOT: c.root,
    ENV_CHECK_MODE: c.static ? "static" : "full",
    // "Not the main checkout"; empty when git could not be read, set so an inherited value never wins.
    ENV_CHECK_WORKTREE: c.gitDir === null ? "" : c.isWorktree ? "1" : "0",
    ENV_CHECK_PROJECT: project ?? "",
    ENV_CHECK_ID: l.id,
    GOPROXY: "off",
    GOTOOLCHAIN: "local",
    // A mise shim must not install a missing tool: auto_install off also turns off exec and not-found auto-install.
    MISE_AUTO_INSTALL: "0",
    NO_COLOR: "1"
  };
  const r = c.run(resolve2(c.root, l.run), [], { cwd: c.root, env, timeoutMs: l.timeoutMs, group: true });
  const mk = (level, id, message, fix) => ({ level, id, message, fix, source: "local" });
  const out = [];
  for (const line of r.stdout.split("\n").map((s) => s.replace(/\r$/, "").replace(/[ \t]+$/, "")).filter(Boolean)) {
    const m = CONTROL.test(line) ? null : LINE.exec(line);
    if (m && (m[2] === l.id || m[2].startsWith(`${l.id}.`))) out.push(mk(m[1], m[2], m[3], m[4]?.trim() || void 0));
    else out.push(mk("FAIL", `${l.id}.protocol`, `unparseable line ${quote(c.redact(line))}`, "emit `LEVEL id message`, with an optional fix after an em dash and `fix:`, one line per result, id = the configured id or <id>.<name>"));
  }
  if (r.lost) {
    if (out.some((x) => x.level === "FAIL")) return out;
    const what = r.cleaned === "yes" ? "check group killed" : r.cleaned === "no" ? "check group belongs to another process, nothing killed" : "check group could not be verified, nothing killed";
    return [...out, mk("WARN", l.id, `supervisor lost; ${what}`, "rerun once; report it if it repeats")];
  }
  if (r.timedOut) return [...out, mk("WARN", l.id, `timed out after ${l.timeoutS}s (not a pass)`, `raise timeout_s or run ${l.run} by hand`)];
  const stderr = r.stderr.split("\n").map((x) => x.trim()).find(Boolean) ?? "";
  const why = stderr ? ` (${cut(c.redact(stderr), 120)})` : "";
  const none = r.notFound ? NO_INTERP : r.code === null ? `could not run (${r.abend ?? "killed"})` : `printed no results${r.code ? `, exit ${r.code}` : ""}`;
  if (!out.length) return [mk("FAIL", l.id, `${none}${why}`, `run ${l.run} by hand`)];
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
function requiredIds(v) {
  const out = [];
  for (const id of v.split(",").map((x) => x.trim())) {
    if (!id) throw new UsageError(`--require-checks: empty id in "${v}"`);
    if (!/^[a-ex]\.[\w.*-]+$/.test(id)) throw new UsageError(`--require-checks: id "${id}" must look like <a-e or x>.<name> ("*" in the name matches any run of characters)`);
    if (isReserved(id)) throw new UsageError(`--require-checks: ${id} is reserved for env-check's own row and cannot be required`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
function idMatcher(id) {
  if (!id.includes("*")) return (s) => s === id;
  const parts2 = id.split("*");
  const first = parts2[0];
  const last = parts2[parts2.length - 1];
  const middle = parts2.slice(1, -1).filter((p) => p !== "");
  return (s) => {
    if (s.length < first.length + last.length || !s.startsWith(first) || !s.endsWith(last)) return false;
    let at = first.length;
    const end = s.length - last.length;
    for (const p of middle) {
      const i = s.indexOf(p, at);
      if (i < 0 || i + p.length > end) return false;
      at = i + p.length;
    }
    return true;
  };
}
var STATIC_SKIP = "not run in --static mode";
var skipped2 = (id) => ({ level: "SKIP", id, message: STATIC_SKIP, source: "builtin" });
var staticOmission = (r) => r.level === "SKIP" && (r.message === STATIC_SKIP || r.message === "not checked in --static mode");
function staticSkips(cfg) {
  return [
    ...cfg.pins.filter((p) => Object.values(p.local).some((s) => s !== "off")).map((p) => skipped2(`a.local.${p.tool}`)),
    ...cfg.compose?.mode === "test" && cfg.compose.inputs.length ? [skipped2("b.containers")] : [],
    ...cfg.harness.tools.length ? [skipped2("d.tools")] : [],
    ...cfg.harness.sparse ? [skipped2("d.sparse")] : [],
    ...cfg.harness.nodeModules !== "off" ? [skipped2("d.node_modules")] : []
  ];
}
function requiredRows(required, rows, isStatic) {
  const counted = (r) => r.level === "PASS" || r.level === "WARN" || r.level === "FAIL";
  return required.flatMap((id) => {
    const m = idMatcher(id);
    const source = id.startsWith("x.") ? "local" : "builtin";
    const hits = rows.filter((r) => r.source === source && m(r.id));
    if (hits.some(counted)) return [];
    const drop = `drop ${id} from --require-checks`;
    if (hits.length) {
      const shown = hits.slice(0, 3).map((r) => `${r.level} ${r.id}: ${r.message}`).join("; ") + (hits.length > 3 ? `; and ${hits.length - 3} more` : "");
      const fix2 = !isStatic || !hits.every(staticOmission) ? `fix what keeps the check from running, or ${drop}` : source === "builtin" ? `${id} is a built-in check that --static does not run (run env-check without --static, outside CI, to see it), or ${drop}` : `make the check run under --static (a [[local]] needs static = true; CI=true implies --static), or ${drop}`;
      return [{ level: "FAIL", id: "x.required", message: `${id} produced only SKIP/INFO rows (${shown})`, fix: fix2, source: "builtin" }];
    }
    const lookalike = source === "builtin" && rows.some((r) => r.source === "local" && m(r.id));
    const what = id.includes("*") ? "an id matching it" : "this id";
    const fix = source === "builtin" ? `configure the built-in check that produces ${id} in .loops/env-check.toml, or ${drop}` : `add a [[local]] check that prints ${id} to .loops/env-check.toml, or ${drop}`;
    return [{ level: "FAIL", id: "x.required", message: `${id} not configured: no check produced ${what}${lookalike ? " (a [[local]] row with it does not count: a-e ids are satisfied only by built-in checks)" : ""}`, fix, source: "builtin" }];
  });
}
var mapText = (r, f) => ({
  ...r,
  id: f(r.id),
  message: f(r.message),
  fix: r.fix === void 0 ? void 0 : f(r.fix),
  ...r.also ? { also: r.also.map(f) } : {}
});
function envCheckMain(argv, d) {
  const f = parseFlags(argv, { bool: ["static", "json", "quiet", "compose-project"], opt: ["require-checks"] });
  const req = f["require-checks"];
  if (req !== void 0 && f["compose-project"]) throw new UsageError("--require-checks does not combine with --compose-project");
  const required = typeof req === "string" ? requiredIds(req) : [];
  const root = repoRoot(d.run, d.cwd, gitEnv(d.env));
  if (!root) throw new UsageError("not a git repository");
  const cfgFile = join6(root, ".loops", "env-check.toml");
  if (!existsSync4(cfgFile)) throw new UsageError(`no ${cfgFile} (nothing to check)`);
  let text;
  try {
    text = readFileSync6(cfgFile, "utf8");
  } catch (e) {
    throw new UsageError(`cannot read ${cfgFile}: ${e.message}`);
  }
  const cfg = parseConfig(text, ".loops/env-check.toml");
  for (const l of cfg.locals) {
    if (!isExecutable(resolve3(root, l.run))) throw new UsageError(`local check ${l.id}: ${l.run} is missing or not executable`);
  }
  const isStatic = (f.static === true || d.env.CI === "true") && !f["compose-project"];
  const dir = (flag) => {
    const out = git(d.run, root, ["rev-parse", flag], gitEnv(d.env))?.trim();
    return out ? resolve3(root, out) : null;
  };
  const [own, common] = [dir("--git-dir"), dir("--git-common-dir")];
  const gitDir = own && common ? own : null;
  const isWorktree = !!gitDir && own !== common;
  const ls = d.run("git", ["ls-files", "-z"], { cwd: root, env: gitEnv(d.env, { gitDir, root }) });
  if (ls.code !== 0) throw new UsageError(`git ls-files failed${ls.stderr.trim() ? `: ${ls.stderr.trim().split("\n")[0]}` : ""}`);
  const tracked = ls.stdout.split("\0").filter(Boolean);
  let worktrees = [];
  let worktreesRead = false;
  if (!isStatic) {
    const list2 = git(d.run, root, ["worktree", "list", "--porcelain"], gitEnv(d.env, { gitDir, root }));
    worktreesRead = list2 !== null;
    worktrees = (list2 ?? "").split("\n").flatMap((l) => l.startsWith("worktree ") ? [l.slice(9)] : []);
  }
  const home = d.env.HOME || homedir();
  const redact = (s) => redactHome(s, home);
  const showRow = (r) => mapText(r, (s) => escapeCtl(redact(s)));
  const ctx = { run: d.run, root, cwd: d.cwd, env: d.env, static: isStatic, cfg, tracked, isWorktree, gitDir, worktrees, worktreesRead, redact, platform: d.platform };
  if (f["compose-project"]) {
    if (cfg.compose?.mode !== "test") throw new UsageError("compose mode is not test; there is no project name");
    const { name, results: results2, warnings } = composeProject(ctx);
    if (name) d.out(redact(name));
    const fails = results2.filter((r) => r.level === "FAIL");
    for (const r of fails.map(showRow)) d.err(`env-check: ${name ? "warning: " : ""}${r.message} \u2014 fix: ${r.fix}`);
    for (const r of warnings.map(showRow)) d.err(`env-check: warning: ${r.message} \u2014 fix: ${r.fix}`);
    if (!fails.length && !name) d.err(`env-check: ${showRow(results2[0]).message}`);
    return name ? 0 : 1;
  }
  const compose = cfg.compose?.mode === "test" ? composeProject(ctx) : null;
  const project = compose?.name ?? null;
  const results = [
    ...pinChecks(ctx),
    ...sharedCheck(ctx),
    ...harnessChecks(ctx),
    ...composeChecks(ctx, compose),
    ...cfg.locals.flatMap((l) => runLocal(ctx, l, project))
  ].map((r, i) => ({ r, i })).sort((a, b) => group(a.r) - group(b.r) || a.i - b.i).map(({ r }) => r);
  const missing = requiredRows(required, isStatic ? [...results, ...staticSkips(cfg)] : results, isStatic);
  if (!results.some((r) => r.level !== "INFO" && r.level !== "SKIP")) {
    const level = req === void 0 ? "WARN" : "FAIL";
    results.push(
      isStatic ? { level, id: "x.none", message: "no check ran under --static (CI=true implies it)", fix: "add checks that run under --static to .loops/env-check.toml ([[pins]], [harness] files, entrypoints or tracked, or a [[local]] with static = true)", source: "builtin" } : { level, id: "x.none", message: "no check ran", fix: "add checks to .loops/env-check.toml (see the loops README)", source: "builtin" }
    );
  }
  results.push(...missing);
  const shown = collapse(results).map((r) => {
    const x = mapText({ ...r, fix: r.fix ?? (r.level === "WARN" || r.level === "FAIL" ? "address the message above and re-run" : "") }, redact);
    return { ...x, fix: x.fix || void 0 };
  });
  const n = (level) => shown.filter((r) => r.level === level).length;
  const summary = { fail: n("FAIL"), warn: n("WARN"), pass: n("PASS"), skip: n("SKIP") };
  const exit = summary.fail ? 1 : 0;
  if (f.json) {
    const rs = shown.map((r) => ({ level: r.level, id: r.id, message: r.message, fix: r.fix ?? null, also: r.also ?? [], source: r.source }));
    d.out(jsonText({ schema: 1, engine: VERSION, mode: isStatic ? "static" : "full", root: redact(root), results: rs, summary, exit }));
  } else {
    const lines = shown.filter((r) => !f.quiet || r.level === "WARN" || r.level === "FAIL").map((r) => mapText(r, escapeCtl)).map((r) => `${r.level} ${r.id}  ${r.message}${r.fix ? ` \u2014 fix: ${r.fix}` : ""}${r.also ? ` (also: ${r.also.join(", ")})` : ""}`);
    lines.push(`env-check: ${summary.fail} FAIL, ${summary.warn} WARN, ${summary.pass} PASS, ${summary.skip} SKIP`);
    d.out(lines.join("\n"));
  }
  return exit;
}

// src/lib/zone-cli.ts
import { existsSync as existsSync5, readFileSync as readFileSync7 } from "node:fs";
import { join as join7, relative, resolve as resolve4 } from "node:path";

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
    for (const r of p.rows) {
      if (r.zone !== zone) continue;
      let a = byRow.get(r);
      if (!a) byRow.set(r, a = []);
      a.push(p.path);
    }
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
    for (const p of t.slice(i + 1, i + 1 + n)) if (p) paths.push(p);
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
  const ref = tried.find((x) => git(d.run, root, ["rev-parse", "--verify", "--quiet", `${x}^{commit}`], void 0) !== null);
  if (!ref) throw new UsageError(`no base ref found (tried ${tried.join(", ")}); pass --base`);
  const mergeBase = g(["merge-base", ref, "HEAD"]).trim();
  const diff = (...a) => parseNameStatus(g(["diff", "--ignore-submodules=untracked", "--no-ext-diff", "--name-status", "-M", "-z", ...a]));
  const paths = [];
  const add = (list2) => {
    for (const p of list2) paths.push(p);
  };
  add(diff(mergeBase, "HEAD"));
  if (!committed) {
    add(diff("HEAD"));
    add(diff("--cached"));
    add(g(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"));
  }
  return paths;
}
var plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
var LIST_CAP = 8;
var showPath = (p) => /[\u0000-\u001f\u007f]/.test(p) ? JSON.stringify(p) : p;
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
    const shown = paths.slice(0, LIST_CAP).map(showPath).join(", ") + (paths.length > LIST_CAP ? `, (+${paths.length - LIST_CAP} more)` : "");
    lines.push(`  ${s.zone}  ${row ? `\`${row.glob}\`` : "(no row: default yellow)"}  ${plural(paths.length, "path")}: ${shown}`);
  }
  const inc2 = s.unmatched ? ` incl. ${s.unmatched} unmatched` : "";
  lines.push(`paths: ${infos.length} (red ${s.counts.red}, yellow ${s.counts.yellow}${inc2}, green ${s.counts.green})`);
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
      lines.push(`  ${p.zone.padEnd(6)} ${p.prod ? "prod" : "-   "}  ${showPath(p.path)}  <- ${rows}`);
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
  const root = repoRoot(d.run, d.cwd, void 0) ?? d.cwd;
  const filePath = typeof f.file === "string" ? resolve4(d.cwd, f.file) : join7(root, "risk-zones.md");
  if (!existsSync5(filePath)) throw new UsageError(`cannot read ${filePath}`);
  const shown = relative(d.cwd, filePath).startsWith("..") ? filePath : relative(d.cwd, filePath);
  let text;
  try {
    text = readFileSync7(filePath, "utf8");
  } catch (e) {
    throw new UsageError(`cannot read ${filePath}: ${e.message}`);
  }
  const rz = parseRiskZones(text, shown);
  const oneEach = (list2) => {
    for (const p of list2) if (/[\n\r\0]/.test(p)) throw new UsageError(`path ${JSON.stringify(p)} contains a line break or NUL; pass one path per entry`);
    return list2;
  };
  let raw;
  if (Array.isArray(f.paths)) raw = oneEach(f.paths);
  else if (f.stdin) {
    const input = d.readStdin();
    if (!f.z && input.includes("\0")) throw new UsageError("--stdin input contains NUL; pass -z for NUL-separated paths");
    if (f.z && !input.includes("\0") && input.includes("\n")) throw new UsageError("--stdin -z input has newlines but no NUL; drop -z for newline-separated paths");
    raw = oneEach(input.split(f.z ? "\0" : "\n").map((p) => f.z ? p : p.replace(/\r$/, "")));
  } else if (repoRoot(d.run, d.cwd, void 0) === null) throw new UsageError("not a git repository; pass --paths or --stdin");
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
  env-check  [--static] [--json] [--quiet] [--require-checks[=IDS]] [--compose-project]
  --version`;
function realDeps() {
  return {
    run,
    cwd: process.cwd(),
    env: process.env,
    readStdin: () => readFileSync8(0, "utf8"),
    out: (s) => process.stdout.write(`${s}
`),
    err: (s) => process.stderr.write(`${s}
`)
  };
}
function main(argv, d = realDeps()) {
  const [cmd, ...rest] = argv;
  let usage;
  try {
    if (cmd === "--version" || cmd === "-V") d.out(`loops ${VERSION}`);
    else if (cmd === "-h" || cmd === "--help") d.out(USAGE);
    else if (cmd === "zone") return zoneMain(rest, d);
    else if (cmd === "env-check") return envCheckMain(rest, d);
    else {
      usage = cmd ? USAGE : USAGE.slice(USAGE.indexOf("\n") + 1);
      throw new UsageError(cmd ? `unknown command ${cmd}` : `loops ${VERSION}`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    d.err(escapeCtl(redactHome(`${cmd ?? "loops"}: ${e.message}`, d.env.HOME || homedir2())));
    if (usage) d.err(usage);
    return 2;
  }
}

// src/bin/loops.ts
process.exitCode = main(process.argv.slice(2));
