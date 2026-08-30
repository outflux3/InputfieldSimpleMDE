/**
 * The parts of ProcessWire's admin JS the module actually interacts with.
 *
 * Only two things matter to InputfieldSimpleMDE, and both are reproduced here
 * verbatim in behaviour so the suite is testing the real contract rather than a
 * convenient approximation:
 *
 *   1. Change tracking. Core delegates a 'change' listener and stamps
 *      .InputfieldStateChanged on the enclosing .Inputfield. The navigate-away
 *      confirmation then reads that class. Copied from
 *      wire/templates-admin/scripts/inputfields.js (the handler at ~line 2779
 *      and InputfieldFormBeforeUnloadEvent at ~line 2494 in 3.0.270).
 *
 *   2. The events the module keeps as a safety net — 'reloaded', 'opened' and
 *      friends — which here are only ever fired by the suite.
 *
 * If a ProcessWire upgrade changes the selectors below, this stub is where the
 * suite will drift from reality. Re-check it against core before trusting a
 * green run after a PW major upgrade.
 */
(function($) {
	'use strict';

	// --- inputfields.js: confirm changed forms that user navigates away from ---
	$(document).on('change', '.InputfieldForm :input, .InputfieldForm .Inputfield', function() {
		var $this = $(this);
		if($this.hasClass('Inputfield')) {
			if($this.hasClass('InputfieldIgnoreChanges')) return false;
			$this.addClass('InputfieldStateChanged').trigger('changed');
			if($this.closest('.InputfieldFormConfirm').length > 0) return false;
		} else {
			if($this.hasClass('InputfieldIgnoreChanges') || $this.closest('.InputfieldIgnoreChanges').length) return false;
			$this.closest('.Inputfield').addClass('InputfieldStateChanged').trigger('changed');
		}
	});

	// --- inputfields.js: InputfieldFormBeforeUnloadEvent, reduced to its test ---
	window.PWStub = {
		/**
		 * The fields core would name in the "you have unsaved changes" prompt.
		 * Empty means navigating away would be silent.
		 */
		unsavedChanges: function() {
			var names = [];
			$('.InputfieldFormConfirm:not(.InputfieldFormSubmitted) .InputfieldStateChanged').each(function() {
				names.push($(this).attr('id') || $(this).find(':input').attr('name') || '?');
			});
			return names;
		}
	};

}(jQuery));
