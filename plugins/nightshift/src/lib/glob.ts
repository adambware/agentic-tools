// Minimal path-glob matcher for area globs (change_flag intersection).
// Supports `**` (any path segments incl. /), `*` (any chars except /), and `?`.
// Globs are anchored to the full relative path.

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` — match across path separators
        re += ".*";
        i++;
        // swallow a trailing slash so `a/**` matches `a/b` and `a/`
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

export function globMatch(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

/** True if ANY glob matches ANY of the given paths. */
export function anyGlobMatch(globs: string[], paths: string[]): boolean {
  if (globs.length === 0 || paths.length === 0) return false;
  const res = globs.map(globToRegExp);
  return paths.some((p) => res.some((r) => r.test(p)));
}
