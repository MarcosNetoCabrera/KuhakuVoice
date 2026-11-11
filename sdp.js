// Moves H264 to the front of the video codec list: on Windows it is usually GPU-encoded, so 1080p60+ doesn't eat the CPU.
function preferH264(sdp) {
  const lines = sdp.split('\r\n');
  const mi = lines.findIndex(l => l.startsWith('m=video'));
  if (mi < 0) return sdp;
  const pts = lines.filter(l => /^a=rtpmap:\d+ H264\//.test(l)).map(l => l.slice(9).split(' ')[0]);
  if (!pts.length) return sdp;
  const parts = lines[mi].split(' ');
  lines[mi] = [...parts.slice(0, 3), ...pts, ...parts.slice(3).filter(p => !pts.includes(p))].join(' ');
  return lines.join('\r\n');
}
if (typeof module !== 'undefined') module.exports = { preferH264 };
