/* SENTINEL_HELD — the other half of the pair. What actually broke was HELD and
 * FAILED being conflated (a deferral flipped between exit 3 and exit 1), so this
 * sentinel always exits 3 and must be reported as held and NEVER appear in the red
 * roster. Paired with SENTINEL_RED it covers "the classification is correct". */
console.log('NEEDS-INPUT: SENTINEL_HELD exists to be unproven on purpose');
process.exit(3);
