/* SENTINEL_RED — a permanent NEGATIVE control. It MUST fail, and it must be
 * REPORTED (named in the red roster with its exit code) while NEVER changing the
 * gate's exit code. Both directions are asserted by the runner: if it stops being
 * listed the negative control is silently dead; if it starts counting the gate is
 * welded shut. It is excluded by DECLARATION (deferrals.json.sentinels), not by a
 * name convention — a convention is how `known_bad` became a hole. */
console.log('SENTINEL_RED: this suite exists to fail on purpose');
process.exit(1);
