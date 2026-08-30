# Manual checks

`./run.sh` covers initialisation, the repeater regression, configuration, change
tracking, fullscreen stacking and observer behaviour. This is the remainder —
the things that need a real ProcessWire admin, a real database, and eyes.

Roughly ten minutes. Ordered by how likely each is to actually be broken.

## 1. Field Descriptions Extended still gets an editor

The one integration the automated suite can only half-test: it proves
`window.SimpleMDE` is aliased and constructs a working editor, but not that
FDE's own script arrives after it in a real admin request.

- Modules → configure Field Descriptions Extended → *Enable SimpleMDE* is on.
- Setup → Fields → open any field → the **Description** textarea has a Markdown
  toolbar.
- Console shows no `SimpleMDE is not defined`.

If this breaks, the cause is script ordering: `easymde.min.js` and
`InputfieldSimpleMDE.js` must both come before FDE's `simplemde_init.js`.

## 2. A real save round-trip

The suite tests that the textarea is kept in sync, not that ProcessWire stores
what it holds.

- Edit a page with a Markdown field, inside a repeater if you have one.
- Type, save, reload. The content is intact, including blank lines and any
  trailing whitespace you care about.
- The front end renders it as Markdown, through whatever textformatter you use.

## 3. Unsaved-changes warning

The behaviour that did not exist before this version.

- Open a page, type in a Markdown field only, then navigate away without saving.
- The browser asks for confirmation and ProcessWire names the field.
- Then: save, and navigate away again — no warning this time.

## 4. Real repeater AJAX

The fixtures reproduce the DOM shape of a repeater; they do not run
ProcessWire's repeater JavaScript.

- A repeater with several collapsed items, each holding a Markdown field.
- Open one — editor appears, correctly sized, first time.
- Add a new item — same.
- Drag to reorder with an editor open — editors survive and stay usable.
- Delete an item, save, reload.

Worth doing with the page loaded fresh and **every** item collapsed, since that
is the exact case that was broken.

## 5. Language tabs

- A multi-language Markdown field, with the Language Tabs module active.
- Every language tab has its own editor with the right content.
- Switching tabs leaves each editor correctly sized, not collapsed.
- Editing a non-default language saves to that language only.

## 6. Fullscreen in your actual admin theme

The suite asserts the computed z-index clears AdminThemeUikit's sticky masthead
at 980. It cannot tell you it *looks* right, and the old code was reportedly
worse on Reno.

- Fullscreen from a normal field, and from inside a repeater item.
- Nothing from the admin chrome sits on top of the editor.
- Side-by-side preview likewise.
- Escape returns you to the page with the layout unchanged.
- If you use a non-Uikit theme, check it there too.

## 7. Field configuration persists

- Setup → Fields → your Markdown field → Input tab → *EasyMDE options*.
- Enter `"toolbar": ["bold", "italic"]`, save, edit a page: two toolbar buttons.
- Clear it, save: the full default toolbar returns.
- Enter deliberate rubbish (`"toolbar": [bold]`), save, edit a page: the editor
  still works with default settings, and the console explains why.
- If you use template context overrides, set it on one template and confirm
  other templates are unaffected.

## 8. Upgrade path on a real site

Do this on a staging copy before any production site.

- Replace the module folder, Modules → Refresh.
- Existing fields keep working with no changes to their settings.
- Any custom CSS you wrote against `.CodeMirror` still applies — if not, prefix
  it with `.EasyMDEContainer` (see the main README).
- Nothing 404s in the network tab; in particular nothing still requests
  `simplemde.min.js`.

## 9. Modal and panel contexts

Not covered at all by the suite, and a plausible source of stacking bugs.

- Edit a page in a modal from Lister, or via a page-field's edit panel.
- The editor initialises, and fullscreen still clears the modal.
