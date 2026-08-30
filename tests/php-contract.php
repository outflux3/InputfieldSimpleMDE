<?php
/**
 * The PHP half of the suite: the contract the browser side depends on.
 *
 * Everything in suite.js starts from markup ProcessWire rendered — a textarea
 * carrying .InputfieldSimpleMDEField and, when configured, data-mde-options. If
 * the module stops emitting those, the browser suite would go on passing
 * against fixtures that no longer resemble reality. This checks the real class
 * against a real ProcessWire.
 *
 * Read-only: the Inputfield is constructed directly and given the API, so
 * nothing is installed and nothing is written to the database.
 *
 *     php tests/php-contract.php
 */

error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);

$root = dirname(__DIR__, 4);
if(!is_file("$root/index.php")) {
	fwrite(STDERR, "Could not find a ProcessWire installation at $root\n");
	exit(2);
}

// index.php renders the site as a side effect of bootstrapping; discard it.
ob_start();
require "$root/index.php";
ob_end_clean();

// ---------------------------------------------------------------- harness

$passed = 0;
$failed = 0;
$failures = array();
$currentTest = '';

function test($name, callable $fn) {
	global $passed, $failed, $failures, $currentTest;
	$currentTest = $name;
	try {
		$fn();
		$passed++;
	} catch(\Throwable $e) {
		$failed++;
		$failures[] = array($name, $e->getMessage());
		echo "FAIL $name\n     " . str_replace("\n", "\n     ", $e->getMessage()) . "\n";
	}
}

function ok($condition, $message) {
	if(!$condition) throw new \Exception($message);
}

function eq($actual, $expected, $what) {
	if($actual !== $expected) {
		throw new \Exception($what . ': expected ' . var_export($expected, true)
			. ', got ' . var_export($actual, true));
	}
}

function contains($haystack, $needle, $what) {
	if(strpos($haystack, $needle) === false) {
		throw new \Exception($what . ': expected to find ' . var_export($needle, true)
			. ' in ' . var_export(substr($haystack, 0, 300), true));
	}
}

function missing($haystack, $needle, $what) {
	if(strpos($haystack, $needle) !== false) {
		throw new \Exception($what . ': did NOT expect to find ' . var_export($needle, true)
			. ' in ' . var_export(substr($haystack, 0, 300), true));
	}
}

/**
 * A fresh Inputfield wired to the running ProcessWire, without installing it.
 */
function makeField($options = null) {
	$wire = \ProcessWire\wire();
	$field = new \ProcessWire\InputfieldSimpleMDE();
	$wire->wire($field);
	$field->init();
	if($options !== null) $field->set('mde_options', $options);
	$field->attr('name', 'body');
	$field->attr('id', 'Inputfield_body');
	return $field;
}

$moduleDir = dirname(__DIR__);

// ------------------------------------------------------------------ tests

test('the module class loads under the ProcessWire namespace', function() {
	ok(class_exists('\\ProcessWire\\InputfieldSimpleMDE'),
		'\\ProcessWire\\InputfieldSimpleMDE should exist after bootstrap');
});

test('it is still an InputfieldTextarea', function() {
	// Changing the base class would silently change how values are stored.
	ok(makeField() instanceof \ProcessWire\InputfieldTextarea,
		'should extend InputfieldTextarea');
});

test('module info declares a version and its requirements', function() {
	$info = \ProcessWire\InputfieldSimpleMDE::getModuleInfo();
	ok(!empty($info['version']), 'version should be set');
	ok((int) $info['version'] >= 200, 'version should be at least 200, got ' . $info['version']);
	contains($info['requires'], 'ProcessWire>=3.0.0', 'requires');
	eq($info['autoload'], 'template=admin', 'autoload');
});

test('the marker class is always applied', function() {
	$attrs = makeField()->getAttributes();
	contains($attrs['class'], 'InputfieldSimpleMDEField', 'class attribute');
});

test('the marker class survives a size attribute', function() {
	// The old code only added the class when 'size' was empty — a guard copied
	// from InputfieldText. A stray size attribute disabled the editor entirely,
	// with no error anywhere.
	$field = makeField();
	$field->attr('size', 40);
	contains($field->getAttributes()['class'], 'InputfieldSimpleMDEField',
		'class attribute with size set');
});

test('the marker class survives other classes already present', function() {
	$field = makeField();
	$field->addClass('SomeOtherModuleClass');
	$attrs = $field->getAttributes();
	contains($attrs['class'], 'InputfieldSimpleMDEField', 'class attribute');
	contains($attrs['class'], 'SomeOtherModuleClass', 'pre-existing class should be kept');
});

test('the marker class is not duplicated across repeated calls', function() {
	// getAttributes() is called more than once per render.
	$field = makeField();
	$field->getAttributes();
	$field->getAttributes();
	$attrs = $field->getAttributes();
	eq(substr_count($attrs['class'], 'InputfieldSimpleMDEField'), 1,
		'occurrences of the marker class');
});

