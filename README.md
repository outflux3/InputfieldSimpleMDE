# InputfieldSimpleMDE

A Markdown editor inputfield for [ProcessWire](https://processwire.com/), built on
[EasyMDE](https://github.com/Ionaru/easy-markdown-editor).

## About the name

The module is called `InputfieldSimpleMDE` for historical reasons — it originally
shipped [SimpleMDE](https://github.com/sparksuite/simplemde-markdown-editor), which
has been unmaintained since 2017. As of version 2.0.0 it ships **EasyMDE**, the
maintained fork, which brings a current CodeMirror and Marked with it.

The class name stays the same on purpose: renaming it would orphan every field
already using this inputfield, on every site. Upgrading is a drop-in — see
[Upgrading](#upgrading-from-1x).

## Requirements

ProcessWire 3.0 or newer, PHP 5.4 or newer.

## Installation

In the admin, Modules → Add New, and install by class name
`InputfieldSimpleMDE`.

Or install manually: copy the module folder to
`/site/modules/InputfieldSimpleMDE/`, then Modules → Refresh → Install.

## Usage

Create a Textarea field and set **Inputfield Type** to *Simple Markdown Editor* on
the field's Details tab.

Markdown is stored as-is; nothing is converted on save. For output, apply a
textformatter to the field — the core `TextformatterMarkdownExtra` module, or
[Parsedown](https://processwire.com/modules/textformatter-parsedown/), both work.
Alternatively, format it at output time:

```php
echo $sanitizer->entitiesMarkdown($page->your_field, ['fullMarkdown' => true]);
```

For images, [Image Tags](https://processwire.com/modules/textformatter-image-tags/)
or [Hanna Code](https://processwire.com/modules/process-hanna-code/) work well
alongside it.

## Configuration

By default the field needs no configuration and none is required to keep working
as it always has.

Optionally, on the field's **Input** tab, *EasyMDE options* takes a JSON fragment
that is merged **over** the defaults — so you only supply the keys you want to
change and the rest of the stock configuration stays put:

```
"toolbar": ["bold", "italic", "heading", "|", "preview"],
"sideBySideFullscreen": false
```

Keys must be in double quotes. The surrounding braces are optional. Invalid JSON
is logged to the browser console and ignored, so a typo costs you the option, not
the editor. The full list of options is in the
[EasyMDE documentation](https://github.com/Ionaru/easy-markdown-editor#configuration).

The option is context-aware: it can be set per template under Setup → Templates →
*(template)* → *(field)* → Overrides.

The defaults are:

| Option | Default |
| --- | --- |
| `toolbar` | bold, italic, heading, quote, lists, link, image, preview, side-by-side, fullscreen, table, horizontal rule, code, guide |
| `spellChecker` | `false` (the browser's native spellcheck still applies) |
| `promptURLs` | `true` |
| `autoDownloadFontAwesome` | `false` — see below |

### FontAwesome

The toolbar icons are FontAwesome classes, so they render in whatever
FontAwesome your admin already loads. Install
[FontAwesome Pro](https://processwire.com/modules/font-awesome-pro/) and the
toolbar picks up its styling automatically, with nothing to configure.

The module sets `autoDownloadFontAwesome: false` deliberately. Left unset, the
library looks for a stylesheet whose href contains
`//maxcdn.bootstrapcdn.com/font-awesome/` and, not finding one, appends a
`<link>` to that CDN. It only recognises FontAwesome served from that single
host, so a locally hosted copy — which is what every ProcessWire admin theme
uses — never satisfies the check, and it fires on every page. It also runs per
editor, so a page with ten Markdown fields appended ten of them.

That means an outbound request from your admin to a third-party host on every
page load. SimpleMDE behaved identically, so any site that ran an earlier
version of this module was doing it too; it had simply never been switched off.
If you have a Content Security Policy or a privacy audit that flagged
`maxcdn.bootstrapcdn.com`, this is where it came from.

Note that a module constructing the editor itself — via the `window.SimpleMDE`
alias — bypasses these defaults and needs to pass `autoDownloadFontAwesome:
false` in its own options. Field Descriptions Extended does construct its own,
and passes it.

### The spell checker

`spellChecker` is `false` by default, and that is the only reason the editor
makes no other outbound request. Enabled, the bundled spell checker fetches its
dictionaries from `cdn.jsdelivr.net` at runtime — two files per editor, from a
third party, in your admin.

The browser's own spell checking is on regardless (`nativeSpellcheck`), works
offline, and already knows the editor's language, so there is rarely a reason to
turn the bundled one on. If you do, do it knowingly:

```
"spellChecker": true
```

## How the editor gets initialised

Worth knowing if you are debugging, because it does not work the way most
ProcessWire inputfields do.

The module is `autoload => 'template=admin'` and loads its assets from `init()`
rather than `renderReady()`. ProcessWire only calls `renderReady()` when a field
actually renders, so loading here as well puts the init script on every admin
page whether or not anything rendered, and a textarea arriving later by AJAX
always has something waiting for it.

This is belt-and-braces rather than the fix for the collapsed-repeater bug,
despite how it looks. Measurement says a repeater renders a hidden prototype
item and even an AJAX-collapsed one still takes its inner fields through
`renderReady()`, so on any page holding a Markdown field the assets arrive that
way regardless. The repeater bug was actually fixed by the rewrite of
`InputfieldSimpleMDE.js`: the old double-init guard compared jQuery `.data()`
against the string `'true'` after `.data()` had already coerced it to a boolean,
so it never held, and initialisation depended on guessing which ProcessWire
event would fire and when.

The trade-off is that EasyMDE loads on every admin request, not only on pages
holding a Markdown field. That is deliberate: gating it on the current Process
would drop the library in exactly the cases that are hard to predict — custom
Process modules, and third parties that ask for the library themselves.

`InputfieldSimpleMDE.js` then uses a `MutationObserver` rather than binding to
ProcessWire events, so an AJAX-loaded repeater item, a cloned item, a re-sorted
one, a language tab and a plain page load are all the same case. An
`IntersectionObserver` re-measures each editor when it first becomes visible,
which is what a CodeMirror instance built inside a hidden container needs.

For diagnostics, in the browser console:

```js
InputfieldSimpleMDE.report()    // library loaded? textareas found? editors built?
InputfieldSimpleMDE.scan()      // force a pass over the document
InputfieldSimpleMDE.instance('Inputfield_body')   // the EasyMDE object for a field
```

The EasyMDE instance is also on the textarea element itself, as
`element.simplemdeInstance`.

## Tests

`tests/run.sh` runs a browser suite and a PHP suite. Neither needs anything
installed beyond Chrome, Python 3 and PHP.

```
cd tests
./run.sh              # both suites
./run.sh --open       # open the browser suite in your own browser
./run.sh --mutate     # check the suites can actually fail
```

`tests/MANUAL.md` lists the handful of checks that need a real admin — the Field
Descriptions Extended integration, a save round-trip, real repeater AJAX,
language tabs, fullscreen in other admin themes, and the upgrade path.

See [tests/README.md](tests/README.md) for how it works.

## Interoperability

**Other modules calling `new SimpleMDE(...)`.** The library this module loads is
registered as `window.SimpleMDE` as well as `window.EasyMDE`, so code written
against the old global keeps working. [Field Descriptions
Extended](https://processwire.com/modules/field-descriptions-extended/) relies on
this: its *Enable SimpleMDE* option asks this module for the library and then
constructs an editor on the field description textarea itself.

**Multi-language fields.** Each language renders its own textarea and gets its own
editor, with the field's configured options.

## Upgrading from 1.x

Nothing to do beyond replacing the module folder and running Modules → Refresh.
Field settings, stored content and the default appearance are unchanged; existing
fields keep working without being touched.

Two things to be aware of if you have customised it:

- **Custom CSS.** EasyMDE wraps the editor in `.EasyMDEContainer` and scopes its
  own rules to it, so a bare `.CodeMirror { ... }` override of yours now loses on
  specificity. Prefix such rules with `.EasyMDEContainer`.
- **Heading sizes.** Headings are now visibly larger in the editor, which they
  never were under SimpleMDE. If a line of yours suddenly looks like a heading,
  check for a line of dashes directly beneath it — that is a setext heading by
  the CommonMark spec, and always was. A blank line before the dashes makes it a
  horizontal rule instead. Override `.cm-s-easymde .cm-header-N` in your admin
  CSS to change the scale.
- **The vendor files moved.** `simplemde.min.js` / `simplemde.min.css` at the
  module root are gone, replaced by `easymde/easymde.min.js` and
  `easymde/easymde.min.css`. Anything hard-coding those paths needs updating.

## Changelog

### 2.0.0

- Replaced SimpleMDE 1.11.2 (unmaintained since 2017, bundling CodeMirror 5.15.2)
  with EasyMDE 2.21.0 (CodeMirror 5.65, Marked 4).
- `window.SimpleMDE` is aliased to EasyMDE so dependent modules keep working.
- Editing now marks the field as changed, so ProcessWire's "unsaved changes"
  confirmation covers it. Previously you could edit a Markdown field, navigate
  away and lose the work with no warning.
- Optional per-field EasyMDE options, merged over the defaults, settable per
  template context.
- Fullscreen and side-by-side now escape repeater and image-edit stacking
  contexts.
- The marker class is applied unconditionally rather than only when the `size`
  attribute is empty — a leftover from `InputfieldText` that could silently
  disable the editor.
- Reduced the MutationObserver's work: mutations CodeMirror makes to its own DOM
  are ignored and scans are coalesced per animation frame, so typing no longer
  triggers a document scan per keystroke.
- Editors are released when their field genuinely leaves the document.
- Replaced EasyMDE's heading sizes with a fixed scale. EasyMDE sizes headings
  with `calc(1.375rem + 1.5vw)` — about 2.5x body text, and it rescales with the
  browser window, which no other part of a fixed-width admin field does.
  SimpleMDE never styled heading sizes at all. Headings are now 1.6em down to
  1em, proportional to the field's own text and stable at any window size.
- Stopped fetching FontAwesome from a third-party CDN. The library only ever
  recognised FontAwesome loaded from `maxcdn.bootstrapcdn.com`, so a locally
  hosted copy never counted and it appended a `<link>` to that CDN on every
  page, once per editor. SimpleMDE did the same, so this predates the fork.
- Added a `LICENSE` for the module itself (MIT).

### 1.1.0

- Fixed initialisation inside repeaters.

## License

The module is MIT licensed — see [LICENSE](LICENSE).

The bundled EasyMDE library is MIT licensed by its own authors — see
[easymde/LICENSE](easymde/LICENSE).
