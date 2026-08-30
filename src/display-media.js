function buildDisplayMediaStreams(source, includeAudio) {
  if (!source) return null;
  return includeAudio
    ? { video: source, audio: 'loopback' }
    : { video: source };
}

module.exports = { buildDisplayMediaStreams };
