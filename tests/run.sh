#!/usr/bin/env bash
#
# Run the InputfieldSimpleMDE test suites.
#
#   ./run.sh              both suites (browser + PHP)
#   ./run.sh --js         browser suite only
#   ./run.sh --php        PHP contract suite only
#   ./run.sh --open       open the browser suite in your own browser instead
#   ./run.sh --mutate     check that the suites can actually fail
#   ./run.sh -v           list passing tests too
#
# Exits non-zero if anything failed, so it can be used in a pre-push hook.
#
# Requirements: Chrome (or Chromium/Edge) and Python 3 for the browser suite;
# PHP and a working ProcessWire installation for the PHP suite. No npm, no pip.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS="$DIR/harness.html"

RUN_JS=1
RUN_PHP=1
VERBOSE=""

for arg in "$@"; do
	case "$arg" in
		--js)      RUN_PHP=0 ;;
		--php)     RUN_JS=0 ;;
		-v|--verbose) VERBOSE="--verbose" ;;
		--open)
			command -v open >/dev/null 2>&1 && open "$HARNESS" || xdg-open "$HARNESS"
			echo "Opened $HARNESS"
			echo "Results appear at the top of the page; the fixtures below stay interactive."
			exit 0
			;;
		--mutate)
			exec python3 "$DIR/mutate.py"
			;;
		-h|--help)
			sed -n '3,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
			exit 0
			;;
		*)
			echo "Unknown option: $arg (try --help)" >&2
			exit 2
			;;
	esac
done

STATUS=0

if [ "$RUN_JS" -eq 1 ]; then
	echo "── Browser suite ─────────────────────────────────────────────"
	python3 "$DIR/cdp.py" "file://$HARNESS" $VERBOSE || STATUS=1
	echo
fi

if [ "$RUN_PHP" -eq 1 ]; then
	echo "── PHP contract suite ────────────────────────────────────────"
	# ProcessWire in debug mode is chatty on stderr; the suite's own output is
	# on stdout and is what matters.
	"${PHP:-php}" "$DIR/php-contract.php" 2>/dev/null || STATUS=1
	echo
fi

if [ "$STATUS" -eq 0 ]; then
	echo "All suites passed."
else
	echo "Something failed — see above."
fi

exit "$STATUS"
