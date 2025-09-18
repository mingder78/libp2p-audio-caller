import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import * as pipe from 'it-pipe';
import { fromString as uint8FromString } from 'uint8arrays/from-string';
import { toString as uint8ToString } from 'uint8arrays/to-string';
import { peerIdFromString } from '@libp2p/peer-id';
import { base58btc } from 'multiformats/bases/base58'

const app = document.getElementById('app');
const status = document.getElementById('status');
const peersDiv = document.getElementById('peers');
const localAudio = document.getElementById('localAudio');
const remoteAudio = document.getElementById('remoteAudio');
const startBtn = document.getElementById('startAudio');
const connectBtn = document.getElementById('connect');
const remoteMaInput = document.getElementById('remoteMultiaddr');
const remotePeerInput = document.getElementById('remotePeerId');

let libp2p;
let localStream;
let peerConnection; // Underlying RTCPeerConnection for audio
const AUDIO_PROTOCOL = '/audio-chat/1.0.0';

// Status updater
function updateStatus(msg) {
  status.textContent = msg;
}

// Create libp2p node with WebRTC + Relay support
async function createNode() {
  libp2p = await createLibp2p({
    addresses: {
      listen: ['/webrtc', '/p2p-circuit'] // Listen for relayed WebRTC
    },
    transports: [
      webRTC({
        rtcConfiguration: {
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // STUN for NAT
        }
      }),
      webSockets(),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify()
    }
  });

  // Handle peer connections
  libp2p.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail.toString();
    updatePeers();
    updateStatus(`Connected to peer: ${peerId}`);
    // On connect, dial audio protocol
    dialAudioProtocol(peerId);
  });

  // Custom audio protocol handler (for signaling if needed; audio via RTC)
  await libp2p.handle(AUDIO_PROTOCOL, async ({ stream, connection }) => {
    // Here, you could exchange custom signals, but we use RTC directly
    pipe(
      stream,
      async function* (source) {
        for await (const msg of source) {
          console.log('Received audio signal:', uint8ToString(msg.slice(0, msg.length)));
          // e.g., Handle SDP/ICE if extending signaling
        }
      }
    );
  });

  await libp2p.start();
  updateStatus('libp2p Node Started. Local Peer ID: ' + libp2p.peerId.toString());
  updatePeers();
}

// Update peers list
function updatePeers() {
  peersDiv.innerHTML = 'Connected Peers: ' + Array.from(libp2p.getPeers()).map(p => p.toString()).join(', ');
}

// Start local audio capture
startBtn.addEventListener('click', async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localAudio.srcObject = localStream;
    updateStatus('Local audio started');
  } catch (err) {
    updateStatus('Error accessing audio: ' + err.message);
  }
});

// Dial relay and remote peer
connectBtn.addEventListener('click', async () => {
  const relayMaStr = remoteMaInput.value;
  const remotePeerStr = remotePeerInput.value;

  try {
  const peerId = peerIdFromString(remotePeerStr);
  console.log('Valid Peer ID:', peerId.toString());
  const peerId2 = peerIdFromString(remotePeerStr, { decode: base58btc })

console.log(peerId2.toString())
} catch (err) {
  console.error('Invalid Peer ID:', err);
}
  if (!relayMaStr || !remotePeerStr) {
    updateStatus('Enter relay multiaddr and remote peer ID');
    return;
  }

  try {
    // Dial remote peer via orelay (libp2p auto-reserves relay if needed)
    let remotePeerMultiAddress = relayMaStr + '/p2p-circuit/p2p/' + remotePeerStr
    console.log(remotePeerMultiAddress)
    await libp2p.dial(multiaddr(remotePeerMultiAddress));
    updateStatus('Dialing remote peer...');

    const relayMa = multiaddr(relayMaStr);
    await libp2p.dial(relayMa); // Dial relay for discovery
    updateStatus('Dialed relay');

    } catch (err) {
    updateStatus('Connection error: ' + err);
  }
});

// Dial audio protocol on connection (setup RTC for media)
async function dialAudioProtocol(peerIdStr) {
  if (!localStream) {
    updateStatus('Start local audio first');
    return;
  }

  try {
    // Access underlying WebRTC connection (libp2p exposes via connection.newStream)
    const connection = libp2p.connectionManager.get(peerIdStr); // Get existing conn
    if (!connection) throw new Error('No connection');

    // Create or get RTCPeerConnection (hybrid: use libp2p conn for signaling, RTC for media)
    // Note: In full libp2p, WebRTC transport uses internal RTC; here we create a separate one for audio
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Add local audio track
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    // Handle remote stream
    peerConnection.addEventListener('track', (event) => {
      remoteAudio.srcObject = event.streams[0];
      updateStatus('Remote audio connected');
    });

    // Signaling via libp2p stream (exchange SDP/ICE)
    const stream = await connection.newStream(AUDIO_PROTOCOL);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await pipe([uint8FromString(JSON.stringify(offer))], stream);

    // Receive remote SDP (simplified; in prod, loop for ICE candidates)
    const remoteDesc = await pipe(stream, async (source) => {
      for await (const chunk of source) {
        console.log(chunk.length)
        return JSON.parse(uint8ToString(chunk.slice(0, chunk.length)));
      }
    });
    await peerConnection.setRemoteDescription(remoteDesc);

    // Create answer and send back
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await pipe([uint8FromString(JSON.stringify(answer))], stream);

    updateStatus('Audio protocol dialed');
  } catch (err) {
    updateStatus('Audio setup error: ' + err.message);
  }
}

createNode();