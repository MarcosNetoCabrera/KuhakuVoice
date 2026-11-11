const assert = require('assert');
const { preferH264 } = require('./sdp');

const sdp = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103', 'a=rtpmap:96 VP8/90000', 'a=rtpmap:102 H264/90000', 'a=fmtp:102 profile-level-id=42e01f', 'a=fmtp:97 apt=96', 'a=rtpmap:103 H264/90000', ''].join('\r\n');
const out = preferH264(sdp).split('\r\n');
assert.strictEqual(out[1], 'm=video 9 UDP/TLS/RTP/SAVPF 102 103 96 97');
assert.strictEqual(out[4], 'a=fmtp:102 profile-level-id=42e01f;x-google-start-bitrate=6000');
assert.strictEqual(out[5], 'a=fmtp:97 apt=96'); // non-H264 untouched
assert.strictEqual(preferH264(preferH264(sdp)).split('\r\n')[4], out[4]); // idempotent
assert.strictEqual(preferH264('v=0\r\nm=audio 9 X 111'), 'v=0\r\nm=audio 9 X 111');
console.log('ok');
