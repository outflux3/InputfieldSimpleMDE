# Tests

Two suites, no dependencies to install. You need Chrome (or Chromium/Edge) and
Python 3 for the browser suite, and PHP plus this ProcessWire installation for
the PHP one. No npm, no pip, no test framework.

```
./run.sh              # both suites
./run.sh --js         # browser only
./run.sh --php        # PHP only
./run.sh -v           # list passing tests too
./run.sh --open       # open the browser suite in your own browser
./run.sh --mutate     # check the suites can actually fail
```

`run.sh` exits non-zero if anything failed, so it works in a pre-push hook.

## What is here

| File | |
| --- | --- |
| `harness.html` | Fixtures and page shell. Open it directly to poke at real editors. |
| `suite.js` | The browser tests. |
| `pw-stub.js` | The parts of ProcessWire's admin JS the module actually touches. |
| `php-contract.php` | The PHP tests, run against a real bootstrapped ProcessWire. |
| `cdp.py` | Drives headless Chrome. Stdlib only. |
| `mutate.py` | Breaks the module deliberately and checks the suites notice. |
| `MANUAL.md` | The short list of things only a real admin can prove. |

The browser suite covers initialization (visible, hidden, AJAX-injected,
multi-language), the repeater regression, per-field configuration, change
tracking, fullscreen stacking, and observer behavior. The PHP suite covers the
markup contract the browser suite depends on — if the module stopped emitting
`.InputfieldSimpleMDEField`, the browser suite would happily keep passing
against fixtures that no longer resembled anything ProcessWire renders.

## The suites are checked against mutations

A suite that has never failed is not evidence of anything. `./run.sh --mutate`
breaks the module one way at a time — several of the mutations restore the
actual bug that was there before — and reports whether the suites caught it.
All 13 are caught. `python3 mutate.py --list` shows them.

This is not decoration; it found real problems while the suite was being
written. Three tests passed against a deliberately broken module before they
were fixed, and one of those fixes uncovered a genuine bug in the module (see
"re-adoption" below).

Two mutations are documented as *equivalent* — they provably cannot change
behavior, so they are listed in `mutate.py` rather than chased. Read that list
before concluding the suite has a hole.

## Things worth knowing before editing these tests

**Measure the sizer, not the wrapper.** `.CodeMirror`'s own height is useless as
a signal: the module's CSS caps it at 300px and EasyMDE sets `height: auto`, so
a correctly measured editor and a completely unmeasured one both report 300 as
soon as they are visible. `.CodeMirror-sizer` tells the truth — 0 while hidden,
roughly line-count × line-height once CodeMirror has actually measured itself.
The first version of these tests asserted on wrapper height and passed with the
entire measurement mechanism deleted.

**Set content while the container is hidden.** Content set while an editor is
*visible* and then hidden leaves CodeMirror holding correct line metrics, and it
recovers on its own when reshown. Only content set while *hidden* is computed
against zero metrics and cached wrong, which is the state an AJAX-loaded
repeater item is really in, and the only state where a refresh is required.
`makeUnmeasured()` exists for this.

**Scroll it into view.** Measurement is driven by an `IntersectionObserver`, so
an editor revealed below the fold stays unmeasured until it is actually on
screen. That is correct — you cannot see a mismeasured editor without scrolling
to it — but a test that reveals without scrolling waits forever.

**Assert the mechanism, not only the effect, where you can.** The re-adoption
test checks `simplemdeWatched` directly as well as checking that measurement
still happens, because measurement can recover by luck while the editor is in
fact no longer being watched.

**Results are rendered once, at the end.** The module's MutationObserver watches
the whole document, and one test reads `report().flushed` to prove that typing
does not trigger a document scan. A runner that appended a result row after each
test would mutate the DOM under the observer and end up measuring itself.

## Why Chrome is driven over the DevTools protocol

The obvious approach, `chrome --headless --dump-dom`, cannot see an
asynchronous suite:

* `--dump-dom` writes the page at the load event, long before the tests finish.
* `--virtual-time-budget` defers that dump, but only advances timers when
  combined with `--disable-gpu`.
* `--disable-gpu` stops `requestAnimationFrame` ever firing — verified, not
  assumed — and the module coalesces its DOM scans into a rAF callback. Under
  those flags, most of what the suite tests never runs at all.

So `cdp.py` talks to the browser directly: real frames, real timers, and results
read back as data once the suite reports it has finished. It implements just
enough of RFC 6455 to carry CDP messages, in about eighty lines of stdlib, which
is why there is nothing to install.

## The ProcessWire stub

`pw-stub.js` reproduces two things from
`wire/templates-admin/scripts/inputfields.js`: the delegated `change` handler
that stamps `InputfieldStateChanged` on the enclosing `.Inputfield`, and the
navigate-away confirmation that reads it. Both are copied in behavior, not
approximated, because the change bridge exists specifically to satisfy them.

If a ProcessWire upgrade changes those selectors, this stub is where the suite
drifts from reality. Re-check it against core after a major upgrade — a green
run against a stale stub proves nothing.
