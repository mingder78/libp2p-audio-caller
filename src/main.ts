import { createLibp2p } from 'libp2p';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { identify } from '@libp2p/identify';
import { multiaddr } from '@multiformats/multiaddr';
import * as pipe from 'it-pipe'; ``
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

/** --- helpers --- **/
function concatChunks(chunks: Uint8Array[]) {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

let libp2p;
let localStream;
let peerConnection; // Underlying RTCPeerConnection for audio
const AUDIO_PROTOCOL = '/audio-chat/1.0.0';

// Status updater
function updateStatus(msg) {
  status.textContent = msg;
}

// Create libp2p node with WebRTC + Relay support
async function main() {
  libp2p = await createLibp2p({
    addresses: {
      listen: ['/webrtc', '/p2p-circuit', '/p2p-circuit/webrtc'] // Listen for relayed WebRTC
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
      identify: identify(),
      relay: circuitRelayServer({
        reservations: {  // Configures reservation limits (default: unlimited for testing)
          maxReservations: 50,  // Max concurrent reservations
          maxReservationsPerPeer: 10,  // Per client
          reservationDuration: 300000,  // 5 minutes in ms (renewable)
          reservationTTL: 600000  // Total lifetime
        },
        connections: {  // Limits relayed connections
          maxIncoming: 100,
          maxOutgoing: 100,
          maxPerPeer: 5
        },
        // ACL: undefined  // No ACL = accepts reservations from any peer (key for "true" reservations)
        // For production: ACL: { allow: ['QmSpecificPeerID'] } to restrict
        metrics: { enabled: true }  // Optional: Enable Prometheus metrics
      })
    }
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

  console.log('✅ Caller Local PeerID:', libp2p.peerId.toString())
  await libp2p.start();
  updateStatus('libp2p Node Started. Local Peer ID: ' + libp2p.peerId.toString());
  updatePeers();

  // Handle peer connections
  // On new connection, setup track listener
  libp2p.addEventListener('peer:connect', (evt) => {
    console.log(evt)
    const peerId = evt.detail.toString();
    console.log('-----> 🔗 connected to', peerId)

    // WebRTC connections embed an RTCPeerConnection
    // we need to get it so we can add tracks, listen for tracks

    const rtcConn = (connection as any).peerConnection as RTCPeerConnection | undefined

    if (rtcConn) {
      // listen for remote audio
      rtcConn.addEventListener('track', (evt) => {
        const [remoteStream] = evt.streams
        if (!remoteStream) return
        const audioEl = document.createElement('audio')
        audioEl.srcObject = remoteStream
        audioEl.autoplay = true
        document.body.appendChild(audioEl)
        console.log('🎧 Received remote stream tracks')
      })
    } else {
      console.warn('⚠️ peer:connect but no RTCPeerConnection found on this connection')
    }
  })
}
// UI to dial
const input = document.createElement('input')
input.placeholder = 'Remote PeerId or Multiaddr'

const btn = document.createElement('button')
btn.textContent = 'Connect & send audio'

document.body.append(input, btn)

btn.onclick = async () => {
  const target = input.value.trim()
  if (!target) {
    console.warn('Enter a peer address/ID')
    return
  }

  console.log('📞 Dialing', target)
  console.log('➤before  Dial')
  const conn = await libp2p.dial(multiaddr(target))
  const rtcConn = conn.maConn.peerConnection || undefined
  console.log('➤ Dial success')

  if (!rtcConn) {
    console.warn('No RTCPeerConnection on dialed connection')
    return
  }
  console.log(rtcConn)

  // add local audio tracks


  // Add local audio tracks to RTCPeerConnection
  for (const track of localStream.getTracks()) {
    rtcConn.addTrack(track, localStream);
    console.log(`🎤 Added track: ${track.kind} (${track.id})`);
  }
  console.log('🎤 Local audio tracks added')

  console.log('➤ Dial success, audo done')

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
    let remotePeerMultiAddress = relayMaStr + '/p2p-circuit/webrtc/p2p/' + remotePeerStr
    console.log(remotePeerMultiAddress)
    input.value = remotePeerMultiAddress; // add for use another btn to dial for audio
    // await libp2p.dial(multiaddr(remotePeerMultiAddress));
    updateStatus('no Dialing remote peer...');

    const relayMa = multiaddr(relayMaStr);
    await libp2p.dial(relayMa); // Dial relay for discovery
    updateStatus('Dialed relay');

  } catch (err) {
    updateStatus('Connection error: ' + err);
  }
});

main();