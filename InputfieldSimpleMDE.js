/**
 * EasyMDE init for ProcessWire — no jQuery dependency, no event guessing.
 *
 * WHY NOT jQUERY / PW EVENTS
 * The original version bound to 'reloaded opened repeateradd wiretabclick
 * tabsactivate' and hoped one of them fired at the right moment. Inside a
 * repeater that is a bet on ProcessWire's internals: which event, on which
 * element, before or after the markup lands. A MutationObserver asks a simpler
 * question the DOM can always answer — "has a textarea I care about appeared?"
 * — so an AJAX-loaded repeater item, a cloned item, a re-sorted one and a
 * plain page load are all the same case, and no PW event name is depended on.
 *
 * TWO THINGS CODEMIRROR NEEDS
 * 1. It can be BUILT inside a hidden container, but not MEASURED there — it
 *    comes out zero-height. So build regardless of visibility and refresh()
 *    once it is on screen. That is what "it works after I open and close the
 *    field" was: an accidental refresh.
 * 2. Building twice on one textarea gives two editors. The instance is stored
 *    on the element itself, so the guard cannot be defeated by type coercion —
 *    the old one compared .data() against the string 'true' and .data() had
 *    already converted it to a boolean, so it never held.
 *
 * Diagnosing: window.InputfieldSimpleMDE.report() in the console.
 */
