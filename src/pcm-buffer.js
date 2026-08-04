const DEFAULT_MAX_PCM_BYTES = 16000 * 2 * 120;

function pcmBufferBytes(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  return total;
}

function pushPcmChunk(chunks, chunk, maxBytes = DEFAULT_MAX_PCM_BYTES) {
  if (!chunk || !chunk.length) return pcmBufferBytes(chunks);
  chunks.push(Buffer.from(chunk));
  let total = pcmBufferBytes(chunks);
  while (total > maxBytes && chunks.length > 1) {
    const dropped = chunks.shift();
    total -= dropped.length;
  }
  if (total > maxBytes && chunks.length === 1 && chunks[0].length > maxBytes) {
    chunks[0] = chunks[0].subarray(chunks[0].length - maxBytes);
    total = chunks[0].length;
  }
  return total;
}

function clearPcmBuffer(chunks) {
  chunks.length = 0;
}

module.exports = { DEFAULT_MAX_PCM_BYTES, pcmBufferBytes, pushPcmChunk, clearPcmBuffer };
