// Moves H264 to the front of the video codec list: on Windows it is usually GPU-encoded, so 1080p60+ doesn't eat the CPU.
// Also tells Chrome to start H264 at 6 Mbps instead of ramping up from ~300 kbps (blurry first seconds).
function preferH264(sdp) {
  const lines = sdp.split('\r\n');
  const mi = lines.findIndex(l => l.startsWith('m=video'));
  if (mi < 0) return sdp;
  const pts = lines.filter(l => /^a=rtpmap:\d+ H264\//.test(l)).map(l => l.slice(9).split(' ')[0]);
  if (!pts.length) return sdp;
  const parts = lines[mi].split(' ');
  lines[mi] = [...parts.slice(0, 3), ...pts, ...parts.slice(3).filter(p => !pts.includes(p))].join(' ');
  return lines.map(l => {
    const pt = l.match(/^a=fmtp:(\d+) /)?.[1];
    return pt && pts.includes(pt) && !l.includes('x-google-start-bitrate') ? l + ';x-google-start-bitrate=6000' : l;
  }).join('\r\n');
}
if (typeof module !== 'undefined') module.exports = { preferH264 };
