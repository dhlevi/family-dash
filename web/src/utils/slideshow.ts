/**
 * Laying two sources of pictures out in one rotation.
 *
 * Extracted from the screensaver so the ordering can be tested without
 * mounting a component that wants a clock, the weather and two API calls.
 */

/**
 * Alternates between two lists, carrying on with whichever is longer.
 *
 * Interleaved rather than concatenated or shuffled: "both" should actually
 * alternate, not show eleven photographs and then four maps. A shuffle would
 * average out to the same thing but can still deal out long runs of one kind,
 * which on a wall display reads as the other source being broken.
 */
export function interleave<A, B>(first: readonly A[], second: readonly B[]): (A | B)[] {
  const merged: (A | B)[] = []

  for (let index = 0; index < Math.max(first.length, second.length); index++) {
    if (index < first.length) merged.push(first[index]!)
    if (index < second.length) merged.push(second[index]!)
  }

  return merged
}
