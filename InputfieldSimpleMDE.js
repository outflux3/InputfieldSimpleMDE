/**
 * SimpleMDE init for ProcessWire — no jQuery, no event guessing.
 *
 * WHY NOT jQUERY / PW EVENTS
 * The previous version bound to 'reloaded opened repeateradd wiretabclick
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

	var TOOLBAR = ["bold", "italic", "heading", "|",
				   "quote", "unordered-list", "ordered-list", "|",
				   "link", "image", "|",
				   "preview", "side-by-side", "fullscreen", "|",
				   "table", "horizontal-rule", "code", "|",
				   "guide"];

	var built = 0, refreshed = 0, failed = 0;
	var seen = null; // IntersectionObserver, when supported

	function isBuilt(el) {
		return !!el.simplemdeInstance;
	}

	function build(el) {
		if(isBuilt(el)) return el.simplemdeInstance;
		if(typeof SimpleMDE === 'undefined') { failed++; return null; }

		var instance;
		try {
			instance = new SimpleMDE({
				element: el,
				toolbar: TOOLBAR,
				spellChecker: false,
				promptURLs: true
			});
		} catch(e) {
			failed++;
			if(window.console) console.error('InputfieldSimpleMDE: build failed', el, e);
			return null;
		}

		// On the element, not in a data-attribute: nothing to stringify and
		// nothing for a .data() cache to coerce.
		el.simplemdeInstance = instance;
		built++;

		// Built hidden means measured hidden. Watch for it coming on screen.
		instance.codemirror.refresh();
		watch(el);

		return instance;
	}

	function refresh(el) {
		if(!isBuilt(el)) return;
		el.simplemdeInstance.codemirror.refresh();
		refreshed++;
	}

	/**
	 * Re-measure when the editor first becomes visible. Covers a collapsed
	 * field, a closed repeater item and an unopened tab without knowing which
	 * of them it was.
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

	function scan(root) {
		var nodes = (root || document).querySelectorAll(SELECTOR);
		for(var i = 0; i < nodes.length; i++) {
			if(isBuilt(nodes[i])) refresh(nodes[i]); else build(nodes[i]);
		}
		return nodes.length;
	}

	function start() {
		scan(document);

		if(!('MutationObserver' in window)) return;

		// Anything added later: an AJAX-loaded repeater item, a newly added or
		// cloned one, a field revealed by a dependency.
		new MutationObserver(function(mutations) {
			for(var m = 0; m < mutations.length; m++) {
				var added = mutations[m].addedNodes;
				for(var a = 0; a < added.length; a++) {
					var node = added[a];
					if(node.nodeType !== 1) continue;
					if(node.matches && node.matches(SELECTOR)) build(node);
					else if(node.querySelectorAll) scan(node);
				}
			}
		}).observe(document.documentElement, { childList: true, subtree: true });
	}

	if(document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start);
	} else {
		start();
	}

	// Kept as a safety net where they do fire, and harmless where they do not:
	// every path is idempotent. This is belt-and-braces, not the mechanism.
	if(window.jQuery) {
		jQuery(document).on('reloaded opened repeateradd wiretabclick tabsactivate', function() {
			scan(document);
		});
	}

	window.InputfieldSimpleMDE = {
		scan: function() { return scan(document); },
		report: function() {
			var all = document.querySelectorAll(SELECTOR);
			var withEditor = 0;
			for(var i = 0; i < all.length; i++) if(isBuilt(all[i])) withEditor++;
			return {
				libraryLoaded: typeof SimpleMDE !== 'undefined',
				textareasFound: all.length,
				withEditor: withEditor,
				withoutEditor: all.length - withEditor,
				built: built,
				refreshed: refreshed,
				failed: failed,
				editorsInDom: document.querySelectorAll('.CodeMirror').length
			};
		}
	};
}());
