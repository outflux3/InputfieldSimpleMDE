/**
 * Markdown Image Picker
 *
 * Swaps the Markdown editor's "insert image" button — which prompts for a URL —
 * for ProcessWire's own image selector, then writes a Markdown reference to
 * whatever variation it produces.
 *
 * The picker itself is entirely ProcessPageEditImageSelect, opened in a modal
 * iframe exactly as core's CKEditor and TinyMCE plugins do. This file only
 * decides WHEN to open it, WHICH page's images to show, and WHAT to insert.
 *
 * Because core's resize step writes a real variation file, the crop and size
 * the user chose are carried by the URL itself, so plain Markdown expresses
 * them with no width attributes or inline HTML:
 *
 *     ![description](/site/assets/files/1068/photo.400x0-is.jpg)
 */
(function() {
	'use strict';

	var ADMIN = ProcessWire.config.urls.admin;
	var PICKER_URL = ADMIN + 'page/image/';

	var LABELS = (ProcessWire.config.MarkdownImagePicker || {}).labels || {
		selectImage: 'Select Image',
		insertImage: 'Insert',
		selectAnother: 'Select another',
		cancel: 'Cancel',
		saving: 'Saving'
	};

	/**
	 * The picker must sit above a fullscreen editor.
	 *
	 * InputfieldSimpleMDE puts fullscreen at z-index 1000/1001 so it clears
	 * AdminThemeUikit's sticky masthead at 980. jQuery UI dialogs compute their
	 * own stacking and land at 100, so without this the picker opens UNDERNEATH
	 * a fullscreen editor — verified, not assumed. Core carries a commented-out
	 * version of the same workaround for CKEditor's maximized mode.
	 */
	var FULLSCREEN_DIALOG_Z = 1100;

	function liftAboveFullscreen() {
		if(!document.querySelector('.CodeMirror-fullscreen')) return;
		jQuery('.ui-dialog').css('z-index', FULLSCREEN_DIALOG_Z);
		jQuery('.ui-widget-overlay').css('z-index', FULLSCREEN_DIALOG_Z - 1);
	}

	/**
	 * Which page's images should the picker show?
	 *
	 * Ported from core's pwimage plugin rather than reinvented: a Markdown field
	 * inside a repeater belongs to the repeater item's own page, but only when
	 * that item actually holds an image field to browse. Otherwise the images
	 * live on the page being edited.
	 *
	 * Returning 0 means there is no page context at all — a Markdown field on a
	 * module config screen, say — and the picker cannot be offered there.
	 */
	function resolvePageId(el) {
		var $inputfield = jQuery(el).closest('.Inputfield');
		var $repeaterItem = $inputfield.closest('.InputfieldRepeaterItem');

		if($repeaterItem.length && $repeaterItem.find('.InputfieldImage').length) {
			var dataPage = $repeaterItem.attr('data-page');
			if(typeof dataPage !== 'undefined' && parseInt(dataPage, 10)) return parseInt(dataPage, 10);
		}

		var $id = jQuery('#Inputfield_id');
		if($id.length && parseInt($id.val(), 10)) return parseInt($id.val(), 10);

		var pid = $inputfield.attr('data-pid');
		return pid ? parseInt(pid, 10) : 0;
	}

	/** The page being edited, which is not always the page holding the images. */
	function editPageId() {
		var $id = jQuery('#Inputfield_id');
		return $id.length ? parseInt($id.val(), 10) : 0;
	}

	function version(pageId) {
		var v = ProcessWire.config.PagesVersions;
		return (v && v.page == pageId) ? v.version : 0;
	}

	/**
	 * Turn the picker's selection into Markdown.
	 *
	 * Only what Markdown can actually express. Size and crop already travel in
	 * the variation URL. Caption, class and alignment have no Markdown syntax
	 * and are deliberately dropped rather than smuggled in as inline HTML.
	 */
	function toMarkdown(src, doc) {
		var descriptionEl = doc.getElementById('selected_image_description');
		var alt = descriptionEl ? (descriptionEl.value || '') : '';
		var markdown = '![' + alt.replace(/([\[\]])/g, '\\$1') + '](' + src + ')';

		var linkEl = doc.getElementById('selected_image_link');
		if(linkEl && linkEl.checked && linkEl.value) {
			markdown = '[' + markdown + '](' + linkEl.value + ')';
		}

		return markdown;
	}

	/**
	 * Ask core to produce the variation, then insert a reference to it.
	 *
	 * The resize request is what turns the on-screen selection into a real file
	 * on disk; its response carries the variation's URL in #selected_image.
	 */
	function insertSelected(cm, $iframe) {
		var doc = $iframe[0].contentDocument;
		var img = doc.getElementById('selected_image');
		if(!img) return;

		var src = img.getAttribute('src');
		var width = img.getAttribute('width') || img.width;
		var height = img.getAttribute('height') || img.height;
		var imagePageId = doc.getElementById('page_id').value;
		var hidpiEl = doc.getElementById('selected_image_hidpi');
		var hidpi = (hidpiEl && hidpiEl.checked && !hidpiEl.disabled) ? 1 : 0;
		var rotateEl = doc.getElementById('selected_image_rotate');
		var rotate = rotateEl ? parseInt(rotateEl.value, 10) : 0;
		var file = src.substring(src.lastIndexOf('/') + 1);

		$iframe.dialog('disable');
		$iframe.setTitle(LABELS.saving);

		var url = PICKER_URL + 'resize?id=' + imagePageId +
			'&file=' + encodeURIComponent(file) +
			'&width=' + width + '&height=' + height +
			'&hidpi=' + hidpi + '&version=' + version(imagePageId);

		if(rotate) url += '&rotate=' + rotate;
		if(img.className.indexOf('flip_horizontal') > -1) url += '&flip=h';
		else if(img.className.indexOf('flip_vertical') > -1) url += '&flip=v';

		jQuery.get(url, function(data) {
			var variation = jQuery('<div></div>').html(data).find('#selected_image').attr('src');
			if(variation) {
				cm.replaceSelection(toMarkdown(variation, doc));
				cm.focus();
			}
			$iframe.dialog('close');
		}).fail(function() {
			$iframe.dialog('enable');
			$iframe.setTitle(LABELS.selectImage);
			if(window.console) console.error('MarkdownImagePicker: resize request failed', url);
		});
	}

	/**
	 * Build the dialog's buttons each time the iframe navigates.
	 *
	 * The picker is a multi-step screen inside one iframe: a browser first, then
	 * an editor for the chosen image. Which buttons belong depends on which of
	 * those is showing, which is why this runs on every load rather than once.
	 */
	function onIframeLoad(cm, $iframe, pageId) {
		var doc = $iframe[0].contentDocument;
		var buttons = [];

		if(doc.getElementById('selected_image')) {
			buttons.push({
				html: "<i class='fa fa-camera'></i> " + LABELS.insertImage,
				click: function() { insertSelected(cm, $iframe); }
			});
			buttons.push({
				html: "<i class='fa fa-folder-open'></i> " + LABELS.selectAnother,
				'class': 'ui-priority-secondary',
				click: function() {
					var id = doc.getElementById('page_id').value;
					$iframe.attr('src', PICKER_URL + '?id=' + id + '&modal=1&version=' + version(id));
					$iframe.setButtons({});
				}
			});
		} else {
			// The image browser, or one of core's own sub-screens: surface its
			// buttons rather than guessing what they should be.
			jQuery('button.pw-modal-button, button[type=submit]:visible', jQuery(doc)).each(function() {
				var $button = jQuery(this);
				buttons.push({ html: $button.html(), click: function() { $button.trigger('click'); } });
				if(!$button.hasClass('pw-modal-button-visible')) $button.hide();
			});
		}

		buttons.push({
			html: "<i class='fa fa-times-circle'></i> " + LABELS.cancel,
			'class': 'ui-priority-secondary',
			click: function() { $iframe.dialog('close'); }
		});

		$iframe.setButtons(buttons);
		liftAboveFullscreen();

		var title = doc.title;
		if(title && title.length) $iframe.setTitle(title);
	}

	function openPicker(cm, el) {
		var pageId = resolvePageId(el);
		if(!pageId) return; // nothing to browse; the button should not have existed

		var url = PICKER_URL +
			'?id=' + pageId +
			'&edit_page_id=' + editPageId() +
			'&modal=1' +
			'&version=' + version(pageId) +
			'&winwidth=' + (jQuery(window).width() - 30);

		var $iframe = pwModalWindow(url, {
			title: "<i class='fa fa-fw fa-folder-open'></i> " + LABELS.selectImage,
			open: liftAboveFullscreen
		}, 'large');

		$iframe.on('load', function() { onIframeLoad(cm, $iframe, pageId); });
	}

	/**
	 * Take over the editor's image button.
	 *
	 * Cloned rather than rebound: cloneNode drops the library's own listener
	 * while keeping the icon and the button's place in the toolbar, so the
	 * toolbar looks untouched and behaves differently.
	 */
	function attach(mde, el) {
		if(el.markdownImagePicker) return;

		var cm = mde.codemirror;
		if(!resolvePageId(el)) return; // no page context: leave the stock button alone

		var toolbar = mde.gui && mde.gui.toolbar ? mde.gui.toolbar : mde.toolbar_div;
		if(!toolbar) return;

		var existing = toolbar.querySelector('button.image');
		var button;

		if(existing) {
			button = existing.cloneNode(true);
			existing.parentNode.replaceChild(button, existing);
		} else {
			// Field configured without an image button: don't add one it didn't ask for.
			return;
		}

		button.title = LABELS.selectImage;
		button.addEventListener('click', function(e) {
			e.preventDefault();
			openPicker(cm, el);
		});

		// The keyboard shortcut lives in CodeMirror's keymap, not on the button,
		// so replacing the button alone would leave Cmd-Alt-I opening the old
		// URL prompt — two behaviours for one action.
		var keymap = {};
		keymap[/Mac/.test(navigator.platform) ? 'Cmd-Alt-I' : 'Ctrl-Alt-I'] = function() {
			openPicker(cm, el);
		};
		cm.addKeyMap(keymap);

		el.markdownImagePicker = true;
	}

	function enhance(instance, element) {
		try {
			attach(instance, element);
		} catch(e) {
			// One broken field must not take down the others.
			if(window.console) console.error('MarkdownImagePicker: could not attach', element, e);
		}
	}

	// Editors built from now on...
	document.addEventListener('simplemde:built', function(e) {
		enhance(e.detail.instance, e.detail.element);
	});

	// ...and those that already existed when this script ran. Both are needed:
	// page-load editors are built during InputfieldSimpleMDE's own start-up,
	// which is before this listener could have been registered.
	function catchUp() {
		if(typeof InputfieldSimpleMDE === 'undefined' || !InputfieldSimpleMDE.editors) return;
		InputfieldSimpleMDE.editors().forEach(function(ed) { enhance(ed.instance, ed.element); });
	}

	if(document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', catchUp);
	} else {
		catchUp();
	}

	window.MarkdownImagePicker = {
		open: openPicker,
		resolvePageId: resolvePageId,
		toMarkdown: toMarkdown
	};
}());
