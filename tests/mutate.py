#!/usr/bin/env python3
"""
Check that the suite would actually notice if the module regressed.

Breaks the module one way at a time, runs the suite, and reports whether the
break was caught. A test that never fails is not a test, and a suite that passes
first time is worth exactly as much as the evidence that it can fail.

Each mutation reverses a specific decision in the module — several of them
restore the actual bug that was there before. Every one of them SHOULD be
caught. Two known exceptions are listed in EQUIVALENT below.

The module is restored after each run, including on error. Nothing is committed.

    python3 mutate.py            # all mutations
    python3 mutate.py --list     # just show them
    python3 mutate.py -k options # only mutations matching a substring
"""

import argparse
import io
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.dirname(HERE)

JS = "InputfieldSimpleMDE.js"
CSS = "InputfieldSimpleMDE.css"
PHP = "InputfieldSimpleMDE.module"

# (name, file, find, replace, which suite should catch it)
MUTATIONS = [
    ("no SimpleMDE alias", JS,
     "\t\tif(typeof window.SimpleMDE === 'undefined' && libraryReady()) {\n"
     "\t\t\twindow.SimpleMDE = window.EasyMDE;\n\t\t}",
     "\t\t/* alias removed by mutation test */", "js"),

    ("FontAwesome CDN download left enabled", JS,
     "\t\tautoDownloadFontAwesome: false,", "\t\t/* left to the library */", "js"),

    # Disables the feature itself rather than one call site: applyRowsHeight is
    # called from both build() and the IntersectionObserver, so removing either
    # alone leaves the other to do the work.
    ("rows setting ignored (the old fixed-300px behavior)", JS,
     "\t\tvar rows = parseInt(el.getAttribute('rows'), 10);",
     "\t\tvar rows = 0; // feature disabled by mutation test", "js"),

    ("growth cap not raised for a tall field", JS,
     "\t\t\tif(total > DEFAULT_CAP) container.style.setProperty('--mde-max-height', total + 'px');",
     "\t\t\tif(false) container.style.setProperty('--mde-max-height', total + 'px');", "js"),

    ("cap made a constant again", CSS,
     "\tmax-height: var(--mde-max-height, 300px);", "\tmax-height: 300px;", "js"),

    ("simplemde:built event never fired", JS,
     "\t\tif(CAN_DISPATCH) {", "\t\tif(false) {", "js"),

    ("CustomEvent used without a guard", JS,
     "\tvar CAN_DISPATCH = typeof CustomEvent === 'function';",
     "\tvar CAN_DISPATCH = typeof __NoSuchCtor__ === 'function';", "js"),

    ("editors() cannot see already-built editors", JS,
     "\t\t\t\tif(el.simplemdeInstance) out.push({ instance: el.simplemdeInstance, element: el });",
     "\t\t\t\tif(false) out.push({ instance: el.simplemdeInstance, element: el });", "js"),

    ("no change bridge", JS,
     "\t\tbridgeChanges(el, instance);", "\t\t/* bridge removed */", "js"),

    ("observer does not filter CodeMirror mutations", JS,
     "\t\tif(!node || node.nodeType !== 1 || !node.closest) return false;",
     "\t\treturn false; /* filter disabled */", "js"),

    ("options parsed by stripping braces (the tempting bug)", JS,
     "\t\tvar attempts = [raw, '{' + raw + '}'];",
     "\t\tvar attempts = ['{' + raw.replace(/^\\s*\\{/, '').replace(/\\}\\s*$/, '') + '}'];", "js"),

    ("IntersectionObserver never observes", JS,
     "\t\tseen.observe(wrap);", "\t\t/* observation disabled */", "js"),

    ("no detached-editor cleanup", JS,
     "\t\tscan(document);\n\t\tcollect();", "\t\tscan(document);", "js"),

    ("no re-adoption of a moved editor", JS,
     "\t\t\t} else if(!nodes[i].simplemdeWatched) {", "\t\t\t} else if(false) {", "js"),

    ("fullscreen z-index back to the old 12/13", CSS,
     ".EasyMDEContainer .CodeMirror-fullscreen {\n\tz-index: 1000;\n}",
     ".EasyMDEContainer .CodeMirror-fullscreen {\n\tz-index: 12;\n}", "js"),

    ("fullscreen ancestors not lifted", CSS,
     "\tposition: relative;\n\tz-index: 1000 !important;", "\tposition: static;", "js"),

    ("EasyMDE viewport-relative heading sizes left in place", CSS,
     ".cm-s-easymde .cm-header-1 { font-size: 1.6em; }",
     ".cm-s-easymde .cm-header-1 { font-size: calc(1.375rem + 1.5vw); }", "js"),

    ("headings flattened to body size", CSS,
     ".cm-s-easymde .cm-header-2 { font-size: 1.4em; }",
     ".cm-s-easymde .cm-header-2 { font-size: 1em; }", "js"),

    ("heading weight lost", CSS,
     "\tline-height: 1.3;\n\tmargin-bottom: 0;",
     "\tline-height: 1.3;\n\tmargin-bottom: 0;\n\tfont-weight: normal;", "js"),

    ("old size guard restored", PHP,
     "\t\t$attrs['class'] = (empty($attrs['class']) ? '' : $attrs['class'] . ' ')\n"
     "\t\t\t. 'InputfieldMaxWidth InputfieldSimpleMDEField';\n\t\tunset($attrs['size']);",
     "\t\tif(empty($attrs['size'])) {\n\t\t\tunset($attrs['size']);\n"
     "\t\t\t$attrs['class'] = (empty($attrs['class']) ? '' : $attrs['class'] . ' ')"
     " . 'InputfieldMaxWidth InputfieldSimpleMDEField';\n\t\t}", "php"),

    ("options stored as an attribute instead of a setting", PHP,
     "\t\t$this->set('mde_options', '');", "\t\t$this->setAttribute('mde_options', '');", "php"),

    ("options not passed to the element", PHP,
     "\t\tif(strlen($options)) $attrs['data-mde-options'] = $options;",
     "\t\t/* not passed */", "php"),

    ("library path typo", PHP,
     '"easymde/easymde.min.js?v=$version"', '"easymde/easymde.min.jsx?v=$version"', "php"),
]

