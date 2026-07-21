export function matchTimelineAnchors(expected: readonly number[], candidates: readonly number[]): number[] {
  if (expected.length === 0) return [];
  if (candidates.length < expected.length) return candidates.map((_, index) => index);
  const rows = expected.length + 1;
  const columns = candidates.length + 1;
  const costs = Array.from({ length: rows }, () => Array<number>(columns).fill(Number.POSITIVE_INFINITY));
  const matched = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false));
  for (let candidateIndex = 0; candidateIndex < columns; candidateIndex += 1) costs[0]![candidateIndex] = 0;
  for (let anchorIndex = 1; anchorIndex < rows; anchorIndex += 1) {
    for (let candidateIndex = 1; candidateIndex < columns; candidateIndex += 1) {
      costs[anchorIndex]![candidateIndex] = costs[anchorIndex]![candidateIndex - 1]!;
      const delta = candidates[candidateIndex - 1]! - expected[anchorIndex - 1]!;
      const matchCost = costs[anchorIndex - 1]![candidateIndex - 1]! + delta * delta;
      if (matchCost < costs[anchorIndex]![candidateIndex]!) {
        costs[anchorIndex]![candidateIndex] = matchCost;
        matched[anchorIndex]![candidateIndex] = true;
      }
    }
  }
  let anchorIndex = expected.length;
  let candidateIndex = candidates.length;
  const selected: number[] = [];
  while (anchorIndex > 0 && candidateIndex > 0) {
    if (matched[anchorIndex]![candidateIndex]) {
      selected.push(candidateIndex - 1);
      anchorIndex -= 1;
    }
    candidateIndex -= 1;
  }
  return selected.reverse();
}

export function matchNearestTimelineAnchors(expected: readonly number[], candidates: readonly number[]): number[] {
  const selected: number[] = [];
  let previousCandidate = -1;
  for (const expectedTime of expected) {
    let bestCandidate = -1;
    let bestError = Number.POSITIVE_INFINITY;
    for (let index = previousCandidate + 1; index < candidates.length; index += 1) {
      const error = Math.abs(candidates[index]! - expectedTime);
      if (error < bestError) { bestError = error; bestCandidate = index; }
    }
    if (bestCandidate < 0) break;
    selected.push(bestCandidate);
    previousCandidate = bestCandidate;
  }
  return selected;
}
