// String and comment tokens keep their braces as data rather than syntax.
// A trailing comment shares its line with code, so only whitespace may precede it.
export function foldingRanges(document) {
  const tokens = document?.tokens || [];
  const lines = String(document?.text || '').split(/\r?\n/);
  const ranges = [];
  const stack = [];
  let commentStart = null;
  let commentEnd = null;

  const isCommentLine = token => token.type === 'comment' &&
    !(lines[token.start.line]?.slice(0, token.start.character) || '').trim();

  const flushComments = () => {
    if (commentStart !== null && commentEnd > commentStart) {
      ranges.push({ startLine: commentStart, endLine: commentEnd, kind: 'comment' });
    }
    commentStart = null;
    commentEnd = null;
  };

  for (const token of tokens) {
    if (isCommentLine(token)) {
      if (commentEnd === null || token.start.line !== commentEnd + 1) {
        flushComments();
        commentStart = token.start.line;
      }
      commentEnd = token.start.line;
    } else if (commentEnd !== null && token.start.line >= commentEnd) {
      flushComments();
    }

    if (token.type !== 'punct') continue;
    if (token.value === '{') {
      stack.push(token);
    } else if (token.value === '}' && stack.length) {
      const opening = stack.pop();
      if (opening.start.line < token.start.line) {
        ranges.push({
          startLine: opening.start.line,
          endLine: token.start.line,
          kind: 'region'
        });
      }
    }
  }

  flushComments();
  return ranges.sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}