# Mutations that provably cannot change behavior. Listed rather than deleted,
# so the next person does not spend an afternoon rediscovering why.
EQUIVALENT = {
    "no double-build guard":
        "build() opens with `if(isBuilt(el)) return`, but its only caller, scan(), "
        "already checks !isBuilt() first. The guard is unreachable defensive code, "
        "so removing it changes nothing observable.",
    "eager cleanup (collect before scan)":
        "Moving collect() ahead of scan() inside flush() makes no difference. A "
        "MutationObserver callback runs after the whole tick, so an item detached "
        "and reinserted by a sort is already back before collect() ever sees it; "
        "and a move split across ticks is handled by re-adoption in scan() "
        "regardless of the ordering here.",
}


def run_suite(which):
    if which == "php":
        p = subprocess.run([os.environ.get("PHP", "php"), "php-contract.php"],
                           cwd=HERE, capture_output=True, text=True)
    else:
        p = subprocess.run([sys.executable, "cdp.py",
                            "file://" + os.path.join(HERE, "harness.html"),
                            "--timeout", "90"],
                           cwd=HERE, capture_output=True, text=True)
    fails = [l[5:].strip() for l in p.stdout.split("\n") if l.startswith("FAIL")]
    summary = next((l for l in p.stdout.split("\n") if l.startswith("RESULT")), "NO RESULT")
    return fails, summary


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list the mutations and exit")
    ap.add_argument("-k", metavar="SUBSTRING", help="only run mutations whose name matches")
    args = ap.parse_args()

    selected = [m for m in MUTATIONS if not args.k or args.k.lower() in m[0].lower()]

    if args.list:
        for name, fname, _, _, suite in selected:
            print("  [%s] %-52s (%s)" % (suite, name, fname))
        print("\nKnown equivalent mutations (cannot be caught, and should not be):")
        for name, why in EQUIVALENT.items():
            print("  %s\n      %s" % (name, why))
        return 0

    missed = []
    for name, fname, old, new, suite in selected:
        path = os.path.join(MODULE, fname)
        original = io.open(path, encoding="utf-8").read()
        if old not in original:
            print("SKIP    %-52s anchor no longer in %s" % (name, fname))
            missed.append(name + " (stale mutation)")
            continue
        io.open(path, "w", encoding="utf-8").write(original.replace(old, new, 1))
        try:
            fails, summary = run_suite(suite)
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

        if fails:
            print("caught  %-52s %d test%s: %s"
                  % (name, len(fails), "" if len(fails) == 1 else "s", "; ".join(fails[:2])))
        else:
            print("MISSED  %-52s %s" % (name, summary))
            missed.append(name)

    print()
    if missed:
        print("%d mutation(s) went unnoticed — the suite has a blind spot there:" % len(missed))
        for m in missed:
            print("  - " + m)
        return 1

    print("All %d mutations were caught." % len(selected))
    return 0


if __name__ == "__main__":
    sys.exit(main())
