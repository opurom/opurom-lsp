// Content-Length framing for JSON-RPC messages (Node builtins only).
const HEADER_END = '\r\n\r\n';

export function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

// Splits a byte stream into JSON-RPC messages. A frame that cannot be read
// reports the problem and keeps the stream alive: the reader never throws.
export function createFrameReader(onMessage, onError) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const headerEnd = buffer.indexOf(HEADER_END);
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('ascii');
        const match = /content-length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.subarray(headerEnd + HEADER_END.length);
          onError('frame header has no Content-Length', null);
          continue;
        }
        const length = Number(match[1]);
        const start = headerEnd + HEADER_END.length;
        if (buffer.length < start + length) return;
        const body = buffer.subarray(start, start + length).toString('utf8');
        buffer = buffer.subarray(start + length);
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch (error) {
          onError(`frame body is not valid JSON: ${error.message}`, null);
          continue;
        }
        onMessage(parsed, null);
      }
    }
  };
}
