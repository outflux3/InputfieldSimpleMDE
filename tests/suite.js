/**
 * InputfieldSimpleMDE test suite.
 *
 * Results are buffered and rendered once at the end, never incrementally. That
 * is not cosmetic: the module's MutationObserver watches the whole document, and
 * the "typing does not trigger a document scan" test reads report().flushed. A
 * runner that appended a <li> after each test would mutate the DOM under the
 * observer and make that test measure the runner instead of the module.
 */
(function() {
	'use strict';

	var results = [];

	// Set before anything else so the driver can distinguish "still running"
	// from "died before it could report".
	window.__SUITE__ = { done: false, summary: null, passed: 0, failed: 0, results: [] };

	// ---------------------------------------------------------------- helpers

	function frame() {
		return new Promise(function(resolve) {
			requestAnimationFrame(function() { requestAnimationFrame(resolve); });
		});
	}

	function sleep(ms) {
		return new Promise(function(resolve) { setTimeout(resolve, ms); });
	}

	function waitFor(predicate, label, timeout) {
		timeout = timeout || 4000;
		var started = Date.now();
		return new Promise(function(resolve, reject) {
			(function poll() {
				var value;
				try { value = predicate(); } catch(e) { value = false; }
				if(value) return resolve(value);
				if(Date.now() - started > timeout) {
					return reject(new Error('timed out after ' + timeout + 'ms waiting for: ' + label));
				}
				setTimeout(poll, 25);
			}());
		});
	}

	function editorOf(id) {
		return document.getElementById(id).simplemdeInstance || null;
	}

	function containersIn(id) {
		return document.getElementById(id).querySelectorAll('.EasyMDEContainer').length;
	}

	function toolbarButtons(fixtureId) {
		return document.getElementById(fixtureId).querySelectorAll('.editor-toolbar button').length;
	}

	/**
	 * Height of the CodeMirror sizer — the element whose height reflects the
	 * measured content.
	 *
	 * The wrapper's own height is useless as a signal: the module's CSS caps it
	 * at 300px and EasyMDE sets height:auto, so a correctly measured editor and
	 * a completely unmeasured one both report 300 the moment they are visible.
	 * The sizer tells the truth — 0 while hidden, and roughly line-count *
	 * line-height once CodeMirror has actually measured itself.
	 */
	function sizerOf(id) {
		var editor = editorOf(id);
		if(!editor) return -1;
		var sizer = editor.codemirror.getWrapperElement().querySelector('.CodeMirror-sizer');
		return sizer ? Math.round(sizer.getBoundingClientRect().height) : -1;
	}

	/**
	 * Put an editor into the state an AJAX-loaded repeater item is really in:
	 * content set while the container is hidden.
	 *
	 * This distinction matters more than it looks. Content set while VISIBLE and
	 * then hidden leaves CodeMirror with correct line metrics cached, and it
	 * comes back fine on its own — a test built that way passes even with the
	 * measurement machinery ripped out. Content set while HIDDEN is computed
	 * against zero metrics and cached wrong, and only an explicit refresh fixes
	 * it. Only the second case tests anything.
	 */
	async function makeUnmeasured(wrapperId, textareaId, content) {
		var wrap = document.getElementById(wrapperId);
		wrap.style.display = 'none';
		await frame();
		editorOf(textareaId).codemirror.setValue(content);
		await frame();
		eq(sizerOf(textareaId), 0, textareaId + ' should be unmeasured while hidden');
	}

	var MANY_LINES = 'one\ntwo\nthree\nfour\nfive\nsix\nseven';

	/**
	 * Reveal an element and scroll it into view, then wait for the module to
	 * re-measure. The scroll is required, not incidental: measurement is driven
	 * by an IntersectionObserver, so an editor revealed below the fold stays
	 * unmeasured until it is actually on screen — which is correct, because you
	 * cannot see it before then.
	 */
	async function revealAndScrollTo(wrapperId, textareaId) {
		var wrap = document.getElementById(wrapperId);
		wrap.style.display = '';
		await frame();
		wrap.scrollIntoView();
		await waitFor(function() { return sizerOf(textareaId) > 80; },
			textareaId + ' to be re-measured after being revealed (sizer was ' + sizerOf(textareaId) + ')');
	}

	function makeField(id, opts) {
		opts = opts || {};
		var wrap = document.createElement('div');
		wrap.className = opts.wrapClass || 'Inputfield';
		wrap.id = 'fx-' + id;
		if(opts.hidden) wrap.style.display = 'none';

		var label = document.createElement('label');
		label.textContent = opts.label || id;
		wrap.appendChild(label);

		if(!opts.empty) wrap.appendChild(makeTextarea(id, opts));
		return wrap;
	}

	function makeTextarea(id, opts) {
		opts = opts || {};
		var ta = document.createElement('textarea');
		ta.id = 'ta-' + id;
		ta.name = id;
		ta.className = 'InputfieldMaxWidth InputfieldSimpleMDEField';
		ta.value = opts.value || ('Injected: ' + id);
		if(opts.options) ta.setAttribute('data-mde-options', opts.options);
		return ta;
	}

	function target() {
		return document.getElementById('fx-ajax-target');
	}

	// ------------------------------------------------------------- assertions

	function Fail(message) { this.message = message; }
	Fail.prototype.toString = function() { return this.message; };

	function fail(message) { throw new Fail(message); }

	function ok(condition, message) {
		if(!condition) fail(message);
	}

	function eq(actual, expected, what) {
		if(actual !== expected) fail(what + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
	}

	function atLeast(actual, min, what) {
		if(!(actual >= min)) fail(what + ': expected at least ' + min + ', got ' + actual);
	}

	// ----------------------------------------------------------------- runner

	var tests = [];

	function describe(name) { tests.push({ group: name }); }
	function it(name, fn) { tests.push({ name: name, fn: fn }); }

	async function run() {
		for(var i = 0; i < tests.length; i++) {
			var t = tests[i];
			if(t.group) { results.push({ group: t.group }); continue; }
			try {
				await t.fn();
				results.push({ name: t.name, pass: true });
			} catch(e) {
				results.push({ name: t.name, pass: false, why: (e && e.message) || String(e) });
			}
		}
		render();
	}

	function crashed(e) {
		window.__SUITE__ = {
			done: true,
			summary: 'RESULT FAIL total=0 passed=0 failed=1',
			passed: 0,
			failed: 1,
			results: [{ name: 'the suite itself threw before finishing', pass: false, why: String((e && e.stack) || e) }]
		};
		var summary = document.getElementById('summary');
		summary.textContent = window.__SUITE__.summary;
		summary.className = 'fail';
	}

	function render() {
		var passed = results.filter(function(r) { return r.pass === true; }).length;
		var failed = results.filter(function(r) { return r.pass === false; }).length;

		var list = document.getElementById('results');
		var html = '';
		results.forEach(function(r) {
			if(r.group) {
				html += '<li class="grp">' + escapeHtml(r.group) + '</li>';
				return;
			}
			html += '<li class="' + (r.pass ? 'ok' : 'no') + '">'
				+ '<span class="tag">' + (r.pass ? 'PASS' : 'FAIL') + '</span>'
				+ escapeHtml(r.name) + '</li>';
			if(!r.pass) html += '<li class="no"><span class="why">' + escapeHtml(r.why) + '</span></li>';
		});
		list.innerHTML = html;

		var summary = document.getElementById('summary');
		// run.sh greps for this exact line, so keep the shape stable.
		summary.textContent = 'RESULT ' + (failed === 0 ? 'PASS' : 'FAIL')
			+ ' total=' + (passed + failed) + ' passed=' + passed + ' failed=' + failed;
		summary.className = failed === 0 ? 'pass' : 'fail';

		// Machine-readable handle for the headless driver (tests/cdp.py). The
		// rendered page is for humans; this is what run.sh actually reads.
		window.__SUITE__ = {
			done: true,
			summary: summary.textContent,
			passed: passed,
			failed: failed,
			results: results.filter(function(r) { return !r.group; })
		};

		if(window.console) {
			console.log(summary.textContent);
			results.filter(function(r) { return r.pass === false; })
				.forEach(function(r) { console.error('FAIL ' + r.name + '\n  ' + r.why); });
		}
	}

	function escapeHtml(s) {
		return String(s).replace(/[&<>"]/g, function(c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
		});
	}

	// ====================================================================
	// Library and compatibility
	// ====================================================================

	describe('Library and compatibility');

	it('EasyMDE is loaded', function() {
		eq(typeof EasyMDE, 'function', 'typeof EasyMDE');
		ok(InputfieldSimpleMDE.report().libraryLoaded, 'report().libraryLoaded should be true');
	});

	it('window.SimpleMDE is aliased to EasyMDE for dependent modules', function() {
		// Field Descriptions Extended calls `new SimpleMDE(...)` against whatever
		// library this module loaded. Losing this alias breaks it silently.
		ok(typeof window.SimpleMDE === 'function', 'window.SimpleMDE should be a constructor');
		eq(window.SimpleMDE, window.EasyMDE, 'window.SimpleMDE === window.EasyMDE');
	});

	it('the alias actually constructs a working editor', function() {
		var host = document.createElement('div');
		host.style.display = 'none';
		var ta = document.createElement('textarea');
		ta.id = 'ta-alias-probe';
		ta.value = '# via the alias';
		host.appendChild(ta);
		document.body.appendChild(host);

		// Constructed directly, so the module's DEFAULTS do not apply — which is
		// exactly how other modules use the alias. autoDownloadFontAwesome is
		// passed explicitly so this probe does not itself reach out to a CDN and
		// invalidate the assertion below.
		var editor = new window.SimpleMDE({
			element: ta, toolbar: ['bold'], spellChecker: false, autoDownloadFontAwesome: false
		});
		ok(!!editor.codemirror, 'constructed editor should expose .codemirror');
		eq(editor.value(), '# via the alias', 'editor value');

		host.parentNode.removeChild(host);
	});

	// ====================================================================
	// Initialization
	// ====================================================================

	describe('Initialization');

	it('builds an editor for a field visible at load', function() {
		ok(editorOf('ta-visible'), 'ta-visible should have an instance');
		eq(containersIn('fx-visible'), 1, 'editors inside fx-visible');
	});

	it('builds an editor for a field hidden at load', function() {
		// The whole point: a collapsed field or closed repeater item must still
		// get an editor, because it is only hidden, not absent.
		ok(editorOf('ta-hidden'), 'ta-hidden should have an instance despite display:none');
		eq(containersIn('fx-hidden'), 1, 'editors inside fx-hidden');
	});

	it('does not build twice when scanned repeatedly', function() {
		var before = editorOf('ta-visible');
		InputfieldSimpleMDE.scan();
		InputfieldSimpleMDE.scan();
		InputfieldSimpleMDE.scan();
		eq(containersIn('fx-visible'), 1, 'editors inside fx-visible after three scans');
		eq(editorOf('ta-visible'), before, 'instance identity should be unchanged');
	});

	it('does not build twice when ProcessWire events fire', async function() {
		// The jQuery bindings are a safety net. They must be idempotent, because
		// in a real admin they fire constantly.
		jQuery(document).trigger('reloaded');
		jQuery(document).trigger('opened');
		jQuery(document).trigger('repeateradd');
		jQuery(document).trigger('wiretabclick');
		await frame();
		eq(containersIn('fx-visible'), 1, 'editors inside fx-visible after PW events');
		eq(containersIn('fx-lang'), 2, 'editors inside fx-lang after PW events');
	});

	it('gives every language of a multi-language field its own editor', function() {
		ok(editorOf('ta-lang-default'), 'default language editor');
		ok(editorOf('ta-lang-es'), 'second language editor');
		eq(containersIn('fx-lang'), 2, 'editors inside fx-lang');
		ok(editorOf('ta-lang-default') !== editorOf('ta-lang-es'), 'the two must be separate instances');
	});

	it('exposes the instance through the public accessor', function() {
		eq(InputfieldSimpleMDE.instance('ta-visible'), editorOf('ta-visible'), 'instance(id)');
		eq(InputfieldSimpleMDE.instance('does-not-exist'), null, 'instance() for a missing id');
	});

	// ====================================================================
	// AJAX and the repeater regression
	// ====================================================================

	describe('The simplemde:built extension point');

	it('fires simplemde:built once per editor, with the instance', async function() {
		var seen = [];
		function onBuilt(e) { seen.push(e); }
		document.addEventListener('simplemde:built', onBuilt);
		try {
			target().appendChild(makeField('evt-one', { label: 'Event probe' }));
			await waitFor(function() { return editorOf('ta-evt-one'); }, 'ta-evt-one to get an editor');
			var mine = seen.filter(function(e) { return e.target && e.target.id === 'ta-evt-one'; });
			eq(mine.length, 1, 'simplemde:built events for ta-evt-one');
			ok(mine[0].detail && mine[0].detail.instance === editorOf('ta-evt-one'),
				'detail.instance is the editor for that textarea');
			ok(mine[0].detail.element === document.getElementById('ta-evt-one'),
				'detail.element is the textarea');
			ok(mine[0].bubbles, 'the event bubbles, so one document listener covers every field');
		} finally {
			document.removeEventListener('simplemde:built', onBuilt);
		}
	});

	it('fires for an editor injected later, which is the whole point', async function() {
		// A registration API would miss this one: by the time the item arrives, any
		// other module has long since finished loading.
		var seen = 0;
		function onBuilt(e) { if(e.target && e.target.id === 'ta-evt-late') seen++; }
		document.addEventListener('simplemde:built', onBuilt);
		try {
			target().appendChild(makeField('evt-late', { label: 'Late event probe', hidden: true }));
			await waitFor(function() { return editorOf('ta-evt-late'); }, 'ta-evt-late to get an editor');
			eq(seen, 1, 'simplemde:built events for a hidden, late-injected field');
		} finally {
			document.removeEventListener('simplemde:built', onBuilt);
		}
	});

	// Checks a guarantee this module RELIES on rather than one it implements:
	// dispatchEvent does not propagate a listener's exception to the dispatcher.
	// Worth a test precisely because it is the reason no try/catch is needed.
	//
	// Asserting on a SIBLING, not just on the field whose listener threw. The
	// dispatch is the last statement in build(), so that field keeps its editor
	// even if the exception did propagate — the earlier version of this test
	// would have passed either way. What propagation would actually cost is the
	// rest of the scan pass: build() throws, scan()'s loop unwinds, and every
	// later textarea in the same batch goes unbuilt.
	it('a listener that throws does not stop other editors being built', async function() {
		function boom(e) {
			if(e.target && e.target.id === 'ta-evt-boom') throw new Error('deliberate listener failure');
		}
		document.addEventListener('simplemde:built', boom);
		try {
			// One tick, so all three are built by a single scan pass.
			var frag = document.createDocumentFragment();
			frag.appendChild(makeField('evt-before', { label: 'Before the thrower' }));
			frag.appendChild(makeField('evt-boom', { label: 'Throwing listener' }));
			frag.appendChild(makeField('evt-after', { label: 'After the thrower' }));
			target().appendChild(frag);

			await waitFor(function() { return editorOf('ta-evt-after'); },
				'ta-evt-after to be built despite an earlier listener throwing');

			ok(editorOf('ta-evt-before'), 'the field before the thrower should be built');
			ok(editorOf('ta-evt-boom'), 'the field whose listener threw should still be built');
			ok(editorOf('ta-evt-after'), 'the field after the thrower should be built');
		} finally {
			document.removeEventListener('simplemde:built', boom);
		}
	});

	it('survives an environment without CustomEvent', function() {
		// The dispatch sits outside build()'s try/catch and scan() has none, so a
		// throw there escapes the whole scan pass. Simulating a missing
		// constructor took 38 of 50 tests down before this was guarded, which is
		// why it is feature-detected rather than assumed.
		ok(typeof CustomEvent === 'function',
			'this browser has CustomEvent, so the guarded path is not exercised here');
		ok(editorOf('ta-visible'), 'editors build normally when it is available');
	});

	it('lets a listener registering late catch up on editors already built', async function() {
		// The event only reaches listeners present when the editor was built, and
		// the page-load editors are built during the initial scan. A module
		// registering inside $(document).ready() — the usual ProcessWire pattern —
		// hears nothing about them. Without a way to enumerate, the feature shows
		// up inside AJAX-loaded repeater items and silently never on normal fields.
		var late = 0;
		document.addEventListener('simplemde:built', function() { late++; });
		eq(late, 0, 'a listener registering now should receive no events for existing editors');

		var editors = InputfieldSimpleMDE.editors();
		atLeast(editors.length, 5, 'editors() should report the editors already built');

		// Same shape as the event's detail, so one function handles both paths.
		ok(editors[0].instance && editors[0].element, 'each entry carries instance and element');
		eq(editors[0].instance, editors[0].element.simplemdeInstance,
			'the instance belongs to its element');

		var found = editors.filter(function(e) { return e.element.id === 'ta-visible'; });
		eq(found.length, 1, 'a known page-load editor should appear exactly once');
	});

	it('supports the documented two-path pattern end to end', async function() {
		// The exact shape the README tells module authors to write: one enhance
		// function, reached both by the event and by the catch-up call. Written as
		// a test because the first version of that example did not run — editors()
		// returns the event's DETAIL, and the example passed those entries to a
		// handler expecting an event.
		var enhanced = [];
		function enhance(mde, el) {
			if(el.dataset.enhanced) return; // documented idempotence guard
			el.dataset.enhanced = '1';
			enhanced.push(el.id);
			var button = document.createElement('button');
			button.className = 'suite-probe-button';
			button.onclick = function() { mde.codemirror.replaceSelection('[[t]]'); };
			mde.gui.toolbar.appendChild(button);
		}

		function onBuilt(e) { enhance(e.detail.instance, e.detail.element); }
		document.addEventListener('simplemde:built', onBuilt);
		try {
			InputfieldSimpleMDE.editors().forEach(function(ed) { enhance(ed.instance, ed.element); });
			var caughtUp = enhanced.length;
			atLeast(caughtUp, 5, 'the catch-up pass should reach the editors already built');

			// and the event half, for one built afterwards
			target().appendChild(makeField('doc-pattern', { label: 'Documented pattern' }));
			await waitFor(function() { return editorOf('ta-doc-pattern'); }, 'ta-doc-pattern to be built');
			await frame();

			ok(enhanced.indexOf('ta-doc-pattern') !== -1, 'a later editor should be reached by the event');
			eq(enhanced.length, caughtUp + 1, 'exactly one more, so neither path double-enhances');

			var button = document.getElementById('fx-doc-pattern').querySelector('.suite-probe-button');
			ok(button, 'the button should be in the toolbar');
			button.click();
			ok(editorOf('ta-doc-pattern').value().indexOf('[[t]]') !== -1,
				'the button should act on its own editor');
		} finally {
			document.removeEventListener('simplemde:built', onBuilt);
			// This test enhances EVERY editor on the page, so it has to put them
			// back. Without this it inflates the toolbar counts that the
			// configuration tests further down assert on — which is exactly how
			// the pollution was found.
			var added = document.querySelectorAll('.suite-probe-button');
			for(var i = 0; i < added.length; i++) added[i].parentNode.removeChild(added[i]);
			var flagged = document.querySelectorAll('[data-enhanced]');
			for(var j = 0; j < flagged.length; j++) flagged[j].removeAttribute('data-enhanced');
		}
	});

	describe('AJAX injection and the repeater regression');

	it('builds an editor for a textarea injected after load', async function() {
		target().appendChild(makeField('ajax-plain', { label: 'AJAX injected' }));
		await waitFor(function() { return editorOf('ta-ajax-plain'); }, 'ta-ajax-plain to get an editor');
		eq(containersIn('fx-ajax-plain'), 1, 'editors inside fx-ajax-plain');
	});

	it('builds an editor for a textarea injected into a HIDDEN container', async function() {
		// This is the exact shape of the original bug: a collapsed repeater item
		// whose contents arrive by AJAX while still hidden.
		target().appendChild(makeField('ajax-hidden', {
			label: 'AJAX into hidden', hidden: true,
			value: 'One.\nTwo.\nThree.\nFour.\nFive.'
		}));
		await waitFor(function() { return editorOf('ta-ajax-hidden'); }, 'ta-ajax-hidden to get an editor');
		eq(containersIn('fx-ajax-hidden'), 1, 'editors inside fx-ajax-hidden');
	});

	it('leaves a hidden editor unmeasured until it is shown', function() {
		// Not a defect — CodeMirror cannot measure inside a hidden container.
		// Asserted so the next test is proving a real transition.
		eq(sizerOf('ta-ajax-hidden'), 0, 'sizer height while hidden');
	});

	it('re-measures an AJAX-injected editor once it is revealed', async function() {
		// The original symptom: an editor that came out zero-height and only
		// fixed itself if you happened to open and close the field.
		await revealAndScrollTo('fx-ajax-hidden', 'ta-ajax-hidden');
		atLeast(sizerOf('ta-ajax-hidden'), 80, 'sizer height after reveal');
	});

	it('re-measures the field that was hidden at page load', async function() {
		eq(sizerOf('ta-hidden'), 0, 'sizer height while hidden');
		await revealAndScrollTo('fx-hidden', 'ta-hidden');
		atLeast(sizerOf('ta-hidden'), 80, 'sizer height after reveal');
	});

	it('builds an editor for a textarea added to an existing container', async function() {
		// A second language appearing, or a field revealed by a dependency.
		var wrap = document.getElementById('fx-ajax-plain');
		wrap.appendChild(makeTextarea('ajax-second', { value: 'Second textarea.' }));
		await waitFor(function() { return editorOf('ta-ajax-second'); }, 'ta-ajax-second to get an editor');
		eq(containersIn('fx-ajax-plain'), 2, 'editors inside fx-ajax-plain');
	});

	// ====================================================================
	// Per-field configuration
	// ====================================================================

	describe('Per-field configuration');

	it('applies a bare JSON fragment', function() {
		eq(toolbarButtons('fx-opt-fragment'), 1, 'toolbar buttons for "toolbar": ["bold"]');
	});

	it('applies a complete JSON object', function() {
		eq(toolbarButtons('fx-opt-full'), 2, 'toolbar buttons for {"toolbar": ["bold","italic"]}');
	});

	it('applies a fragment that ends in a nested object', function() {
		// The brace-stripping approach eats the closing brace here and silently
		// falls back to defaults. The editor must be configured, not just alive.
		var editor = editorOf('ta-opt-nested');
		ok(editor, 'ta-opt-nested should have an editor');
		eq(editor.options.renderingConfig.singleLineBreaks, false, 'renderingConfig.singleLineBreaks');
	});

	it('keeps the default toolbar for keys the fragment does not mention', function() {
		// Merged over the defaults, not instead of them.
		atLeast(toolbarButtons('fx-opt-nested'), 10, 'toolbar buttons with only renderingConfig set');
	});

	it('falls back to defaults on invalid JSON without losing the editor', function() {
		ok(editorOf('ta-opt-bad'), 'ta-opt-bad should still have an editor');
		atLeast(toolbarButtons('fx-opt-bad'), 10, 'toolbar buttons after invalid config');
		atLeast(InputfieldSimpleMDE.report().badConfig, 1, 'report().badConfig');
	});

	it('applies configuration to a textarea injected by AJAX', async function() {
		target().appendChild(makeField('ajax-opt', { label: 'AJAX with options', options: '"toolbar": ["bold"]' }));
		await waitFor(function() { return editorOf('ta-ajax-opt'); }, 'ta-ajax-opt to get an editor');
		eq(toolbarButtons('fx-ajax-opt'), 1, 'toolbar buttons on the injected field');
	});

	// ====================================================================
	// Change tracking
	// ====================================================================

	describe('Change tracking');

	it('does not mark a field changed just for existing', function() {
		// If building an editor marked the field dirty, every page edit would
		// warn on navigate-away and the signal would be worthless.
		var wrap = document.getElementById('fx-dirty');
		ok(!wrap.classList.contains('InputfieldStateChanged'), 'fx-dirty should be clean before editing');
		eq(PWStub.unsavedChanges().indexOf('fx-dirty'), -1, 'fx-dirty should not be listed as unsaved');
	});

	it('marks the field changed when the editor is typed in', async function() {
		var editor = editorOf('ta-dirty');
		editor.codemirror.setValue('Start. Now edited.');
		await waitFor(function() {
			return document.getElementById('fx-dirty').classList.contains('InputfieldStateChanged');
		}, 'fx-dirty to be marked InputfieldStateChanged');
	});

	it('syncs the edited value back to the textarea', function() {
		eq(document.getElementById('ta-dirty').value, 'Start. Now edited.', 'textarea value after edit');
	});

	it('surfaces the field in the unsaved-changes confirmation', function() {
		// The user-visible payoff: core would now name this field before letting
		// you navigate away. Before the bridge existed, the list was empty.
		ok(PWStub.unsavedChanges().indexOf('fx-dirty') !== -1,
			'fx-dirty should appear in ' + JSON.stringify(PWStub.unsavedChanges()));
	});

	// ====================================================================
	// Fullscreen and stacking contexts
	// ====================================================================

	describe('Fullscreen');

	it('flags the body and every Inputfield ancestor while fullscreen is open', async function() {
		var editor = editorOf('ta-fullscreen');
		editor.toggleFullScreen();
		await frame();

		ok(document.body.classList.contains('simplemde-fullscreen'), 'body.simplemde-fullscreen');
		ok(document.getElementById('fx-rep-fullscreen').classList.contains('has-simplemde-fullscreen'),
			'the repeater item should be flagged');
		ok(document.getElementById('fx-repeater').classList.contains('has-simplemde-fullscreen'),
			'the repeater wrapper should be flagged');
	});

	it('lifts the editor above the admin masthead', async function() {
		// AdminThemeUikit's sticky masthead is z-index 980. The module used to
		// raise the editor to 12, which never cleared it.
		var wrapper = editorOf('ta-fullscreen').codemirror.getWrapperElement();
		var z = parseInt(getComputedStyle(wrapper).zIndex, 10);
		atLeast(z, 981, 'computed z-index of the fullscreen editor');

		var item = document.getElementById('fx-rep-fullscreen');
		atLeast(parseInt(getComputedStyle(item).zIndex, 10), 981,
			'computed z-index of the flagged repeater item');
	});

	it('removes every flag when fullscreen closes', async function() {
		// Left behind, these would reorder the admin permanently.
		editorOf('ta-fullscreen').toggleFullScreen();
		await frame();

		ok(!document.body.classList.contains('simplemde-fullscreen'), 'body flag should be gone');
		ok(!document.getElementById('fx-rep-fullscreen').classList.contains('has-simplemde-fullscreen'),
			'repeater item flag should be gone');
		ok(!document.getElementById('fx-repeater').classList.contains('has-simplemde-fullscreen'),
			'repeater wrapper flag should be gone');
		eq(getComputedStyle(document.getElementById('fx-rep-fullscreen')).zIndex, 'auto',
			'repeater item z-index should return to auto');
	});

	// ====================================================================
	// Editor height
	// ====================================================================

	describe('Editor height');

	/** The scroller's starting height — what the field's Rows setting drives. */
	function startHeight(id) {
		var cm = editorOf(id).codemirror;
		return parseFloat(cm.getScrollerElement().style.minHeight) || 0;
	}

	function lineHeight(id) {
		return editorOf(id).codemirror.defaultTextHeight();
	}

	it('starts a field at the height its Rows setting asks for', async function() {
		// rows was rendered on the textarea and offered on every config screen,
		// but did nothing: the library set min-height 300px inline and the
		// module's CSS capped the same element at 300px, freezing every editor
		// at exactly 300 whatever the field asked for.
		document.getElementById('fx-rows-3').scrollIntoView();
		await sleep(300);

		var expected = 3 * lineHeight('ta-rows-3');
        var actual = startHeight('ta-rows-3');
		ok(Math.abs(actual - expected) <= 2,
			'rows=3 should start at about ' + Math.round(expected) + 'px, got ' + actual + 'px');
	});

	it('scales with the number of rows', async function() {
		document.getElementById('fx-rows-10').scrollIntoView();
		await sleep(300);

		var three = startHeight('ta-rows-3');
		var ten = startHeight('ta-rows-10');
		ok(ten > three, 'rows=10 (' + ten + 'px) should be taller than rows=3 (' + three + 'px)');

		var ratio = ten / three;
		ok(ratio > 3.0 && ratio < 3.7,
			'rows=10 should be about 10/3 the height of rows=3, ratio was ' + ratio.toFixed(2));
	});

	it('does not clip a field configured taller than the growth cap', async function() {
		// rows=25 asks for more than the 300px cap. Without raising the cap the
		// field would render shorter than it was configured for — min-height
		// beats max-height on the scroller, but the wrapper would still clip.
		document.getElementById('fx-rows-25').scrollIntoView();
		await sleep(300);

		var start = startHeight('ta-rows-25');
		ok(start > 300, 'rows=25 should start past the default cap, got ' + start + 'px');

		var wrapper = editorOf('ta-rows-25').codemirror.getWrapperElement();
		var cap = parseFloat(getComputedStyle(wrapper).maxHeight);
		ok(cap >= start, 'the cap (' + cap + 'px) must clear the starting height (' + start + 'px)');
	});

	it('leaves the library default alone when no rows are set', function() {
		// Nothing to honor, so nothing is imposed.
		eq(startHeight('ta-rows-none'), 300, 'scroller min-height without a rows attribute');
	});

	it('keeps the growth cap for an ordinary field', function() {
		var wrapper = editorOf('ta-rows-3').codemirror.getWrapperElement();
		eq(Math.round(parseFloat(getComputedStyle(wrapper).maxHeight)), 300,
			'a small field should still stop growing at the default cap');
	});

	// ====================================================================
	// Heading scale
	// ====================================================================

	describe('Heading scale');

	/** A heading's size as a multiple of the editor's own body text. */
	function headingRatio(textareaId, selector) {
		var wrapper = editorOf(textareaId).codemirror.getWrapperElement();
		var header = wrapper.querySelector(selector);
		if(!header) return null;
		var base = parseFloat(getComputedStyle(wrapper.querySelector('.CodeMirror-line')).fontSize);
		return parseFloat(getComputedStyle(header).fontSize) / base;
	}

	it('scales a Field Descriptions Extended divider modestly, not enormously', async function() {
		// FDE separates the halves of a description with a line of dashes, which
		// by the CommonMark spec makes the line above it a setext heading. That
		// is correct and unchanged — SimpleMDE simply never styled headings, so
		// upgrading to EasyMDE's calc(1.325rem + 0.9vw) made the first line of
		// every extended description balloon to ~2.5x.
		var editor = editorOf('ta-visible');
		editor.codemirror.setValue('Visible part of the description.\n-----\nHidden extended part.');
		document.getElementById('fx-visible').scrollIntoView();
		await sleep(300);

		var ratio = headingRatio('ta-visible', '.cm-header-2');
		ok(ratio !== null, 'the divider should still be parsed as a heading');
		ok(ratio > 1.25 && ratio < 1.55,
			'h2 should be about 1.4x body text, got ' + (ratio ? ratio.toFixed(2) : ratio) + 'x');
	});

	it('keeps a real heading visibly larger', async function() {
		// The other half of the bargain: headings must still read as headings.
		var editor = editorOf('ta-opt-nested');
		editor.codemirror.setValue('# A real heading\n\nBody text.');
		document.getElementById('fx-opt-nested').scrollIntoView();
		await sleep(300);

		var ratio = headingRatio('ta-opt-nested', '.cm-header-1');
		ok(ratio !== null, 'the ATX heading should be parsed as cm-header-1');
		ok(ratio > 1.45 && ratio < 1.75,
			'h1 should be about 1.6x body text, got ' + (ratio ? ratio.toFixed(2) : ratio) + 'x');
	});

	it('does not use EasyMDE\'s viewport-relative sizing', async function() {
		// calc(1.375rem + 1.5vw) measures ~2.5x at this window and grows with it.
		// Anything at or above 2x means the vw-based rules are winning again.
		var h1 = headingRatio('ta-opt-nested', '.cm-header-1');
		ok(h1 < 2, 'h1 should be well under 2x body text, got ' + (h1 ? h1.toFixed(2) : h1) + 'x');
	});

	it('still marks headings bold, as SimpleMDE did', function() {
		var wrapper = editorOf('ta-visible').codemirror.getWrapperElement();
		var weight = getComputedStyle(wrapper.querySelector('.cm-header')).fontWeight;
		ok(parseInt(weight, 10) >= 600, 'heading font-weight should still be bold, got ' + weight);
	});

	// ====================================================================
	// Observer behavior
	// ====================================================================

	describe('Observer behavior');

	it('does not rescan the document while you type', async function() {
		// CodeMirror rewrites its own line elements on every keystroke. Without
		// the filter this was a full document scan per character.
		var editor = editorOf('ta-visible');
		var before = InputfieldSimpleMDE.report().flushed;

		for(var i = 0; i < 25; i++) {
			editor.codemirror.replaceSelection('x');
		}
		await frame();
		await frame();

		var after = InputfieldSimpleMDE.report().flushed;
		eq(after - before, 0, '25 keystrokes should cause 0 document scans, but caused ' + (after - before));
	});

	it('still rescans when unrelated markup appears', async function() {
		// The filter must not be so broad that it stops noticing real changes.
		var before = InputfieldSimpleMDE.report().flushed;
		var probe = document.createElement('div');
		probe.id = 'probe-unrelated';
		document.getElementById('fx-ajax-target').appendChild(probe);
		await frame();
		await frame();
		atLeast(InputfieldSimpleMDE.report().flushed - before, 1, 'scans after unrelated DOM change');
		probe.parentNode.removeChild(probe);
	});

	it('keeps the editor alive when a repeater item is detached and reinserted', async function() {
		// jQuery UI sortable moves an item by detaching and reinserting it. An
		// eager cleanup would destroy the editor mid-drag.
		var item = document.getElementById('fx-rep-sort');
		var parent = item.parentNode;
		var before = editorOf('ta-sort');
		var builtBefore = InputfieldSimpleMDE.report().built;
		var trackedBefore = InputfieldSimpleMDE.report().tracked;
		ok(before, 'ta-sort should have an editor to begin with');

		parent.removeChild(item);
		parent.appendChild(item); // same tick, as a sort does
		await frame();
		await frame();

		eq(editorOf('ta-sort'), before, 'the instance should survive the move');
		eq(InputfieldSimpleMDE.report().built, builtBefore, 'no editor should have been rebuilt');
		eq(containersIn('fx-rep-sort'), 1, 'editors inside fx-rep-sort');
		eq(InputfieldSimpleMDE.report().tracked, trackedBefore,
			'the moved editor should still be tracked, not released as if deleted');
	});

	it('still re-measures a repeater item that has been moved', async function() {
		// Releasing an editor during the detach half of a move would leave it
		// alive but no longer observed: it would survive the sort and then never
		// be measured again. Only re-measuring proves it is still watched.
		await makeUnmeasured('fx-rep-sort', 'ta-sort', MANY_LINES);
		await revealAndScrollTo('fx-rep-sort', 'ta-sort');
		atLeast(sizerOf('ta-sort'), 80, 'sizer height after being moved, hidden and reshown');
	});

	it('re-adopts an editor moved across two ticks, not just within one', async function() {
		// A same-tick move is safe for free: a MutationObserver callback runs
		// after the whole tick, so the item is already back. A move split across
		// ticks is the case that bites — the editor gets released while
		// detached, and without re-adoption it would survive but never be
		// measured again.
		var item = document.getElementById('fx-rep-sort');
		var parent = item.parentNode;
		var before = editorOf('ta-sort');
		var trackedBefore = InputfieldSimpleMDE.report().tracked;

		parent.removeChild(item);
		// Wait for the release to actually happen, otherwise this test would
		// silently degrade into the same-tick case it is meant to be distinct
		// from.
		await waitFor(function() { return InputfieldSimpleMDE.report().tracked < trackedBefore; },
			'the detached field to be released before it is put back');

		parent.appendChild(item);
		await frame();
		await frame();

		eq(editorOf('ta-sort'), before, 'the instance should still be the same one');
		eq(containersIn('fx-rep-sort'), 1, 'editors inside fx-rep-sort');

		// Assert the mechanism, not only its consequence. Measurement can
		// recover by luck — CodeMirror sometimes still has usable metrics — but
		// being observed again is the thing that has to be true.
		ok(document.getElementById('ta-sort').simplemdeWatched,
			'the reattached editor should be observed again');
		eq(InputfieldSimpleMDE.report().tracked, trackedBefore,
			'the reattached editor should be tracked again');

		// The real proof it is watched again: put it back into an unmeasured
		// state and check something still measures it.
		await makeUnmeasured('fx-rep-sort', 'ta-sort', MANY_LINES);
		await revealAndScrollTo('fx-rep-sort', 'ta-sort');
		atLeast(sizerOf('ta-sort'), 80, 'sizer after a cross-tick move');
	});

	it('releases an editor whose field is genuinely removed', async function() {
		var item = document.getElementById('fx-rep-remove');
		var before = InputfieldSimpleMDE.report().tracked;
		ok(editorOf('ta-remove'), 'ta-remove should have an editor to begin with');

		item.parentNode.removeChild(item);
		await waitFor(function() { return InputfieldSimpleMDE.report().tracked < before; },
			'the removed field to be released');
	});

	// ====================================================================
	// Health
	// ====================================================================

	describe('Health');

	it('built an editor for every marker textarea on the page', function() {
		var r = InputfieldSimpleMDE.report();
		eq(r.withoutEditor, 0, 'textareas left without an editor');
		eq(r.textareasFound, r.withEditor, 'textareasFound vs withEditor');
	});

	it('never reaches out to a third-party CDN', function() {
		// Left to itself the library appends a <link> to
		// maxcdn.bootstrapcdn.com for FontAwesome, once per editor, on every
		// page — it only recognizes FontAwesome served from that exact host, so
		// the admin's own local copy never satisfies the check. An outbound
		// request from a client site's admin to a host nobody chose.
		var links = document.querySelectorAll('link[href*="bootstrapcdn"], link[href*="maxcdn"]');
		eq(links.length, 0, 'CDN stylesheets appended by the editor');
	});

	it('recorded no build failures', function() {
		eq(InputfieldSimpleMDE.report().failed, 0, 'report().failed');
	});

	it('created exactly one editor per marker textarea', function() {
		var r = InputfieldSimpleMDE.report();
		// .CodeMirror instances include the alias probe's, which was removed, and
		// any editor built by another module — so compare containers to textareas
		// within the fixtures form only.
		var form = document.querySelector('.InputfieldForm');
		eq(form.querySelectorAll('.EasyMDEContainer').length,
		   form.querySelectorAll('.InputfieldSimpleMDEField').length,
		   'containers vs marker textareas inside the form');
	});

	// ------------------------------------------------------------------ go

	function go() {
		run().catch(crashed);
	}

	if(document.readyState === 'complete') {
		setTimeout(go, 100);
	} else {
		window.addEventListener('load', function() { setTimeout(go, 100); });
	}
}());
