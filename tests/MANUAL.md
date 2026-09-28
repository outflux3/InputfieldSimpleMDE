# Manual checks

Almost everything that used to be on this list is automated now:

| Was manual | Covered by |
| --- | --- |
| Field Descriptions Extended integration | `run.sh` — the `SimpleMDE` alias, and that it constructs a working editor |
| Unsaved-changes warning | `run.sh` — against a faithful copy of core's change handler |
| Repeater AJAX, collapsed fields, sorting | `run.sh` — injection, measurement, moves; `mde-matrix.php` — real repeater and repeater-matrix render |
| Multi-language | `mde-matrix.php` — one marker per language textarea |
| Field configuration persisting | `mde-matrix.php` — `data-mde-options` per field, including invalid JSON and nested objects |
| Save round-trip | `mde-matrix.php` — seeded content survives a real page render |

```
./run.sh                                    # 41 browser + 21 PHP tests
php ../../../_dev-tests/mde-matrix.php run  # real admin render matrix
```

Three things are left. They need a running browser, a real admin theme, and
judgment about whether something *looks* right — none of which a test can
supply. Perhaps five minutes.

## 1. Fullscreen in an admin theme other than Uikit

The suite asserts the computed z-index clears AdminThemeUikit's sticky masthead
at 980, and that the ancestor chain is lifted and released. It cannot tell you it
looks right, and it knows nothing about other themes' chrome. The old code was
reportedly worse on Reno, so this is the one with history.

- Fullscreen from a normal field, and from inside a repeater item.
- Nothing from the admin chrome sits on top of the editor.
- Side-by-side preview likewise.
- Escape returns you to the page with the layout unchanged.

## 2. Modal and panel contexts

Not covered at all, and a plausible source of stacking bugs — a modal is another
stacking context wrapped around everything the fullscreen fix reasons about.

- Edit a page in a modal from Lister, or via a page field's edit panel.
- The editor initializes.
- Fullscreen still clears the modal.

## 3. Upgrade path on an existing site

Do this on a staging copy before any production site. The suites all run against
a fresh install, so they say nothing about what happens to a site that has been
running 1.x for years.

- Replace the module folder, Modules → Refresh.
- Existing fields keep working with no changes to their settings.
- Custom CSS you wrote against `.CodeMirror` still applies — if not, prefix it
  with `.EasyMDEContainer` (see the main README).
- Nothing 404s in the network tab; in particular nothing still requests
  `simplemde.min.js`.
- If a line in an existing field suddenly looks like a heading, check for a line
  of dashes directly beneath it. That is a setext heading and always was;
  SimpleMDE just never styled headings. It does not affect stored content or
  rendered output.