(function() {
	'use strict';

	var SELECTOR = '.InputfieldSimpleMDEField';

	/**
	 * Stock configuration. Deliberately the same three options the SimpleMDE
	 * version used, so the editor behaves as it always has.
	 */
	var DEFAULTS = {
		toolbar: ["bold", "italic", "heading", "|",
				  "quote", "unordered-list", "ordered-list", "|",
				  "link", "image", "|",
				  "preview", "side-by-side", "fullscreen", "|",
				  "table", "horizontal-rule", "code", "|",
				  "guide"],
		spellChecker: false,
		promptURLs: true
	};

	var CHANGE_DELAY = 250; // debounce for the ProcessWire dirty-state ping

	var built = 0, refreshed = 0, failed = 0, flushed = 0;
	var seen = null;     // IntersectionObserver, when supported
	var queued = false;  // rAF scheduled
	var tracked = [];    // textareas holding a live editor, for cleanup

	function isBuilt(el) {
		return !!el.simplemdeInstance;
	}

	function libraryReady() {
		return typeof EasyMDE !== 'undefined';
	}

	/**
	 * Compatibility alias.
	 *
	 * EasyMDE is a drop-in for SimpleMDE's constructor, and other modules call
	 * `new SimpleMDE(...)` against the library this module loads — Field
	 * Descriptions Extended does exactly that in simplemde_init.js. Swapping the
	 * vendor library without this would break them with no warning.
	 *
	 * Called at script-evaluation time, which beats any DOM-ready or window-load
	 * handler those modules use, and again from start() to cover a vendor script
	 * that arrives late.
	 */
	function alias() {
		if(typeof window.SimpleMDE === 'undefined' && libraryReady()) {
			window.SimpleMDE = window.EasyMDE;
		}
	}

	alias();

	/**
	 * Build the option set for one textarea.
	 */
	function optionsFor(el) {
		var options = {}, key;
		for(key in DEFAULTS) if(DEFAULTS.hasOwnProperty(key)) options[key] = DEFAULTS[key];
		options.element = el;
		return options;
	}

	/**
	 * Fullscreen has to escape the admin's stacking contexts.
	 *
	 * CSS alone cannot do it: a fixed-position editor is still trapped inside a
	 * positioned ancestor, and a repeater item is one. So flag the ancestors at
	 * toggle time and let InputfieldSimpleMDE.css lift them.
	 *
	 * Wrapped rather than assigned, so a field that configures its own
	 * onToggleFullScreen keeps it.
	 */
	function withFullscreenFix(options, el) {
		var theirs = typeof options.onToggleFullScreen === 'function' ? options.onToggleFullScreen : null;

		options.onToggleFullScreen = function(isFullscreen) {
			document.body.classList.toggle('simplemde-fullscreen', isFullscreen);
			var ancestor = el.closest ? el.closest('.InputfieldRepeaterItem, .InputfieldRepeater, .Inputfield') : null;
			while(ancestor) {
				ancestor.classList.toggle('has-simplemde-fullscreen', isFullscreen);
				ancestor = ancestor.parentElement && ancestor.parentElement.closest
					? ancestor.parentElement.closest('.InputfieldRepeaterItem, .InputfieldRepeater, .Inputfield')
					: null;
			}
			if(theirs) theirs.call(this, isFullscreen);
		};

		return options;
	}

	/**
	 * Tell ProcessWire the field is dirty.
	 *
	 * Without this the editor is invisible to core: inputfields.js watches for a
	 * native 'change' on '.InputfieldForm :input' to add InputfieldStateChanged,
	 * and InputfieldFormBeforeUnloadEvent() reads that class for the "unsaved
	 * changes" confirmation. Typing only in the editor meant navigating away
	 * with no warning at all.
	 *
	 * Debounced rather than fired once, so anything else listening on the
	 * textarea keeps hearing about later edits too. codemirror.save() first, so
	 * the textarea genuinely holds the value the event is announcing.
	 */
	function bridgeChanges(el, instance) {
		var timer = null;

		instance.codemirror.on('change', function() {
			if(timer) clearTimeout(timer);
			timer = setTimeout(function() {
				timer = null;
				instance.codemirror.save();
				if(window.jQuery) {
					jQuery(el).trigger('change');
				} else if(typeof Event === 'function') {
					el.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}, CHANGE_DELAY);
		});
	}

	function build(el) {
		if(isBuilt(el)) return el.simplemdeInstance;
		if(!libraryReady()) { failed++; return null; }

		var instance;
		try {
			instance = new EasyMDE(withFullscreenFix(optionsFor(el), el));
		} catch(e) {
			failed++;
			if(window.console) console.error('InputfieldSimpleMDE: build failed', el, e);
			return null;
		}

		// On the element, not in a data-attribute: nothing to stringify and
		// nothing for a .data() cache to coerce.
		el.simplemdeInstance = instance;
		tracked.push(el);
		built++;

		bridgeChanges(el, instance);

		// Built hidden means measured hidden. Watch for it coming on screen.
		instance.codemirror.refresh();
		watch(el);

		return instance;
	}

	/**
	 * Re-measure when the editor first becomes visible. Covers a collapsed
	 * field, a closed repeater item and an unopened language tab without
	 * knowing which of them it was.
	 */
	function watch(el) {
		if(!('IntersectionObserver' in window)) return;
		var wrap = el.simplemdeInstance.codemirror.getWrapperElement();
		if(!wrap) return;
		if(!seen) {
			seen = new IntersectionObserver(function(entries) {
				for(var i = 0; i < entries.length; i++) {
					if(!entries[i].isIntersecting) continue;
					var cm = entries[i].target.CodeMirror;
					if(cm) { cm.refresh(); refreshed++; }
				}
			});
		}
		seen.observe(wrap);
	}

	/**
	 * Build any editor that does not exist yet. Never refreshes: measurement is
	 * the IntersectionObserver's job, and refreshing every editor on every DOM
	 * change would be a relayout per mutation.
	 */
	function scan(root) {
		var nodes = (root || document).querySelectorAll(SELECTOR);
		for(var i = 0; i < nodes.length; i++) {
			if(!isBuilt(nodes[i])) build(nodes[i]);
		}
		return nodes.length;
	}

	/**
	 * Release editors whose textarea has genuinely left the document, so the
	 * IntersectionObserver stops holding detached nodes.
	 *
	 * Deferred to the rAF flush on purpose: sorting a repeater detaches and
	 * reinserts an item within the same tick, and destroying an editor
	 * mid-drag would be worse than the leak.
	 */
	function collect() {
		for(var i = tracked.length - 1; i >= 0; i--) {
			var el = tracked[i];
			if(document.contains(el)) continue;
			if(seen && el.simplemdeInstance) {
				var wrap = el.simplemdeInstance.codemirror.getWrapperElement();
				if(wrap) seen.unobserve(wrap);
			}
			tracked.splice(i, 1);
		}
	}

	function flush() {
		queued = false;
		flushed++;
		scan(document);
		collect();
	}

	function schedule() {
		if(queued) return;
		queued = true;
		if(window.requestAnimationFrame) requestAnimationFrame(flush);
		else setTimeout(flush, 16);
	}

	/**
	 * True for mutations CodeMirror makes to its own innards. Every keystroke
	 * rewrites line elements, so without this filter typing in one editor would
	 * re-run a document scan on every character.
	 */
	function selfInflicted(node) {
		if(!node || node.nodeType !== 1 || !node.closest) return false;
		return !!node.closest('.EasyMDEContainer, .CodeMirror, .editor-toolbar, .editor-preview');
	}

	function start() {
		alias();
		scan(document);

		if(!('MutationObserver' in window)) return;

		// Anything added later: an AJAX-loaded repeater item, a newly added or
		// cloned one, a field revealed by a dependency.
		new MutationObserver(function(mutations) {
			for(var m = 0; m < mutations.length; m++) {
				if(selfInflicted(mutations[m].target)) continue;
				if(!mutations[m].addedNodes.length && !mutations[m].removedNodes.length) continue;
				schedule();
				return;
			}
		}).observe(document.documentElement, { childList: true, subtree: true });
	}

	/**
	 * The module loads easymde.min.js immediately before this file, so the
	 * library is normally present already. The retry is for the case where
	 * something reorders or defers the vendor script — better a late editor
	 * than none.
	 */
	function startWhenReady() {
		if(libraryReady()) { start(); return; }
		var tries = 0;
		var poll = setInterval(function() {
			if(libraryReady()) {
				clearInterval(poll);
				failed = 0; // the earlier misses were this, not real failures
				start();
			} else if(++tries > 40) { // ~10s
				clearInterval(poll);
				if(window.console) console.error('InputfieldSimpleMDE: EasyMDE library never loaded');
			}
		}, 250);
	}

	if(document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', startWhenReady);
	} else {
		startWhenReady();
	}

	// Kept as a safety net where they do fire, and harmless where they do not:
	// every path is idempotent. This is belt-and-braces, not the mechanism.
	if(window.jQuery) {
		jQuery(document).on('reloaded opened repeateradd wiretabclick tabsactivate', function() {
			schedule();
		});
	}

	window.InputfieldSimpleMDE = {
		scan: function() { return scan(document); },
		instance: function(el) {
			if(typeof el === 'string') el = document.getElementById(el);
			return el ? el.simplemdeInstance || null : null;
		},
		report: function() {
			var all = document.querySelectorAll(SELECTOR);
			var withEditor = 0;
			for(var i = 0; i < all.length; i++) if(isBuilt(all[i])) withEditor++;
			return {
				libraryLoaded: libraryReady(),
				textareasFound: all.length,
				withEditor: withEditor,
				withoutEditor: all.length - withEditor,
				built: built,
				refreshed: refreshed,
				failed: failed,
				// A scan triggered by a DOM change. Should NOT climb while you
				// type — if it does, the CodeMirror mutation filter is leaking.
				flushed: flushed,
				tracked: tracked.length,
				editorsInDom: document.querySelectorAll('.CodeMirror').length
			};
		}
	};
}());
