/**
 * Init for Processwire
 * These items could be added if fullscreen or sidebyside would work on PW
 * Note that fullscreen mode is not working right on Reno theme
 */
var initSimpleMDE = function() {
	var thisID = $(this).attr('id');
	var visible = $(this).is(":visible");

	if(visible && $(this).data('simplemde-made') !== 'true') {
		$(this).attr('data-simpleMDE-made', 'true');
		var simplemde = new SimpleMDE({
			element: document.getElementById(thisID),
			toolbar: ["bold", "italic", "heading", "|",
					  "quote", "unordered-list", "ordered-list", "|",
					  "link", "image", "|",
					  "preview", "side-by-side", "fullscreen", "|",
					  "table", "horizontal-rule", "code", "|",
					  "guide"
					  ],
			spellChecker: false,
			promptURLs: true,
		});
	}
}

/**
 * Init the field on page load
 */
$(window).load(function(){
	$('.InputfieldSimpleMDEField').each(initSimpleMDE);
});

/**
 * Re-init for fields that are now visible due to:
 *     - opening a tab with a hidden field, making it visible
 *     - opening an accordion with a hidden field, making it visible
 *     - opening a field that was closed
 */
$(document).on('wiretabclick reloaded opened', function() {
	$('.InputfieldSimpleMDEField').each(initSimpleMDE);
});