test('no options attribute when the field is not configured', function() {
	$attrs = makeField()->getAttributes();
	ok(!isset($attrs['data-mde-options']), 'data-mde-options should be absent when unconfigured');
});

test('configured options reach the element verbatim', function() {
	$json = '"toolbar": ["bold", "italic"]';
	$attrs = makeField($json)->getAttributes();
	eq($attrs['data-mde-options'], $json, 'data-mde-options');
});

test('options survive rendering, correctly escaped', function() {
	// The JSON is full of double quotes; if it were not escaped it would break
	// out of the attribute and mangle the markup.
	$out = makeField('"toolbar": ["bold"]')->render();
	contains($out, 'data-mde-options=', 'rendered markup');
	contains($out, '&quot;toolbar&quot;', 'rendered markup should carry escaped JSON');
	missing($out, 'data-mde-options=""toolbar', 'rendered markup should not contain raw quotes');
});

test('the options setting is never emitted as its own attribute', function() {
	// Stored with set() rather than setAttribute() precisely so this cannot
	// happen. An attribute would leak the config into the markup twice.
	$out = makeField('"toolbar": ["bold"]')->render();
	missing($out, 'mde_options=', 'rendered markup');
});

test('rendered markup carries the marker class', function() {
	contains(makeField()->render(), 'InputfieldSimpleMDEField', 'rendered markup');
});

test('the field configuration screen offers the options field', function() {
	$config = makeField()->getConfigInputfields();
	$found = false;
	foreach($config as $f) {
		if($f->attr('name') === 'mde_options') $found = true;
	}
	ok($found, 'getConfigInputfields() should include an mde_options field');
});

test('the options can be overridden per template context', function() {
	$allowed = makeField()->getConfigAllowContext(new \ProcessWire\Field());
	ok(in_array('mde_options', $allowed, true),
		'getConfigAllowContext() should include mde_options, got ' . implode(', ', $allowed));
});

test('init registers the EasyMDE library, not SimpleMDE', function() {
	$config = \ProcessWire\wire('config');
	makeField();
	$scripts = implode(' ', iterator_to_array($config->scripts));
	$styles = implode(' ', iterator_to_array($config->styles));
	contains($scripts, 'easymde/easymde.min.js', 'config->scripts');
	contains($styles, 'easymde/easymde.min.css', 'config->styles');
	missing($scripts, 'simplemde.min.js', 'config->scripts should no longer load SimpleMDE');
});

test('the asset URLs are cache-busted by the module version', function() {
	$info = \ProcessWire\InputfieldSimpleMDE::getModuleInfo();
	$scripts = implode(' ', iterator_to_array(\ProcessWire\wire('config')->scripts));
	contains($scripts, 'easymde.min.js?v=' . (int) $info['version'], 'config->scripts');
});

test('every file the module loads actually exists', function() use ($moduleDir) {
	// A broken path here is invisible until a browser 404s on it.
	foreach(array(
		'easymde/easymde.min.js',
		'easymde/easymde.min.css',
		'easymde/LICENSE',
		'InputfieldSimpleMDE.js',
		'InputfieldSimpleMDE.css',
		'LICENSE',
		'README.md',
	) as $file) {
		ok(is_file("$moduleDir/$file"), "$file should exist in the module directory");
		ok(filesize("$moduleDir/$file") > 0, "$file should not be empty");
	}
});

test('the bundled library is the EasyMDE build it claims to be', function() use ($moduleDir) {
	$head = file_get_contents("$moduleDir/easymde/easymde.min.js", false, null, 0, 200);
	contains($head, 'easymde v2.', 'the vendor bundle banner');
	contains($head, 'ionaru/easy-markdown-editor', 'the vendor bundle banner');
});

test('the old SimpleMDE library is gone', function() use ($moduleDir) {
	ok(!is_file("$moduleDir/simplemde.min.js"), 'simplemde.min.js should have been removed');
	ok(!is_file("$moduleDir/simplemde.min.css"), 'simplemde.min.css should have been removed');
});

test('maxlength still truncates on the way in', function() {
	$field = makeField();
	$field->attr('maxlength', 10);
	$field->attr('value', '0123456789abcdef');
	eq($field->attr('value'), '0123456789', 'truncated value');
});

test('a zero maxlength does not become maxlength="0"', function() {
	$field = makeField();
	$field->attr('maxlength', 0);
	missing($field->render(), 'maxlength="0"', 'rendered markup');
});

// ----------------------------------------------------------------- report

echo "\n";
echo 'RESULT ' . ($failed === 0 ? 'PASS' : 'FAIL')
	. ' total=' . ($passed + $failed) . ' passed=' . $passed . ' failed=' . $failed . "\n";

exit($failed === 0 ? 0 : 1);
