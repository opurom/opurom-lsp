// TEXT-mode fuzzy matcher for completion candidates.
// Mirrors the analyzer's role classification, dynamic-programming score and
// poor-match rejection so filtering and ranking follow the same algorithm:
// word-head and case-aligned matches win, camel tails are penalized, and a
// subsequence must still cover the pattern in order.

const MAX_INPUT = 127;
const MAX_PATTERN = 63;
const MIN_SCORE = -10000;
const TYPES =
  '0000000000000000000000000000000010000000000000112222222222100000' +
  '0333333333333333333333333330000002222222222222222222222222200000';

const NONE = 0;
const SEPARATOR = 1;
const TAIL = 2;
const UC_TAIL = 3;
const HEAD = 4;

function charType(code) {
  return code < 128 ? TYPES.charCodeAt(code) - 48 : 2; // non-ASCII counts as lower
}

function classify(text, roles) {
  let previous = NONE;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const type = charType(code);
    let role = NONE;
    if (type === 2) {
      role = previous <= SEPARATOR ? HEAD : TAIL;
    } else if (type === 3) {
      role = HEAD;
      const next = text.charCodeAt(index + 1);
      if (previous === 3 && !(next >= 97 && next <= 122)) role = UC_TAIL;
    }
    // TEXT mode never marks separators; punctuation only affects HEAD/TAIL
    // classification above.
    roles[index] = role;
    previous = type;
  }
}

export function createFuzzyMatcher(rawPattern) {
  const pattern = String(rawPattern || '').slice(0, MAX_PATTERN);
  const patternLower = pattern.toLowerCase();
  const caseSensitive = pattern !== patternLower;
  const patternShort = patternLower.slice(0, 3);
  const patternRoles = new Uint8Array(pattern.length);
  classify(pattern, patternRoles);
  const scoreScale = pattern.length ? 1 / (6 * pattern.length) : 0;
  const offset = pattern.length + 1;
  const rowWidth = 2 * offset;
  const table = new Int32Array((MAX_INPUT + 1) * rowWidth);

  const cell = (row, column) => table[row * rowWidth + column];
  const setCell = (row, column, value) => { table[row * rowWidth + column] = value; };
  const scoreAt = (row, column, matched) => cell(row, column + matched * offset) >> 1;
  const bestLayer = (row, column) => scoreAt(row, column, 0) < scoreAt(row, column, 1) ? 1 : 0;

  function matches(candidateLower) {
    let matched = 0;
    for (let index = 0; index < candidateLower.length && matched < patternLower.length; index += 1) {
      if (candidateLower.charCodeAt(index) === patternLower.charCodeAt(matched)) matched += 1;
    }
    return matched === patternLower.length;
  }

  function computeScore(candidate, lower, roles) {
    for (let column = 0; column <= pattern.length; column += 1) {
      setCell(0, column, column === 0 ? 0 : MIN_SCORE * 2);
      setCell(0, offset + column, MIN_SCORE * 2);
    }
    let segmentsLeft = 1;
    let lastSegmentStart = 0;
    for (let index = 0; index < candidate.length; index += 1) {
      if (roles[index] === SEPARATOR) {
        segmentsLeft += 1;
        lastSegmentStart = index + 1;
      }
    }

    for (let row = 1; row <= candidate.length; row += 1) {
      const isHead = roles[row - 1] === HEAD;
      if (roles[row - 1] === SEPARATOR && segmentsLeft > 1) segmentsLeft -= 1;
      const segmentScore = segmentsLeft > 1 ? 0 : 1;
      const skipPenalty = row - 1 === lastSegmentStart ? 3 : 0;

      for (let column = 0; column <= pattern.length; column += 1) {
        const matchedColumn = offset + column;
        setCell(row, matchedColumn, MIN_SCORE * 2);
        if (segmentsLeft > 1 && column === pattern.length) {
          setCell(row, column, MIN_SCORE * 2);
          continue;
        }
        const cameFrom = bestLayer(row - 1, column);
        let skipScore = scoreAt(row - 1, column, cameFrom);
        if (column !== pattern.length) skipScore -= skipPenalty;
        setCell(row, column, (skipScore << 1) + cameFrom);

        if (column === 0 || lower.charCodeAt(row - 1) !== patternLower.charCodeAt(column - 1)) continue;

        let charScore = segmentScore;
        if (roles[row - 1] === TAIL && patternRoles[column - 1] === HEAD) {
          if (column > 1) continue;
          if (patternShort !== lower.slice(row - 1, row - 1 + patternShort.length)) continue;
          charScore -= 4;
        }
        if (candidate.charCodeAt(row - 1) === pattern.charCodeAt(column - 1) ||
            (isHead && (!caseSensitive || patternRoles[column - 1] === HEAD))) {
          charScore += 1;
        }

        for (let previousMatched = 0; previousMatched < 2; previousMatched += 1) {
          let score = scoreAt(row - 1, column - 1, previousMatched) + charScore;
          const wasMatched = previousMatched === 1;
          const consecutive = wasMatched || row - 1 === 0 || row - 1 === lastSegmentStart;
          if (consecutive || column - 1 === 0) score += 4;
          if (!wasMatched && (roles[row - 1] === TAIL || roles[row - 1] === UC_TAIL)) score -= 3;
          if (score > (cell(row, matchedColumn) >> 1)) {
            setCell(row, matchedColumn, (score << 1) + previousMatched);
          }
        }
      }
    }
    return scoreAt(candidate.length, pattern.length, bestLayer(candidate.length, pattern.length));
  }

  function isPoorMatch(length, roles) {
    if (pattern.length < 2) return false;
    let row = length;
    let column = pattern.length;
    let layer = bestLayer(row, column);
    let shortRuns = 0;
    let runLength = 0;
    while (row > 0) {
      const taken = layer === 1;
      layer = cell(row, column + layer * offset) & 1;
      if (taken) {
        runLength += 1;
        if (layer === 0 && runLength < 3 && roles[row - 1] === TAIL) {
          shortRuns += 1;
          if (shortRuns > 1) return true;
        }
        column -= 1;
      } else {
        runLength = 0;
      }
      row -= 1;
    }
    return false;
  }

  return {
    score(rawCandidate) {
      if (!pattern.length) return 1;
      let candidate = String(rawCandidate || '');
      if (candidate.length > MAX_INPUT) candidate = candidate.slice(0, MAX_INPUT);
      const lower = candidate.toLowerCase();
      if (!matches(lower)) return -1;
      const roles = new Uint8Array(candidate.length);
      classify(candidate, roles);
      const rawScore = computeScore(candidate, lower, roles);
      if (rawScore <= MIN_SCORE / 2 || isPoorMatch(candidate.length, roles)) return -1;
      if (pattern.length === candidate.length) return 1;
      return Math.min(1, Math.max(0, rawScore) * scoreScale);
    }
  };
}
