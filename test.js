const assert = require('assert');
const { preferH264 } = require('./sdp');

const sdp = ['v=0', 'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103', 'a=rtpmap:96 VP8/90000', 'a=rtpmap:102 H264/90000', 'a=rtpmap:103 H264/90000', ''].join('\r\n');
assert.strictEqual(preferH264(sdp).split('\r\n')[1], 'm=video 9 UDP/TLS/RTP/SAVPF 102 103 96 97');
assert.strictEqual(preferH264('v=0\r\nm=audio 9 X 111'), 'v=0\r\nm=audio 9 X 111');
console.log('ok');
